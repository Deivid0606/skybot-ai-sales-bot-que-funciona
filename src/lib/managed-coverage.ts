/**
 * Pestañas «Zonas de cobertura» y «Datos bancarios».
 * Lo que el vendedor carga ahí se convierte en entradas de entrenamiento
 * «oficiales» (categoría zonas_cobertura / datos_bancarios) que el bot usa en
 * lugar de la cobertura o los datos bancarios escritos a mano en el entrenamiento.
 * Sin filas cargadas, nada cambia: el bot sigue leyendo el entrenamiento.
 */
import { cityAliases, PY_CITIES } from "@/lib/py-cities";

export type CoverageMethod = "contraentrega" | "encomienda" | "sin_envio";
export type CoverageRow = {
  city: string; department: string; method: CoverageMethod;
  shipping_fee: number | null; address_required: boolean; note?: string | null;
};
export type BankAccount = {
  bank: string; holder: string; account_number?: string | null; alias?: string | null;
  document?: string | null; note?: string | null; active?: boolean;
};
type TrainingEntry = {
  title: string; content: string; category: string; priority: number;
  /** Versión corta que se manda a la IA (ahorra tokens); `content` es la que leen los controles. */
  prompt_content?: string | null;
  scope?: string | null; product_id?: string | null; keywords?: string[] | null; created_at?: string | null;
};

export const COVERAGE_CATEGORY = "zonas_cobertura";
export const BANK_CATEGORY = "datos_bancarios";

const gs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

/** Texto de la modalidad tal como lo verá la IA y los controles del bot. */
export function methodLabel(row: Pick<CoverageRow, "method" | "shipping_fee">): string {
  if (row.method === "contraentrega") {
    return row.shipping_fee && row.shipping_fee > 0
      ? `CONTRA ENTREGA, PAGO AL RECIBIR — DELIVERY ${gs(row.shipping_fee)}`
      : "ENVÍO GRATIS CONTRA ENTREGA, PAGO AL RECIBIR";
  }
  if (row.method === "encomienda") {
    return row.shipping_fee && row.shipping_fee > 0
      ? `ENCOMIENDA CON PAGO ANTICIPADO — COSTO DE ENVÍO ${gs(row.shipping_fee)}`
      : "ENCOMIENDA CON PAGO ANTICIPADO — COSTO DE ENVÍO A CONFIRMAR";
  }
  return "SIN ENVÍO";
}

/** Entrada de entrenamiento oficial con la cobertura de la pestaña (formato que lee el bot). */
export function coverageTrainingEntry(rows: CoverageRow[]): TrainingEntry | null {
  const useful = rows.filter(r => r.city && r.department);
  if (!useful.length) return null;
  const block = (r: CoverageRow) => [
    `📍 ${r.city}`,
    ...(cityAliases(r.city).length ? [`✅ ${[r.city, ...cityAliases(r.city)].join(", ")}`] : []),
    `DEPARTAMENTO: ${r.department}`,
    `COBERTURA: ${r.method === "contraentrega" ? "SÍ" : "NO"}`,
    `MODALIDAD: ${methodLabel(r)}`,
    `DIRECCIÓN_REQUERIDA: ${r.method === "contraentrega" && r.address_required ? "SÍ" : "NO"}`,
    ...(r.note?.trim() ? [`NOTA: ${r.note.trim()}`] : []),
  ].join("\n");
  const cod = useful.filter(r => r.method === "contraentrega");
  const others = useful.filter(r => r.method !== "contraentrega");
  const content = [
    "COBERTURA OFICIAL cargada por el vendedor en la pestaña «Zonas de cobertura».",
    "Reemplaza cualquier otra lista de ciudades del entrenamiento. Una ciudad que no figura aquí NO tiene envío.",
    "",
    "ZONAS CON COBERTURA:",
    ...cod.map(block),
    "",
    "ZONAS SIN COBERTURA:",
    ...others.map(block),
    "",
    "FIN DEL ENTRENAMIENTO DE COBERTURA",
  ].join("\n\n").replace(/\n{3,}/g, "\n\n");
  return { title: "Ciudades y cobertura (pestaña Zonas de cobertura)", content, prompt_content: coveragePromptSummary(useful), category: COVERAGE_CATEGORY,
    priority: 1000, scope: "global", product_id: null, keywords: [], created_at: null };
}

