import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  MessageCircle,
  Music,
  Search,
  X,
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
   PRESENTACIÓN COMERCIAL LIMPIA
   Reutiliza datos reales; no inventa beneficios ni reseñas.
========================================================= */

function plainProductText(value: string | null | undefined, max = 650): string {
  const cleaned=String(value??"")
    .replace(/<[^>]*>/g," ")
    .replace(/&(?:nbsp|#x20);/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/\\([*_~])/g,"$1")
    .replace(/\*{1,3}|_{2,3}|#{1,6}\s*/g,"")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,"")
    .replace(/(?:🔥|✅|💥|👉|✔|•|▶)\s*/gu,"")
    .replace(/(?:\b(?:stock limitado|apurate|últimas unidades|ultimas unidades)\b[!.]*)/gi,"")
    .replace(/[ \t]+/g," ")
    .replace(/\n\s*\n\s*\n/g,"\n\n")
    .trim();
  const clipped=cleaned.slice(0,max);
  return cleaned.length>max?clipped.replace(/\s+\S*$/,"").trimEnd()+"…":clipped;
}

function productSummary(product: CatalogProduct): string {
  const description=plainProductText(product.description,200);
  if(description)return description;
  return plainProductText(product.sales_copy,160);
}

function productHighlights(product: CatalogProduct): string[] {
  const source=String(product.description||product.sales_copy||"");
  return source.split(/\n|[;]+/).map(line=>plainProductText(line,100))
    .filter(line=>line.length>=12 && line.length<=100)
    .filter(line=>!/(?:^precio|^gs\.?|^pago|^envi|^delivery|^whatsapp|^stock|^compr[aá])/i.test(line))
    .filter((line,index,all)=>all.findIndex(other=>other.toLowerCase()===line.toLowerCase())===index)
    .slice(0,3);
}

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

  // Sin precio unitario real NO anunciar un ahorro ficticio.
  // Si solo hay combos, se pueden elegir sin mostrar descuentos inventados.
  return 0;
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
  // La posición de una opción NO prueba que sea "la más elegida".
  // Mantener la primera como selección predeterminada transparente.
  return prices.length ? 0 : -1;
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
  const [activeImage,setActiveImage]=useState(0);
  const hero=images[Math.min(activeImage,Math.max(0,images.length-1))];

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
          <a href={hero.url} target="_blank" rel="noopener noreferrer"
            aria-label={`Ampliar fotografía de ${product.name}`}
            className="block h-full w-full cursor-zoom-in"
          >
            <img
              src={hero.url}
              alt={product.name}
              className={`h-full w-full transition-transform duration-300 group-hover:scale-[1.02] ${compact?"object-cover":"object-contain"}`}
              loading={compact?"lazy":"eager"}
            />
          </a>
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
        <div className="grid grid-cols-5 gap-2" aria-label="Fotos del producto">
          {images.slice(0,10).map((item,index)=>(
            <button type="button" key={item.id??item.url}
              onClick={()=>setActiveImage(index)}
              aria-label={`Ver imagen ${index+1} de ${images.length}`}
              aria-pressed={activeImage===index}
              className={`aspect-square overflow-hidden rounded-lg border-2 bg-muted transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${activeImage===index?"border-primary":"border-transparent"}`}
            >
              <img src={item.url} alt={`${product.name}, vista ${index+1}`}
                className="h-full w-full object-contain" loading="lazy"/>
            </button>
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
      {isBest && (
        <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">
          Mejor precio por unidad
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
        <ShoppingBag className="h-4 w-4 text-muted-foreground" />

        <p className="text-xs font-semibold tracking-wide">
          Elegí tu presentación
        </p>
      </div>

      {visiblePrices.map((item, index) => {
        const savings = getSavings(
          product,
          prices,
          item,
        );

        const isPopular = false;

        const isBest =
          prices.some(option=>option.quantity>1) &&
          prices.length > 1 &&
          index === bestIndex;

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

  // Seleccionar la primera opción publicada por el vendedor.
  // Nunca cambiar a un combo automáticamente por una suposición de ventas.
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
          <ShoppingBag className="h-5 w-5" />

          <h2 className="text-lg font-black">
            Elegí la opción que querés
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

          const isPopular = false;

          const isBest =
            prices.some(option=>option.quantity>1) &&
            prices.length > 1 &&
            index === bestIndex;

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
              {isBest && (
                <div className="absolute -top-2.5 left-4">
                  <Badge variant="secondary" className="shadow-sm">
                    Mejor precio por unidad
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

      {/* Acción siempre visible en celular, sincronizada con la opción elegida. */}
      {phone && selectedPrice && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-lg backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground">{selectedPrice.label}</p>
              <p className="text-lg font-black">{formatGs(selectedPrice.price)}</p>
            </div>
            <Button asChild className="h-12 shrink-0 rounded-xl px-5 font-bold">
              <a href={buyLink(phone,product,selectedPrice)??"#"} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 h-5 w-5"/> Pedir ahora
              </a>
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>La selección exacta se enviará a WhatsApp para confirmar tu pedido.</span>
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
  const description = productSummary(product);

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

          {prices.length > 1 && prices.some(p=>getSavings(product,prices,p)>0) && (
            <Badge className="absolute left-5 top-5 shadow-sm">
              Combo disponible
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
              {plainProductText(product.name,100)}
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
              Ver producto
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
  const products=data.products as CatalogProductWithPrices[];
  const [search,setSearch]=useState("");
  const [discountOnly,setDiscountOnly]=useState(false);
  const normalized=search.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().trim();
  const visible=products.filter(p=>{
    const searchable=[p.name,p.description,p.sales_copy,...(p.keywords??[])].join(" ")
      .normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase();
    if(normalized && !searchable.includes(normalized))return false;
    if(discountOnly){
      const prices=getProductPrices(p);
      return prices.some(o=>getSavings(p,prices,o)>0);
    }
    return true;
  });

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
            Comprá directamente con la tienda
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
        <section className="mb-7 space-y-4 rounded-3xl border bg-background p-5 shadow-sm sm:p-7">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Tu tienda, más cerca</p>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Encontrá lo que necesitás</h2>
            <p className="max-w-xl text-sm text-muted-foreground">Explorá productos, compará presentaciones y elegí la opción ideal para vos.</p>
          </div>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Buscar productos…" aria-label="Buscar productos"
              className="h-12 w-full rounded-xl border bg-background pl-11 pr-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={()=>setDiscountOnly(false)}
              aria-pressed={!discountOnly}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${!discountOnly?"border-primary bg-primary text-primary-foreground":"bg-background hover:bg-muted"}`}>Todos</button>
            <button type="button" onClick={()=>setDiscountOnly(true)}
              aria-pressed={discountOnly}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${discountOnly?"border-primary bg-primary text-primary-foreground":"bg-background hover:bg-muted"}`}>Combos con ahorro</button>
            <span className="ml-auto text-xs text-muted-foreground">{visible.length} productos</span>
          </div>
        </section>
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
        ) : visible.length===0 ? (
          <div className="rounded-2xl border bg-background px-5 py-12 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground"/>
            <p className="font-bold">No encontramos productos con esos filtros</p>
            <p className="mt-1 text-sm text-muted-foreground">Probá otra búsqueda o mirá todo el catálogo.</p>
            <Button type="button" variant="outline" className="mt-4" onClick={()=>{setSearch("");setDiscountOnly(false)}}>
              <X className="mr-2 h-4 w-4"/> Limpiar filtros
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((product) => (
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
          {data.workspaceName} · Atención directa por WhatsApp
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

  const description = productSummary(product);

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

      <main className="mx-auto max-w-6xl px-4 py-6 pb-28 md:py-10 lg:pb-10">
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
                Consultá disponibilidad
              </Badge>

              <h1 className="text-2xl font-black leading-tight tracking-tight sm:text-3xl">
                {plainProductText(product.name,100)}
              </h1>
              {description && (
                <p className="text-sm leading-6 text-muted-foreground sm:text-base">
                  {description}
                </p>
              )}
              {productHighlights(product).length>0 && (
                <div className="grid gap-2 border-t pt-4">
                  {productHighlights(product).map((line,index)=>(
                    <div key={index} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary"/>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
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
