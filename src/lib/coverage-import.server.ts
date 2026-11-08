/**
 * «Importar desde mi entrenamiento»: propone la tabla de Zonas de cobertura a
 * partir de lo que el vendedor ya escribió. No guarda nada: el vendedor revisa
 * y toca «Guardar».
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseCoverage, sellerAllowsNationwideAdvance } from "@/lib/rule-sales.server";
import { findParaguayPlace, findPyCity } from "@/lib/py-cities";
import { moneyAmounts } from "@/lib/price-guard.server";
import type { CoverageMethod, CoverageRow } from "@/lib/managed-coverage";

export type CoverageImport = {
  rows: CoverageRow[];
  restOfCountry: "encomienda" | "sin_envio" | null;
  source: "entrenamiento" | "ia" | "ninguno";
  unmatched: string[];
};

function toMethod(text: string, active: boolean): CoverageMethod {
  const t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (active && /contra ?entrega|pago al recibir|al recibir/.test(t)) return "contraentrega";
  if (/encomienda|anticipad|transferencia|transportadora|tsi/.test(t)) return "encomienda";
  if (/sin envio|no (?:enviamos|llegamos|hay envio)/.test(t)) return "sin_envio";
  return active ? "contraentrega" : "sin_envio";
}

function canonical(city: string, department: string) {
  return findParaguayPlace(`${city} ${department}`) ?? findPyCity(city) ?? findParaguayPlace(city);
}

export async function importCoverageFromTraining(workspaceId: string): Promise<CoverageImport> {
  const { data, error } = await supabaseAdmin.from("training_entries")
    .select("title, content, category, priority, scope, product_id, keywords, created_at")
    .eq("workspace_id", workspaceId).eq("is_active", true);
  if (error) throw error;
  const training = (data ?? []) as any[];
  const nationwide = sellerAllowsNationwideAdvance(training);
  const unmatched: string[] = [];
  const byKey = new Map<string, CoverageRow>();
  const add = (city: string, department: string, method: CoverageMethod, fee: number | null, addressRequired = true) => {
    const place = canonical(city, department);
    if (!place) { if (!unmatched.includes(city)) unmatched.push(city); return; }
    const key = `${place.city}|${place.department}`;
    const prev = byKey.get(key);
    // Si una ciudad aparece dos veces, gana la contraentrega.
    if (prev && prev.method === "contraentrega") return;
    byKey.set(key, { city: place.city, department: place.department, method, shipping_fee: fee, address_required: addressRequired });
  };

  // 1) Cobertura escrita con el formato que ya entiende el bot.
  for (const c of parseCoverage(training)) {
    const fee = moneyAmounts(c.method)[0] ?? null;
    add(c.city, c.department, toMethod(c.method, c.active), /gratis/i.test(c.method) ? 0 : fee, c.addressRequired);
  }
  if (byKey.size) {
    return { rows: [...byKey.values()], restOfCountry: nationwide ? "encomienda" : null, source: "entrenamiento", unmatched };
  }

  // 2) Cobertura escrita a mano en cualquier formato: la IA la lee UNA vez.
  const relevant = training.filter(t => /cobertura|ciudad|env[ií]o|delivery|encomienda|zona/i.test(`${t.title}\n${t.content}`))
    .map(t => `### ${t.title}\n${t.content}`).join("\n\n").slice(0, 60000);
  if (!relevant.trim()) return { rows: [], restOfCountry: nationwide ? "encomienda" : null, source: "ninguno", unmatched };
  const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
  const { callJson } = await import("@/lib/ai-extract.server");
  const ctx = await buildWorkspaceAiContext(supabaseAdmin, workspaceId, [], null);
  const system = `Leés el entrenamiento de una tienda de Paraguay y extraés SOLO su cobertura de envíos tal como la escribió el vendedor. No inventes ciudades.
Devolvé SOLO JSON: {"ciudades":[{"ciudad":"","departamento":"","modalidad":"contraentrega|encomienda|sin_envio","costo":null}],"resto_del_pais":"encomienda|sin_envio|null"}
- contraentrega: ciudades donde el cliente paga al recibir (delivery propio).
- encomienda: ciudades con envío por transportadora/encomienda y pago anticipado.
- sin_envio: ciudades que el vendedor dice explícitamente que no tienen envío.
- costo: número en guaraníes del delivery de ESA ciudad si el vendedor lo escribió (0 si dice gratis), si no null.
- resto_del_pais: qué pasa con las ciudades que no nombró ("encomienda" si dice que envía a todo el país/interior por encomienda).
Usá los nombres oficiales de las ciudades (ej. «CDE» → «Ciudad del Este»).`;
  const raw = await callJson(ctx, system, relevant, 4000);
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1)) as {
    ciudades?: Array<{ ciudad?: string; departamento?: string; modalidad?: string; costo?: number | null }>;
    resto_del_pais?: string | null;
  };
  for (const c of parsed.ciudades ?? []) {
    const m = String(c.modalidad ?? "");
    const method: CoverageMethod = m === "contraentrega" || m === "encomienda" || m === "sin_envio" ? m : "sin_envio";
    const fee = c.costo == null || !Number.isFinite(Number(c.costo)) ? null : Math.max(0, Math.round(Number(c.costo)));
    add(String(c.ciudad ?? ""), String(c.departamento ?? ""), method, fee);
  }
  const rest = parsed.resto_del_pais === "encomienda" || parsed.resto_del_pais === "sin_envio" ? parsed.resto_del_pais : null;
  return { rows: [...byKey.values()], restOfCountry: rest ?? (nationwide ? "encomienda" : null), source: "ia", unmatched };
}
