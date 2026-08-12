import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  MessageCircle,
  Music,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
} from "lucide-react";

import { formatGs } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

import type {
  CatalogData,
  CatalogProduct,
} from "@/lib/catalog.functions";

/* =========================================================
   TIPOS
========================================================= */

type CatalogPrice = {
  id?: string;
  label: string;
  quantity: number;
  price: number;
  sort_order: number;
};

type CatalogProductWithPrices = CatalogProduct & {
  product_prices?: CatalogPrice[] | null;
};

/* =========================================================
   PRECIOS
========================================================= */

function getLegacyPrice(product: CatalogProduct) {
  const promo = Number(product.promo_price ?? 0);
  const regular = Number(product.price ?? 0);

  if (promo > 0) {
    return promo;
  }

  return regular;
}

function getProductPrices(
  product: CatalogProductWithPrices,
): CatalogPrice[] {
  const prices = Array.isArray(product.product_prices)
    ? product.product_prices
    : [];

  const normalized = prices
    .map((item, index) => ({
      id: item.id,
      label:
        String(item.label ?? "").trim() ||
        `${Number(item.quantity) || 1} ${
          Number(item.quantity) === 1
            ? "unidad"
            : "unidades"
        }`,
      quantity: Math.max(
        1,
        Number(item.quantity) || 1,
      ),
      price: Number(item.price) || 0,
      sort_order: Number(item.sort_order ?? index),
    }))
    .filter((item) => item.price > 0)
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) {
        return a.sort_order - b.sort_order;
      }

      return a.quantity - b.quantity;
    });

  /*
   * Compatibilidad con productos antiguos.
   *
   * Tu sistema nuevo guarda los precios en product_prices.
   * Pero si existe algún producto viejo que todavía tenga
   * products.price / products.promo_price, evitamos romperlo.
   */
  if (normalized.length === 0) {
    const legacyPrice = getLegacyPrice(product);

    if (legacyPrice > 0) {
      return [
        {
          label: "1 unidad",
          quantity: 1,
          price: legacyPrice,
          sort_order: 0,
        },
      ];
    }
  }

  return normalized;
}

function getPricePerUnit(price: CatalogPrice) {
  return Math.round(
    price.price / Math.max(price.quantity, 1),
  );
}

function getReferenceUnitPrice(
  product: CatalogProductWithPrices,
  prices: CatalogPrice[],
) {
  const oneUnit = prices.find(
    (item) => item.quantity === 1,
  );

  if (oneUnit) {
    return oneUnit.price;
  }

  /*
   * Si no existe una opción de cantidad 1,
   * usamos el precio unitario de la primera opción
   * únicamente como referencia.
   */
  const first = prices[0];

  if (first) {
    return getPricePerUnit(first);
  }

  return getLegacyPrice(product);
}

function getSavings(
  product: CatalogProductWithPrices,
  prices: CatalogPrice[],
  selectedPrice: CatalogPrice,
) {
  if (selectedPrice.quantity <= 1) {
    return 0;
  }

  const unitReference = getReferenceUnitPrice(
    product,
    prices,
  );

  if (unitReference <= 0) {
    return 0;
  }

  const normalTotal =
    unitReference * selectedPrice.quantity;

  return Math.max(
    normalTotal - selectedPrice.price,
    0,
  );
}

function getPopularPriceIndex(
  prices: CatalogPrice[],
) {
  /*
   * Para una oferta con:
   *
   * 1 unidad
   * 2 unidades
   * 3 unidades
   *
   * marcamos la segunda como MÁS ELEGIDO.
   */
  if (prices.length >= 2) {
    return 1;
  }

  return 0;
}

function getBestPriceIndex(
  prices: CatalogPrice[],
) {
  if (prices.length === 0) {
    return -1;
  }

  let bestIndex = 0;
  let bestUnitPrice = Infinity;

  prices.forEach((item, index) => {
    const unitPrice =
      item.price / Math.max(item.quantity, 1);

    if (unitPrice < bestUnitPrice) {
      bestUnitPrice = unitPrice;
      bestIndex = index;
    }
  });

  return bestIndex;
}

/* =========================================================
   WHATSAPP
========================================================= */

