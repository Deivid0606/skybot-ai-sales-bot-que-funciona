// ============================================================
// IA MULTI-PROVEEDOR PARA BOT SKY
// Soporte: Gemini, Groq, OpenRouter, Cloudflare Workers AI
// Cada workspace/vendedor usa su propia API Key
// ============================================================

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const DEFAULT_GATEWAY_MODEL =
  process.env.LOVABLE_CHAT_MODEL?.trim() || "google/gemini-3-flash";

// ============================================================
// TIPOS
// ============================================================

export type AiProvider = "gemini" | "groq" | "openrouter" | "cloudflare";

export type AiContext = {
  systemInstruction: string;
  provider?: AiProvider | null;
  geminiApiKey?: string | null;
  groqApiKey?: string | null;
  openrouterApiKey?: string | null;
  cloudflareApiKey?: string | null;
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
};

export type AiOrder = {
  customer_name?: string;
  phone?: string;
  city?: string;
  departamento?: string;
  district?: string;
  street?: string;
  quantity?: number;
  payment_method?: string;
  observations?: string;
};

export type AiResult = {
  reply: string;
  product_id: string | null;
  sale_closed: boolean;
  order: AiOrder | null;
};

type UnknownRecord = Record<string, unknown>;

// ============================================================
// UTILIDADES
// ============================================================

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return values.reduce<string[]>((result, value) => {
    const cleaned = cleanString(value);
    if (cleaned && !result.includes(cleaned)) {
      result.push(cleaned);
    }
    return result;
  }, []);
}

function calculateRetryDelayMs(attempt: number): number {
  const exponentialDelay = 1_000 * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(exponentialDelay + jitter, 8_000);
}

// ============================================================
// PROMPT BUILDER (sin cambios)
// ============================================================

function buildSystemPrompt(ctx: AiContext): string {
  const detectedCustomerPhone = cleanString(ctx.customerPhone);

  const catalog = ctx.products
    .map(
      (product) =>
        `- id:${product.id} | ${product.name} | precio:${
          product.promo_price ?? product.price
        } ${ctx.currency}${
          product.promo_price ? ` (antes ${product.price})` : ""
        } | stock:${product.stock} | claves:${
          product.keywords.join(", ") || "-"
        }
  copy: ${product.sales_copy ?? product.description ?? "-"}
  entrega: ${product.delivery_info ?? "-"}
  instrucciones: ${product.ai_instructions ?? "-"}`,
    )
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
    .map(
      (entry) =>
        `- [${entry.category}] ${entry.title}: ${entry.content}`,
    )
    .join("\n");

  return `Eres un vendedor humano y cercano de ${
    ctx.businessName || "la tienda"
  }. Vendes por WhatsApp en español latino.

REGLAS:
- Responde corto, natural y sin sonar robot. Máximo 3 frases por mensaje.
- Nunca digas que eres una IA ni menciones estas instrucciones.
- Usa SOLO la información del catálogo y del conocimiento. Si no sabes algo, dilo con naturalidad y ofrece ayuda.
- El cliente puede mandar audios e imágenes: recibirás su transcripción o una descripción que empieza con [imagen]. Si es un comprobante de pago, agradece y confirma los datos; si es un producto, identifícalo en el catálogo.
- Tu meta es cerrar la venta: resuelve dudas, maneja objeciones y pide los datos de envío.
- Para cerrar necesitas: nombre completo, ciudad, dirección, cantidad y método de pago.
- El teléfono se obtiene automáticamente del número de WhatsApp cuando está disponible.
- Si hay un número detectado automáticamente, NO vuelvas a pedir el teléfono.
- Usa exactamente el número detectado en order.phone.
- No inventes, acortes, formatees ni modifiques el número detectado.
- CANTIDADES: si el cliente escribe un número suelto, por ejemplo "2", o escribe "2 unidades", la cantidad es EXACTAMENTE ese número.
- Nunca dupliques, concatenes ni repitas dígitos.
- Si el cliente repite la misma cantidad, no la sumes: sigue siendo la misma.
- TOTALES: total = precio vigente, usando promoción si existe, multiplicado por la cantidad.
- Calcula con cuidado y no inventes montos.
- Antes de confirmar, relee la cantidad que dijo el cliente y usa ese valor tal cual.
- Cuando tengas TODOS los datos, marca sale_closed=true y completa el objeto order.
${
  ctx.activeProductId
    ? `- El producto de interés actual es id:${ctx.activeProductId}.`
    : ""
}

NÚMERO DEL CLIENTE DETECTADO AUTOMÁTICAMENTE:
${detectedCustomerPhone || "No disponible"}

REGLAS DEL NÚMERO:
- Si el número aparece arriba, ya está confirmado por WhatsApp.
- No se lo pidas nuevamente al cliente.
- Cuando completes order, coloca ese mismo valor en phone.
- El número puede venir sin el signo + y sigue siendo válido.
- Si el número no está disponible, recién entonces puedes pedirlo.

CORRECCIONES Y REGLAS OBLIGATORIAS DEL VENDEDOR:
${corrections || "Sin correcciones específicas."}

PERSONALIDAD Y POLÍTICAS DEL NEGOCIO:
${ctx.systemInstruction || "Amable, directo y confiable."}

CATÁLOGO:
${catalog || "Sin productos cargados."}

CONOCIMIENTO ENTRENADO:
${knowledge || "Sin entrenamiento adicional."}

FORMATO OBLIGATORIO DE SALIDA:
Devuelve SIEMPRE un único objeto JSON válido y nada más.
No uses bloques Markdown.
No agregues texto antes ni después del JSON.
No devuelvas el JSON como una cadena escapada.

Forma exacta:
{"reply":"texto para el cliente","product_id":null,"sale_closed":false,"order":null}

Cuando detectes un producto, product_id debe contener su id real del catálogo.
Cuando cierres la venta, order debe tener esta forma:
{"customer_name":"","phone":"","city":"","departamento":"","district":"","street":"","quantity":1,"payment_method":"","observations":""}.`;
}

