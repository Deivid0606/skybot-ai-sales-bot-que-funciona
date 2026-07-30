import { formatGs } from "@/lib/format";

export type CatalogTemplate = {
  productId: string;
  name: string;
  copy: string;
  media: { type: "image" | "video" | "audio" | "document"; url: string }[];
};

type AnyClient = {
  from: (table: string) => any;
  storage: { from: (bucket: string) => any };
};

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/**
 * Detecta la palabra clave de un producto en el texto y arma la plantilla
 * (multimedia + copy) tal como se enviaría por WhatsApp.
 */
export async function buildKeywordTemplate(
  supabase: AnyClient,
  workspaceId: string,
  text: string,
): Promise<CatalogTemplate | null> {
  const haystack = normalize(text ?? "");
  if (!haystack) return null;

  const { data: keywords } = await supabase
    .from("product_keywords")
    .select(
      "keyword, product_id, products!inner(id, name, price, promo_price, sales_copy, description, delivery_info, is_active)",
    )
    .eq("workspace_id", workspaceId);
  if (!keywords?.length) return null;

  type Row = {
    keyword: string | null;
    products: {
      id: string;
      name: string;
      price: number | null;
      promo_price: number | null;
      sales_copy: string | null;
      description: string | null;
      delivery_info: string | null;
      is_active: boolean;
    } | null;
  };

  let match: Row | null = null;
  for (const row of keywords as Row[]) {
    if (!row.products || row.products.is_active === false) continue;
    const k = normalize(row.keyword ?? "");
    if (!k) continue;
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`,
      "u",
    );
    if (re.test(haystack) && (!match || k.length > normalize(match.keyword ?? "").length)) {
      match = row;
    }
  }
  const p = match?.products;
  if (!p) return null;

  const { data: media } = await supabase
    .from("product_media")
    .select("url, storage_path, media_type, position")
    .eq("product_id", p.id)
    .order("position", { ascending: true });

  const items: CatalogTemplate["media"] = [];
  for (const m of (media ?? []).slice(0, 8)) {
    let link: string | null = m.url ?? null;
    if (m.storage_path) {
      const { data: signed } = await supabase.storage
        .from("product-media")
        .createSignedUrl(m.storage_path, 60 * 60 * 6);
      if (signed?.signedUrl) link = signed.signedUrl;
    }
    if (!link) continue;
    const type = (["image", "video", "audio"].includes(m.media_type) ? m.media_type : "document") as
      CatalogTemplate["media"][number]["type"];
    items.push({ type, url: link });
  }

  const promo = p.promo_price !== null && Number(p.promo_price) > 0 ? Number(p.promo_price) : null;
  const priceLine = promo
    ? `💰 ${formatGs(promo)} (antes ${formatGs(Number(p.price ?? 0))})`
    : `💰 ${formatGs(Number(p.price ?? 0))}`;

  const copy = [
    `*${p.name}*`,
    priceLine,
    (p.sales_copy || p.description || "").trim(),
    p.delivery_info ? `🚚 ${p.delivery_info}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { productId: p.id, name: p.name, copy, media: items };
}
