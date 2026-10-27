import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiContext } from "./ai.server";
import { extractRecipientCiFromCustomerText, isEncomiendaAdvanceOrder, isValidRecipientCi, sellerRequiresEncomiendaCi } from "./rule-sales.server";

const CI_LABEL = "C.I. destinatario encomienda:";
const CI_NOTE = /(?:^|\s*\|\s*)C\.I\. destinatario encomienda:\s*([0-9]{4,9})(?=\s*\||$)/i;
export const RECIPIENT_CI_QUESTION = "🪪 Para completar los datos de la encomienda, ¿me pasás el número de cédula del destinatario?";

export function storedRecipientCi(observations: unknown): string | null {
  return String(observations ?? "").match(CI_NOTE)?.[1] ?? null;
}

export function shouldAskPostSaleCi(training: AiContext["training"], order: {
  city?: unknown; departamento?: unknown; payment_method?: unknown; recipient_ci?: unknown;
}, observations: unknown): boolean {
  return sellerRequiresEncomiendaCi(training) &&
    isEncomiendaAdvanceOrder(training, order.city, order.departamento, order.payment_method) &&
    !isValidRecipientCi(order.recipient_ci) && !storedRecipientCi(observations);
}

export function mergeRecipientCiObservation(observations: unknown, ci: string): string {
  if (!isValidRecipientCi(ci)) throw new Error("Cédula inválida");
  const retained = String(observations ?? "").split(/\s*\|\s*/)
    .filter(part => part.trim() && !/^C\.I\. destinatario encomienda:/i.test(part.trim()));
  return [...retained, `${CI_LABEL} ${ci.replace(/\D/g, "")}`].join(" | ");
}

/** Solo el mensaje actual del cliente; nunca OCR ni respuestas generadas por IA. */
export async function handlePostSaleRecipientCi(args: {
  client: SupabaseClient;
  workspaceId: string;
  conversationId: string;
  training: AiContext["training"];
  customerText: string;
}): Promise<{ reply: string; orderId: string | null } | null> {
  const { client, workspaceId, conversationId, training, customerText } = args;
  if (!sellerRequiresEncomiendaCi(training)) return null;
  const text = customerText.trim();
  if (!text || /^\s*(?:\[(?:imagen|image|documento|document|audio)\]|COMPROBANTE)/i.test(text)) return null;
  const { data: order, error } = await client.from("orders")
    .select("id,order_number,city,departamento,payment_method,observations,created_at,status")
    .eq("workspace_id", workspaceId).eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!order || order.status === "cancelado" || !isEncomiendaAdvanceOrder(training, order.city, order.departamento, order.payment_method)) return null;
  const { data: lastOutbound, error: historyError } = await client.from("messages")
    .select("body").eq("workspace_id", workspaceId).eq("conversation_id", conversationId)
    .eq("direction", "outbound").eq("status", "sent").gte("created_at", order.created_at)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (historyError) throw historyError;
  const awaitingCi = /(?:me pas[aá]s|me confirm[aá]s|indic[aá]s|envi[aá]s)[^?\n]{0,100}c[eé]dula[^?\n]{0,60}destinatario/i.test(String(lastOutbound?.body ?? ""));
  const explicit = /(?:\bc[eé]dula\b|\bsedula\b|\bc\.?\s*i\.?(?=\s|[:=#-]|\d|$))/i.test(text);
  if (!explicit && !(awaitingCi && /^[0-9oO.\s-]+$/.test(text))) return null;
  const ci = extractRecipientCiFromCustomerText(text, awaitingCi);
  if (!ci) return { reply: "🪪 ¿Me confirmás el número de cédula del destinatario usando solo números, sin letras? Tu pedido ya está confirmado. 😊", orderId: order.id };
  let current: string | null = order.observations;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (storedRecipientCi(current) === ci) return { reply: "😊 La cédula ya está guardada en las observaciones de tu pedido confirmado. ¡Gracias!", orderId: order.id };
    let update = client.from("orders").update({ observations: mergeRecipientCiObservation(current, ci) })
      .eq("workspace_id", workspaceId).eq("conversation_id", conversationId).eq("id", order.id);
    update = current === null ? update.is("observations", null) : update.eq("observations", current);
    const { data: saved, error: saveError } = await update.select("id,observations").maybeSingle();
    if (saveError) throw saveError;
    if (saved && storedRecipientCi(saved.observations) === ci) return { reply: "😊 ¡Gracias! Agregué la cédula a las observaciones de tu pedido confirmado.", orderId: order.id };
    const { data: fresh, error: readError } = await client.from("orders").select("observations")
      .eq("workspace_id", workspaceId).eq("conversation_id", conversationId).eq("id", order.id).maybeSingle();
    if (readError) throw readError;
    if (!fresh) break;
    current = fresh.observations;
  }
  return { reply: "Tu pedido sigue confirmado. No pude guardar la cédula todavía; un asesor podrá revisar ese dato. 🙏", orderId: order.id };
}