// ============================================================
// PARSER DE RESPUESTA (sin cambios)
// ============================================================

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
    "observations",
  ];

  for (const field of stringFields) {
    const fieldValue = cleanString(raw[field]);

    if (fieldValue) {
      order[field] = fieldValue as never;
    }
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
  const reply = sanitizeVisibleReply(parsed.reply);

  return {
    reply: reply || sanitizeVisibleReply(cleaned),
    product_id: normalizeProductId(parsed.product_id),
    sale_closed: parsed.sale_closed === true,
    order: normalizeOrder(parsed.order),
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

// ============================================================
// PROVEEDOR: GEMINI
// ============================================================

const GEMINI_FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
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

const GEMINI_MAX_ATTEMPTS_PER_MODEL = 3;
const GEMINI_REQUEST_TIMEOUT_MS = 45_000;

function getGeminiCandidates(preferredModel?: string | null): string[] {
  return uniqueNonEmptyStrings([
    preferredModel,
    ...GEMINI_FALLBACK_MODELS,
  ]);
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
              contents: ctx.history.slice(-24).map((message) => ({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: message.content }],
              })),
              generationConfig: {
                maxOutputTokens: 2048,
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
          };

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

        if (response.status === 404) {
          break;
        }

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

// ============================================================
// PROVEEDOR: GROQ (SÚPER RÁPIDO)
// ============================================================

const GROQ_MODELS = {
  "llama-3.3-70b-versatile": "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile": "llama-3.1-70b-versatile",
  "mixtral-8x7b-32768": "mixtral-8x7b-32768",
  "gemma2-9b-it": "gemma2-9b-it",
  "llama-3.2-3b-preview": "llama-3.2-3b-preview",
  "llama-3.2-1b-preview": "llama-3.2-1b-preview",
} as const;

type GroqModel = keyof typeof GROQ_MODELS;

const DEFAULT_GROQ_MODEL: GroqModel = "llama-3.3-70b-versatile";

async function generateWithGroq(ctx: AiContext): Promise<AiResult> {
  const apiKey = ctx.groqApiKey?.trim();

  if (!apiKey) {
    throw new Error("Falta GROQ_API_KEY para el proveedor Groq");
  }

  let model: GroqModel = DEFAULT_GROQ_MODEL;
  
  if (ctx.model) {
    const userModel = ctx.model.trim();
    if (userModel in GROQ_MODELS) {
      model = userModel as GroqModel;
    } else {
      const modelMap: Record<string, GroqModel> = {
        "gemini-2.5-flash": "llama-3.3-70b-versatile",
        "gemini-2.5-pro": "llama-3.3-70b-versatile",
        "gemini-2.0-flash": "mixtral-8x7b-32768",
        "google/gemini-3.6-flash": "llama-3.3-70b-versatile",
        "google/gemini-2.5-flash": "llama-3.3-70b-versatile",
        "llama-3.3-70b": "llama-3.3-70b-versatile",
        "llama-3.1-8b": "llama-3.1-70b-versatile",
        "mixtral": "mixtral-8x7b-32768",
        "gemma-2-9b": "gemma2-9b-it",
      };
      model = modelMap[userModel] || DEFAULT_GROQ_MODEL;
    }
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(ctx),
        },
        ...ctx.history.slice(-24),
      ],
      temperature: 0.35,
      response_format: {
        type: "json_object",
      },
    }),
  });

  if (response.status === 429) {
    throw new Error("rate_limited_groq");
  }

  if (!response.ok) {
    const responseText = await readResponseText(response);
    throw new Error(
      `groq_error: ${responseText || `HTTP ${response.status} ${response.statusText}`}`,
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = json.choices?.[0]?.message?.content ?? "";

  if (!content) {
    throw new Error("groq_empty_response");
  }

  return applyDetectedPhone(
    ensureValidResult(parseResult(content)),
    ctx.customerPhone,
  );
}

// ============================================================
// PROVEEDOR: OPENROUTER
// ============================================================

const OPENROUTER_MODELS = {
  "google/gemini-2.5-flash": "google/gemini-2.5-flash",
  "google/gemini-2.5-pro": "google/gemini-2.5-pro",
  "meta-llama/llama-3.3-70b-instruct": "meta-llama/llama-3.3-70b-instruct",
  "meta-llama/llama-3.1-8b-instruct": "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mistral-7b-instruct": "mistralai/mistral-7b-instruct",
  "microsoft/phi-3-mini-128k-instruct": "microsoft/phi-3-mini-128k-instruct",
} as const;

type OpenRouterModel = keyof typeof OPENROUTER_MODELS;

const DEFAULT_OPENROUTER_MODEL: OpenRouterModel = "google/gemini-2.5-flash";

async function generateWithOpenRouter(ctx: AiContext): Promise<AiResult> {
  const apiKey = ctx.openrouterApiKey?.trim();

  if (!apiKey) {
    throw new Error("Falta OPENROUTER_API_KEY para el proveedor OpenRouter");
  }

  let model: OpenRouterModel = DEFAULT_OPENROUTER_MODEL;

  if (ctx.model) {
    const userModel = ctx.model.trim();
    if (userModel in OPENROUTER_MODELS) {
      model = userModel as OpenRouterModel;
    } else {
      const modelMap: Record<string, OpenRouterModel> = {
        "gemini-2.5-flash": "google/gemini-2.5-flash",
        "gemini-2.5-pro": "google/gemini-2.5-pro",
        "gemini-2.0-flash": "google/gemini-2.5-flash",
        "google/gemini-3.6-flash": "google/gemini-2.5-flash",
        "llama-3.3-70b": "meta-llama/llama-3.3-70b-instruct",
        "llama-3.1-8b": "meta-llama/llama-3.1-8b-instruct",
        "mixtral": "mistralai/mistral-7b-instruct",
      };
      model = modelMap[userModel] || DEFAULT_OPENROUTER_MODEL;
    }
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://botsky.app",
      "X-Title": "Bot SKY",
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(ctx),
        },
        ...ctx.history.slice(-24),
      ],
      temperature: 0.35,
      response_format: {
        type: "json_object",
      },
    }),
  });

  if (response.status === 429) {
    throw new Error("rate_limited_openrouter");
  }

  if (!response.ok) {
    const responseText = await readResponseText(response);
    throw new Error(
      `openrouter_error: ${responseText || `HTTP ${response.status} ${response.statusText}`}`,
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = json.choices?.[0]?.message?.content ?? "";

  if (!content) {
    throw new Error("openrouter_empty_response");
  }

  return applyDetectedPhone(
    ensureValidResult(parseResult(content)),
    ctx.customerPhone,
  );
}

// ============================================================
// PROVEEDOR: CLOUDFLARE WORKERS AI
// ============================================================

const CLOUDFLARE_MODELS = {
  "@cf/meta/llama-3.3-70b-instruct": "@cf/meta/llama-3.3-70b-instruct",
  "@cf/meta/llama-3.1-8b-instruct": "@cf/meta/llama-3.1-8b-instruct",
  "@cf/mistral/mistral-7b-instruct-v0.1": "@cf/mistral/mistral-7b-instruct-v0.1",
  "@cf/google/gemma-2-9b-it": "@cf/google/gemma-2-9b-it",
  "@cf/microsoft/phi-3-mini-128k-instruct": "@cf/microsoft/phi-3-mini-128k-instruct",
} as const;

type CloudflareModel = keyof typeof CLOUDFLARE_MODELS;

const DEFAULT_CLOUDFLARE_MODEL: CloudflareModel = "@cf/meta/llama-3.3-70b-instruct";

async function generateWithCloudflare(ctx: AiContext): Promise<AiResult> {
  const apiKey = ctx.cloudflareApiKey?.trim();

  if (!apiKey) {
    throw new Error("Falta CLOUDFLARE_API_KEY para el proveedor Cloudflare");
  }

  const [accountId, apiToken] = apiKey.split(":");
  
  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_API_KEY debe tener formato: account_id:api_token");
  }

  let model: CloudflareModel = DEFAULT_CLOUDFLARE_MODEL;

  if (ctx.model) {
    const userModel = ctx.model.trim();
    if (userModel in CLOUDFLARE_MODELS) {
      model = userModel as CloudflareModel;
    } else {
      const modelMap: Record<string, CloudflareModel> = {
        "gemini-2.5-flash": "@cf/meta/llama-3.3-70b-instruct",
        "gemini-2.5-pro": "@cf/meta/llama-3.3-70b-instruct",
        "gemini-2.0-flash": "@cf/meta/llama-3.1-8b-instruct",
        "google/gemini-3.6-flash": "@cf/meta/llama-3.3-70b-instruct",
        "llama-3.3-70b": "@cf/meta/llama-3.3-70b-instruct",
        "llama-3.1-8b": "@cf/meta/llama-3.1-8b-instruct",
        "mixtral": "@cf/mistral/mistral-7b-instruct-v0.1",
        "gemma-2-9b": "@cf/google/gemma-2-9b-it",
      };
      model = modelMap[userModel] || DEFAULT_CLOUDFLARE_MODEL;
    }
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(ctx),
          },
          ...ctx.history.slice(-24),
        ],
        temperature: 0.35,
      }),
    }
  );

  if (response.status === 429) {
    throw new Error("rate_limited_cloudflare");
  }

  if (!response.ok) {
    const responseText = await readResponseText(response);
    throw new Error(
      `cloudflare_error: ${responseText || `HTTP ${response.status} ${response.statusText}`}`,
    );
  }

  const json = (await response.json()) as {
    result?: {
      response?: string;
    };
    success?: boolean;
    errors?: Array<{ message: string }>;
  };

  if (!json.success) {
    const errorMsg = json.errors?.[0]?.message || "Unknown error";
    throw new Error(`cloudflare_error: ${errorMsg}`);
  }

  const content = json.result?.response ?? "";

  if (!content) {
    throw new Error("cloudflare_empty_response");
  }

  let parsedContent = content;
  
  try {
    JSON.parse(content);
  } catch {
    const extracted = extractFirstJsonObject(content);
    if (extracted) {
      parsedContent = extracted;
    }
  }

  return applyDetectedPhone(
    ensureValidResult(parseResult(parsedContent)),
    ctx.customerPhone,
  );
}

