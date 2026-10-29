// Limites defensivos por mensaje, configurables en Vercel.
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 950;
const MAX_OUTPUT_TOKENS = 1536; // Dejar margen para JSON completo y el razonamiento del modelo.
const MAX_PROVIDER_ATTEMPTS = 4;
const MAX_PROMPT_CHARS = 100000;
function limitedHistory(ctx: AiContext) {
  return ctx.history.slice(-MAX_HISTORY_MESSAGES).map(message => ({
    role: message.role,
    content: message.content.slice(-MAX_HISTORY_CHARS),
  }));
}
function lastCustomerText(ctx: AiContext) {
  return ctx.history.filter(h => h.role === "user").slice(-2).map(h => h.content).join(" ").toLowerCase();
}
export type AiContext = {
  systemInstruction: string;
  geminiApiKey?: string | null;
  geminiApiKey2?: string | null;
  geminiApiKey3?: string | null;
  openaiApiKey?: string | null;
  providerOrder?: string[] | null;
  providerModels?: Record<string, string> | null;
  model?: string | null;
  customerPhone?: string | null;
  businessName: string;
  currency: string;
  products: {
    id: string;
    name: string;
    price: number;
    promo_price: number | null;
    stock: number;
    sales_copy: string | null;
    description: string | null;
    delivery_info: string | null;
    ai_instructions: string | null;
    keywords: string[];
    sku?: string | null;
    product_prices?: {
      id: string;
      label: string;
      quantity: number;
      price: number;
      sort_order: number;
    }[];
  }[];
  training: {
    title: string;
    content: string;
    category: string;
    priority: number;
    /** Metadatos del entrenamiento: usados SOLO para seleccionar instrucciones de IA. */
    scope?: string | null;
    product_id?: string | null;
    keywords?: string[] | null;
    created_at?: string | null;
  }[];
  history: {
    role: "user" | "assistant";
    content: string;
  }[];
  activeProductId: string | null;
  /** Estado persistido de la compra ACTUAL, no del pedido anterior. */
  saleState?: import("@/lib/rule-sales.server").SaleState | null;
};

export type AiOrder = {
  customer_name?: string;
  phone?: string;
  city?: string;
  departamento?: string;
  district?: string;
  street?: string;
  quantity?: number;
  /** Cuántas promociones/paquetes de product_prices compra el cliente. */
  promo_quantity?: number;
  /** Identificador exacto de product_prices, no la cantidad. */
  product_price_id?: string;
  /** Nombre de presentación, para compatibilidad con modelos que devuelven texto. */
  price_option_label?: string;
  payment_method?: string;
  /** Cédula del destinatario de encomienda; el backend solo acepta la confirmada por cliente. */
  recipient_ci?: string;
  observations?: string;
};

export type AiResult = {
  reply: string;
  product_id: string | null;
  sale_closed: boolean;
  order: AiOrder | null;
  /** Datos que el CLIENTE escribió (cualquier redacción). El backend verifica que aparezcan en sus mensajes. */
  detected?: { customer_name?: string; street?: string; option_id?: string };
};

/**
 * El entrenamiento es DATOS del vendedor, no lógica fija del código. Las reglas
 * activas entran al contexto cada turno; estas utilidades hacen determinista
 * únicamente el requisito de compartir un enlace comercial expresamente
 * configurado en una regla global, sin fijar URL, nombre ni copy de tienda.
 */
