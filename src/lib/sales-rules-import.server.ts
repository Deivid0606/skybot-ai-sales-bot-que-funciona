/**
 * «Completar con mi entrenamiento»: la IA lee lo que el vendedor ya escribió y
 * propone las fichas. No guarda nada: el vendedor revisa y toca «Guardar».
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeSalesRules, type SalesRules } from "@/lib/sales-rules";
import { sellerRequiresEncomiendaCi } from "@/lib/rule-sales.server";

export async function suggestSalesRulesFromTraining(workspaceId: string): Promise<{ rules: SalesRules; source: "ia" | "ninguno" }> {
  const { data, error } = await supabaseAdmin.from("training_entries")
    .select("title, content, category, priority").eq("workspace_id", workspaceId).eq("is_active", true);
  if (error) throw error;
  const training = (data ?? []) as any[];
  const text = training.map(t => `### ${t.title}\n${t.content}`).join("\n\n").slice(0, 60000);
  if (!text.trim()) return { rules: normalizeSalesRules({}), source: "ninguno" };
  const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
  const { callJson } = await import("@/lib/ai-extract.server");
  const ctx = await buildWorkspaceAiContext(supabaseAdmin, workspaceId, [], null);
  const system = `Leés el entrenamiento escrito por una tienda de Paraguay y completás sus REGLAS tal como las escribió el vendedor. No inventes: si el entrenamiento no lo dice, dejá el valor por defecto indicado.
Devolvé SOLO JSON con esta forma:
{"invoice":{"enabled":false,"pending":false},"card":{"enabled":false,"link":""},"qr":{"enabled":false},"encomienda_ci":{"enabled":false},"catalog_on_greeting":{"enabled":false},"pickup":{"enabled":false,"address":"","hours":""},"store_location":"","warranty":{"enabled":false,"days":null,"note":""},"discounts":{"enabled":false,"max_percent":null},"wholesale":{"enabled":false,"min_qty":null,"note":""},"not_sold_message":"","human_handoff":{"enabled":false,"phone":"","when":""}}
- invoice.enabled: true si dice que emite factura legal. Si dice que todavía no está confirmado o que se consulta, enabled false y "pending": true.
- card: true si acepta tarjeta de crédito; link solo si escribió un link de pago real.
- qr: true si acepta pago con QR.
- encomienda_ci: true si exige la cédula del destinatario en encomienda.
- catalog_on_greeting: true si manda el catálogo cuando el cliente saluda.
- pickup: true solo si dice que se puede retirar en un local; address y hours tal cual.
- store_location: la respuesta a «¿de dónde son?» en una frase corta (ej. «Somos una tienda online de Asunción, Paraguay»).
- warranty: true si ofrece cambios o garantía; days si lo dice.
- discounts: true solo si permite descuentos fuera del catálogo; max_percent si lo dice.
- wholesale: true si vende por mayor; min_qty si lo dice.
- not_sold_message: el mensaje para productos que no venden, en 1 o 2 frases, sin el link del catálogo.
- human_handoff: true si dice que se deriva a una persona; phone y cuándo.`;
  const raw = await callJson(ctx, system, text, 1500);
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
  const rules = normalizeSalesRules(parsed);
  // La cédula de encomienda la decide el mismo control que ya usa el bot.
  rules.encomienda_ci.enabled = rules.encomienda_ci.enabled || sellerRequiresEncomiendaCi(training);
  return { rules, source: "ia" };
}
