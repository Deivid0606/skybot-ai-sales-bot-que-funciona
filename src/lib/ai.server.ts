// Limites defensivos por mensaje, configurables en Vercel.
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 950;
const MAX_OUTPUT_TOKENS = 768; // JSON de pedido y respuesta; probar antes de bajar a 512.
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
};

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

  const sortedTraining = [...ctx.training].sort(
    (a, b) => b.priority - a.priority,
  );

  const isRule = (category: string) =>
    category === "correccion" || category === "reglas";

  const corrections = sortedTraining
    .filter((entry) => isRule(entry.category))
    .map((entry) => `- ${entry.title}: ${entry.content}`)
    .join("\n");

  const knowledge = sortedTraining
    .filter((entry) => !isRule(entry.category))
    .filter((entry) => {
      // Cobertura, entregas, pagos y otras normas deben estar siempre accesibles.
      const heading = (entry.title + " " + entry.category).toLowerCase();
      if (/cobertura|ciudad|entrega|envio|pago|banco|factur|horario|garantia|politica/.test(heading)) return true;
      const keywords = entry.title.toLowerCase().split(/[^a-záéíóúñ0-9]+/).filter(w => w.length > 4);
      return keywords.some(w => query.includes(w)) || entry.priority >= 90;
    })
    .map(
      (entry) =>
        `- [${entry.category}] ${entry.title}: ${entry.content}`,
    )
    .join("\n");

  // BOT SKY: el código define solamente el contrato JSON, hechos verificables
  // y barreras de seguridad. TODA la conversación comercial viene de la IA
  // con las instrucciones de entrenamiento ACTIVO de esta misma tienda.
  const prompt = `${stateContext}

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
{"reply":"texto natural al cliente","product_id":null,"sale_closed":false,"order":null}
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

  return {
    reply: reply || (directOrder
      ? "Gracias, ya recibí los datos. Estoy verificando tu pedido. 😊"
      : "Gracias por escribirnos. Estoy revisando tu consulta. 😊"),
    product_id: normalizeProductId(parsed.product_id),
    sale_closed: directOrder ? Boolean(order) : parsed.sale_closed === true,
    order,
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
