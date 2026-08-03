import { formatGs } from "@/lib/format";

export type CatalogTemplate = {
  productId: string;
  name: string;
  copy: string;
  media: {
    type: "image" | "video" | "audio" | "document";
    url: string;
  }[];
};

type AnyClient = {
  from: (table: string) => any;
};

type ProductPrice = {
  label: string;
  quantity: number;
  price: number;
  sort_order: number;
};

type ProductRow = {
  id: string;
  name: string;
  price: number | null;
  promo_price: number | null;
  sales_copy: string | null;
  description: string | null;
  delivery_info: string | null;
  is_active: boolean;
  product_prices?: ProductPrice[] | null;
};

type KeywordRow = {
  keyword: string | null;
  product_id: string;
  products: ProductRow | ProductRow[] | null;
};

type ProductMediaRow = {
  url: string | null;
  storage_path: string | null;
  media_type: string | null;
  position: number | null;
};

const PRODUCT_MEDIA_BUCKET = "product-media";

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

function isCompleteUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    value.startsWith("blob:") ||
    value.startsWith("data:")
  );
}

/**
 * Convierte distintos formatos posibles en una ruta válida.
 *
 * Admite:
 * workspace/producto/imagen.jpg
 * product-media/workspace/producto/imagen.jpg
 * URL pública o firmada completa
 */
function normalizeMediaPath(value: string): string {
  const originalValue = value.trim();

  if (!originalValue) {
    return "";
  }

  if (isCompleteUrl(originalValue)) {
    return originalValue;
  }

  let normalizedPath = originalValue.replace(/^\/+/, "");

  const bucketPrefix = `${PRODUCT_MEDIA_BUCKET}/`;

  if (normalizedPath.startsWith(bucketPrefix)) {
    normalizedPath = normalizedPath.slice(bucketPrefix.length);
  }

  try {
    return decodeURIComponent(normalizedPath);
  } catch {
    return normalizedPath;
  }
}

function getProductFromRelation(
  products: ProductRow | ProductRow[] | null,
): ProductRow | null {
  if (Array.isArray(products)) {
    return products[0] ?? null;
  }

  return products;
}

function getMediaType(
  value: string | null,
): CatalogTemplate["media"][number]["type"] {
  const normalizedType = value?.trim().toLowerCase();

  if (
    normalizedType === "image" ||
    normalizedType === "video" ||
    normalizedType === "audio"
  ) {
    return normalizedType;
  }

  return "document";
}

/**
 * Obtiene la ruta que ChatMedia firmará desde el navegador.
 *
 * No genera URLs firmadas en el servidor.
 */
function getProductMediaPath(media: ProductMediaRow): string | null {
  const storagePath =
    typeof media.storage_path === "string"
      ? media.storage_path.trim()
      : "";

  const legacyUrl =
    typeof media.url === "string"
      ? media.url.trim()
      : "";

  /*
   * storage_path es la fuente principal porque es donde Productos
   * guarda la ubicación real dentro del bucket product-media.
   */
  const rawValue = storagePath || legacyUrl;

  if (!rawValue) {
    console.warn("[CatalogTemplate] Archivo multimedia sin ruta", {
      mediaType: media.media_type,
      storagePath: media.storage_path,
      url: media.url,
    });

    return null;
  }

  const normalizedValue = normalizeMediaPath(rawValue);

  if (!normalizedValue) {
    console.warn("[CatalogTemplate] La ruta multimedia quedó vacía", {
      mediaType: media.media_type,
      storagePath: media.storage_path,
      url: media.url,
    });

    return null;
  }

  return normalizedValue;
}

function buildPriceLines(product: ProductRow): string[] {
  const prices = [...(product.product_prices ?? [])]
    .filter((item) => {
      const label = item?.label?.trim() ?? "";
      const quantity = Number(item?.quantity ?? 0);
      const price = Number(item?.price ?? 0);

      return Boolean(label) && quantity > 0 && price > 0;
    })
    .sort(
      (first, second) =>
        Number(first.sort_order ?? 0) -
        Number(second.sort_order ?? 0),
    );

  /*
   * Sistema actual de precios múltiples.
   */
  if (prices.length > 0) {
    return prices.map((item) => {
      const label = item.label.trim();
      const price = Number(item.price);

      return `💰 ${label}: ${formatGs(price)}`;
    });
  }

  /*
   * Compatibilidad con las columnas antiguas.
   */
  const regularPrice = Number(product.price ?? 0);

  const promoPrice =
    product.promo_price !== null &&
    Number(product.promo_price) > 0
      ? Number(product.promo_price)
      : null;

  if (promoPrice) {
    if (regularPrice > 0) {
      return [
        `💰 ${formatGs(promoPrice)} (antes ${formatGs(
          regularPrice,
        )})`,
      ];
    }

    return [`💰 ${formatGs(promoPrice)}`];
  }

  if (regularPrice > 0) {
    return [`💰 ${formatGs(regularPrice)}`];
  }

  return [];
}

