import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AiContext } from "@/lib/ai.server";

type Client = SupabaseClient<Database>;

const DEFAULT_TIME_ZONE = "America/Asuncion";

type CurrentTimeContext = {
  timeZone: string;
  weekday: string;
  date: string;
  time: string;
  hour: number;
  minute: number;
  period: "madrugada" | "mañana" | "tarde" | "noche";
  greeting:
    | "Buenos días"
    | "Buenas tardes"
    | "Buenas noches";
};

function getCurrentTimeContext(
  timeZone = DEFAULT_TIME_ZONE,
): CurrentTimeContext {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("es-PY", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const getPart = (
    type: Intl.DateTimeFormatPartTypes,
  ): string =>
    parts.find((part) => part.type === type)?.value ??
    "";

  const hour = Number(getPart("hour"));
  const minute = Number(getPart("minute"));

  let period: CurrentTimeContext["period"];
  let greeting: CurrentTimeContext["greeting"];

  if (hour >= 5 && hour < 12) {
    period = "mañana";
    greeting = "Buenos días";
  } else if (hour >= 12 && hour < 19) {
    period = "tarde";
    greeting = "Buenas tardes";
  } else if (hour >= 19 || hour < 1) {
    period = "noche";
    greeting = "Buenas noches";
  } else {
    period = "madrugada";
    greeting = "Buenas noches";
  }

  const weekday = new Intl.DateTimeFormat("es-PY", {
    timeZone,
    weekday: "long",
  }).format(now);

  const date = new Intl.DateTimeFormat("es-PY", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const time = new Intl.DateTimeFormat("es-PY", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);

  return {
    timeZone,
    weekday,
    date,
    time,
    hour,
    minute,
    period,
    greeting,
  };
}

function buildCurrentTimeInstruction(
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const current = getCurrentTimeContext(timeZone);

  return [
    "FECHA Y HORA ACTUAL DEL NEGOCIO:",
    `- Zona horaria: ${current.timeZone}`,
    `- Día actual: ${current.weekday}`,
    `- Fecha actual: ${current.date}`,
    `- Hora actual: ${current.time}`,
    `- Momento del día: ${current.period}`,
    `- Saludo apropiado: ${current.greeting}`,
    "",
    "REGLAS TEMPORALES OBLIGATORIAS:",
    "- Usa exclusivamente la fecha y hora indicadas arriba como referencia actual.",
    "- No inventes otra fecha ni otra hora.",
    "- Si el cliente saluda o inicia una conversación, responde con el saludo apropiado al momento del día.",
    "- No menciones la hora actual en cada respuesta, salvo que el cliente pregunte la hora.",
    "- No repitas el saludo en todos los mensajes de la misma conversación.",
    "- Si el cliente pregunta qué día es, qué fecha es o qué hora es, responde usando estos datos.",
    "- Si el cliente pregunta si el negocio está abierto, compara la hora actual con los horarios configurados en el entrenamiento.",
    "- No inventes horarios de atención si no están configurados.",
  ].join("\n");
}

function mergeSystemInstruction(
  originalInstruction: string | null | undefined,
): string {
  const timeInstruction = buildCurrentTimeInstruction(
    DEFAULT_TIME_ZONE,
  );

  const original = originalInstruction?.trim() ?? "";

  if (!original) {
    return timeInstruction;
  }

  return `${timeInstruction}

INSTRUCCIONES GENERALES DEL NEGOCIO:
${original}`.trim();
}

// ============================================================
// FUNCIÓN PRINCIPAL ACTUALIZADA CON MÚLTIPLES PROVEEDORES
// ============================================================

export async function buildWorkspaceAiContext(
  supabase: Client,
  workspaceId: string,
  history: {
    role: "user" | "assistant";
    content: string;
  }[],
  activeProductId: string | null = null,
  customerPhone: string | null = null,
): Promise<AiContext> {
  // 🔥 OBTENER TODOS LOS DATOS INCLUYENDO TODAS LAS API KEYS
  const [
    aiSettingsResult,
    settingsResult,
    productsResult,
    trainingResult,
  ] = await Promise.all([
    supabase
      .from("ai_settings")
      .select(
        "system_instruction, gemini_api_key, groq_api_key, openrouter_api_key, cloudflare_api_key, provider, model, autodetect_model, ai_enabled"
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle(),

    supabase
      .from("user_settings")
      .select("business_name, currency")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),

    /*
     * Los precios reales del catálogo se encuentran
     * en product_prices.
     *
     * products.price y products.promo_price se conservan
     * solamente por compatibilidad con productos antiguos.
     */
    supabase
      .from("products")
      .select(`
        id,
        name,
        price,
        promo_price,
        stock,
        sales_copy,
        description,
        delivery_info,
        ai_instructions,
        product_keywords (
          keyword
        ),
        product_prices (
          id,
          label,
          quantity,
          price,
          sort_order
        )
      `)
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),

    supabase
      .from("training_entries")
      .select("title, content, category, priority")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
  ]);

  if (aiSettingsResult.error) {
    throw aiSettingsResult.error;
  }

  if (settingsResult.error) {
    throw settingsResult.error;
  }

  if (productsResult.error) {
    throw productsResult.error;
  }

  if (trainingResult.error) {
    throw trainingResult.error;
  }

  const products = (productsResult.data ?? []).map(
    (product) => {
      const productPrices = [
        ...(product.product_prices ?? []),
      ]
        .map((priceOption) => ({
          id: priceOption.id,
          label: String(priceOption.label ?? "").trim(),
          quantity: Math.max(
            1,
            Math.floor(Number(priceOption.quantity) || 1),
          ),
          price: Number(priceOption.price) || 0,
          sort_order:
            Number(priceOption.sort_order) || 0,
        }))
        .filter(
          (priceOption) =>
            Boolean(priceOption.label) &&
            Number.isFinite(priceOption.price) &&
            priceOption.price > 0,
        )
        .sort(
          (first, second) =>
            first.sort_order - second.sort_order,
        );

      /*
       * Precio heredado para mantener compatibilidad
       * con partes antiguas de la IA.
       *
       * Si existe product_prices, usamos como referencia
       * la primera opción válida.
       */
      const firstPriceOption =
        productPrices[0] ?? null;

      const legacyPrice = Number(product.price);
      const legacyPromoPrice =
        product.promo_price === null
          ? null
          : Number(product.promo_price);

      const fallbackPrice =
        firstPriceOption?.price ??
        (Number.isFinite(legacyPromoPrice) &&
        legacyPromoPrice !== null &&
        legacyPromoPrice > 0
          ? legacyPromoPrice
          : Number.isFinite(legacyPrice) &&
              legacyPrice > 0
            ? legacyPrice
            : 0);

      return {
        id: product.id,
        name: product.name,

        /*
         * Se mantiene price para no romper ai.server.ts.
         * Representa el total de la primera opción.
         */
        price: fallbackPrice,

        promo_price:
          Number.isFinite(legacyPromoPrice) &&
          legacyPromoPrice !== null &&
          legacyPromoPrice > 0
            ? legacyPromoPrice
            : null,

        stock: product.stock,
        sales_copy: product.sales_copy,
        description: product.description,
        delivery_info: product.delivery_info,
        ai_instructions: product.ai_instructions,

        keywords: (
          product.product_keywords ?? []
        )
          .map((keyword) =>
            String(keyword.keyword ?? "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),

        product_prices: productPrices,
      };
    },
  );

  // 🔥 OBTENER EL PROVEEDOR Y LAS KEYS
  const aiData = aiSettingsResult.data;
  
  // Determinar qué provider usar (prioridad: lo guardado en DB, o gemini por defecto)
  const provider = aiData?.provider || "gemini";
  
  // Log para debugging
  console.log(`[AI Context] Proveedor configurado: ${provider}`);
  console.log(`[AI Context] Groq API Key: ${aiData?.groq_api_key ? '✅ Configurada' : '❌ No configurada'}`);
  console.log(`[AI Context] Gemini API Key: ${aiData?.gemini_api_key ? '✅ Configurada' : '❌ No configurada'}`);

  return {
    systemInstruction: mergeSystemInstruction(
      aiData?.system_instruction,
    ),

    // 🔥 TODAS LAS API KEYS
    geminiApiKey: aiData?.gemini_api_key ?? null,
    groqApiKey: aiData?.groq_api_key ?? null,
    openrouterApiKey: aiData?.openrouter_api_key ?? null,
    cloudflareApiKey: aiData?.cloudflare_api_key ?? null,

    // 🔥 EL PROVEEDOR SELECCIONADO
    provider: provider,

    model: aiData?.autodetect_model
      ? null
      : (aiData?.model ?? null),

    customerPhone,

    businessName:
      settingsResult.data?.business_name ?? "",

    currency:
      settingsResult.data?.currency ?? "PYG",

    products,

    training: trainingResult.data ?? [],

    history,

    activeProductId,
  };
}
