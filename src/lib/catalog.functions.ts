import { createServerFn } from "@tanstack/react-start";

export type CatalogMedia = {
  id: string;
  media_type: string;
  url: string;
};

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

type CatalogInput = {
  workspaceId: string;
  productId?: string;
};

const EMPTY_CATALOG: CatalogData = {
  workspaceName: "",
  phone: null,
  enabled: false,
  products: [],
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export const getPublicCatalog = createServerFn({ method: "GET" })
  .inputValidator((data: CatalogInput) => {
    if (!data || typeof data.workspaceId !== "string") {
      throw new Error("Falta el ID del workspace.");
    }

    return {
      workspaceId: data.workspaceId.trim(),
      productId:
        typeof data.productId === "string" && data.productId.trim()
          ? data.productId.trim()
          : undefined,
    };
  })
  .handler(async ({ data }): Promise<CatalogData> => {
    if (!isUuid(data.workspaceId)) {
      console.error(
        "[CATALOG] workspaceId inválido:",
        data.workspaceId,
      );

      return EMPTY_CATALOG;
    }

    /*
     * Este archivo se ejecuta como Server Function.
     * La clave administrativa nunca debe exponerse con prefijo VITE_.
     */
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const sb = supabaseAdmin;

    /*
     * 1. Buscar el workspace.
     */
    const {
      data: workspace,
      error: workspaceError,
    } = await sb
      .from("workspaces")
      .select("id, name")
      .eq("id", data.workspaceId)
      .maybeSingle();

    if (workspaceError) {
      console.error(
        "[CATALOG] Error consultando workspaces:",
        workspaceError,
      );

      throw new Error(
        `No se pudo consultar el workspace: ${workspaceError.message}`,
      );
    }

    if (!workspace) {
      console.warn(
        "[CATALOG] Workspace no encontrado:",
        data.workspaceId,
      );

      return EMPTY_CATALOG;
    }

    /*
     * 2. Consultar configuración pública y conexión de WhatsApp.
     */
    const [
      {
        data: settings,
        error: settingsError,
      },
      {
        data: whatsappConnection,
        error: whatsappError,
      },
    ] = await Promise.all([
      sb
        .from("user_settings")
        .select("catalog_enabled, business_name")
        .eq("workspace_id", data.workspaceId)
        .maybeSingle(),

      sb
        .from("whatsapp_connections")
        .select("display_phone")
        .eq("workspace_id", data.workspaceId)
        .maybeSingle(),
    ]);

    if (settingsError) {
      console.error(
        "[CATALOG] Error consultando user_settings:",
        settingsError,
      );

      throw new Error(
        `No se pudo consultar la configuración del catálogo: ${settingsError.message}`,
      );
    }

    if (whatsappError) {
      console.error(
        "[CATALOG] Error consultando whatsapp_connections:",
        whatsappError,
      );

      /*
       * No detenemos todo el catálogo por un problema con WhatsApp.
       * El catálogo se mostrará, pero sin botón de compra.
       */
    }

    const workspaceName =
      settings?.business_name?.trim() ||
      workspace.name?.trim() ||
      "Catálogo online";

    const catalogEnabled =
      settings?.catalog_enabled !== false;

    if (!catalogEnabled) {
      return {
        workspaceName,
        phone: null,
        enabled: false,
        products: [],
      };
    }

    /*
     * 3. Consultar productos publicados.
     */
    let productsQuery = sb
      .from("public_catalog_products")
      .select(
        [
          "id",
          "name",
          "description",
          "sales_copy",
          "price",
          "promo_price",
          "delivery_info",
          "created_at",
        ].join(", "),
      )
      .eq("workspace_id", data.workspaceId)
      .order("created_at", {
        ascending: false,
      });

    if (data.productId) {
      if (!isUuid(data.productId)) {
        console.warn(
          "[CATALOG] productId inválido:",
          data.productId,
        );

        return {
          workspaceName,
          phone: null,
          enabled: true,
          products: [],
        };
      }

      productsQuery = productsQuery.eq(
        "id",
        data.productId,
      );
    }

    const {
      data: productRows,
      error: productsError,
    } = await productsQuery;

    if (productsError) {
      console.error(
        "[CATALOG] Error consultando public_catalog_products:",
        productsError,
      );

      throw new Error(
        `No se pudieron cargar los productos: ${productsError.message}`,
      );
    }

    const rows = productRows ?? [];
    const productIds = rows.map(
      (product) => product.id as string,
    );

    /*
     * 4. Consultar archivos y palabras clave.
     */
    let mediaRows: Array<{
      id: string;
      product_id: string;
      media_type: string;
      storage_path: string | null;
      position: number | null;
    }> = [];

    let keywordRows: Array<{
      product_id: string;
      keyword: string;
    }> = [];

    if (productIds.length > 0) {
      const [
        {
          data: fetchedMedia,
          error: mediaError,
        },
        {
          data: fetchedKeywords,
          error: keywordsError,
        },
      ] = await Promise.all([
        sb
          .from("product_media")
          .select(
            "id, product_id, media_type, storage_path, position",
          )
          .in("product_id", productIds),

        sb
          .from("product_keywords")
          .select("product_id, keyword")
          .in("product_id", productIds),
      ]);

      if (mediaError) {
        console.error(
          "[CATALOG] Error consultando product_media:",
          mediaError,
        );

        throw new Error(
          `No se pudieron cargar los archivos de los productos: ${mediaError.message}`,
        );
      }

      if (keywordsError) {
        console.error(
          "[CATALOG] Error consultando product_keywords:",
          keywordsError,
        );

        throw new Error(
          `No se pudieron cargar las palabras clave: ${keywordsError.message}`,
        );
      }

      mediaRows = fetchedMedia ?? [];
      keywordRows = fetchedKeywords ?? [];
    }

    /*
     * 5. Construir productos y crear URLs firmadas.
     */
    const products: CatalogProduct[] = [];

    for (const productRow of rows) {
      const productId = productRow.id as string;

      const productMediaRows = mediaRows
        .filter(
          (mediaItem) =>
            mediaItem.product_id === productId,
        )
        .sort(
          (first, second) =>
            (first.position ?? 0) -
            (second.position ?? 0),
        );

      const media: CatalogMedia[] = [];

      for (const mediaItem of productMediaRows) {
        if (!mediaItem.storage_path) {
          continue;
        }

        const {
          data: signedData,
          error: signedUrlError,
        } = await sb.storage
          .from("product-media")
          .createSignedUrl(
            mediaItem.storage_path,
            60 * 60 * 6,
          );

        if (signedUrlError) {
          console.error(
            `[CATALOG] No se pudo crear URL para ${mediaItem.storage_path}:`,
            signedUrlError,
          );

          /*
           * Una imagen dañada no debe impedir que se muestre
           * todo el catálogo.
           */
          continue;
        }

        if (signedData?.signedUrl) {
          media.push({
            id: mediaItem.id,
            media_type: mediaItem.media_type,
            url: signedData.signedUrl,
          });
        }
      }

      const keywords = keywordRows
        .filter(
          (keywordRow) =>
            keywordRow.product_id === productId,
        )
        .map((keywordRow) =>
          keywordRow.keyword?.trim(),
        )
        .filter(
          (keyword): keyword is string =>
            Boolean(keyword),
        );

      products.push({
        id: productId,
        name: productRow.name?.trim() || "Producto",
        description:
          productRow.description ?? null,
        sales_copy:
          productRow.sales_copy ?? null,
        price: Number(productRow.price ?? 0),
        promo_price:
          productRow.promo_price === null ||
          productRow.promo_price === undefined
            ? null
            : Number(productRow.promo_price),
        delivery_info:
          productRow.delivery_info ?? null,
        keywords,
        media,
      });
    }

    const phone = whatsappError
      ? null
      : (whatsappConnection?.display_phone ?? "")
          .replace(/[^0-9]/g, "") || null;

    return {
      workspaceName,
      phone,
      enabled: true,
      products,
    };
  });