function normalizeSellerText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}
function isGeneralCustomerQuestion(text: string): boolean {
  const value = normalizeSellerText(text);
  if (!value || value.length > 140) return false;
  return /^(?:(?:hola+|holaa+|buenas?|buen dia|buenas tardes|buenas noches|saludos?|mbaeichapa|mbaeteko|que tal)(?:\s+(?:como estas|que tal|buenas|quiero informacion|quiero info|me pasas el catalogo|necesito informacion|me das informacion|por favor))?|(?:info|informacion|quiero informacion|quiero info|necesito informacion|que productos tienen|que venden|que ofertas tienen|que hay disponible|que tienen disponible|quiero ver sus productos|quiero ver el catalogo|pasame el catalogo|me pasas el catalogo|catalogo|productos|ofertas|precio|cuanto cuesta|cuanto sale))$/.test(value);
}
function currentCustomerMessage(ctx: AiContext): string {
  return [...ctx.history].reverse().find(message => message.role === "user")?.content ?? "";
}
function productMentioned(message: string, products: AiContext["products"]): boolean {
  const normalized = normalizeSellerText(message);
  return products.some(product => [product.name, ...product.keywords].some(candidate => {
    const needle = normalizeSellerText(candidate);
    return needle.length > 3 && normalized.includes(needle);
  }));
}
function extractTrainedCatalogUrl(text: string): string | null {
  if (!/cat[aá]logo/i.test(text) || !/(?:salud|hola|consulta general|informaci[oó]n|cliente inicia)/i.test(text)) return null;
  const urls = [...text.matchAll(/https?:\/\/[^\s<>\])]+/gi)].map(match => match[0].replace(/[.,;]+$/, ""));
  if (!urls.length) return null;
  // Primer enlace de catálogo especificado por el vendedor; jamás fijar dominio.
  return urls[0];
}
function extractExplicitSellerResponse(trainingText: string): string | null {
  // Solo usar texto literal cuando el vendedor lo tituló como respuesta oficial.
  const match = trainingText.match(/(?:^|\n)#{1,6}\s*(?:\d+[.)]\s*)?RESPUESTA\s+AUTOM[AÁ]TICA\s+OFICIAL\s*\n([\s\S]*?)(?=\n#{1,6}\s*(?:\d+[.)]\s*)?[A-Za-zÁÉÍÓÚ]|$)/i);
  if (!match) return null;
  const response = match[1].trim()
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$2")
    .replace(/\*\*([^*]+)\*\*/g, "*$1")
    .replace(/\\\n/g, "\n");
  return response.length > 10 && response.length < 3600 ? response : null;
}

export function applyDynamicSellerTrainingReply(args: {
  reply: string;
  customerText: string;
  history: AiContext["history"];
  training: AiContext["training"];
  products: AiContext["products"];
  activeProductId: string | null;
  checkoutActive: boolean;
}): string {
  const original = args.reply.trim();
  if (!isGeneralCustomerQuestion(args.customerText) || args.checkoutActive || args.activeProductId ||
      productMentioned(args.customerText, args.products)) return original;
  const matches = args.training.filter(entry => entry.scope !== "producto")
    .map(entry => ({entry,url:extractTrainedCatalogUrl(entry.content)}))
    .filter((match): match is {entry:AiContext["training"][number];url:string} => Boolean(match.url))
    .sort((a,b) => (Number(b.entry.priority)||0)-(Number(a.entry.priority)||0));
  if (!matches.length) return original;
  const {entry,url} = matches[0];
  // No repetir un catálogo ya enviado en esta conversación.
  if (original.includes(url) || args.history.some(h => h.role === "assistant" && h.content.includes(url))) return original;
  const explicit = extractExplicitSellerResponse(entry.content);
  console.info("[BOT_SKY_DYNAMIC_TRAINING] catálogo general aplicado", {category:entry.category,explicitResponse:Boolean(explicit)});
  return explicit && explicit.includes(url)
    ? explicit
    : `${original}\n\n📦 *Catálogo de productos:*\n${url}\n\n¿Cuál te interesa? 😊`.trim();
}

type UnknownRecord = Record<string, unknown>;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildSystemPrompt(ctx: AiContext): string {
  const detectedCustomerPhone = cleanString(ctx.customerPhone);
  const state = ctx.saleState;
  const coverage = state?.city
    ? `${state.city} — ${state.department || "departamento sin verificar"} (destino verificado: ${state.cityVerified===true})`
    : "ciudad aún no declarada";
  const selected = ctx.products.find(p => p.id === (state?.productId ?? ctx.activeProductId));
  const option = selected?.product_prices?.find(o => o.id === state?.optionId);
  const stateContext = [
    "ESTADO DE VENTA DEL CICLO ACTUAL (HECHOS TÉCNICOS, NO INSTRUCCIONES DE PREGUNTAS):",
    `Producto: ${selected?.name ?? "pendiente"}`,
    `Variante: ${option?.label ?? "pendiente"}`,
    `Nombre: ${state?.customerName ?? "pendiente"}`,
    `Cédula del destinatario confirmada por cliente: ${state?.recipientCi ?? "pendiente"}`,
    `Ciudad/departamento: ${coverage}`,
    `Dirección: ${state?.street ?? state?.locationUrl ?? "pendiente"}`,
    `Cantidad: ${state?.quantity ?? "pendiente"}`,
    `Pago: ${state?.paymentMethod ?? "pendiente"}`,
    `Comprobantes técnicamente evaluados de esta compra: ${state?.receiptDocuments?.length ?? 0}`,
    `Resultado de revisión documental: ${state?.receiptReview ?? "sin observaciones técnicas"}`,
    `Archivo de comprobante conservado: ${Boolean(state?.receiptPath)}`,
    "No afirmes monto bancario, beneficiario, saldo a favor ni que el comprobante fue validado si no constan en el estado técnico. Si llegó una imagen pero no hay lectura legible, pedí revisión sin inventar valores.",
    `Comprobante guardado en ciclo actual: ${Boolean(state?.receiptPath)}`,
    `Revisión documental del comprobante: ${state?.receiptReview ?? "pendiente"}`,
    "Nunca inventes montos leídos ni llames acreditado a un pago documentado.",
    "ENCOMIENDA: no exigir domicilio, barrio, calle, referencia ni GPS como requisito del pedido. Si el entrenamiento ACTIVO requiere número de cédula del destinatario, pedirlo SOLAMENTE después de recibir un comprobante documentalmente compatible y suficiente, y antes de registrar el pedido. No pedir foto de la cédula. Diferenciar C.I. del destinatario de alias, cédula del titular bancario y operación de transferencia. El backend decide si están todos los requisitos; jamás anunciar registro sin INSERT real.",
    "Si un campo está completo NO lo preguntes otra vez. Si el cliente cambia explícitamente de ciudad, usa la última válida.",
    "Interpretá una respuesta de ubicación en contexto: por ejemplo Fernando de la Mora zona sur significa ciudad Fernando de la Mora y referencia zona sur; no confundas barrio o zona con otra ciudad.",
    "Cuando la persona contesta a una pregunta anterior, interpretá primero su respuesta dentro del flujo vigente; no reinicies ofertas ni vuelvas a preguntar la cantidad elegida.",
    "La cobertura autorizada, el departamento, los métodos de pago y los requisitos de dirección provienen EXCLUSIVAMENTE del entrenamiento de este vendedor. Si el destino no es inequívoco, solicitá únicamente la aclaración necesaria.",
    "El entrenamiento ACTIVO de este vendedor determina qué preguntar y en qué orden. Nunca repetir campos conocidos. Capacidad en litros no es cantidad de unidades.",
    "Nunca afirmes que el pedido se registró: solamente el backend tras INSERT puede confirmarlo.",
  ].join("\n");

  const query = lastCustomerText(ctx).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const fullProducts = ctx.products.filter(product => {
    const words = [product.name, ...(product.keywords ?? [])].map(s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    return product.id === (ctx.saleState?.productId ?? ctx.activeProductId) || words.some(s => s.length >= 4 && query.includes(s));
  });
  // Indice compacto de otros productos: la IA identifica el nuevo producto sin reenviar todos los copys.
  const compactIndex = ctx.products.filter(p => !fullProducts.some(f => f.id === p.id))
    .map(p => `${p.id}:${p.name}`).join(" | ").slice(0, 5000);
  const catalog = fullProducts
    .map((product) => {
      const variants = [...(product.product_prices ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((option) =>
          `    - variante_id:${option.id} | nombre:${option.label} | unidades_incluidas:${option.quantity} | precio_total:${option.price} ${ctx.currency}`,
        )
        .join("\n");
      return `- id:${product.id} | ${product.name} | stock:${product.stock} | claves:${product.keywords.join(", ") || "-"}
  variantes/precios de catálogo:
${variants || `    - precio_unitario_heredado:${product.promo_price ?? product.price} ${ctx.currency}`}
  copy: ${product.sales_copy ?? product.description ?? "-"}
  entrega: ${product.delivery_info ?? "-"}
  instrucciones: ${product.ai_instructions ?? "-"}`;
    })
    .join("\n");

  // El panel permite guardar reglas globales con prioridad 0. Anteriormente
  // se descartaban si el título no coincidía con el mensaje: parecían
  // "guardadas" pero la IA nunca las recibía. Todas las entradas globales
  // ACTIVAS de este workspace deben estar disponibles en cada respuesta.
  // Entradas específicas de producto solo se envían al producto en curso;
  // esto no altera ctx.training, que sigue usándose SIN CAMBIOS para las
  // comprobaciones de cobertura, cierre y pagos del backend.
  const relevantProductIds = new Set<string>();
  const selectedProductId = state?.productId ?? ctx.activeProductId;
  if (selectedProductId) relevantProductIds.add(selectedProductId);
  for (const product of fullProducts) relevantProductIds.add(product.id);

  const promptTraining = ctx.training.filter(entry => {
    if (entry.scope !== "producto") return true;
    return Boolean(entry.product_id && relevantProductIds.has(entry.product_id));
  });
  const sortedTraining = [...promptTraining].sort((a, b) =>
    (Number(b.priority) || 0) - (Number(a.priority) || 0) ||
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
  const isRule = (category: string) =>
    category === "correccion" || category === "reglas";

  const formatTraining = (entry: AiContext["training"][number]) =>
    `- [${entry.category || "general"} | prioridad ${Number(entry.priority) || 0}] ${entry.title}: ${entry.content}`;

  const corrections = sortedTraining
    .filter(entry => isRule(entry.category))
    .map(formatTraining)
    .join("\n");

  // No hacer depender la presencia de un entrenamiento de palabras del título,
  // categoría ni prioridad: la IA necesita ver también Objeciones, Cierre,
  // General, Producto, etc. Las palabras clave son ayudas de relevancia,
  // NO condiciones para ocultar instrucciones activas.
  const knowledge = sortedTraining
    .filter(entry => !isRule(entry.category))
    .map(formatTraining)
    .join("\n");

  // En cada mensaje se vuelven a evaluar las reglas activas. Las condiciones
  // comerciales del vendedor tienen prioridad en el turno al que aplican;
  // esta selección solo afecta el PROMPT y nunca las validaciones de pedidos.
  const incoming = currentCustomerMessage(ctx);
  const generalInquiry = isGeneralCustomerQuestion(incoming) &&
    !productMentioned(incoming, ctx.products) && !(state?.productId ?? ctx.activeProductId);
  const incomingNormalized = normalizeSellerText(incoming);
  const focusedTraining = sortedTraining.filter(entry => {
    const keywords = (entry.keywords ?? []).filter(Boolean);
    if (keywords.some(keyword => incomingNormalized.includes(normalizeSellerText(keyword)))) return true;
    if (generalInquiry && extractTrainedCatalogUrl(entry.content)) return true;
    if (generalInquiry && /salud|hola|consultas? generales?|informaci[oó]n/i.test(entry.title + " " + entry.content.slice(0,1600))) return true;
    const titleWords = normalizeSellerText(entry.title).split(" ").filter(word => word.length > 4);
    return titleWords.length > 0 && titleWords.some(word => incomingNormalized.split(" ").includes(word));
  }).slice(0, 16);
  const focusInstructions = focusedTraining.map(formatTraining).join("\n\n");
  const generalInquiryHint = generalInquiry
    ? "CONSULTA GENERAL SIN PRODUCTO: atendé el saludo o la pregunta actual antes de intentar capturar datos de pedido. Si el vendedor entrenó un envío de catálogo para este caso, incluí el enlace EXACTO de esa regla ahora (si no se envió previamente); no lo inventes ni repitas. No pidas ciudad, nombre ni cantidad hasta que haya intención de compra de un producto."
    : "PRIORIZÁ las instrucciones del vendedor que se aplican al mensaje actual y respetá el progreso del pedido.";

  // BOT SKY: el código define solamente el contrato JSON, hechos verificables
  // y barreras de seguridad. TODA la conversación comercial viene de la IA
  // con las instrucciones de entrenamiento ACTIVO de esta misma tienda.
  const prompt = `${stateContext}

ENTRENAMIENTO APLICABLE EN ESTE TURNO (RESPETAR Y NO OMITIR):
${generalInquiryHint}
${focusInstructions || "Sin coincidencias especiales; aplicar el resto de reglas activas."}

Sos la atención comercial de ${ctx.businessName || "la tienda"}, por WhatsApp en español paraguayo.
Respondé el ÚLTIMO mensaje del cliente de manera natural, consultiva y breve.
Tu ÚNICA fuente para preguntas, orden de venta, estilo, descuentos, modalidades,
cobertura, cuentas bancarias y requisitos comerciales es el ENTRENAMIENTO ACTIVO
de este vendedor que aparece más abajo. No implementes formularios ni secuencias
comerciales de código. No vuelvas a preguntar datos ya recibidos y no reinicies
la conversación cuando el cliente ya dio ciudad o cantidad.
La ficha de catálogo muestra precios/variantes reales. No inventes precio,
stock, cobertura, transportadora, tarifa, plazo ni cuenta bancaria.
Cuando un cliente mencione una ciudad, conservá exactamente ese destino;
no lo sustituyas por ejemplos (como Asunción) presentes en las reglas.
Una ciudad no listada para contraentrega NO significa ausencia de encomienda:
la modalidad depende estrictamente del entrenamiento del vendedor y de la
confirmación logística que corresponda.
En encomienda no pidas dirección, barrio ni Google Maps. Nombre y cédula del
destinatario se solicitan tras el comprobante, únicamente cuando la política
del vendedor los requiere y el documento sea compatible. No extraigas la cédula
desde el comprobante, la cuenta del titular ni el alias bancario.
No marques acreditado un pago por una imagen, ni confirmes un pedido sin un
INSERT real en Supabase. Si el sistema todavía no registró, no digas "pedido confirmado".
El código puede recibir datos y crear pedidos seguros, pero no redacta tus
preguntas de venta. Respetá siempre la solicitud actual del comprador.

HECHOS DEL WORKSPACE:
Nombre comercial: ${ctx.businessName || "Tienda"}
Moneda: ${ctx.currency}
Teléfono de este contacto, si lo hay: ${detectedCustomerPhone || "No disponible"}
Producto activo: ${ctx.activeProductId || "No identificado"}

REGLAS Y CORRECCIONES DEL VENDEDOR (PRIORIDAD MÁXIMA):
${corrections || "Sin entradas de reglas"}

INSTRUCCIONES DEL WORKSPACE:
${ctx.systemInstruction || "Sin instrucciones adicionales"}

CATÁLOGO ACTIVO (FUENTE DE PRECIOS Y VARIANTES):
${catalog || "No hay producto inequívoco todavía"}
ÍNDICE ADICIONAL DE PRODUCTOS: ${compactIndex || "-"}

OTRAS ENTRADAS ENTRENADAS:
${knowledge || "Sin entradas adicionales"}

SALIDA OBLIGATORIA (no mostrar al cliente): devolvé exclusivamente UN objeto JSON válido,
sin Markdown ni texto adicional, con estas claves:
{"reply":"texto natural al cliente","product_id":null,"sale_closed":false,"order":null,"detected":{"customer_name":"","street":"","option_id":""}}
"detected" se completa SIEMPRE que el cliente haya dado en esta compra su nombre y apellido o su dirección de entrega,
en cualquier forma («me llamo X», «X me llamo», «soy X», «a nombre de X», o un mensaje que solo diga el nombre).
Copiá esas palabras TAL COMO las escribió el cliente; nunca inventes ni completes. Si no lo dijo, dejá "".
"option_id": el ID REAL de product_prices que el cliente eligió explícitamente («el de 2», «la promo de 99 mil», «3 unidades»…); "" si todavía no eligió.
product_id debe ser un ID REAL de catálogo o null. sale_closed indica que
aportaste un pedido estructurado COMPLETO pero no prueba INSERT ni pago.
Si falta un dato o no hay pedido suficientemente definido, sale_closed:false y order:null.
Para pedido estructurado usá:
{"customer_name":"","phone":"","city":"","departamento":"","district":"","street":"","quantity":1,"promo_quantity":1,"product_price_id":"ID REAL","price_option_label":"etiqueta real","payment_method":"","recipient_ci":"","observations":""}
La cantidad y la presentación deben respetar exactamente lo elegido por el
cliente y la definición de product_prices; una caja de varias unidades tiene
un precio de paquete, no se multiplica dos veces. El código verifica el total.
En encomienda street debe estar vacío; la cédula debe ser únicamente la del
destinatario recibida explícitamente en un mensaje suyo.
El teléfono se obtiene del contacto de WhatsApp, sin volver a pedirlo si existe.`;
  // Protección ante entrenamientos anormalmente extensos.
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  // Conservamos SIEMPRE el formato JSON final, esencial para registrar pedidos.
  const tail = prompt.slice(-3200);
  return prompt.slice(0, MAX_PROMPT_CHARS - tail.length - 90) +
    "\n[CONTEXTO EXTENSO OMITIDO POR LÍMITE DE COSTO]\n" + tail;
}

function stripMarkdownCodeFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(raw: string): string | null {
  const text = stripMarkdownCodeFence(raw);
  const firstBrace = text.indexOf("{");

  if (firstBrace < 0) return null;

  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let index = firstBrace; index < text.length; index += 1) {
    const character = text[index];

    if (insideString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === '"') {
        insideString = false;
      }

      continue;
    }

    if (character === '"') {
      insideString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(firstBrace, index + 1);
      }
    }
  }

  return null;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function unwrapJsonValue(value: unknown): unknown {
  let current = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (typeof current !== "string") {
      return current;
    }

    const trimmed = stripMarkdownCodeFence(current);
    const parsed = tryParseJson(trimmed);

    if (parsed === null) {
      const extracted = extractFirstJsonObject(trimmed);
      if (!extracted) return current;

      const extractedParsed = tryParseJson(extracted);
      if (extractedParsed === null) return current;

      current = extractedParsed;
      continue;
    }

    current = parsed;
  }

  return current;
}

function sanitizeVisibleReply(value: unknown): string {
  if (typeof value !== "string") return "";

  let text = stripMarkdownCodeFence(value);

  const unwrapped = unwrapJsonValue(text);

  if (
    unwrapped &&
    typeof unwrapped === "object" &&
    !Array.isArray(unwrapped)
  ) {
    const nestedReply = cleanString(
      (unwrapped as UnknownRecord).reply,
    );

    if (nestedReply) {
      text = nestedReply;
    }
  }

  text = text
    .replace(/^\s*\{\s*"reply"\s*:\s*"/i, "")
    .replace(
      /"\s*,\s*"product_id"\s*:\s*(?:"[^"]*"|null)[\s\S]*$/i,
      "",
    )
    .replace(
      /,\s*"product_id"\s*:\s*(?:"[^"]*"|null)[\s\S]*$/i,
      "",
    )
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\\\/g, "\\")
    .trim();

  return text;
}

function normalizeProductId(value: unknown): string | null {
  const productId = cleanString(value);

  if (!productId || productId.toLowerCase() === "null") {
    return null;
  }

  return productId;
}

function normalizeOrder(value: unknown): AiOrder | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as UnknownRecord;
  const order: AiOrder = {};

  const stringFields: (keyof AiOrder)[] = [
    "customer_name",
    "phone",
    "city",
    "departamento",
    "district",
    "street",
    "payment_method",
    "recipient_ci",
    "observations",
    "product_price_id",
    "price_option_label",
  ];

  for (const field of stringFields) {
    const fieldValue = cleanString(raw[field]);

    if (fieldValue) {
      order[field] = fieldValue as never;
    }
  }

  const promoQuantity = Number(raw.promo_quantity);
  if (Number.isSafeInteger(promoQuantity) && promoQuantity >= 1 && promoQuantity <= 25) {
    order.promo_quantity = promoQuantity;
  }

  const quantity = Number(raw.quantity);

  if (Number.isFinite(quantity) && quantity > 0) {
    order.quantity = Math.floor(quantity);
  }

  return Object.keys(order).length > 0 ? order : null;
}

function applyDetectedPhone(
  result: AiResult,
  customerPhone: string | null | undefined,
): AiResult {
  const detectedPhone = cleanString(customerPhone);

  if (!detectedPhone) {
    return result;
  }

  if (!result.order) {
    return result;
  }

  return {
    ...result,
    order: {
      ...result.order,
      phone: detectedPhone,
    },
  };
}

function fallbackResult(raw: string): AiResult {
  return {
    reply: sanitizeVisibleReply(raw),
    product_id: null,
    sale_closed: false,
    order: null,
  };
}

function parseResult(raw: string): AiResult {
  const cleaned = stripMarkdownCodeFence(raw);

  if (!cleaned) {
    return {
      reply: "",
      product_id: null,
      sale_closed: false,
      order: null,
    };
  }

  const unwrapped = unwrapJsonValue(cleaned);

  if (
    !unwrapped ||
    typeof unwrapped !== "object" ||
    Array.isArray(unwrapped)
  ) {
    return fallbackResult(cleaned);
  }

  const parsed = unwrapped as UnknownRecord;
  // Algunos modelos devuelven directamente {customer_name, city, ...}.
  // Jamás publicar ese objeto como mensaje visible. El backend validará la venta.
  const directOrder = typeof parsed.customer_name === "string" &&
    typeof parsed.city === "string" && (parsed.quantity !== undefined || parsed.product_price_id !== undefined);
  const order = normalizeOrder(directOrder ? parsed : parsed.order);
  const reply = sanitizeVisibleReply(parsed.reply);
  const rawDetected = parsed.detected && typeof parsed.detected === "object" && !Array.isArray(parsed.detected)
    ? parsed.detected as UnknownRecord : null;
  const detected = rawDetected ? {
    customer_name: cleanString(rawDetected.customer_name) || undefined,
    street: cleanString(rawDetected.street) || undefined,
    option_id: cleanString(rawDetected.option_id) || undefined,
  } : undefined;

  // Nunca reemplazar una salida incompleta de IA por preguntas o esperas
  // comerciales programadas. ensureValidResult hará probar otro proveedor.
  return {
    reply,
    product_id: normalizeProductId(parsed.product_id),
    sale_closed: directOrder ? Boolean(order) : parsed.sale_closed === true,
    order,
    detected,
  };
}

function ensureValidResult(result: AiResult): AiResult {
  const reply = sanitizeVisibleReply(result.reply);

  if (!reply) {
    throw new Error("La IA devolvió una respuesta vacía");
  }

  return {
    reply,
    product_id: result.product_id,
    sale_closed: result.sale_closed,
    order: result.order,
    detected: result.detected,
  };
}

// Modelos Flash-Lite estables anunciados por Google para la API Gemini.
// El 404 de gemini-2.5-flash-lite no debe volver a repetirse.
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

const RETRYABLE_GEMINI_STATUSES = new Set([
  408,
  429,
  500,
  502,
  503,
  504,
]);

const GEMINI_MAX_ATTEMPTS_PER_MODEL = 2;
const GEMINI_REQUEST_TIMEOUT_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return values.reduce<string[]>((result, value) => {
    const cleaned = cleanString(value);

    if (cleaned && !result.includes(cleaned)) {
      result.push(cleaned);
    }

    return result;
  }, []);
}

function getGeminiCandidates(preferredModel?: string | null): string[] {
  const normalized = cleanString(preferredModel).replace(/^models\//i, "");
  // No confiar en modelos obsoletos guardados en ai_settings.model.
  // Tampoco activar un modelo Pro por accidente ni repetir solicitudes 404.
  const validPreferred = /^gemini-3\.(?:1-flash-lite|5-flash-lite|6-flash|8-flash)$/i.test(normalized)
    ? normalized
    : null;
  return uniqueNonEmptyStrings([
    validPreferred,
    ...GEMINI_FALLBACK_MODELS,
  ]);
}

function calculateRetryDelayMs(attempt: number): number {
  const exponentialDelay = 1_000 * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * 500);

  return Math.min(exponentialDelay + jitter, 8_000);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("aborted"))
  );
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1_000);
  } catch {
    return "";
  }
}

