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

type PriceTier = {
  quantity: number;
  price: number;
};

type CatalogProductWithTiers = CatalogProduct & {
  price_tiers?: PriceTier[] | null;
};

/* =========================================================
   HELPERS DE PRECIO
========================================================= */

function getBasePrice(product: CatalogProduct) {
  const hasPromo =
    product.promo_price !== null &&
    product.promo_price !== undefined &&
    product.promo_price > 0;

  return hasPromo ? product.promo_price : product.price;
}

function getProductTiers(
  product: CatalogProductWithTiers,
): PriceTier[] {
  const rawTiers = Array.isArray(product.price_tiers)
    ? product.price_tiers
    : [];

  const validTiers = rawTiers
    .filter(
      (tier) =>
        Number.isFinite(Number(tier.quantity)) &&
        Number.isFinite(Number(tier.price)) &&
        Number(tier.quantity) > 0 &&
        Number(tier.price) > 0,
    )
    .map((tier) => ({
      quantity: Number(tier.quantity),
      price: Number(tier.price),
    }))
    .sort((a, b) => a.quantity - b.quantity);

  /*
   * Si el producto todavía no tiene price_tiers,
   * usamos el precio normal/promoción como 1 unidad.
   */
  if (validTiers.length === 0) {
    return [
      {
        quantity: 1,
        price: getBasePrice(product),
      },
    ];
  }

  return validTiers;
}

function getSingleUnitPrice(
  product: CatalogProductWithTiers,
  tiers: PriceTier[],
) {
  const singleTier = tiers.find((tier) => tier.quantity === 1);

  if (singleTier) {
    return singleTier.price;
  }

  return getBasePrice(product);
}

function getSavings(
  product: CatalogProductWithTiers,
  tiers: PriceTier[],
  tier: PriceTier,
) {
  if (tier.quantity <= 1) return 0;

  const unitPrice = getSingleUnitPrice(product, tiers);
  const regularTotal = unitPrice * tier.quantity;

  return Math.max(regularTotal - tier.price, 0);
}

function getPricePerUnit(tier: PriceTier) {
  return Math.round(tier.price / tier.quantity);
}

