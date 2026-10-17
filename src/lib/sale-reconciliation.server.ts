import type { AiContext, AiOrder } from "@/lib/ai.server";
import type { SaleState } from "@/lib/rule-sales.server";
import { verifiedCoverage, parseCoverage } from "@/lib/rule-sales.server";

const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

type ChatLine = { role: "user" | "assistant"; content: string };

/** Recupera hechos EXPLÍCITOS de los mensajes del pedido actual, sin inventar ciudad o nombre.
 * Nunca reabre una venta: el llamador debe usarlo únicamente si aún no hay venta cerrada.
 */
export function recoverSaleStateFromHistory(ctx: AiContext, previous: SaleState, history: ChatLine[]): SaleState {
  const result: SaleState = { ...previous };
  const coverage = parseCoverage(ctx.training);
  const product = ctx.products.find(p => p.id === result.productId || p.id === ctx.activeProductId);
  if (!product) return result;
  result.productId = product.id;
  const inputs = history.slice(-24);
  let lastQuestion = "";
  for (const item of inputs) {
    if (item.role === "assistant") { lastQuestion = normal(item.content); continue; }
    const value = item.content.trim();
    const n = normal(value);
    if (!n || /^\[(?:image|audio|document|video)/i.test(value)) continue;
    const hits = coverage.filter(c => [c.city, ...c.aliases].some(alias => {
      const a = normal(alias); return a.length >= 3 && new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i").test(n);
    }));
    if (hits.length === 1 && hits[0].active && (!result.cityVerified || !result.city)) {
      result.city = hits[0].city;
      result.department = hits[0].department;
      result.cityVerified = true;
      result.coverageStatus = "covered";
    }
    const variants = product.product_prices ?? [];
    if (!result.optionId && variants.length) {
      const matches = variants.filter(o => {
        const label = normal(o.label);
        const capacity = label.match(/\b(\d+)\s*(?:litros?|l|lts?)\b/);
        return capacity ? new RegExp(`\\b${capacity[1]}\\s*(?:litros?|l|lts?)\\b`).test(n) : (label.length >= 5 && n.includes(label));
      });
      if (matches.length === 1) result.optionId = matches[0].id;
    }
    if (!result.customerName && /(?:nombre|apellido|como te llamas|como te llam[aá]s)/.test(lastQuestion)) {
      const candidate = value.replace(/^(?:soy|me llamo|mi nombre es)\s+/i, "").trim();
      if (/^[\p{L}]+(?:[ '-]+[\p{L}]+){1,5}$/u.test(candidate) && !/\b(?:quiero|pedido|ciudad|central|gracias|entrega|litros|ubicacion|precio|hola)\b/i.test(normal(candidate))) result.customerName = candidate;
    }
    if (!result.street && /(?:direcci[oó]n|ubicaci[oó]n|domicilio|referencia|n[uú]mero de casa)/.test(lastQuestion) && !/^(?:si|sí|no|ok|dale)$/i.test(n) && value.length >= 6 && !hits.length) result.street = value;
    if (/\b(?:pago al recibir|contra entrega|contraentrega|pagare al recibir)\b/.test(n)) result.paymentMethod = "contraentrega";
  }
  if (result.cityVerified && result.city && result.department) {
    const matched = verifiedCoverage(result.city, result.department, coverage);
    if (!matched || !matched.active) { result.cityVerified = false; result.coverageStatus = "unknown"; }
    else if (!result.paymentMethod && /CONTRA ENTREGA/i.test(matched.method)) result.paymentMethod = "contraentrega";
  }
  if (result.optionId && !result.quantity) {
    const option = product.product_prices?.find(o => o.id === result.optionId);
    // Presentación de capacidad 3 L = 1 unidad, no tres unidades.
    if (option && /\b\d+\s*(?:litros?|l|lts?)\b/i.test(option.label)) result.quantity = 1;
  }
  return result;
}

/** Componer la orden usando datos verificados del ciclo actual, incluso cuando el modelo omite JSON. */
export function reconcileOrderWithSaleState(order: AiOrder | null, state: SaleState, training: AiContext["training"]): AiOrder | null {
  if (!order && !state.productId) return null;
  const next: AiOrder = { ...(order ?? {}) };
  const location = state.cityVerified && state.city && state.department
    ? verifiedCoverage(state.city, state.department, parseCoverage(training)) : null;
  if (location) { next.city = location.city; next.departamento = location.department; }
  if (state.customerName) next.customer_name = state.customerName;
  if (state.street && !next.street?.trim()) next.street = state.street;
  if (state.locationUrl && !next.street?.trim()) next.street = state.locationUrl;
  if (state.paymentMethod && !next.payment_method?.trim()) next.payment_method = state.paymentMethod;
  if (state.optionId && !next.product_price_id) next.product_price_id = state.optionId;
  if (state.quantity && (!next.quantity || next.quantity < 1)) next.quantity = state.quantity;
  return next;
}
