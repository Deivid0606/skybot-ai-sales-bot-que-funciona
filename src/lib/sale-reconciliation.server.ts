import type { AiContext, AiOrder } from "@/lib/ai.server";
import type { SaleState } from "@/lib/rule-sales.server";
import { verifiedCoverage, parseCoverage } from "@/lib/rule-sales.server";

type ChatLine = { role: "user" | "assistant"; content: string };
const normal = (s: string) => String(s ?? "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const exactToken = (s: string, token: string) => {
  const a = normal(token);
  if (a.length < 3) return false;
  return (` ${normal(s).replace(/[^a-z0-9 ]/g, " ")} `).includes(` ${a.replace(/[^a-z0-9 ]/g, " ")} `);
};
const validName = (raw: string): string | null => {
  const name = raw.replace(/^(?:soy|me llamo|mi nombre es|nombre(?: y apellido)?\s*:)\s*/i, "").trim();
  if (!/^[\p{L}]+(?:[ '-]+[\p{L}]+){1,5}$/u.test(name)) return null;
  if (/\b(?:quiero|pedido|ciudad|central|gracias|entrega|litros|ubicacion|precio|hola|de|para|cerca|calle)\b/.test(normal(name))) return null;
  return name;
};
const isCityReply = (value: string, lastQuestion: string) => {
  const n = normal(value);
  return /(?:ciudad|de donde sos|donde estas|donde vivis|cobertura|departamento)/.test(lastQuestion) ||
    /^(?:soy de|de|para|ciudad(?: de)?|vivo en)\b/.test(n) || n.split(" ").length <= 3;
};

/** Recupera hechos expresos sin reemplazar datos con respuestas vacías de la IA.
 * Llamar solamente para el ciclo de compra activo; nunca para pedidos ya cerrados.
 */
export function recoverSaleStateFromHistory(ctx: AiContext, previous: SaleState, history: ChatLine[]): SaleState {
  const state: SaleState = { ...previous };
  const coverage = parseCoverage(ctx.training);
  if (!coverage.length) console.warn("[BOT_SKY_COVERAGE] No hay ciudades parseables en el entrenamiento activo del workspace");
  const product = ctx.products.find(p => p.id === state.productId || p.id === ctx.activeProductId);
  if (product) state.productId = product.id;
  // No salir si aún falta productId: el cliente puede haber indicado ciudad y nombre.
  let lastQuestion = "";
  for (const item of history.slice(-32)) {
    if (item.role === "assistant") { lastQuestion = normal(item.content); continue; }
    const raw = String(item.content ?? "").trim();
    const n = normal(raw);
    if (!n || /^\[(?:image|audio|document|video)/i.test(raw)) continue;
    const hits = coverage.filter(c => [c.city, ...c.aliases].some(alias => exactToken(raw, alias)));
    const uniqueHits = hits.filter((c,i)=>hits.findIndex(x=>normal(x.city)===normal(c.city) && normal(x.department)===normal(c.department))===i);
    // La última ciudad explícita del cliente gana; no confundir referencias de dirección.
    if (uniqueHits.length === 1 && isCityReply(raw, lastQuestion) && !/(?:calle|esquina|casi|referencia|barrio)/.test(n)) {
      const found = uniqueHits[0];
      const previousLocation = state.city && state.department
        ? verifiedCoverage(state.city, state.department, coverage) : null;
      const explicitlyUpdated = !previousLocation || normal(previousLocation.city) !== normal(found.city);
      if (!state.cityVerified || explicitlyUpdated || normal(state.city ?? "") === normal(found.city)) {
        state.city = found.city;
        state.department = found.department;
        state.cityVerified = true;
        state.coverageStatus = found.active ? "covered" : "uncovered";
      }
    }
    if (product && !state.optionId) {
      const matches = (product.product_prices ?? []).filter(o => {
        const label = normal(o.label);
        const capacity = label.match(/\b(\d+)\s*(?:litros?|l|lts?)\b/);
        return capacity ? new RegExp(`\\b${capacity[1]}\\s*(?:litros?|l|lts?)\\b`).test(n)
          : (label.length >= 5 && exactToken(raw, label));
      });
      if (matches.length === 1) state.optionId = matches[0].id;
    }
    if (!state.customerName && (/(?:nombre|apellido|como te llamas)/.test(lastQuestion) || /^(?:me llamo|mi nombre es)\s+/i.test(raw))) {
      const candidate = validName(raw);
      if (candidate) state.customerName = candidate;
    }
    if (!state.street && /(?:direccion|ubicacion|domicilio|referencia|numero de casa)/.test(lastQuestion)
      && !/^(?:si|no|ok|dale)$/.test(n) && raw.length >= 6 && uniqueHits.length === 0) state.street = raw;
    if (/\b(?:pago al recibir|contra entrega|contraentrega|pagare al recibir)\b/.test(n)) state.paymentMethod = "contraentrega";
    else if (/\b(?:pago anticipado|voy a transferir|pago por transferencia)\b/.test(n)) state.paymentMethod = "anticipado";
  }
  if (state.city && state.department) {
    const location = verifiedCoverage(state.city, state.department, coverage);
    if (location) {
      state.city = location.city; state.department = location.department;
      state.cityVerified = true; state.coverageStatus = location.active ? "covered" : "uncovered";
      if (!state.paymentMethod && location.active && /CONTRA ENTREGA/i.test(location.method))
        state.paymentMethod = "contraentrega";
    } else { state.cityVerified = false; state.coverageStatus = "unknown"; }
  }
  if (product && state.optionId && !state.quantity) {
    const option = product.product_prices?.find(o => o.id === state.optionId);
    if (option && /\b\d+\s*(?:litros?|l|lts?)\b/i.test(option.label)) state.quantity = 1;
  }
  return state;
}

/** Estado técnico verificado prevalece sobre valores incompletos del modelo. */
export function reconcileOrderWithSaleState(order: AiOrder | null, state: SaleState, training: AiContext["training"]): AiOrder | null {
  if (!order && !state.productId) return null;
  const next: AiOrder = { ...(order ?? {}) };
  const location = state.cityVerified && state.city && state.department
    ? verifiedCoverage(state.city, state.department, parseCoverage(training)) : null;
  if (location) { next.city = location.city; next.departamento = location.department; }
  if (state.customerName) next.customer_name = state.customerName;
  if (state.street?.trim()) next.street = state.street;
  else if (state.locationUrl && !next.street?.trim()) next.street = state.locationUrl;
  if (state.paymentMethod) next.payment_method = state.paymentMethod;
  if (state.optionId) next.product_price_id = state.optionId;
  if (state.quantity && state.quantity > 0) next.quantity = state.quantity;
  // Una variante de capacidad 3 litros equivale a 1 unidad, no a 3 promociones.
  if (state.optionId && next.quantity === 1 && (!next.promo_quantity || next.promo_quantity < 1)) next.promo_quantity = 1;
  return next;
}


/** Próximo dato faltante, usando el estado VERIFICADO del pedido y el catálogo real.
 * No confirma ventas ni infiere cobertura; solo se utiliza durante checkout activo.
 */
export function nextVerifiedSaleQuestion(ctx: AiContext, state: SaleState): string | null {
  const product = ctx.products.find(p => p.id === state.productId || p.id === ctx.activeProductId);
  if (!product) return null;
  const coverage = parseCoverage(ctx.training);
  const place = state.city && state.department
    ? verifiedCoverage(state.city, state.department, coverage) : null;
  const options = [...(product.product_prices ?? [])].filter(o => o.price > 0)
    .sort((a,b) => a.sort_order - b.sort_order);
  // Una variante de capacidad es una elección obligatoria. No escoger por defecto.
  const selected = options.find(o => o.id === state.optionId);
  if (options.length > 1 && !selected && !state.cartLines?.length) {
    return `😊 ¿Cuál tamaño de *${product.name}* preferís? ${options.map(o => `${o.label} (${Math.round(o.price).toLocaleString("es-PY")} Gs.)`).join(" · ")}`;
  }
  if (!state.customerName?.trim()) return "😊 ¿Me indicás tu nombre y apellido para el pedido?";
  if (!place || !state.cityVerified) return "📍 ¿De qué ciudad sos para verificar la entrega?";
  if (!place.active && !/ENCOMIENDA|ANTICIPADO|TRANSFERENCIA/i.test(place.method)) {
    return "📦 No tenemos entrega habilitada para esa ciudad. ¿Querés consultar otra localidad?";
  }
  if (!state.quantity || state.quantity < 1) {
    if (selected && /\b\d+\s*(?:litros?|l|lts?)\b/i.test(selected.label)) {
      return "📦 ¿Cuántas unidades de esa presentación querés llevar?";
    }
    return "📦 ¿Cuántas unidades querés llevar?";
  }
  if (place.addressRequired && !state.street?.trim() && !state.locationUrl?.trim())
    return "🏠 ¿Me pasás tu dirección o ubicación para la entrega?";
  if (!state.paymentMethod?.trim()) {
    if (place.active && /CONTRA ENTREGA/i.test(place.method))
      return "💵 ¿Confirmás que vas a pagar al recibir?";
    return "💳 ¿Qué modalidad de pago habilitada preferís?";
  }
  if (/anticip|transfer|deposit|giro/i.test(state.paymentMethod) && !state.receiptPath)
    return "📎 ¿Me enviás el comprobante de la transferencia, por favor?";
  return null;
}

/** Solo corregir preguntas repetidas del modelo; no interrumpir consultas libres. */
export function fixRepeatedCheckoutQuestion(reply: string, ctx: AiContext, state: SaleState): string {
  const n = normal(reply);
  const asksCity = /(?:ciudad|departamento|de donde sos|donde vivis|de que zona)/.test(n);
  const asksName = /(?:nombre y apellido|nombre completo|como te llamas)/.test(n);
  const asksAddress = /(?:direccion|domicilio|ubicacion|referencia)/.test(n);
  const asksVariant = /(?:cual (?:tamano|tamaño|capacidad)|(?:2|3|5) litros|presentacion)/.test(n);
  const knownCity = state.cityVerified && Boolean(state.city && state.department &&
    verifiedCoverage(state.city!,state.department!,parseCoverage(ctx.training)));
  const knownAddress = Boolean(state.street || state.locationUrl);
  const knownVariant = Boolean(state.optionId || state.cartLines?.length);
  const product = ctx.products.find(p => p.id === state.productId || p.id === ctx.activeProductId);
  const needsVariant = Boolean(product && (product.product_prices?.length ?? 0) > 1 && !knownVariant);
  if ((asksCity && knownCity) || (asksName && (state.customerName || needsVariant)) ||
      (asksAddress && knownAddress) || (asksVariant && knownVariant)) {
    return nextVerifiedSaleQuestion(ctx,state) ?? "¡Gracias! 😊 Ya tengo esos datos. Estoy verificando tu pedido.";
  }
  return reply;
}