export function buyMessage(
  product: CatalogProductWithPrices,
  selectedPrice?: CatalogPrice,
) {
  const prices = getProductPrices(product);

  const price =
    selectedPrice ??
    prices[0];

  const keyword =
    product.keywords?.[0]?.trim() ||
    product.name;

  /*
   * Fallback por seguridad.
   */
  if (!price) {
    return [
      "Hola 👋 Quiero realizar un pedido:",
      "",
      `🛍️ Producto: ${product.name}`,
      "",
      "Quiero consultar las opciones disponibles.",
      "",
      keyword,
    ].join("\n");
  }

  const lines = [
    "Hola 👋 Quiero realizar este pedido:",
    "",
    `🛍️ Producto: ${product.name}`,
    `🏷️ Opción: ${price.label}`,
    `📦 Cantidad: ${price.quantity}`,
    `💰 Total: ${formatGs(price.price)}`,
  ];

  if (price.quantity > 1) {
    lines.push(
      `💵 Precio por unidad: ${formatGs(
        getPricePerUnit(price),
      )}`,
    );
  }

  lines.push(
    "",
    "Quiero confirmar mi pedido.",
    "",
    keyword,
  );

  return lines.join("\n");
}

export function buyLink(
  phone: string | null,
  product: CatalogProductWithPrices,
  selectedPrice?: CatalogPrice,
) {
  if (!phone) {
    return null;
  }

  const cleanPhone = String(phone).replace(
    /\D/g,
    "",
  );

  if (!cleanPhone) {
    return null;
  }

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
    buyMessage(product, selectedPrice),
  )}`;
}

/* =========================================================
   BOTÓN WHATSAPP
========================================================= */

function BuyButton({
  phone,
  product,
  selectedPrice,
}: {
  phone: string | null;
  product: CatalogProductWithPrices;
  selectedPrice?: CatalogPrice;
}) {
  const href = buyLink(
    phone,
    product,
    selectedPrice,
  );

  if (!href) {
    return (
      <Button
        type="button"
        disabled
        size="lg"
        className="h-12 w-full rounded-xl text-base font-bold"
      >
        <MessageCircle className="mr-2 h-5 w-5" />
        WhatsApp no disponible
      </Button>
    );
  }

  return (
    <Button
      asChild
      size="lg"
      className="h-12 w-full rounded-xl text-base font-bold"
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MessageCircle className="mr-2 h-5 w-5" />
        Comprar por WhatsApp
      </a>
    </Button>
  );
}

/* =========================================================
   MEDIA
========================================================= */

function Media({
  product,
  compact = false,
}: {
  product: CatalogProduct;
  compact?: boolean;
}) {
  const media = product.media ?? [];

  const images = media.filter(
    (item) => item.media_type === "image",
  );

  const videos = media.filter(
    (item) => item.media_type === "video",
  );

  const audios = media.filter(
    (item) => item.media_type === "audio",
  );

  return (
    <div className="space-y-2">
      {images.length > 0 ? (
        <div
          className={[
            "overflow-hidden bg-muted",
            compact
              ? "aspect-square rounded-xl"
              : "aspect-square rounded-2xl",
          ].join(" ")}
        >
          <img
            src={images[0].url}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        </div>
      ) : (
        <div
          className={[
            "flex aspect-square items-center justify-center bg-muted",
            compact
              ? "rounded-xl"
              : "rounded-2xl",
          ].join(" ")}
        >
          <ShoppingBag className="h-12 w-12 text-muted-foreground/40" />
        </div>
      )}

      {!compact && images.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {images
            .slice(1, 5)
            .map((item, index) => (
              <div
                key={`${item.url}-${index}`}
                className="aspect-square overflow-hidden rounded-lg bg-muted"
              >
                <img
                  src={item.url}
                  alt={`${product.name} ${index + 2}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
        </div>
      )}

      {!compact &&
        videos.map((item, index) => (
          <video
            key={`${item.url}-${index}`}
            src={item.url}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-xl border bg-black"
          />
        ))}

      {!compact &&
        audios.map((item, index) => (
          <div
            key={`${item.url}-${index}`}
            className="rounded-xl border bg-muted/30 p-3"
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Music className="h-4 w-4" />
              Audio
            </div>

            <audio
              src={item.url}
              controls
              preload="metadata"
              className="w-full"
            />
          </div>
        ))}
    </div>
  );
}