async function generateWithGemini(
  ctx: AiContext,
  key: string,
): Promise<AiResult> {
  const candidates = getGeminiCandidates(ctx.model);
  let lastError = "";
  let lastStatus: number | null = null;

  for (const model of candidates) {
    for (
      let attempt = 1;
      attempt <= GEMINI_MAX_ATTEMPTS_PER_MODEL;
      attempt += 1
    ) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        GEMINI_REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model,
          )}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: buildSystemPrompt(ctx) }],
              },
              contents: limitedHistory(ctx).map((message) => ({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: message.content }],
              })),
              generationConfig: {
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                responseMimeType: "application/json",
              },
            }),
          },
        );

        if (response.ok) {
          const json = (await response.json()) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  text?: string;
                }>;
              };
              finishReason?: string;
            }>;
            promptFeedback?: {
              blockReason?: string;
            };
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
          };

          if (json.usageMetadata) {
            console.info("[BOT_SKY_AI_USAGE]", JSON.stringify({
              provider: "gemini", model,
              input_tokens: json.usageMetadata.promptTokenCount ?? 0,
              output_tokens: json.usageMetadata.candidatesTokenCount ?? 0,
              total_tokens: json.usageMetadata.totalTokenCount ?? 0,
            }));
          }
          const raw =
            json.candidates?.[0]?.content?.parts
              ?.map((part) => part.text ?? "")
              .join("") ?? "";

          if (!raw.trim()) {
            const blockReason = cleanString(json.promptFeedback?.blockReason);
            const finishReason = cleanString(
              json.candidates?.[0]?.finishReason,
            );

            throw new Error(
              blockReason
                ? `gemini_blocked:${blockReason}`
                : finishReason
                  ? `gemini_empty:${finishReason}`
                  : "gemini_empty_response",
            );
          }

          return applyDetectedPhone(
            ensureValidResult(parseResult(raw)),
            ctx.customerPhone,
          );
        }

        lastStatus = response.status;
        lastError =
          (await readResponseText(response)) ||
          `HTTP ${response.status} ${response.statusText}`;

        console.error("[AI] Gemini request failed", {
          model,
          attempt,
          status: response.status,
          error: lastError,
        });

        // Cuota o saldo agotado: otra clave/proyecto debe probarse ya.
        if (response.status === 402 || response.status === 429 ||
            response.status === 401 || response.status === 403) {
          throw new Error(`gemini_key_unavailable:${response.status} ${lastError.slice(0, 350)}`);
        }

        // 404: modelo inexistente/no disponible para esta cuenta.
        // No tiene sentido reintentarlo: pasa inmediatamente al siguiente.
        if (response.status === 404) {
          break;
        }

        // Errores de autenticación/configuración tampoco mejoran con reintentos.
        if (
          response.status === 400 ||
          response.status === 401 ||
          response.status === 403
        ) {
          break;
        }

        if (!RETRYABLE_GEMINI_STATUSES.has(response.status)) {
          break;
        }

        if (attempt < GEMINI_MAX_ATTEMPTS_PER_MODEL) {
          await sleep(calculateRetryDelayMs(attempt));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (message.startsWith("gemini_key_unavailable:")) throw error;

        lastError = isAbortError(error)
          ? `Tiempo de espera agotado después de ${GEMINI_REQUEST_TIMEOUT_MS} ms`
          : message;

        console.error("[AI] Gemini network/request error", {
          model,
          attempt,
          error: lastError,
        });

        if (attempt < GEMINI_MAX_ATTEMPTS_PER_MODEL) {
          await sleep(calculateRetryDelayMs(attempt));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  const statusPart = lastStatus ? ` status=${lastStatus}` : "";

  throw new Error(
    `gemini_error:${statusPart} ${lastError || "Todos los modelos fallaron"}`.trim(),
  );
}

/** OpenAI: última opción de respaldo. Clave privada del workspace, nunca del navegador. */
async function generateWithOpenAI(ctx: AiContext, key: string): Promise<AiResult> {
  const model = ctx.providerModels?.openai?.trim() || "gpt-4o-mini";
  // Lista deliberadamente limitada a modelos compatibles con JSON mode.
  if (!/^(?:gpt-4o-mini|gpt-4o|gpt-4\.1-mini|gpt-4\.1-nano|gpt-4\.1)$/.test(model)) {
    throw new Error("Modelo OpenAI no permitido para este flujo JSON");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: buildSystemPrompt(ctx) }, ...limitedHistory(ctx)],
        temperature: 0.25,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      const detail = (await readResponseText(response)).slice(0, 250);
      throw new Error(`openai HTTP ${response.status}: ${detail}`);
    }
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (data.usage) console.info("[BOT_SKY_AI_USAGE]", JSON.stringify({
      provider: "openai", model,
      input_tokens: data.usage.prompt_tokens ?? 0,
      output_tokens: data.usage.completion_tokens ?? 0,
      total_tokens: data.usage.total_tokens ?? 0,
    }));
    const raw = data.choices?.[0]?.message?.content ?? "";
    if (!raw.trim() || data.choices?.[0]?.finish_reason === "length") {
      throw new Error("OpenAI devolvió JSON vacío o incompleto");
    }
    return applyDetectedPhone(ensureValidResult(parseResult(raw)), ctx.customerPhone);
  } finally {
    clearTimeout(timeout);
  }
}