/** Resumen corto de la cobertura para la IA (una línea por ciudad con contraentrega). */
export function coveragePromptSummary(rows: CoverageRow[]): string {
  const key = (r: {city: string; department: string}) => `${r.city}|${r.department}`;
  const cod = rows.filter(r => r.method === "contraentrega");
  const enc = rows.filter(r => r.method === "encomienda");
  const set = new Set(rows.filter(r => r.method !== "sin_envio").map(key));
  const noShip = PY_CITIES.filter(c => !set.has(key(c)));
  const fee = (r: CoverageRow) => r.shipping_fee && r.shipping_fee > 0 ? gs(r.shipping_fee) : null;
  const lines = [
    "COBERTURA OFICIAL del vendedor (pestaña «Zonas de cobertura»). Reemplaza cualquier otra lista de ciudades del entrenamiento.",
    `CONTRAENTREGA, pago al recibir (${cod.length} ciudades):`,
    ...cod.map(r => `- ${r.city} (${r.department}): ${fee(r) ? `delivery ${fee(r)}` : "envío gratis"}${r.address_required ? "" : ", sin pedir dirección"}${r.note?.trim() ? `; ${r.note.trim()}` : ""}`),
  ];
  if (enc.length) {
    const withFee = enc.filter(fee);
    if (enc.length > 60 && noShip.length < enc.length) {
      lines.push(`ENCOMIENDA con pago anticipado: todas las demás ciudades del país (${enc.length}), costo de envío a confirmar${noShip.length ? `, EXCEPTO las que no tienen envío: ${noShip.map(c => c.city).join(", ")}` : ""}.`);
    } else {
      lines.push(`ENCOMIENDA con pago anticipado (costo de envío a confirmar): ${enc.map(r => r.city).join(", ")}.`);
      lines.push("SIN ENVÍO: cualquier otra ciudad que no figure arriba.");
    }
    if (withFee.length) lines.push(`Encomienda con costo fijo: ${withFee.map(r => `${r.city} ${fee(r)}`).join(", ")}.`);
  } else {
    lines.push("SIN ENVÍO: cualquier ciudad que no sea de contraentrega (no hay encomienda).");
  }
  return lines.join("\n");
}

/** Entrada oficial con los datos bancarios (solo para encomienda / pago anticipado). */
export function bankTrainingEntry(accounts: BankAccount[]): TrainingEntry | null {
  const active = accounts.filter(a => a.active !== false && a.bank?.trim() && a.holder?.trim());
  if (!active.length) return null;
  const lines = active.map((a, i) => [
    active.length > 1 ? `Cuenta ${i + 1}:` : "",
    `🏦 Banco: ${a.bank.trim()}`,
    `👤 Titular: ${a.holder.trim()}`,
    a.account_number?.trim() ? `🔢 Cuenta: ${a.account_number.trim()}` : "",
    a.alias?.trim() ? `🔑 Alias: ${a.alias.trim()}` : "",
    a.document?.trim() ? `🪪 CI/RUC: ${a.document.trim()}` : "",
    a.note?.trim() ? `📝 ${a.note.trim()}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
  const content = [
    "DATOS BANCARIOS AUTORIZADOS (cargados por el vendedor en la pestaña «Datos bancarios»; usar SOLO en encomienda o pago anticipado, nunca en contraentrega):",
    lines,
  ].join("\n");
  return { title: "Datos bancarios (pestaña Datos bancarios)", content, category: BANK_CATEGORY,
    priority: 1000, scope: "global", product_id: null, keywords: [], created_at: null };
}

export function hasManagedCoverage(training: { category?: string | null }[]): boolean {
  return training.some(t => t.category === COVERAGE_CATEGORY);
}
