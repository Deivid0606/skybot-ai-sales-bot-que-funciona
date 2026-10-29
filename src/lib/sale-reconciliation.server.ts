import type { AiContext, AiOrder } from "@/lib/ai.server";
import type { SaleState } from "@/lib/rule-sales.server";
import { verifiedCoverage, parseCoverage, sellerAllowsNationwideAdvance, nationwideDestinationFromText, extractRecipientCiFromCustomerText, isValidRecipientCi, isEncomiendaAdvanceOrder, sellerRequiresEncomiendaCi } from "@/lib/rule-sales.server";

type ChatLine = { role: "user" | "assistant"; content: string };
const normal = (s: string) => String(s ?? "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const exactToken = (s: string, token: string) => {
  const a = normal(token);
  if (a.length < 3) return false;
  return (` ${normal(s).replace(/[^a-z0-9 ]/g, " ")} `).includes(` ${a.replace(/[^a-z0-9 ]/g, " ")} `);
};

/** Validaciones semánticas compartidas por WhatsApp, Inbox y recuperación manual. */
export function isValidCustomerName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const name = value.replace(/^(?:soy|me llamo|mi nombre es|nombre(?: y apellido)?:)\s*/i, "").trim();
  const n = normal(name);
  if (name.length < 5 || name.length > 160 || !/^[\p{L}]+(?:[ '\-]+[\p{L}]+){1,5}$/u.test(name)) return false;
  // Un destino escrito como "Para itaugua" no es nombre y apellido.
  // Rechazar también otras frases de entrega que pueden parecer nombres.
  if (/^(?:para|en|a|hacia|desde|ciudad|vivo|estoy|mandar|enviar|entregar)\b/.test(n)) return false;
  if (/\b(?:itaugua|luque|lambare|cap iata|capiata|aregua|ypane|nemby|limpio|encarnacion|hernandarias|franco|mariano roque alonso|ciudad del este)\b/.test(n)) return false;

  if (/\b(?:estoy|en|aeropuerto|trabajo|oficina|salgo|almorzar|almuerzo|horas?|hasta|desde|avisa|traigas|aca|aqui|cada|unidades?|cajas?)\b/.test(n)) return false;
  // Frases comunes («Es un poco alto», «O no», «Solo eso») no son nombres:
  // palabras funcionales u opiniones nunca forman parte de un nombre y apellido.
  if (/\b(?:es|son|un|una|uno|unos|poco|muy|mas|menos|alto|alta|caro|cara|barato|barata|solo|sola|nomas|o|y|que|eso|esto|esta|este|todo|nada|algo|ya|tambien|pero|porque|bueno|buena|mejor|peor|igual|tal|vez|creo|puede|seria|hay|tiene|tengo|quiero|necesito|me|te|se|lo|le|les|mi|tu|su|ahi|asi)\b/.test(n)) return false;
  // Referencias de dirección («Caballero casi Rca. de Colombia») no son nombres.
  if (/\b(?:casi|esq|esquina|entre|frente|detras|cerca|km|ruta|rca|republica|mcal|mariscal|tte|gral|cnel|nro|numero|casa|edificio|piso|depto|manzana|lote|villa|sobre)\b/.test(n)) return false;
  if (/\b(?:barrio|ciudad|calle|avenida|avda|ruta|esquina|zona|centro|obrero|direccion|ubicacion|departamento|pedido|entrega|lunes|martes|miercoles|jueves|viernes|sabado|domingo|mañana|manana|hoy|precio|quiero|gracias|okey|perfecto|confirmo|asuncion|central|paraguay)\b/.test(n)) return false;
  if (/\b(?:pago|pagos|pagar|pago al recibir|recibir|recibo|transferencia|transferir|efectivo|contado|contra|contraentrega|deposito|giro|comprobante|tarjeta|cuota|cuotas|envio|delivery|direccion|dirección|avenida|avda|calle|si|no|ok|dale|listo|gracias|hola|buenas|precio|costo|cuanto|foto|disponible|unidad|und|quiero|tenes|tienen)\b/.test(n)) return false;
  if (/\d/.test(name)) return false;
  return true;
}

export function isValidDeliveryAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const address = value.trim();
  const n = normal(address);
  if (!address || address.length > 600) return false;
  if (/^https:\/\/(?:www\.)?(?:google\.[^\s/]+\/maps|maps\.app\.goo\.gl\/|goo\.gl\/maps\/)/i.test(address)) return true;
  if (address.length < 7 || /^(?:ok|okey|dale|si|no|para el |el |este |proximo |mañana|manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo)/.test(n)) return false;
  if (/^(?:barrio|zona|ciudad|de )\s+[\p{L} '\-]+$/u.test(n)) return false;
  // Cantidades o pedidos («Solo 1 caja», «quiero 2 unidades») no son direcciones.
  if (/\b(?:cajas?|unidad(?:es)?|packs?|combos?|promo(?:cion)?|quiero|solo|nomas|precio|gs|guaranies|afilador(?:es)?|bases?)\b/.test(n) &&
      !/\b(?:calle|avenida|avda|ruta|esquina|casi|barrio|frente|entre|km|nro|numero)\b/.test(n)) return false;
  // Calle, avenida, número o referencia inequívoca. Un barrio aislado no basta.
  if (/\b(?:\d{1,2}\s*[:.]\s*\d{2}|\d{1,2}\s*(?:hs|horas?)|de\s+\d{1,2}\s+a\s+\d{1,2}|almorzar|almuerzo|salgo|horario|hasta las)\b/.test(n) && !/\b(?:calle|avenida|ruta|casa|aeropuerto|trabajo|oficina|frente|esquina)\b/.test(n)) return false;
  // Frases vagas sin calle ni referencia ("voy a estar en mi casa", "en casa", "mi domicilio").
  const hasConcreteRef = /(?:\b(?:calle|avenida|avda|av\.|ruta|nro|numero|manzana|lote|pasaje|esquina|casi|frente|al lado|detras|entre|barrio|maps)\b|\d{1,5})/.test(n);
  if (!hasConcreteRef && /\b(?:mi casa|en casa|mi domicilio|mi hogar|donde vivo|voy a estar|estoy en|ahi en|aca en|lo de siempre)\b/.test(n)) return false;
  if (/\b(?:aeropuerto|trabajo|oficina|empresa|shopping|colegio|escuela|universidad|hospital|sanatorio|terminal|supermercado|estacion|iglesia|plaza)\b/.test(n)) return true;
  return /(?:\b(?:calle|avenida|avda|av\.|ruta|numero|nro|casa|manzana|lote|pasaje|esquina|casi|frente|al lado|detras|detrás|entre)\b|\d{1,5}|\b(?:maps|ubicacion exacta)\b)/i.test(n);
}

const validName = (raw: string): string | null => {
  const name = raw.replace(/^(?:soy|me llamo|mi nombre es|nombre(?: y apellido)?\s*:)\s*/i, "").trim();
  if (!/^[\p{L}]+(?:[ '-]+[\p{L}]+){1,5}$/u.test(name)) return null;
  if (/\b(?:quiero|pedido|ciudad|central|gracias|entrega|litros|ubicacion|precio|hola|de|para|cerca|calle)\b/.test(normal(name))) return null;
  return isValidCustomerName(name) ? name : null;
};
const isCityReply = (value: string, lastQuestion: string) => {
  const n = normal(value);
  if (!n || /[?¿]/.test(value) || n.length > 70) return false;
  // Una frase comercial, una respuesta afirmativa o un producto NO son ciudades,
  // aunque la última pregunta del asistente haya mencionado la ciudad.
  if (/\b(?:quiero|comprar|precio|cuanto|cuesta|cepillo|alisado|alizado|producto|unidad|unidades|caja|cajas|pedido|pagar|pago|comprobante|transferencia|problema|gracias|correcto|envio|llegaria|llega|recibir|si es asi|no hay problema)\b/.test(n)) return false;
  const directed = /^(?:soy de|vivo en|para|enviame a|mandar a|ciudad(?: de)?)\s+/.test(n);
  const prompted = /(?:en que ciudad|que ciudad|cual ciudad|ciudad.*(?:entrega|recibir)|donde.*(?:recibir|enviamos)|de donde sos|donde vivis)/.test(lastQuestion);
  // La respuesta a una pregunta de ciudad debe ser breve y nominal.
  return directed || (prompted && n.split(" ").length <= 5) || n.split(" ").length <= 3;
};

/** Recupera hechos expresos sin reemplazar datos con respuestas vacías de la IA.
 * Llamar solamente para el ciclo de compra activo; nunca para pedidos ya cerrados.
 */
export function recoverSaleStateFromHistory(ctx: AiContext, previous: SaleState, history: ChatLine[]): SaleState {
  const state: SaleState = { ...previous };
  // Conservar el archivo y las observaciones de pago sin reconstruirlas desde una respuesta de IA.
  if (previous.receiptDocuments) state.receiptDocuments = [...previous.receiptDocuments];
  if (previous.receiptAnalysisAttemptedPaths) state.receiptAnalysisAttemptedPaths = [...previous.receiptAnalysisAttemptedPaths];
  if (state.customerName && !isValidCustomerName(state.customerName)) state.customerName = undefined;
  if (state.street && !isValidDeliveryAddress(state.street)) state.street = undefined;
  const coverage = parseCoverage(ctx.training);
  // El estado fue guardado para la compra actual en bot_sale_states. Nunca
  // borrar una ciudad verificada solo porque el historial consultado conserva
  // únicamente los últimos 24 mensajes y la declaración original ya no aparece.
  // Un cambio explícito de destino se procesará más adelante en este ciclo.
  if (!coverage.length) console.warn("[BOT_SKY_COVERAGE] No hay ciudades parseables en el entrenamiento activo del workspace");
  const product = ctx.products.find(p => p.id === state.productId || p.id === ctx.activeProductId);
  if (product) state.productId = product.id;
  // No salir si aún falta productId: el cliente puede haber indicado ciudad y nombre.
  let lastQuestion = "";
  for (const item of history.slice(-32)) {
    if (item.role === "assistant") { lastQuestion = normal(item.content); continue; }
    const raw = String(item.content ?? "").trim();
    const n = normal(raw);
    if (!n || /^\[(?:image|imagen|audio|document|documento|video)/i.test(raw)) continue;
    const ci=extractRecipientCiFromCustomerText(raw, /(?:c[eé]dula|c\.?i\.?|documento de identidad)/i.test(lastQuestion));
    if(ci)state.recipientCi=ci;
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
    // Identificar localidades paraguayas conocidas fuera de contraentrega.
    // La localidad es un hecho geográfico; la habilitación de encomienda debe
    // provenir siempre del entrenamiento del mismo workspace.
    if (!uniqueHits.length && sellerAllowsNationwideAdvance(ctx.training) &&
        !/(?:calle|esquina|casi|referencia|barrio|ruta|direcci[oó]n)/i.test(raw)) {
      const destination = nationwideDestinationFromText(raw);
      if (destination) {
        state.city=destination.city;state.department=destination.department;
        state.cityVerified=true;state.coverageStatus="uncovered";
        state.paymentMethod="anticipado";
      }
    }
    // Encomienda nacional: para otras ciudades fuera de la tabla solicitar
    // departamento explícito antes de registrar; jamás fingir geocodificación.
    if (!uniqueHits.length && sellerAllowsNationwideAdvance(ctx.training) &&
        !/(?:calle|esquina|casi|referencia|barrio|ruta|direcci[oó]n)/i.test(raw)) {
      const bare = raw.replace(/^(?:soy de|vivo en|para|enviar a|mandar a|a)\s+/i, "").trim();
      const pair = bare.match(/^([\p{L}][\p{L} .'-]{2,50}?)\s*(?:,|\s+-\s+|\s+(?:del?\s+)?departamento\s+de\s+)\s*([\p{L}][\p{L} .'-]{2,40})$/iu);
      const asksDepartment = /(?:qu[eé] departamento|de qu[eé] departamento|departamento es|confirm[aá].*departamento)/i.test(lastQuestion);
      const asksCity = /(?:en qu[eé] ciudad|qu[eé] ciudad|ciudad.*recibir|d[oó]nde.*recibir)/i.test(lastQuestion);
      if (pair && (asksCity || /^(?:soy de|vivo en|para|enviar a|mandar a)\s+/i.test(raw))) {
        state.city = pair[1].trim(); state.department = pair[2].trim();
        state.cityVerified = true; state.coverageStatus = "uncovered";
      } else if (asksDepartment && state.city && !state.cityVerified &&
                 /^[\p{L} .'-]{3,40}$/u.test(bare)) {
        state.department = bare; state.cityVerified = true;
        state.coverageStatus = "uncovered";
      } else if (asksCity && isCityReply(raw, lastQuestion) && !state.cityVerified &&
                 bare.split(/\s+/).length <= 5 && /^[\p{L} .'-]{3,55}$/u.test(bare)) {
        state.city = bare; state.department = null;
        state.cityVerified = false; state.coverageStatus = "unknown";
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
      && isValidDeliveryAddress(raw) && uniqueHits.length === 0) state.street = raw;
    if (!/[?¿]/.test(raw) && /\b(?:quiero pagar al recibir|pagare al recibir|prefiero contra entrega|elijo contra entrega)\b/.test(n)) state.paymentMethod = "contraentrega";
    else if (/\b(?:pago anticipado|voy a transferir|pago por transferencia)\b/.test(n)) state.paymentMethod = "anticipado";
  }
  if (state.city && state.department) {
    const location = verifiedCoverage(state.city, state.department, coverage);
    if (location) {
      state.city = location.city; state.department = location.department;
      state.cityVerified = true; state.coverageStatus = location.active ? "covered" : "uncovered";
      if (location.active && /CONTRA ENTREGA/i.test(location.method))
        state.paymentMethod = "contraentrega";
      if (!location.active && /ENCOMIENDA|ANTICIPADO|TRANSFERENCIA/i.test(location.method))
        state.paymentMethod = "anticipado";
    } else if (state.cityVerified && sellerAllowsNationwideAdvance(ctx.training)) {
      state.coverageStatus = "uncovered";
      state.paymentMethod = "anticipado";
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
  else if (state.cityVerified && state.city && state.department &&
           sellerAllowsNationwideAdvance(training) && state.coverageStatus === "uncovered") {
    next.city = state.city; next.departamento = state.department;
    next.payment_method = "anticipado";
  }
  // Nunca conservar nombres/direcciones inventados o semánticamente inválidos por la IA.
  if (isValidCustomerName(state.customerName)) next.customer_name = state.customerName;
  else if (!isValidCustomerName(next.customer_name)) delete next.customer_name;
  if (isValidDeliveryAddress(state.street)) next.street = state.street;
  else if (state.locationUrl && isValidDeliveryAddress(state.locationUrl)) next.street = state.locationUrl;
  else if (!isValidDeliveryAddress(next.street)) delete next.street;
  if (state.paymentMethod) next.payment_method = state.paymentMethod;
  // Nunca aceptar la cédula que la IA pudo copiar del titular bancario o comprobante.
  if (isValidRecipientCi(state.recipientCi)) next.recipient_ci = state.recipientCi!.replace(/[^0-9]/g,"");
  else delete next.recipient_ci;
  if (isEncomiendaAdvanceOrder(training,next.city,next.departamento,next.payment_method)) delete next.street;
  if (state.optionId) next.product_price_id = state.optionId;
  if (state.quantity && state.quantity > 0) next.quantity = state.quantity;
  // Una variante de capacidad 3 litros equivale a 1 unidad, no a 3 promociones.
  if (state.optionId && next.quantity === 1 && (!next.promo_quantity || next.promo_quantity < 1)) next.promo_quantity = 1;
  return next;
}

/**
 * Compatibilidad con webhooks anteriores que todavía importan este símbolo.
 * Las preguntas de venta pertenecen exclusivamente a la IA y al entrenamiento.
 * Nunca generar textos comerciales ni decidir el próximo dato desde este módulo.
 * Se puede retirar esta exportación cuando todos los despliegues usen el
 * whatsapp-webhook.server.ts actualizado incluido en el mismo paquete.
 */
export function nextVerifiedSaleQuestion(_ctx: AiContext, _state: SaleState): null {
  return null;
}