/* =========================================================
   BADGES DE PRECIO
========================================================= */

function PriceBadges({
  isPopular,
  isBest,
}: {
  isPopular: boolean;
  isBest: boolean;
}) {
  return (
    <>
      {isPopular && (
        <Badge className="h-5 px-1.5 text-[9px]">
          MÁS ELEGIDO
        </Badge>
      )}

      {isBest && (
        <Badge
          variant="secondary"
          className="h-5 px-1.5 text-[9px]"
        >
          MEJOR PRECIO
        </Badge>
      )}
    </>
  );
}

/* =========================================================
   PRECIOS EN EL CATÁLOGO PRINCIPAL
========================================================= */

function ProductPricePreview({
  product,
}: {
  product: CatalogProductWithPrices;
}) {
  const prices = getProductPrices(product);

  if (prices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-3 text-center">
        <p className="text-xs text-muted-foreground">
          Consultá el precio por WhatsApp
        </p>
      </div>
    );
  }

  const visiblePrices = prices.slice(0, 3);

  const popularIndex =
    getPopularPriceIndex(prices);

  const bestIndex =
    getBestPriceIndex(prices);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" />

        <p className="text-xs font-bold uppercase tracking-wide">
          Ofertas disponibles
        </p>
      </div>

      {visiblePrices.map((item, index) => {
        const savings = getSavings(
          product,
          prices,
          item,
        );

        const isPopular =
          prices.length > 1 &&
          index === popularIndex;

        const isBest =
          prices.length > 1 &&
          index === bestIndex &&
          index !== popularIndex;

        return (
          <div
            key={
              item.id ??
              `${item.quantity}-${item.price}`
            }
            className={[
              "rounded-xl border px-3 py-2.5 transition",
              isPopular
                ? "border-primary bg-primary/5"
                : "bg-muted/20",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold">
                    {item.label}
                  </span>

                  <PriceBadges
                    isPopular={isPopular}
                    isBest={isBest}
                  />
                </div>

                {item.quantity > 1 && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatGs(
                      getPricePerUnit(item),
                    )}{" "}
                    c/u
                  </p>
                )}

                {savings > 0 && (
                  <p className="mt-0.5 text-[11px] font-bold">
                    Ahorrás{" "}
                    {formatGs(savings)}
                  </p>
                )}
              </div>

              <span className="shrink-0 text-base font-black">
                {formatGs(item.price)}
              </span>
            </div>
          </div>
        );
      })}

      {prices.length > 3 && (
        <p className="text-center text-xs text-muted-foreground">
          + {prices.length - 3} opciones disponibles
        </p>
      )}
    </div>
  );
}

/* =========================================================
   SELECTOR DEL DETALLE
========================================================= */

