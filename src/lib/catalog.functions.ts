import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type CatalogMedia = { id: string; media_type: string; url: string };
export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  sales_copy: string | null;
  price: number;
  promo_price: number | null;
  delivery_info: string | null;
  keywords: string[];
  media: CatalogMedia[];
};
export type CatalogData = {
  workspaceName: string;
  phone: string | null;
  enabled: boolean;
  products: CatalogProduct[];
};

function publicClient() {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(process.env.SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export const getPublicCatalog = createServerFn({ method: "GET" })
  .inputValidator((data: { workspaceId: string; productId?: string }) => data)
  .handler(async ({ data }): Promise<CatalogData> => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(data.workspaceId)) {
      return { workspaceName: "", phone: null, enabled: false, products: [] };
    }

    const sb = publicClient();
    const { data: ws } = await sb
      .from("workspaces")
      .select("id, name")
      .eq("id", data.workspaceId)
      .maybeSingle();
    if (!ws) return { workspaceName: "", phone: null, enabled: false, products: [] };

    let query = sb
      .from("products")
      .select(
        "id, name, description, sales_copy, price, promo_price, delivery_info, created_at, product_media(id, media_type, storage_path, position), product_keywords(keyword)",
      )
      .eq("workspace_id", data.workspaceId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (data.productId) query = query.eq("id", data.productId);
    const { data: rows } = await query;

    // Privileged reads limited to the storefront phone + catalog switch + signed media URLs.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: settings }, { data: conn }] = await Promise.all([
      supabaseAdmin
        .from("user_settings")
        .select("catalog_enabled, business_name")
        .eq("workspace_id", data.workspaceId)
        .maybeSingle(),
      supabaseAdmin
        .from("whatsapp_connections")
        .select("display_phone")
        .eq("workspace_id", data.workspaceId)
        .maybeSingle(),
    ]);

    const enabled = settings?.catalog_enabled !== false;
    if (!enabled) {
      return { workspaceName: settings?.business_name || ws.name, phone: null, enabled: false, products: [] };
    }

    const products: CatalogProduct[] = [];
    for (const p of rows ?? []) {
      const media: CatalogMedia[] = [];
      const items = [...(p.product_media ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      for (const m of items) {
        if (!m.storage_path) continue;
        const { data: signed } = await supabaseAdmin.storage
          .from("product-media")
          .createSignedUrl(m.storage_path, 60 * 60 * 6);
        if (signed?.signedUrl) media.push({ id: m.id, media_type: m.media_type, url: signed.signedUrl });
      }
      products.push({
        id: p.id,
        name: p.name,
        description: p.description,
        sales_copy: p.sales_copy,
        price: Number(p.price ?? 0),
        promo_price: p.promo_price === null ? null : Number(p.promo_price),
        delivery_info: p.delivery_info,
        keywords: (p.product_keywords ?? []).map((k) => k.keyword),
        media,
      });
    }

    return {
      workspaceName: settings?.business_name || ws.name,
      phone: (conn?.display_phone ?? "").replace(/[^0-9]/g, "") || null,
      enabled: true,
      products,
    };
  });