/**
 * Detecta una palabra clave del producto y construye la plantilla
 * con su copy, precios y rutas multimedia.
 *
 * Las rutas multimedia se devuelven sin firmar.
 * ChatMedia se encarga de firmarlas desde el navegador utilizando
 * el bucket product-media y la sesión activa del usuario.
 */
export async function buildKeywordTemplate(
  supabase: AnyClient,
  workspaceId: string,
  text: string,
): Promise<CatalogTemplate | null> {
  const haystack = normalize(text ?? "");

  if (!workspaceId || !haystack) {
    return null;
  }

  const {
    data: keywords,
    error: keywordsError,
  } = await supabase
    .from("product_keywords")
    .select(
      `
        keyword,
        product_id,
        products!inner(
          id,
          name,
          price,
          promo_price,
          sales_copy,
          description,
          delivery_info,
          is_active,
          product_prices(
            label,
            quantity,
            price,
            sort_order
          )
        )
      `,
    )
    .eq("workspace_id", workspaceId);

  if (keywordsError) {
    console.error(
      "[CatalogTemplate] Error consultando palabras clave",
      {
        workspaceId,
        message: keywordsError.message,
      },
    );

    throw new Error(
      `No se pudieron consultar las palabras clave: ${keywordsError.message}`,
    );
  }

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return null;
  }

  let matchedRow: KeywordRow | null = null;
  let matchedKeywordLength = 0;

  for (const row of keywords as KeywordRow[]) {
    const product = getProductFromRelation(row.products);

    if (!product || product.is_active === false) {
      continue;
    }

    const keyword = normalize(row.keyword ?? "");

    if (!keyword) {
      continue;
    }

    const escapedKeyword = keyword.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    const keywordExpression = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapedKeyword}([^\\p{L}\\p{N}]|$)`,
      "u",
    );

    if (
      keywordExpression.test(haystack) &&
      keyword.length > matchedKeywordLength
    ) {
      matchedRow = row;
      matchedKeywordLength = keyword.length;
    }
  }

  if (!matchedRow) {
    return null;
  }

  const product = getProductFromRelation(matchedRow.products);

  if (!product) {
    return null;
  }

  const {
    data: media,
    error: mediaError,
  } = await supabase
    .from("product_media")
    .select("url, storage_path, media_type, position")
    .eq("workspace_id", workspaceId)
    .eq("product_id", product.id)
    .order("position", {
      ascending: true,
      nullsFirst: false,
    });

  if (mediaError) {
    console.error(
      "[CatalogTemplate] Error consultando multimedia del producto",
      {
        workspaceId,
        productId: product.id,
        message: mediaError.message,
      },
    );

    throw new Error(
      `No se pudieron consultar los archivos del producto: ${mediaError.message}`,
    );
  }

  const mediaRows = Array.isArray(media)
    ? (media as ProductMediaRow[]).slice(0, 8)
    : [];

  const items: CatalogTemplate["media"] = [];

  for (const mediaItem of mediaRows) {
    const path = getProductMediaPath(mediaItem);

    if (!path) {
      continue;
    }

    items.push({
      type: getMediaType(mediaItem.media_type),
      url: path,
    });
  }

  console.log("[CatalogTemplate] Plantilla generada", {
    workspaceId,
    productId: product.id,
    productName: product.name,
    mediaCount: items.length,
    media: items,
  });

  const priceLines = buildPriceLines(product);

  const salesContent = (
    product.sales_copy ||
    product.description ||
    ""
  ).trim();

  const deliveryContent = product.delivery_info?.trim()
    ? `🚚 ${product.delivery_info.trim()}`
    : "";

  const copy = [
    `*${product.name}*`,
    ...priceLines,
    salesContent,
    deliveryContent,
  ]
    .filter((value) => Boolean(value?.trim()))
    .join("\n\n");

  return {
    productId: product.id,
    name: product.name,
    copy,
    media: items,
  };
}
