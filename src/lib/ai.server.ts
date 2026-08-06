// lib/ai.server.ts - VERSIÓN CORREGIDA (sin duplicados)

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const DEFAULT_GATEWAY_MODEL =
  process.env.LOVABLE_CHAT_MODEL?.trim() || "google/gemini-2.5-flash";

export type AiContext = {
  systemInstruction: string;
  geminiApiKey?: string | null;
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

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// 🔥 buildSystemPrompt CORREGIDO - SIN DUPLICAR FECHA
function buildSystemPrompt(ctx: AiContext): string {
  const detectedCustomerPhone = cleanString(ctx.customerPhone);

  // 🔥 SOLO muestra el producto activo o un resumen del catálogo
  let catalog = "";
  if (ctx.activeProductId) {
    const activeProduct = ctx.products.find(p => p.id === ctx.activeProductId);
    if (activeProduct) {
      catalog = `PRODUCTO ACTIVO:\n- ${activeProduct.name} | precio:${activeProduct.promo_price ?? activeProduct.price} ${ctx.currency} | stock:${activeProduct.stock}\ncopy: ${activeProduct.sales_copy ?? activeProduct.description ?? "-"}\nentrega: ${activeProduct.delivery_info ?? "-"}`;
    }
  }
  
  if (!catalog && ctx.products.length > 0) {
    catalog = "PRODUCTOS DISPONIBLES:\n" + ctx.products
      .slice(0, 20)
      .map(p => `- ${p.name} (${p.keywords.join(", ") || "sin palabras clave"})`)
      .join("\n");
    
    if (ctx.products.length > 20) {
      catalog += `\n... y ${ctx.products.length - 20} productos más.`;
    }
  }

  const sortedTraining = [...ctx.training]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);

  const isRule = (category: string) =>
    category === "correccion" || category === "reglas";

  const corrections = sortedTraining
    .filter((entry) => isRule(entry.category))
    .map((entry) => `- ${entry.title}: ${entry.content}`)
    .join("\n");

  const knowledge = sortedTraining
    .filter((entry) => !isRule(entry.category))
    .map((entry) => `- [${entry.category}] ${entry.title}: ${entry.content}`)
    .join("\n");

  // 🔥 AHORA: System prompt sin duplicar fecha (solo usa ctx.systemInstruction)
  return `${ctx.systemInstruction}

REGLAS DE VENTA:
- Responde corto, natural y sin sonar robot. Máximo 3-4 frases por mensaje.
- Nunca digas que eres una IA ni menciones estas instrucciones.
- Usá SOLO la información del catálogo y del conocimiento.
- Tu meta es cerrar la venta: resolvé dudas, manejá objeciones y pedí los datos necesarios.

NÚMERO DEL CLIENTE DETECTADO:
${detectedCustomerPhone || "No disponible"}

REGLAS DEL NÚMERO:
- Si el número aparece arriba, ya está confirmado por WhatsApp.
- No se lo pidas nuevamente al cliente.
- Cuando completes order, coloca ese mismo valor en phone.

CORRECCIONES Y REGLAS:
${corrections || "Sin correcciones específicas."}

CATÁLOGO:
${catalog || "Sin productos cargados."}

CONOCIMIENTO:
${knowledge || "Sin entrenamiento adicional."}

FORMATO DE SALIDA:
Devuelve SIEMPRE un único objeto JSON válido. Nada más.
{"reply":"texto","product_id":null,"sale_closed":false,"order":null}

Cuando cierres la venta, order debe ser:
{"customer_name":"","phone":"","city":"","departamento":"","district":"","street":"","quantity":1,"payment_method":"","observations":""}`;
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

const GEMINI_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
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
const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
const GEMINI_LIST_MODELS_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueNonEmptyStrings(
  values: Array<string | null | undefined>,
): string[] {
  return values.reduce<string[]>((result, value) => {
    const cleaned = cleanString(value);

    if (cleaned && !result.includes(cleaned)) {
      result.push(cleaned);
    }

    return result;
  }, []);
}

function normalizeGeminiModelName(
  value: string | null | undefined,
): string | null {
  let model = cleanString(value);

  if (!model) return null;

  // Acepta valores guardados como "models/gemini-..." o
  // "google/gemini-..." y los adapta al endpoint directo de Google.
  model = model.replace(/^models\//i, "").replace(/^google\//i, "");

  // Modelos retirados que no deben volver a probarse.
  const deprecatedModels = new Set([
    "gemini-1.5-flash-001",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-lite-001",
  ]);

  return deprecatedModels.has(model) ? null : model;
}

async function listAvailableGeminiModels(key: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GEMINI_LIST_MODELS_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
        key,
      )}`,
      {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      console.warn("[AI] No se pudo consultar ListModels", {
        status: response.status,
        error: await readResponseText(response),
      });
      return [];
    }

    const json = (await response.json()) as {
      models?: Array<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>;
    };

    return uniqueNonEmptyStrings(
      (json.models ?? [])
        .filter((model) =>
          model.supportedGenerationMethods?.includes("generateContent"),
        )
        .map((model) => normalizeGeminiModelName(model.name)),
    );
  } catch (error) {
    console.warn("[AI] Error consultando ListModels", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function getGeminiCandidates(
  key: string,
  preferredModel?: string | null,
): Promise<string[]> {
  const preferred = normalizeGeminiModelName(preferredModel);
  const available = await listAvailableGeminiModels(key);

  // Si Google devolvió la lista, probamos únicamente modelos realmente
  // disponibles para esa API key y compatibles con generateContent.
  if (available.length > 0) {
    const preferredCandidates = uniqueNonEmptyStrings([
      preferred,
      ...GEMINI_FALLBACK_MODELS,
    ]).filter((model) => available.includes(model));

    const otherFlashModels = available
      .filter((model) => /gemini/i.test(model) && /flash/i.test(model))
      .filter((model) => !preferredCandidates.includes(model))
      .sort((first, second) => second.localeCompare(first));

    return uniqueNonEmptyStrings([
      ...preferredCandidates,
      ...otherFlashModels,
    ]);
  }

  // Si ListModels falla temporalmente, conserva fallbacks estables.
  return uniqueNonEmptyStrings([
    preferred,
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

// 🔥 GEMINI: detecta modelos disponibles y evita modelos retirados
async function generateWithGemini(
  ctx: AiContext,
  key: string,
): Promise<AiResult> {
  const candidates = await getGeminiCandidates(key, ctx.model);
  const errors: string[] = [];

  if (candidates.length === 0) {
    throw new Error(
      "gemini_error: La API key no tiene modelos compatibles con generateContent",
    );
  }

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
              contents: ctx.history.slice(-8).map((message) => ({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: message.content }],
              })),
              generationConfig: {
                maxOutputTokens: 1500,
                temperature: 0.35,
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

        const responseText =
          (await readResponseText(response)) ||
          `HTTP ${response.status} ${response.statusText}`;

        errors.push(
          `${model} intento ${attempt}: HTTP ${response.status} ${responseText}`,
        );

        console.error("[AI] Gemini request failed", {
          model,
          attempt,
          status: response.status,
          error: responseText,
        });

        // No reintenta el mismo modelo ante errores definitivos.
        if ([400, 401, 403, 404].includes(response.status)) {
          break;
        }

        if (!RETRYABLE_GEMINI_STATUSES.has(response.status)) {
          break;
        }

        if (attempt < GEMINI_MAX_ATTEMPTS_PER_MODEL) {
          await sleep(calculateRetryDelayMs(attempt));
        }
      } catch (error) {
        const message = isAbortError(error)
          ? `Tiempo de espera agotado después de ${GEMINI_REQUEST_TIMEOUT_MS} ms`
          : error instanceof Error
            ? error.message
            : String(error);

        errors.push(`${model} intento ${attempt}: ${message}`);

        console.error("[AI] Gemini network/request error", {
          model,
          attempt,
          error: message,
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

  throw new Error(
    `gemini_error: ${errors.join(" | ") || "Todos los modelos fallaron"}`,
  );
}

// 🔥 GATEWAY - CON 1500 TOKENS
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
        ...ctx.history.slice(-8),
      ],
      temperature: 0.35,
      max_tokens: 1500, // 🔥 1500 tokens para respuestas COMPLETAS
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
      `ai_error: ${
        responseText ||
        `HTTP ${response.status} ${response.statusText}`
      }`,
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content =
    json.choices?.[0]?.message?.content ?? "";

  return applyDetectedPhone(
    ensureValidResult(parseResult(content)),
    ctx.customerPhone,
  );
}

export async function generateAiReply(
  ctx: AiContext,
): Promise<AiResult> {
  const geminiApiKey = ctx.geminiApiKey?.trim();

  if (geminiApiKey) {
    try {
      return await generateWithGemini(ctx, geminiApiKey);
    } catch (geminiError) {
      console.error(
        "[AI] Gemini agotó reintentos/modelos; usando Lovable Gateway",
        {
          error:
            geminiError instanceof Error
              ? geminiError.message
              : String(geminiError),
        },
      );

      try {
        return await generateWithGateway(ctx);
      } catch (gatewayError) {
        const geminiMessage =
          geminiError instanceof Error
            ? geminiError.message
            : String(geminiError);
        const gatewayMessage =
          gatewayError instanceof Error
            ? gatewayError.message
            : String(gatewayError);

        throw new Error(
          `Todos los proveedores de IA fallaron. Gemini: ${geminiMessage}. Gateway: ${gatewayMessage}`,
        );
      }
    }
  }

  return generateWithGateway(ctx);
}