function PriceSelector({
  product,
  phone,
}: {
  product: CatalogProductWithPrices;
  phone: string | null;
}) {
  const prices = useMemo(
    () => getProductPrices(product),
    [product],
  );

  const popularIndex =
    getPopularPriceIndex(prices);

  const bestIndex =
    getBestPriceIndex(prices);

  /*
   * Si hay más de una opción, dejamos seleccionada
   * la segunda porque será la opción "Más elegido".
   *
   * Si solo existe una, seleccionamos esa.
   */
  const defaultPrice =
    prices[popularIndex] ??
    prices[0];

  const [
    selectedPriceKey,
    setSelectedPriceKey,
  ] = useState(
    defaultPrice
      ? `${defaultPrice.quantity}-${defaultPrice.price}-${defaultPrice.sort_order}`
      : "",
  );

  const selectedPrice =
    prices.find(
      (item) =>
        `${item.quantity}-${item.price}-${item.sort_order}` ===
        selectedPriceKey,
    ) ??
    defaultPrice ??
    prices[0];

  if (prices.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-black">
            Consultá disponibilidad
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            Este producto no tiene precios publicados.
          </p>
        </div>

        <BuyButton
          phone={phone}
          product={product}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />

          <h2 className="text-lg font-black">
            Elegí tu oferta
          </h2>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          Seleccioná la opción que querés comprar.
        </p>
      </div>

      <div className="space-y-3">
        {prices.map((item, index) => {
          const key = `${item.quantity}-${item.price}-${item.sort_order}`;

          const active =
            selectedPrice &&
            key === selectedPriceKey;

          const savings = getSavings(
            product,
            prices,
            item,
          );

          const isPopular =
            prices.length > 1 &&
            index === popularIndex;

          const isBest =
            prices.length > 1 &&
            index === bestIndex &&
            index !== popularIndex;

          return (
            <button
              key={item.id ?? key}
              type="button"
              onClick={() =>
                setSelectedPriceKey(key)
              }
              className={[
                "relative w-full rounded-2xl border p-4 text-left transition-all",
                active
                  ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                  : "bg-background hover:border-primary/50 hover:bg-muted/20",
              ].join(" ")}
            >
              {isPopular && (
                <div className="absolute -top-2.5 left-4">
                  <Badge className="shadow-sm">
                    MÁS ELEGIDO
                  </Badge>
                </div>
              )}

              {isBest && (
                <div className="absolute -top-2.5 left-4">
                  <Badge
                    variant="secondary"
                    className="shadow-sm"
                  >
                    MEJOR PRECIO
                  </Badge>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div
                  className={[
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40",
                  ].join(" ")}
                >
                  {active && (
                    <Check className="h-3.5 w-3.5" />
                  )}
                </div>

                <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {item.label}
                    </p>

                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Cantidad: {item.quantity}
                    </p>

                    {item.quantity > 1 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatGs(
                          getPricePerUnit(item),
                        )}{" "}
                        por unidad
                      </p>
                    )}

                    {savings > 0 && (
                      <p className="mt-1 text-xs font-bold">
                        Ahorrás{" "}
                        {formatGs(savings)}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xl font-black">
                      {formatGs(item.price)}
                    </p>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedPrice && (
        <div className="rounded-2xl border bg-muted/40 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                Tu selección
              </p>

              <p className="truncate font-bold">
                {selectedPrice.label}
              </p>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {selectedPrice.quantity}{" "}
                {selectedPrice.quantity === 1
                  ? "unidad"
                  : "unidades"}
              </p>
            </div>

            <p className="shrink-0 text-2xl font-black">
              {formatGs(selectedPrice.price)}
            </p>
          </div>
        </div>
      )}

      <BuyButton
        phone={phone}
        product={product}
        selectedPrice={selectedPrice}
      />

      <div className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />

        <span>
          Enviaremos producto, opción, cantidad y precio
          automáticamente.
        </span>
      </div>
    </div>
  );
}

/* =========================================================
   INFORMACIÓN DE CONFIANZA
========================================================= */

function TrustBenefits({
  deliveryInfo,
}: {
  deliveryInfo?: string | null;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {deliveryInfo && (
        <div className="flex items-start gap-2 rounded-xl border bg-background p-3">
          <Truck className="mt-0.5 h-4 w-4 shrink-0" />

          <div>
            <p className="text-xs font-bold">
              Entrega
            </p>

            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {deliveryInfo}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border bg-background p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />

        <div>
          <p className="text-xs font-bold">
            Compra segura
          </p>

          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Atención directa por WhatsApp.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border bg-background p-3">
        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />

        <div>
          <p className="text-xs font-bold">
            Atención rápida
          </p>

          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Realizá tu pedido fácilmente.
          </p>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   CATÁLOGO DESACTIVADO
========================================================= */

export function CatalogDisabled({
  name,
}: {
  name: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
      <Card className="w-full max-w-md rounded-2xl">
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <ShoppingBag className="h-6 w-6 text-muted-foreground" />
          </div>

          <h1 className="text-xl font-black">
            Catálogo no disponible
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            {name
              ? `${name} desactivó su catálogo público.`
              : "Este catálogo no existe o fue desactivado."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* =========================================================
   CARD DE PRODUCTO
========================================================= */

function ProductCard({
  product,
  workspaceId,
}: {
  product: CatalogProductWithPrices;
  workspaceId: string;
}) {
  const description =
    product.sales_copy ||
    product.description ||
    "";

  const prices =
    getProductPrices(product);

  const lowestUnitPrice =
    prices.length > 0
      ? Math.min(
          ...prices.map((item) =>
            getPricePerUnit(item),
          ),
        )
      : 0;

  return (
    <Card className="group overflow-hidden rounded-2xl border bg-background shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <CardContent className="flex h-full flex-col p-0">
        <Link
          to="/c/$workspaceId/$productId"
          params={{
            workspaceId,
            productId: product.id,
          }}
          className="relative block p-3 pb-0"
        >
          <Media
            product={product}
            compact
          />

          {prices.length > 1 && (
            <Badge className="absolute left-5 top-5 shadow-sm">
              OFERTA
            </Badge>
          )}
        </Link>

        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex-1 space-y-2">
            <Link
              to="/c/$workspaceId/$productId"
              params={{
                workspaceId,
                productId: product.id,
              }}
              className="line-clamp-2 text-lg font-black leading-tight transition hover:opacity-80"
            >
              {product.name}
            </Link>

            {description && (
              <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          {lowestUnitPrice > 0 &&
            prices.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Desde{" "}
                <span className="font-bold text-foreground">
                  {formatGs(lowestUnitPrice)}
                </span>{" "}
                por unidad
              </p>
            )}

          <ProductPricePreview
            product={product}
          />

          {product.delivery_info && (
            <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
              <Truck className="mt-0.5 h-4 w-4 shrink-0" />

              <p className="text-xs leading-relaxed text-muted-foreground">
                {product.delivery_info}
              </p>
            </div>
          )}

          <Button
            asChild
            size="lg"
            className="h-11 w-full rounded-xl font-bold"
          >
            <Link
              to="/c/$workspaceId/$productId"
              params={{
                workspaceId,
                productId: product.id,
              }}
            >
              <ShoppingBag className="mr-2 h-4 w-4" />
              Ver ofertas
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* =========================================================
   CATÁLOGO PRINCIPAL
========================================================= */

export function CatalogGrid({
  data,
  workspaceId,
}: {
  data: CatalogData;
  workspaceId: string;
}) {
  const products =
    data.products as CatalogProductWithPrices[];

  return (
    <div className="min-h-screen bg-muted/10">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black">
              {data.workspaceName}
            </h1>

            <p className="text-xs text-muted-foreground">
              Catálogo online ·{" "}
              {products.length}{" "}
              {products.length === 1
                ? "producto"
                : "productos"}
            </p>
          </div>

          <div className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            Compra fácil y segura
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
        {products.length === 0 ? (
          <div className="py-20 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <ShoppingBag className="h-7 w-7 text-muted-foreground" />
            </div>

            <h2 className="font-bold">
              Todavía no hay productos publicados
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Volvé pronto para ver las novedades.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="mt-8 border-t py-8 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by BOT SKY
        </p>
      </footer>
    </div>
  );
}

/* =========================================================
   DETALLE DEL PRODUCTO
========================================================= */

export function CatalogDetail({
  data,
  workspaceId,
  product,
}: {
  data: CatalogData;
  workspaceId: string;
  product: CatalogProduct;
}) {
  const typedProduct =
    product as CatalogProductWithPrices;

  const description =
    product.sales_copy ||
    product.description ||
    "";

  return (
    <div className="min-h-screen bg-muted/10">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <Link
            to="/c/$workspaceId"
            params={{ workspaceId }}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />

            {data.workspaceName}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="min-w-0">
            <Media product={product} />
          </div>

          <div className="space-y-6 lg:sticky lg:top-6">
            <div className="space-y-3">
              <Badge
                variant="secondary"
                className="rounded-full"
              >
                Disponible
              </Badge>

              <h1 className="text-2xl font-black leading-tight tracking-tight sm:text-3xl">
                {product.name}
              </h1>

              {description && (
                <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground sm:text-base">
                  {description}
                </p>
              )}
            </div>

            <Card className="rounded-2xl shadow-sm">
              <CardContent className="p-4 sm:p-5">
                <PriceSelector
                  product={typedProduct}
                  phone={data.phone}
                />
              </CardContent>
            </Card>

            <TrustBenefits
              deliveryInfo={
                product.delivery_info
              }
            />

            {product.keywords?.length >
              0 && (
              <div className="flex flex-wrap gap-1.5">
                {product.keywords.map(
                  (keyword, index) => (
                    <Badge
                      key={`${keyword}-${index}`}
                      variant="outline"
                      className="font-normal"
                    >
                      {keyword}
                    </Badge>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-8 border-t py-8 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by BOT SKY
        </p>
      </footer>
    </div>
  );
}
