/**
 * Control de precios para TODA respuesta redactada por la IA.
 * Un importe es válido solo si sale del catálogo o del entrenamiento del
 * vendedor; cualquier otro número de guaraníes es un precio inventado.
 */
type PriceOption = { id: string; label: string; quantity: number; price: number };
type PriceProduct = {
  id: string; price?: number | null; promo_price?: number | null;
  sales_copy?: string | null; description?: string | null; delivery_info?: string | null; ai_instructions?: string | null;
  product_prices?: PriceOption[] | null;
};
type TrainingEntry = { title?: string | null; content?: string | null };

const MONEY = /(?:₲|gs\.?|guaran[ií]es?)\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,7})(?!\d)|(?<![\d.,])([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,7})\s*(?:₲|gs\b\.?|guaran[ií]es?|mil\b)/gi;

/** Importes en guaraníes escritos en un texto («Gs. 99.000», «159.000 Gs», «20 mil»). */
export function moneyAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text ?? "").matchAll(MONEY)) {
    const raw = (m[1] ?? m[2] ?? "").replace(/\D/g, "");
    let value = Number(raw);
    if (/mil\b/i.test(m[0]) && value < 1000) value *= 1000;
    if (Number.isSafeInteger(value) && value >= 1000) out.push(value);
  }
  // «20 mil», «150 mil» sin separador.
  for (const m of String(text ?? "").matchAll(/\b([0-9]{1,3})\s*mil\b/gi)) out.push(Number(m[1]) * 1000);
  return out;
}

const SHIPPING = /\b(?:delivery|deliveri|env[ií]o|envios|flete|tsi|encomienda|transportadora|costo adicional|recargo)\b/i;

/** Costos de envío que el vendedor escribió (líneas que hablan de delivery/envío). */
function shippingFees(text: string): number[] {
  return sellerLines(text).filter(line => SHIPPING.test(line)).flatMap(moneyAmounts);
}

/** «Nunca inventar Gs. 30.000», «prohibido cobrar recargo»: montos que el vendedor PROHÍBE. */
const FORBIDDEN = /\b(?:nunca|jam[aá]s|prohibid[oa]s?|inventar|inventes|no (?:cobrar|cobres|sumar|sumes|agregar|agregues|decir|digas|ofrecer|ofrezcas))\b/i;

/** Frases del vendedor que afirman un importe (sin las que lo prohíben). */
function sellerLines(text: string): string[] {
  // «Gs. 30.000»: el punto de «Gs.» no corta la frase.
  return String(text ?? "").split(/\n|(?<=[;])\s+|(?<![Gg]s\.)(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¡¿•*-])/).filter(line => !FORBIDDEN.test(line));
}

/** Importes permitidos para este vendedor y esta conversación. */
export function allowedAmounts(args: {
  products: PriceProduct[];
  training: TrainingEntry[];
  customerTexts?: string[];
  facts?: number[];
}): Set<number> {
  const allowed = new Set<number>();
  const fees = new Set<number>();
  for (const entry of args.training) {
    const text = `${entry.title ?? ""}\n${entry.content ?? ""}`;
    for (const a of sellerLines(text).flatMap(moneyAmounts)) allowed.add(a); // dicho por el vendedor: vale tal cual
    for (const f of shippingFees(text)) fees.add(f);
  }
  for (const p of args.products) {
    const fields = [p.sales_copy, p.description, p.delivery_info, p.ai_instructions].map(t => t ?? "").join("\n");
    for (const a of sellerLines(fields).flatMap(moneyAmounts)) allowed.add(a);
    for (const f of shippingFees(fields)) fees.add(f);
    for (const o of p.product_prices ?? []) for (const f of shippingFees(o.label)) fees.add(f);
  }
  for (const p of args.products) {
    const own: number[] = [];
    for (const v of [p.price, p.promo_price]) if (Number(v) > 0) own.push(Math.round(Number(v)));
    const options = (p.product_prices ?? []).filter(o => Number(o.price) > 0);
    for (const o of options) {
      const price = Math.round(Number(o.price));
      own.push(price);
      // Varias unidades de una opción, solo si no existe una promo para esa cantidad.
      for (let k = 2; k <= 10; k++) {
        const qty = (Number(o.quantity) || 1) * k;
        if (!options.some(x => Number(x.quantity) === qty)) own.push(price * k);
      }
    }
    for (const v of own) {
      allowed.add(v);
      for (const f of fees) allowed.add(v + f); // precio + costo de envío del entrenamiento
    }
    // Ahorro real del MISMO producto («Ahorrás 37.000»): diferencia entre dos
    // opciones del catálogo, o promo frente a comprar esas unidades sueltas.
    const real = options.map(o => ({q: Number(o.quantity) || 1, p: Math.round(Number(o.price))}));
    const unit = real.find(o => o.q === 1)?.p;
    for (const x of real) for (const y of real) if (x.p > y.p) allowed.add(x.p - y.p);
    if (unit) for (const o of real) if (o.q > 1 && unit * o.q > o.p) allowed.add(unit * o.q - o.p);
  }
  for (const t of args.customerTexts ?? []) for (const a of moneyAmounts(t)) allowed.add(a);
  for (const a of args.facts ?? []) if (a > 0) allowed.add(Math.round(a));
  return allowed;
}

/** Importes de la respuesta que NO salen del catálogo ni del entrenamiento. */
export function inventedAmounts(reply: string, allowed: Set<number>): number[] {
  return [...new Set(moneyAmounts(reply))].filter(a => a >= 10000 && !allowed.has(a));
}

/** Lista de precios reales para pedirle a la IA que reescriba. */
export function realPriceList(products: PriceProduct[], productId: string | null | undefined): string {
  const list = (productId ? products.filter(p => p.id === productId) : products).slice(0, 8);
  return list.map(p => {
    const opts = (p.product_prices ?? []).filter(o => Number(o.price) > 0)
      .map(o => `${o.label} = Gs. ${Math.round(Number(o.price)).toLocaleString("es-PY")}`).join("; ");
    return opts || (Number(p.price) > 0 ? `Gs. ${Math.round(Number(p.price)).toLocaleString("es-PY")}` : "");
  }).filter(Boolean).join(" | ");
}

/** Último recurso: quitar solo las frases que tienen un importe inventado. */
export function dropInventedSentences(reply: string, allowed: Set<number>): string {
  // Separar frases sin cortar los importes («179.900» no es fin de frase).
  return reply.split("\n").map(line => line.split(/(?<![Gg]s\.)(?<=[.!?])\s+/)
      .filter(part => inventedAmounts(part, allowed).length === 0).join(" "))
    .filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