function getBestTierIndex(tiers: PriceTier[]) {
  if (tiers.length <= 1) return 0;

  let bestIndex = 0;
  let lowestUnitPrice = Infinity;

  tiers.forEach((tier, index) => {
    const unitPrice = tier.price / tier.quantity;

    if (unitPrice < lowestUnitPrice) {
      lowestUnitPrice = unitPrice;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function getPopularTierIndex(tiers: PriceTier[]) {
  /*
   * Si hay 2 o más opciones, marcamos normalmente
   * la segunda como "Más elegido".
   */
  if (tiers.length >= 2) {
    return 1;
  }

  return 0;
}

/* =========================================================
   WHATSAPP
========================================================= */

export function buyMessage(
  product: CatalogProductWithTiers,
  selectedTier?: PriceTier,
) {
  const tiers = getProductTiers(product);

  const tier = selectedTier ?? tiers[0];

  const keyword =
    product.keywords?.[0]?.trim() ||
    product.name;

  const lines = [
    "Hola 👋 Quiero realizar este pedido:",
    "",
    `🛍️ Producto: ${product.name}`,
    `📦 Cantidad: ${tier.quantity}`,
    `💰 Precio: ${formatGs(tier.price)}`,
  ];

  if (tier.quantity > 1) {
    lines.push(
      `🏷️ Precio por unidad: ${formatGs(
        getPricePerUnit(tier),
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
  product: CatalogProductWithTiers,
  selectedTier?: PriceTier,
) {
  if (!phone) return null;

  const cleanPhone = String(phone).replace(/\D/g, "");

  if (!cleanPhone) return null;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
    buyMessage(product, selectedTier),
  )}`;
}

/* =========================================================
   BOTÓN DE COMPRA
========================================================= */

function BuyButton({
  phone,
  product,
  selectedTier,
  label = "Comprar ahora",
}: {
  phone: string | null;
  product: CatalogProductWithTiers;
  selectedTier?: PriceTier;
  label?: string;
}) {
  const href = buyLink(phone, product, selectedTier);

  if (!href) return null;

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
        {label}
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
            className="h-full w-full object-cover transition duration-300 hover:scale-[1.02]"
            loading="lazy"
          />
        </div>
      ) : (
        <div
          className={[
            "flex aspect-square items-center justify-center bg-muted",
            compact ? "rounded-xl" : "rounded-2xl",
          ].join(" ")}
        >
          <ShoppingBag className="h-12 w-12 text-muted-foreground/40" />
        </div>
      )}

      {!compact && images.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {images.slice(1, 5).map((item, index) => (
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
   PRECIO SIMPLE
========================================================= */

function SimplePrice({
  product,
}: {
  product: CatalogProduct;
}) {
  const hasPromo =
    product.promo_price !== null &&
    product.promo_price !== undefined &&
    product.promo_price > 0 &&
    product.promo_price < product.price;

  return (
    <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
      <span className="text-2xl font-black tracking-tight">
        {formatGs(
          hasPromo
            ? product.promo_price!
            : product.price,
        )}
      </span>

      {hasPromo && (
        <span className="pb-0.5 text-sm text-muted-foreground line-through">
          {formatGs(product.price)}
        </span>
      )}
    </div>
  );
}

/* =========================================================
   RESUMEN DE PRECIOS EN CARD
========================================================= */

function ProductPricePreview({
  product,
}: {
  product: CatalogProductWithTiers;
}) {
  const tiers = getProductTiers(product);

  /*
   * Si solo hay una opción, mostramos el precio tradicional.
   */
  if (
    tiers.length === 1 &&
    (!product.price_tiers ||
      product.price_tiers.length === 0)
  ) {
    return <SimplePrice product={product} />;
  }

  const visibleTiers = tiers.slice(0, 3);

  const popularIndex =
    getPopularTierIndex(visibleTiers);

  const bestIndex =
    getBestTierIndex(visibleTiers);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" />

        <p className="text-xs font-bold uppercase tracking-wide">
          Ofertas disponibles
        </p>
      </div>

      {visibleTiers.map((tier, index) => {
        const savings = getSavings(
          product,
          tiers,
          tier,
        );

        const isPopular =
          index === popularIndex &&
          visibleTiers.length > 1;

        const isBest =
          index === bestIndex &&
          index !== popularIndex &&
          tier.quantity > 1;

        return (
          <div
            key={tier.quantity}
            className={[
              "rounded-xl border px-3 py-2.5",
              isPopular
                ? "border-primary bg-primary/5"
                : "bg-muted/20",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold">
                    {tier.quantity}{" "}
                    {tier.quantity === 1
                      ? "unidad"
                      : "unidades"}
                  </span>

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
                </div>

                {tier.quantity > 1 && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatGs(
                      getPricePerUnit(tier),
                    )}{" "}
                    c/u
                  </p>
                )}

                {savings > 0 && (
                  <p className="mt-0.5 text-[11px] font-semibold">
                    Ahorrás {formatGs(savings)}
                  </p>
                )}
              </div>

              <span className="shrink-0 text-base font-black">
                {formatGs(tier.price)}
              </span>
            </div>
          </div>
        );
      })}

      {tiers.length > 3 && (
        <p className="text-center text-xs text-muted-foreground">
          + {tiers.length - 3} opciones disponibles
        </p>
      )}
    </div>
  );
}

/* =========================================================
   SELECTOR DE OFERTA
========================================================= */

function PriceSelector({
  product,
  phone,
}: {
  product: CatalogProductWithTiers;
  phone: string | null;
}) {
  const tiers = useMemo(
    () => getProductTiers(product),
    [product],
  );

  const popularIndex = getPopularTierIndex(tiers);
  const bestIndex = getBestTierIndex(tiers);

  const defaultTier =
    tiers[popularIndex] ??
    tiers[0];

  const [selectedQuantity, setSelectedQuantity] =
    useState(defaultTier.quantity);

  const selectedTier =
    tiers.find(
      (tier) =>
        tier.quantity === selectedQuantity,
    ) ?? tiers[0];

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />

          <h2 className="text-lg font-black">
            Elegí tu oferta
          </h2>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          Cuantas más unidades llevás, mejor puede ser
          el precio.
        </p>
      </div>

      <div className="space-y-2.5">
        {tiers.map((tier, index) => {
          const active =
            selectedTier.quantity === tier.quantity;

          const savings = getSavings(
            product,
            tiers,
            tier,
          );

          const isPopular =
            index === popularIndex &&
            tiers.length > 1;

          const isBest =
            index === bestIndex &&
            index !== popularIndex &&
            tier.quantity > 1;

          return (
            <button
              key={tier.quantity}
              type="button"
              onClick={() =>
                setSelectedQuantity(tier.quantity)
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
                  <div>
                    <p className="font-bold">
                      {tier.quantity}{" "}
                      {tier.quantity === 1
                        ? "unidad"
                        : "unidades"}
                    </p>

                    {tier.quantity > 1 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatGs(
                          getPricePerUnit(tier),
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
                      {formatGs(tier.price)}
                    </p>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl bg-muted/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              Total seleccionado
            </p>

            <p className="font-semibold">
              {selectedTier.quantity}{" "}
              {selectedTier.quantity === 1
                ? "unidad"
                : "unidades"}
            </p>
          </div>

          <p className="text-2xl font-black">
            {formatGs(selectedTier.price)}
          </p>
        </div>
      </div>

      <BuyButton
        phone={phone}
        product={product}
        selectedTier={selectedTier}
        label="Comprar por WhatsApp"
      />

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Al tocar el botón enviaremos automáticamente
        el producto, la cantidad y el precio que
        seleccionaste.
      </p>
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
        <div className="flex items-start gap-2 rounded-xl border bg-muted/20 p-3">
          <Truck className="mt-0.5 h-4 w-4 shrink-0" />

          <div>
            <p className="text-xs font-bold">
              Entrega
            </p>

            <p className="mt-0.5 text-xs text-muted-foreground">
              {deliveryInfo}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border bg-muted/20 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />

        <div>
          <p className="text-xs font-bold">
            Compra segura
          </p>

          <p className="mt-0.5 text-xs text-muted-foreground">
            Atención directa por WhatsApp.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border bg-muted/20 p-3">
        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />

        <div>
          <p className="text-xs font-bold">
            Atención rápida
          </p>

          <p className="mt-0.5 text-xs text-muted-foreground">
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
  product: CatalogProductWithTiers;
  workspaceId: string;
}) {
  const description =
    product.sales_copy ||
    product.description ||
    "";

  const hasPromo =
    product.promo_price !== null &&
    product.promo_price !== undefined &&
    product.promo_price > 0 &&
    product.promo_price < product.price;

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

          {hasPromo && (
            <Badge className="absolute left-5 top-5 shadow">
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

          <ProductPricePreview product={product} />

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
              Ver oferta
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* =========================================================
   GRID PRINCIPAL
========================================================= */

export function CatalogGrid({
  data,
  workspaceId,
}: {
  data: CatalogData;
  workspaceId: string;
}) {
  const products =
    data.products as CatalogProductWithTiers[];

  return (
    <div className="min-h-screen bg-muted/10">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black">
              {data.workspaceName}
            </h1>

            <p className="text-xs text-muted-foreground">
              Catálogo online · {products.length}{" "}
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
   DETALLE DE PRODUCTO
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
    product as CatalogProductWithTiers;

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
          {/* =========================
              MULTIMEDIA
          ========================== */}

          <div className="min-w-0">
            <Media product={product} />
          </div>

          {/* =========================
              INFORMACIÓN + COMPRA
          ========================== */}

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
              deliveryInfo={product.delivery_info}
            />

            {product.keywords?.length > 0 && (
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
