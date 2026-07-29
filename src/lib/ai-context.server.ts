import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AiContext } from "@/lib/ai.server";

type Client = SupabaseClient<Database>;

export async function buildWorkspaceAiContext(
  supabase: Client,
  workspaceId: string,
  history: { role: "user" | "assistant"; content: string }[],
  activeProductId: string | null = null,
): Promise<AiContext> {
  const [aiSettings, settings, products, training] = await Promise.all([
    supabase.from("ai_settings").select("system_instruction").eq("workspace_id", workspaceId).maybeSingle(),
    supabase
      .from("user_settings")
      .select("business_name, currency")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase
      .from("products")
      .select(
        "id, name, price, promo_price, stock, sales_copy, description, delivery_info, ai_instructions, product_keywords(keyword)",
      )
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
    supabase
      .from("training_entries")
      .select("title, content, category, priority")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
  ]);

  return {
    systemInstruction: aiSettings.data?.system_instruction ?? "",
    businessName: settings.data?.business_name ?? "",
    currency: settings.data?.currency ?? "PYG",
    products: (products.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      promo_price: p.promo_price === null ? null : Number(p.promo_price),
      stock: p.stock,
      sales_copy: p.sales_copy,
      description: p.description,
      delivery_info: p.delivery_info,
      ai_instructions: p.ai_instructions,
      keywords: (p.product_keywords ?? []).map((k) => k.keyword),
    })),
    training: training.data ?? [],
    history,
    activeProductId,
  };
}
