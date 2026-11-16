/**
 * Una opción que dice «2 unidades», «3 pares» o «Pack x2» con cantidad 1 está mal
 * cargada: el bot cobraría el precio del paquete por cada unidad (2 × 219.000).
 * Se usa la cantidad que dice el texto. Sin dependencias: navegador y servidor.
 */
const WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };

export function packQuantityFromLabel(label: unknown, quantity: unknown): number {
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  if (q !== 1) return q;
  const t = String(label ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const unit = "(?:unidad(?:es)?|unds?|u|uni|piezas?|pares?|packs?|paquetes?|cajas?|combos?|kits?|juegos?|sets?|pcs|plumeros?|frascos?|potes?)";
  const lead = t.match(new RegExp(`^(\\d{1,2}|dos|tres|cuatro|cinco|seis)\\s*(?:x\\s*)?${unit}\\b`));
  const packX = t.match(/\b(?:pack|combo|kit|promo)\s*(?:de\s*)?x?\s*(\d{1,2})\b/);
  const raw = lead?.[1] ?? packX?.[1];
  if (!raw) return 1;
  const n = WORDS[raw] ?? Number(raw);
  return Number.isInteger(n) && n >= 2 && n <= 50 ? n : 1;
}