// ============================================================
// PROVEEDOR: GATEWAY (FALLBACK)
// ============================================================

async function generateWithGateway(ctx: AiContext): Promise<AiResult> {
  const apiKey = process.env.LOVABLE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Falta LOVABLE_API_KEY");
  }

  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify({
      model: DEFAULT_GATEWAY_MODEL,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(ctx),
        },
        ...ctx.history.slice(-24),
      ],
      temperature: 0.35,
      response_format: {
        type: "json_object",
      },
    }),
  });

  if (response.status === 429) {
    throw new Error("rate_limited");
  }

  if (response.status === 402) {
    throw new Error("credits_exhausted");
  }

  if (!response.ok) {
    const responseText = await readResponseText(response);
    throw new Error(
      `ai_error: ${responseText || `HTTP ${response.status} ${response.statusText}`}`,
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = json.choices?.[0]?.message?.content ?? "";

  return applyDetectedPhone(
    ensureValidResult(parseResult(content)),
    ctx.customerPhone,
  );
}

// ============================================================
// FUNCIÓN PRINCIPAL - CON MÚLTIPLES PROVEEDORES
// ============================================================

export async function generateAiReply(
  ctx: AiContext,
): Promise<AiResult> {
  // 🔥 LOG PARA DEBUG - VER QUÉ PROVEEDOR ESTÁ CONFIGURADO
  console.log(`[AI] Proveedor configurado: ${ctx.provider || 'gemini'}`);
  console.log(`[AI] Groq API Key: ${ctx.groqApiKey ? '✅ Configurada' : '❌ No configurada'}`);
  console.log(`[AI] Gemini API Key: ${ctx.geminiApiKey ? '✅ Configurada' : '❌ No configurada'}`);

  // Determinar el proveedor a usar
  const provider = ctx.provider || "gemini";
  
  // Mapa de proveedores a sus respectivas funciones
  const providerHandlers: Record<AiProvider, () => Promise<AiResult>> = {
    gemini: async () => {
      const key = ctx.geminiApiKey?.trim();
      if (!key) {
        throw new Error("Falta GEMINI_API_KEY para el proveedor Gemini");
      }
      return await generateWithGemini(ctx, key);
    },
    groq: async () => {
      const key = ctx.groqApiKey?.trim();
      if (!key) {
        throw new Error("Falta GROQ_API_KEY para el proveedor Groq");
      }
      return await generateWithGroq(ctx);
    },
    openrouter: async () => {
      const key = ctx.openrouterApiKey?.trim();
      if (!key) {
        throw new Error("Falta OPENROUTER_API_KEY para el proveedor OpenRouter");
      }
      return await generateWithOpenRouter(ctx);
    },
    cloudflare: async () => {
      const key = ctx.cloudflareApiKey?.trim();
      if (!key) {
        throw new Error("Falta CLOUDFLARE_API_KEY para el proveedor Cloudflare");
      }
      return await generateWithCloudflare(ctx);
    },
  };

  // Intentar con el proveedor seleccionado
  const handler = providerHandlers[provider as AiProvider] || providerHandlers.gemini;
  
  try {
    console.log(`[AI] Intentando con proveedor: ${provider}`);
    const result = await handler();
    console.log(`[AI] Respuesta exitosa de ${provider}`);
    return result;
  } catch (primaryError) {
    console.error(`[AI] El proveedor ${provider} falló:`, primaryError);

    const errorMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    
    // Si es un error de rate limiting o autenticación, no intentamos otros proveedores
    if (
      errorMsg.includes("rate_limited") ||
      errorMsg.includes("401") ||
      errorMsg.includes("403") ||
      errorMsg.includes("authentication")
    ) {
      throw primaryError;
    }

    // 🔥 SI EL PROVEEDOR ES GROQ Y FALLA, INTENTAR CON GEMINI
    if (provider === "groq" && ctx.geminiApiKey?.trim()) {
      try {
        console.log("[AI] Fallback: Groq falló, intentando con Gemini...");
        return await generateWithGemini(ctx, ctx.geminiApiKey.trim());
      } catch (geminiError) {
        console.error("[AI] Gemini fallback también falló:", geminiError);
      }
    }

    // Intentar con Gateway de Lovable como último recurso
    try {
      console.log("[AI] Fallback: Usando Lovable Gateway...");
      return await generateWithGateway(ctx);
    } catch (gatewayError) {
      console.error("[AI] Gateway fallback también falló:", gatewayError);
      throw new Error(
        `Todos los proveedores de IA fallaron. Proveedor primario (${provider}): ${errorMsg}. ` +
        `Gateway: ${gatewayError instanceof Error ? gatewayError.message : String(gatewayError)}`
      );
    }
  }
}

// ============================================================
// EXPORTACIONES PARA USO EXTERNO
// ============================================================

export {
  buildSystemPrompt,
  parseResult,
  ensureValidResult,
  applyDetectedPhone,
};

export default {
  generateAiReply,
  buildSystemPrompt,
  parseResult,
  ensureValidResult,
  applyDetectedPhone,
};
