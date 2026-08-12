import { createServerFn } from "@tanstack/react-start";

/* =========================================================
   TIPOS
========================================================= */

export type CatalogMedia = {
  id: string;
  media_type: string;
  url: string;
};

export type CatalogProductPrice = {
  id: string;
  label: string;
  quantity: number;
  price: number;
  sort_order: number;
};

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  sales_copy: string | null;

  /*
   * Se mantienen por compatibilidad con productos/vistas
   * antiguas, pero los precios reales del catálogo nuevo
   * vienen de product_prices.
   */
  price: number;
  promo_price: number | null;

  /*
   * Precios reales configurados en Productos.
   */
  product_prices: CatalogProductPrice[];

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

/* =========================================================
   CONSTANTES
========================================================= */

const EMPTY_CATALOG: CatalogData = {
  workspaceName: "",
  phone: null,
  enabled: false,
  products: [],
};

/* =========================================================
   HELPERS
========================================================= */

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/* =========================================================
   SERVER FUNCTION
========================================================= */

export const getPublicCatalog = createServerFn({
  method: "GET",
})
  .inputValidator((data: CatalogInput) => {
    if (
      !data ||
      typeof data.workspaceId !== "string"
    ) {
      throw new Error(
        "Falta el ID del workspace.",
      );
    }

    return {
      workspaceId: data.workspaceId.trim(),

      productId:
        typeof data.productId === "string" &&
        data.productId.trim()
          ? data.productId.trim()
          : undefined,
    };
  })
  .handler(
    async ({
      data,
    }): Promise<CatalogData> => {
      /* =====================================================
         0. VALIDAR WORKSPACE
      ===================================================== */

      if (!isUuid(data.workspaceId)) {
        console.error(
          "[CATALOG] workspaceId inválido:",
          data.workspaceId,
        );

        return EMPTY_CATALOG;
      }

      /*
       * Este archivo corre solamente en servidor.
       *
       * La service role / clave administrativa
       * nunca debe exponerse con prefijo VITE_.
       */
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      const sb = supabaseAdmin;

      /* =====================================================
         1. BUSCAR WORKSPACE
      ===================================================== */

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

      /* =====================================================
         2. CONFIGURACIÓN PÚBLICA + WHATSAPP
      ===================================================== */

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
          .select(
            "catalog_enabled, business_name",
          )
          .eq(
            "workspace_id",
            data.workspaceId,
          )
          .maybeSingle(),

        sb
          .from("whatsapp_connections")
          .select("display_phone")
          .eq(
            "workspace_id",
            data.workspaceId,
          )
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

      /*
       * Un error de WhatsApp NO debe impedir
       * mostrar el catálogo.
       */
      if (whatsappError) {
        console.error(
          "[CATALOG] Error consultando whatsapp_connections:",
          whatsappError,
        );
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

      /* =====================================================
         3. CONSULTAR PRODUCTOS PÚBLICOS
      ===================================================== */

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
        .eq(
          "workspace_id",
          data.workspaceId,
        )
        .order("created_at", {
          ascending: false,
        });

      /*
       * Si estamos entrando al detalle de un producto,
       * cargamos únicamente ese producto.
       */
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

      /* =====================================================
         4. DATOS RELACIONADOS
         
         - product_media
         - product_keywords
         - product_prices
      ===================================================== */

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

      let priceRows: Array<{
        id: string;
        product_id: string;
        label: string;
        quantity: number;
        price: number;
        sort_order: number | null;
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
          {
            data: fetchedPrices,
            error: pricesError,
          },
        ] = await Promise.all([
          /* -----------------------------
             MEDIA
          ----------------------------- */

          sb
            .from("product_media")
            .select(
              [
                "id",
                "product_id",
                "media_type",
                "storage_path",
                "position",
              ].join(", "),
            )
            .in("product_id", productIds),

          /* -----------------------------
             PALABRAS CLAVE
          ----------------------------- */

          sb
            .from("product_keywords")
            .select(
              "product_id, keyword",
            )
            .in("product_id", productIds),

          /* -----------------------------
             PRECIOS
          ----------------------------- */

          sb
            .from("product_prices")
            .select(
              [
                "id",
                "product_id",
                "label",
                "quantity",
                "price",
                "sort_order",
              ].join(", "),
            )
            .in("product_id", productIds)
            .order("sort_order", {
              ascending: true,
            }),
        ]);

        /* -----------------------------
           VALIDAR MEDIA
        ----------------------------- */

        if (mediaError) {
          console.error(
            "[CATALOG] Error consultando product_media:",
            mediaError,
          );

          throw new Error(
            `No se pudieron cargar los archivos de los productos: ${mediaError.message}`,
          );
        }

        /* -----------------------------
           VALIDAR KEYWORDS
        ----------------------------- */

        if (keywordsError) {
          console.error(
            "[CATALOG] Error consultando product_keywords:",
            keywordsError,
          );

          throw new Error(
            `No se pudieron cargar las palabras clave: ${keywordsError.message}`,
          );
        }

        /* -----------------------------
           VALIDAR PRECIOS
        ----------------------------- */

        if (pricesError) {
          console.error(
            "[CATALOG] Error consultando product_prices:",
            pricesError,
          );

          throw new Error(
            `No se pudieron cargar los precios de los productos: ${pricesError.message}`,
          );
        }

        mediaRows = fetchedMedia ?? [];
        keywordRows =
          fetchedKeywords ?? [];
        priceRows = fetchedPrices ?? [];
      }

      /* =====================================================
         5. CONSTRUIR PRODUCTOS
      ===================================================== */

      const products: CatalogProduct[] =
        [];

      for (const productRow of rows) {
        const productId =
          productRow.id as string;

        /* ===================================================
           MEDIA DEL PRODUCTO
        =================================================== */

        const productMediaRows =
          mediaRows
            .filter(
              (mediaItem) =>
                mediaItem.product_id ===
                productId,
            )
            .sort(
              (first, second) =>
                (first.position ?? 0) -
                (second.position ?? 0),
            );

        const media: CatalogMedia[] = [];

        /*
         * Creamos URLs firmadas solamente
         * para los archivos de este producto.
         */
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

              /*
               * URL válida durante 6 horas.
               */
              60 * 60 * 6,
            );

          if (signedUrlError) {
            console.error(
              `[CATALOG] No se pudo crear URL para ${mediaItem.storage_path}:`,
              signedUrlError,
            );

            /*
             * Una imagen dañada no debe romper
             * todo el catálogo.
             */
            continue;
          }

          if (signedData?.signedUrl) {
            media.push({
              id: mediaItem.id,
              media_type:
                mediaItem.media_type,
              url: signedData.signedUrl,
            });
          }
        }

        /* ===================================================
           PALABRAS CLAVE
        =================================================== */

        const keywords = keywordRows
          .filter(
            (keywordRow) =>
              keywordRow.product_id ===
              productId,
          )
          .map((keywordRow) =>
            keywordRow.keyword?.trim(),
          )
          .filter(
            (
              keyword,
            ): keyword is string =>
              Boolean(keyword),
          );

        /* ===================================================
           PRECIOS
        =================================================== */

        const productPrices: CatalogProductPrice[] =
          priceRows
            .filter(
              (priceRow) =>
                priceRow.product_id ===
                productId,
            )
            .map((priceRow) => {
              const quantity = Math.max(
                1,
                Number(
                  priceRow.quantity ?? 1,
                ),
              );

              const price = Number(
                priceRow.price ?? 0,
              );

              const label =
                priceRow.label?.trim() ||
                `${quantity} ${
                  quantity === 1
                    ? "unidad"
                    : "unidades"
                }`;

              return {
                id: priceRow.id,
                label,
                quantity,
                price,
                sort_order: Number(
                  priceRow.sort_order ?? 0,
                ),
              };
            })
            /*
             * Nunca mandamos al catálogo
             * precios inválidos o iguales a 0.
             */
            .filter(
              (priceItem) =>
                priceItem.price > 0 &&
                priceItem.quantity > 0,
            )
            /*
             * Respetamos el orden configurado
             * desde Productos.
             */
            .sort((a, b) => {
              if (
                a.sort_order !==
                b.sort_order
              ) {
                return (
                  a.sort_order -
                  b.sort_order
                );
              }

              return (
                a.quantity - b.quantity
              );
            });

        /* ===================================================
           PUSH FINAL
        =================================================== */

        products.push({
          id: productId,

          name:
            productRow.name?.trim() ||
            "Producto",

          description:
            productRow.description ?? null,

          sales_copy:
            productRow.sales_copy ?? null,

          /*
           * Compatibilidad con la estructura
           * antigua.
           */
          price: Number(
            productRow.price ?? 0,
          ),

          promo_price:
            productRow.promo_price ===
              null ||
            productRow.promo_price ===
              undefined
              ? null
              : Number(
                  productRow.promo_price,
                ),

          /*
           * Esta es ahora la fuente de precios
           * principal del catálogo.
           */
          product_prices:
            productPrices,

          delivery_info:
            productRow.delivery_info ??
            null,

          keywords,

          media,
        });
      }

      /* =====================================================
         6. WHATSAPP
      ===================================================== */

      const phone = whatsappError
        ? null
        : (
            whatsappConnection?.display_phone ??
            ""
          ).replace(/[^0-9]/g, "") ||
          null;

      /* =====================================================
         7. RESPUESTA FINAL
      ===================================================== */

      return {
        workspaceName,
        phone,
        enabled: true,
        products,
      };
    },
  );
