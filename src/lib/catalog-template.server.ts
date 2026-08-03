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
  storage: {
    from: (bucket: string) => any;
  };
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
const SIGNED_URL_SECONDS = 60 * 60 * 6;

const normalize = (value: string) =>
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
 * Supabase Storage necesita solamente la ruta interna del archivo.
 *
 * Correcto:
 * workspace-id/product-id/archivo.jpg
 *
 * Incorrecto:
 * product-media/workspace-id/product-id/archivo.jpg
 */
function normalizeStoragePath(path: string): string {
  let normalizedPath = path.trim().replace(/^\/+/, "");

  const bucketPrefix = `${PRODUCT_MEDIA_BUCKET}/`;

  if (normalizedPath.startsWith(bucketPrefix)) {
    normalizedPath = normalizedPath.slice(bucketPrefix.length);
  }

  /*
   * También admite una URL pública de Supabase que accidentalmente
   * se haya guardado dentro de storage_path.
   */
  const publicMarker = `/storage/v1/object/public/${PRODUCT_MEDIA_BUCKET}/`;
  const signedMarker = `/storage/v1/object/sign/${PRODUCT_MEDIA_BUCKET}/`;

  if (normalizedPath.includes(publicMarker)) {
    normalizedPath =
      normalizedPath.split(publicMarker)[1]?.split("?")[0] ?? normalizedPath;
  }

  if (normalizedPath.includes(signedMarker)) {
    normalizedPath =
      normalizedPath.split(signedMarker)[1]?.split("?")[0] ?? normalizedPath;
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

async function resolveProductMediaUrl(
  supabase: AnyClient,
  media: ProductMediaRow,
): Promise<string | null> {
  const storagePathValue = media.storage_path?.trim() ?? "";
  const urlValue = media.url?.trim() ?? "";

  /*
   * Preferimos storage_path porque es el campo correcto para archivos
   * subidos a Supabase Storage.
   */
  const rawValue = storagePathValue || urlValue;

  if (!rawValue) {
    console.warn("[CatalogTemplate] Archivo sin ruta", {
      mediaType: media.media_type,
      storagePath: media.storage_path,
      url: media.url,
    });

    return null;
  }

  /*
   * Cuando url ya es una URL completa, puede usarse directamente.
   * storage_path, en cambio, siempre debe tratarse como ruta interna.
   */
  if (!storagePathValue && isCompleteUrl(urlValue)) {
    return urlValue;
  }

  const storagePath = normalizeStoragePath(rawValue);

  if (!storagePath) {
    console.warn("[CatalogTemplate] Ruta normalizada vacía", {
      rawValue,
      mediaType: media.media_type,
    });

    return null;
  }

  const { data, error } = await supabase.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);

  if (error) {
    console.error(
      "[CatalogTemplate] No se pudo crear la URL firmada del producto",
      {
        bucket: PRODUCT_MEDIA_BUCKET,
        originalStoragePath: media.storage_path,
        originalUrl: media.url,
        normalizedStoragePath: storagePath,
        message: error.message,
      },
    );

    /*
     * Solo usamos url como respaldo cuando realmente es una URL completa.
     * Nunca devolvemos una ruta interna inválida como si fuera URL.
     */
    if (isCompleteUrl(urlValue)) {
      return urlValue;
    }

    return null;
  }

  if (!data?.signedUrl) {
    console.error(
      "[CatalogTemplate] Supabase no devolvió una URL firmada",
      {
        bucket: PRODUCT_MEDIA_BUCKET,
        storagePath,
      },
    );

    if (isCompleteUrl(urlValue)) {
      return urlValue;
    }

    return null;
  }

  return data.signedUrl;
}

function buildPriceLines(product: ProductRow): string[] {
  const prices = [...(product.product_prices ?? [])]
    .filter(
      (item) =>
        Boolean(item?.label?.trim()) &&
        Number(item?.quantity) > 0 &&
        Number(item?.price) > 0,
    )
    .sort(
      (first, second) =>
        Number(first.sort_order ?? 0) - Number(second.sort_order ?? 0),
    );

  if (prices.length > 0) {
    return prices.map(
      (item) => `💰 ${item.label}: ${formatGs(Number(item.price))}`,
    );
  }

  /*
   * Compatibilidad con columnas antiguas.
   */
  const regularPrice = Number(product.price ?? 0);
  const promoPrice =
    product.promo_price !== null && Number(product.promo_price) > 0
      ? Number(product.promo_price)
      : null;

  if (promoPrice) {
    return [
      `💰 ${formatGs(promoPrice)}${
        regularPrice > 0
          ? ` (antes ${formatGs(regularPrice)})`
          : ""
      }`,
    ];
  }

  if (regularPrice > 0) {
    return [`💰 ${formatGs(regularPrice)}`];
  }

  return [];
}

/**
 * Detecta la palabra clave de un producto y arma la plantilla
 * multimedia más el copy que se enviará en el chat.
 */
export async function buildKeywordTemplate(
  supabase: AnyClient,
  workspaceId: string,
  text: string,
): Promise<CatalogTemplate | null> {
  const haystack = normalize(text ?? "");

  if (!haystack || !workspaceId) {
    return null;
  }

  const { data: keywords, error: keywordsError } = await supabase
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
      "[CatalogTemplate] No se pudieron consultar las palabras clave",
      {
        workspaceId,
        message: keywordsError.message,
      },
    );

    throw new Error(
      `No se pudieron consultar las palabras clave: ${keywordsError.message}`,
    );
  }

  if (!keywords?.length) {
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

    const expression = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapedKeyword}([^\\p{L}\\p{N}]|$)`,
      "u",
    );

    if (
      expression.test(haystack) &&
      keyword.length > matchedKeywordLength
    ) {
      matchedRow = row;
      matchedKeywordLength = keyword.length;
    }
  }

  const product = matchedRow
    ? getProductFromRelation(matchedRow.products)
    : null;

  if (!product) {
    return null;
  }

  const { data: media, error: mediaError } = await supabase
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
      "[CatalogTemplate] No se pudieron consultar los archivos del producto",
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

  const mediaRows = (media ?? []).slice(0, 8) as ProductMediaRow[];

  const resolvedMedia = await Promise.all(
    mediaRows.map(async (mediaItem) => {
      const url = await resolveProductMediaUrl(supabase, mediaItem);

      if (!url) {
        return null;
      }

      return {
        type: getMediaType(mediaItem.media_type),
        url,
      } satisfies CatalogTemplate["media"][number];
    }),
  );

  const items = resolvedMedia.filter(
    (
      item,
    ): item is CatalogTemplate["media"][number] => item !== null,
  );

  const priceLines = buildPriceLines(product);

  const copy = [
    `*${product.name}*`,
    ...priceLines,
    (product.sales_copy || product.description || "").trim(),
    product.delivery_info
      ? `🚚 ${product.delivery_info.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    productId: product.id,
    name: product.name,
    copy,
    media: items,
  };
}