/** Orden fijo de respaldo por workspace: Gemini 1, 2, 3, OpenAI. */
export async function generateAiReply(ctx: AiContext): Promise<AiResult> {
  const keys: Record<string, string | null | undefined> = {
    gemini1: ctx.geminiApiKey,
    gemini2: ctx.geminiApiKey2,
    gemini3: ctx.geminiApiKey3,
    openai: ctx.openaiApiKey,
  };
  const order = ["gemini1", "gemini2", "gemini3", "openai"] as const;
  const triedKeys = new Set<string>();
  const failures: string[] = [];
  let attempts = 0;
  for (const provider of order) {
    if (attempts >= MAX_PROVIDER_ATTEMPTS) break;
    const key = keys[provider]?.trim();
    if (!key || triedKeys.has(`${provider.startsWith("gemini") ? "gemini" : provider}:${key}`)) continue;
    triedKeys.add(`${provider.startsWith("gemini") ? "gemini" : provider}:${key}`);
    attempts++;
    try {
      return provider === "openai" ? await generateWithOpenAI(ctx, key) : await generateWithGemini(ctx, key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[AI] Falló ${provider}: ${reason.slice(0, 200)}`);
      failures.push(`${provider}: ${reason.slice(0, 200)}`);
    }
  }
  throw new Error(`Todos los proveedores fallaron: ${failures.join(" | ") || "Sin claves configuradas"}`);
}
