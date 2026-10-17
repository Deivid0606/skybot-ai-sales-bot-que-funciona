import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiContext } from "@/lib/ai.server";

type Client = SupabaseClient;
const DEFAULT_TIME_ZONE = "America/Asuncion";

function currentTimeInstruction(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("es-PY", {
    timeZone: DEFAULT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (part: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === part)?.value ?? "";
  const hour = Number(get("hour"));
  const greeting = hour >= 5 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 19 ? "Buenas tardes" : "Buenas noches";
  const period = hour >= 5 && hour < 12 ? "mañana" : hour >= 12 && hour < 19 ? "tarde" : hour >= 19 || hour < 1 ? "noche" : "madrugada";
  return [
    "FECHA Y HORA ACTUAL DEL NEGOCIO:",
    `- Zona horaria: ${DEFAULT_TIME_ZONE}`,
    `- Día actual: ${get("weekday")}`,
    `- Fecha actual: ${new Intl.DateTimeFormat("es-PY", { timeZone: DEFAULT_TIME_ZONE, year:"numeric",month:"long",day:"numeric"}).format(now)}`,
    `- Hora actual: ${get("hour")}:${get("minute")}`,
    `- Momento del día: ${period}`,
    `- Saludo apropiado: ${greeting}`,
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

export async function buildWorkspaceAiContext(
  supabase: Client,
  workspaceId: string,
  history: { role: "user" | "assistant"; content: string }[],
  activeProductId: string | null = null,
  customerPhone: string | null = null,
): Promise<AiContext> {
  const [aiSettingsResult, settingsResult, productsResult, trainingResult] = await Promise.all([
    supabase.from("ai_settings").select("system_instruction, gemini_api_key, gemini_api_key_2, gemini_api_key_3, openai_api_key, provider_order, provider_models, model, autodetect_model").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("user_settings").select("business_name, currency").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("products").select(`
      id, name, sku, price, promo_price, stock, sales_copy, description, delivery_info, ai_instructions,
      product_keywords(keyword), product_prices(id, label, quantity, price, sort_order)
    `).eq("workspace_id", workspaceId).eq("is_active", true),
    supabase.from("training_entries").select("title, content, category, priority").eq("workspace_id", workspaceId).eq("is_active", true),
  ]);
  for (const result of [aiSettingsResult, settingsResult, productsResult, trainingResult]) {
    if (result.error) throw result.error;
  }
  const products = (productsResult.data ?? []).map(product => {
    const productPrices = [...(product.product_prices ?? [])].map(option => ({
      id: option.id,
      label: String(option.label ?? "").trim(),
      quantity: Math.max(1, Math.floor(Number(option.quantity) || 1)),
      price: Number(option.price) || 0,
      sort_order: Number(option.sort_order) || 0,
    })).filter(option => Boolean(option.label) && Number.isFinite(option.price) && option.price > 0)
      .sort((a,b) => a.sort_order-b.sort_order);
    const legacy = Number(product.price);
    const legacyPromo = product.promo_price == null ? null : Number(product.promo_price);
    const fallbackPrice = productPrices[0]?.price ?? (legacyPromo !== null && Number.isFinite(legacyPromo) && legacyPromo > 0 ? legacyPromo : Number.isFinite(legacy) && legacy > 0 ? legacy : 0);
    return {
      id: product.id, name: product.name, sku: String(product.sku ?? "").trim() || null,
      price: fallbackPrice,
      promo_price: legacyPromo !== null && Number.isFinite(legacyPromo) && legacyPromo > 0 ? legacyPromo : null,
      stock: product.stock, sales_copy: product.sales_copy, description: product.description,
      delivery_info: product.delivery_info, ai_instructions: product.ai_instructions,
      keywords: (product.product_keywords ?? []).map(k => String(k.keyword ?? "").trim().toLowerCase()).filter(Boolean),
      product_prices: productPrices,
    };
  });
  return {
    systemInstruction: [currentTimeInstruction(), "INSTRUCCIONES GENERALES DEL NEGOCIO:", aiSettingsResult.data?.system_instruction ?? ""].join("\n\n"),
    geminiApiKey: aiSettingsResult.data?.gemini_api_key ?? null,
    geminiApiKey2: aiSettingsResult.data?.gemini_api_key_2 ?? null,
    geminiApiKey3: aiSettingsResult.data?.gemini_api_key_3 ?? null,
    openaiApiKey: aiSettingsResult.data?.openai_api_key ?? null,
    providerOrder: aiSettingsResult.data?.provider_order ?? null,
    providerModels: aiSettingsResult.data?.provider_models ?? null,
    model: aiSettingsResult.data?.autodetect_model ? null : aiSettingsResult.data?.model ?? null,
    customerPhone,
    businessName: settingsResult.data?.business_name ?? "",
    currency: settingsResult.data?.currency ?? "PYG",
    products, training: trainingResult.data ?? [], history, activeProductId,
  };
}
