/**
 * Memoria del cliente que vuelve: sus compras anteriores en ESTA tienda.
 * La IA la usa para atenderlo como una persona que lo recuerda («¿Te lo mando
 * a la misma dirección de la vez pasada?»). Los datos solo se reutilizan si el
 * cliente lo confirma; nunca se cargan en silencio.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AiContext } from "@/lib/ai.server";
import { declaredCityFromTexts, applyDeclaredCity, normalizeNoShipping, type SaleState } from "@/lib/rule-sales.server";
import { isValidCustomerName, isValidDeliveryAddress } from "@/lib/sale-reconciliation.server";

export type PastOrder = {
  name: string | null; city: string | null; department: string | null; street: string | null;
  product: string | null; total: number; date: string; payment: string | null;
};
export type CustomerMemory = { orders: number; last: PastOrder | null; products: string[] };

export async function loadCustomerMemory(workspaceId: string, contactId: string | null, phone: string | null): Promise<CustomerMemory | null> {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!contactId && digits.length < 8) return null;
  let query = (supabaseAdmin as any).from("orders")
    .select("customer_name, city, departamento, street, product_title, total, created_at, payment_method, status")
    .eq("workspace_id", workspaceId).neq("status", "cancelado").order("created_at", { ascending: false }).limit(5);
  query = contactId ? query.or(`contact_id.eq.${contactId}${digits.length >= 8 ? `,phone.eq.${digits}` : ""}`) : query.eq("phone", digits);
  const { data, error } = await query;
  if (error || !data?.length) return null;
  const rows = data as any[];
  const first = rows[0];
  return {
    orders: rows.length,
    last: {
      name: first.customer_name ?? null, city: first.city ?? null, department: first.departamento ?? null,
      street: first.street ?? null, product: first.product_title ?? null, total: Number(first.total) || 0,
      date: String(first.created_at ?? ""), payment: first.payment_method ?? null,
    },
    products: [...new Set(rows.map(r => String(r.product_title ?? "").trim()).filter(Boolean))].slice(0, 4),
  };
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "numeric", month: "numeric" }).format(d);
};

/** Instrucción para la IA: quién es el cliente y qué compró antes. */
export function customerMemoryInstruction(memory: CustomerMemory | null, state: SaleState): string {
  if (!memory?.last) return "";
  const l = memory.last;
  const address = isValidDeliveryAddress(l.street) && !/^https?:/i.test(String(l.street)) ? l.street : (l.street ? "ubicación por GPS" : null);
  const missing = [
    !isValidCustomerName(state.customerName) && isValidCustomerName(l.name) ? "nombre" : null,
    !state.cityVerified && l.city ? "ciudad" : null,
    !(state.street || state.locationUrl) && address ? "dirección" : null,
  ].filter(Boolean);
  return [
    `\nCLIENTE QUE YA NOS COMPRÓ (${memory.orders === 1 ? "1 compra" : `${memory.orders} compras`}; tratalo como alguien conocido, con calidez y sin exagerar):`,
    `- Última compra${fmtDate(l.date) ? ` (${fmtDate(l.date)})` : ""}: ${l.product ?? "un producto"}, a nombre de ${l.name ?? "-"}, en ${[l.city, l.department].filter(Boolean).join(", ") || "-"}${address ? `, ${address}` : ""}.`,
    memory.products.length > 1 ? `- También compró: ${memory.products.slice(1).join(", ")}.` : "",
    missing.length
      ? `- En ESTA compra todavía faltan: ${missing.join(", ")}. Cuando toque pedirlos, ofrecé usar los de la vez pasada en UNA pregunta (ej.: «¿Te lo mandamos de nuevo a ${l.city ?? "la misma ciudad"}${address ? ", a la misma dirección" : ""} y a nombre de ${l.name ?? "la misma persona"}?»). Si dice que sí, el sistema los completa; si cambia algo, usá lo nuevo.`
      : "- Ya tenés los datos de esta compra: no le pidas los de antes.",
    "- No le digas que «tenemos sus datos guardados»: hablale natural, como quien lo recuerda.",
  ].filter(Boolean).join("\n");
}

const OFFERED = /\b(?:misma|mismo|mismos)\s+(?:direcci[oó]n|datos|lugar|ciudad|nombre)|\bla\s+vez\s+pasada\b|\bcomo\s+la\s+(?:[uú]ltima|otra)\s+vez\b|\bde\s+nuevo\s+a\b/i;
const AFFIRM = /^\s*(?:s[ií]+|sii+|dale|ok|okey|okay|claro|exacto|correcto|perfecto|as[ií]\s+es|la\s+misma|el\s+mismo|igual|lo\s+mismo|mismo|misma|s[ií],?\s+(?:la|el|lo)\s+mism[oa])\b/i;

/**
 * El bot ofreció usar los datos de la vez pasada y el cliente dijo que sí:
 * se completan nombre, ciudad (verificada con la cobertura) y dirección que falten.
 */
export function applyRememberedData(state: SaleState, memory: CustomerMemory | null, lastBotText: string, customerText: string,
  training: AiContext["training"]): string[] {
  const l = memory?.last;
  if (!l || !OFFERED.test(lastBotText) || !AFFIRM.test(customerText) || /\bno\b/i.test(customerText)) return [];
  const applied: string[] = [];
  if (!isValidCustomerName(state.customerName) && isValidCustomerName(l.name)) { state.customerName = l.name!.trim(); applied.push("nombre"); }
  if (!state.cityVerified && l.city) {
    const hit = declaredCityFromTexts(training, [`${l.city}${l.department ? ` ${l.department}` : ""}`]) ?? declaredCityFromTexts(training, [l.city]);
    if (hit) { applyDeclaredCity(state, hit, training); normalizeNoShipping(state, training); if (state.cityVerified) applied.push("ciudad"); }
  }
  const sameCity = state.city && l.city && state.city.toLowerCase() === l.city.toLowerCase();
  if (sameCity && !state.street && !state.locationUrl && l.street) {
    if (/^https?:\/\//i.test(l.street)) { state.locationUrl = l.street; applied.push("ubicación"); }
    else if (isValidDeliveryAddress(l.street)) { state.street = l.street; applied.push("dirección"); }
  }
  return applied;
}
