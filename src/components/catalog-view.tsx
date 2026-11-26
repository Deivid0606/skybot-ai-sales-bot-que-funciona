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
        className="h-14 w-full rounded-xl bg-[#173b2b] text-base font-extrabold text-white shadow-lg shadow-[#173b2b]/15 hover:bg-[#255e43]"
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
          {          compact ? (
            <img src={hero.url} alt={product.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy" />
          ) : (
            <a href={hero.url} target="_blank" rel="noopener noreferrer"
              aria-label={`Ampliar fotografía de ${product.name}`}
              className="block h-full w-full cursor-zoom-in">
              <img src={hero.url} alt={product.name}
                className="h-full w-full object-contain transition-transform duration-300"
                loading="eager" />
            </a>
          )}
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
                "relative w-full rounded-2xl border-2 p-4 text-left transition-all",
                active
                  ? "border-[#276543] bg-[#ecf6ee] shadow-sm"
                  : "border-[#e5ebe3] bg-white hover:border-[#9aba9e] hover:bg-[#f7faf6]",
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
                      ? "border-[#23673f] bg-[#23673f] text-white"
                      : "border-[#acbdad]",
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
        <div className="rounded-2xl border border-[#dce9db] bg-[#f2f8f1] p-4">
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
  const prices=getProductPrices(product);
  const first=prices[0];
  const basePrice=prices.length?Math.min(...prices.map(p=>p.price)):0;
  const hasBundle=prices.some(p=>getSavings(product,prices,p)>0);
  const linkParams={workspaceId,productId:product.id};
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-[1.65rem] border border-[#e8e6e0] bg-white shadow-[0_8px_32px_rgba(16,24,21,0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-[#c9d7cc] hover:shadow-[0_20px_55px_rgba(16,24,21,0.12)]">
      <Link to="/c/$workspaceId/$productId" params={linkParams}
        className="relative block overflow-hidden bg-[#f4f5f1] p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_65%_30%,#ffffff_0%,#f3f5f0_65%,#ecf0e9_100%)]"/>
        <div className="relative aspect-[1.16/1] overflow-hidden rounded-2xl">
          <Media product={product} compact />
        </div>
        <span className="absolute bottom-6 left-6 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-[#304a3b] backdrop-blur">
          {prices.length>1?"Varias opciones":"Elegí tu producto"}
        </span>
        {hasBundle&&(
          <span className="absolute right-5 top-5 rounded-full bg-[#163b2a] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Combo ahorro
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col px-5 pb-5 pt-5 sm:px-6 sm:pb-6">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[.21em] text-[#66766b]">Colección de la tienda</div>
        <Link to="/c/$workspaceId/$productId" params={linkParams}
          className="line-clamp-2 text-[18px] font-bold leading-snug tracking-tight text-[#14251c] transition-colors hover:text-[#24744c] sm:text-[20px]">
          {plainProductText(product.name,100)}
        </Link>
        {productSummary(product)&&(
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[#718079]">{productSummary(product)}</p>
        )}
        <div className="mt-auto pt-5">
          <div className="mb-4 flex items-end justify-between gap-2 border-t border-[#e8ece7] pt-4">
            <div>
              <p className="text-[11px] font-medium text-[#7a867f]">{prices.length>1?"Opciones desde":"Precio"}</p>
              <p className="text-[23px] font-extrabold tracking-tight text-[#153c2a]">
                {basePrice>0?formatGs(basePrice):"Consultar"}
              </p>
            </div>
            <span className="text-[11px] text-[#809086]">{prices.length>1?`${prices.length} opciones`:first?.label??""}</span>
          </div>
          <Link to="/c/$workspaceId/$productId" params={linkParams}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#173b2b] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#255e43] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173b2b]">
            Ver detalles <ChevronLeft className="h-4 w-4 rotate-180"/>
          </Link>
        </div>
      </div>
    </article>
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
    <div className="min-h-screen bg-[#f8f8f4] text-[#172a20]">
      <div className="bg-[#153b2b] px-4 py-2.5 text-center text-[11px] font-semibold tracking-[.08em] text-[#ebf2e9] sm:text-xs">
        Tu tienda online · Comprá fácil y consultá por WhatsApp
      </div>
      <header className="sticky top-0 z-30 border-b border-[#e6ece5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-7">
          <Link to="/c/$workspaceId" params={{workspaceId}} className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#153b2b] text-white shadow-sm">
              <ShoppingBag className="h-5 w-5"/>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-black tracking-tight text-[#142c20] sm:text-xl">{data.workspaceName}</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[.16em] text-[#89978d]">Tienda online</span>
            </span>
          </Link>
          <div className="hidden items-center gap-2 rounded-full border border-[#e3eae3] px-4 py-2 text-xs font-semibold text-[#496456] sm:flex">
            <ShieldCheck className="h-4 w-4"/> Compra directa con la tienda
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-7 sm:py-8">
        <section className="relative mb-8 overflow-hidden rounded-[2rem] bg-[#153b2b] text-white shadow-[0_20px_65px_rgba(21,59,43,.16)]">
          <div className="pointer-events-none absolute -right-24 -top-36 h-[28rem] w-[28rem] rounded-full bg-[#3d8c63]/40 blur-3xl"/>
          <div className="pointer-events-none absolute -bottom-48 left-1/3 h-[22rem] w-[22rem] rounded-full bg-[#d2b47a]/20 blur-3xl"/>
          <div className="relative grid min-h-[300px] items-center gap-8 px-6 py-10 sm:min-h-[390px] sm:px-12 sm:py-12 lg:grid-cols-[1fr_0.9fr] lg:px-16">
            <div className="max-w-xl space-y-5">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.22em] text-[#cee7d4]">Colección disponible</p>
              <h1 className="text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl lg:text-[4rem]">
                Descubrí algo <span className="text-[#c9dfbc]">bueno para vos.</span>
              </h1>
              <p className="max-w-lg text-sm leading-7 text-[#d5e1d7] sm:text-base">Productos seleccionados, precios claros y opciones para elegir. Todo en un solo lugar.</p>
              <button type="button" onClick={()=>document.getElementById("catalog-products")?.scrollIntoView({behavior:"smooth"})}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-extrabold text-[#153b2b] transition hover:bg-[#e9f4e8]">
                Explorar productos <ChevronLeft className="h-4 w-4 rotate-180"/>
              </button>
            </div>
            <div className="relative hidden items-center justify-center lg:flex">
              {products[0]?.media?.find(m=>m.media_type==="image") ? (
                <div className="relative flex h-72 w-72 items-center justify-center rounded-[2rem] border border-white/20 bg-white/95 p-5 shadow-[0_35px_70px_rgba(0,0,0,.2)] rotate-3">
                  <img src={products[0].media.find(m=>m.media_type==="image")!.url}
                    alt={products[0].name} className="h-full w-full object-contain" loading="lazy"/>
                </div>
              ) : (
                <div className="flex h-64 w-64 items-center justify-center rounded-[2rem] border border-white/20 bg-white/10">
                  <ShoppingBag className="h-24 w-24 text-white/70"/>
                </div>
              )}
              <div className="absolute bottom-1 right-6 rounded-2xl border border-white/20 bg-white/95 px-5 py-3 text-[#183f2d] shadow-lg">
                <p className="text-xs font-semibold text-[#65786b]">Explorá la colección</p>
                <p className="text-2xl font-black">{products.length} <span className="text-sm font-semibold">productos</span></p>
              </div>
            </div>
          </div>
        </section>
        <section id="catalog-products" className="mb-7 space-y-5 scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[.22em] text-[#6b8878]">Explorá nuestra tienda</p>
              <h2 className="text-[29px] font-black tracking-tight text-[#172f22] sm:text-[37px]">Todos los productos<span className="text-[#79a48b]">.</span></h2>
            </div>
            <p className="rounded-full border border-[#dee7dc] bg-white px-4 py-2 text-xs font-semibold text-[#5e7567]">{visible.length} disponibles para consultar</p>
          </div>
          <div className="rounded-2xl border border-[#e4eae1] bg-white p-3 shadow-sm sm:p-4">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#668473]" />
              <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="¿Qué producto estás buscando?" aria-label="Buscar productos"
                className="h-13 min-h-[52px] w-full rounded-xl border border-[#e7ece5] bg-[#f8faf7] pl-12 pr-4 text-sm text-[#172a20] outline-none placeholder:text-[#849588] focus-visible:ring-2 focus-visible:ring-[#4b9366]"/>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={()=>setDiscountOnly(false)} aria-pressed={!discountOnly}
                className={`rounded-full border px-4 py-2 text-xs font-bold transition ${!discountOnly?"border-[#173b2b] bg-[#173b2b] text-white":"border-[#e1e8e0] bg-white text-[#4c6353] hover:bg-[#eff4ec]"}`}>Todos los productos</button>
              <button type="button" onClick={()=>setDiscountOnly(true)} aria-pressed={discountOnly}
                className={`rounded-full border px-4 py-2 text-xs font-bold transition ${discountOnly?"border-[#173b2b] bg-[#173b2b] text-white":"border-[#e1e8e0] bg-white text-[#4c6353] hover:bg-[#eff4ec]"}`}>Combos con ahorro</button>
            </div>
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
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

      <footer className="mt-14 border-t border-[#284a38] bg-[#143827] px-5 py-9 text-center text-white">
        <div className="mx-auto max-w-7xl">
          <p className="text-lg font-black tracking-tight">{data.workspaceName}</p>
          <p className="mt-2 text-xs text-[#b7d0bd]">Tus productos, tu elección. Atención directa por WhatsApp.</p>
        </div>
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
  const typedProduct=product as CatalogProductWithPrices;
  const description=productSummary(product);
  const highlights=productHighlights(product);
  return (
    <div className="min-h-screen bg-[#f8f8f4] text-[#172a20]">
      <div className="bg-[#153b2b] px-4 py-2.5 text-center text-[11px] font-semibold tracking-[.08em] text-[#ebf2e9]">
        Elegí tu opción · Consultá disponibilidad · Comprá por WhatsApp
      </div>
      <header className="sticky top-0 z-30 border-b border-[#e6ece5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-7">
          <Link to="/c/$workspaceId" params={{workspaceId}} className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#173b2b] text-white">
              <ShoppingBag className="h-5 w-5"/>
            </span>
            <span className="truncate text-lg font-black tracking-tight text-[#172a20]">{data.workspaceName}</span>
          </Link>
          <Link to="/c/$workspaceId" params={{workspaceId}}
            className="inline-flex items-center gap-2 rounded-full border border-[#dce6dd] px-4 py-2 text-xs font-bold text-[#375641] hover:bg-[#edf5eb]">
            <ChevronLeft className="h-4 w-4"/> <span className="hidden sm:inline">Volver al catálogo</span><span className="sm:hidden">Volver</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 pb-28 sm:px-7 sm:py-9 lg:pb-12">
        <nav aria-label="Ubicación dentro del catálogo" className="mb-6 flex items-center gap-2 text-xs text-[#75867a]">
          <Link to="/c/$workspaceId" params={{workspaceId}} className="hover:text-[#173b2b]">Catálogo</Link>
          <ChevronLeft className="h-3 w-3 rotate-180"/>
          <span className="max-w-[220px] truncate font-semibold text-[#385f45]">{plainProductText(product.name,80)}</span>
        </nav>
        <div className="grid items-start gap-7 lg:grid-cols-[1.06fr_0.94fr] lg:gap-12">
          <div className="overflow-hidden rounded-[2rem] border border-[#e3e9df] bg-[radial-gradient(circle_at_50%_35%,#ffffff_0%,#f2f5ee_75%)] p-4 shadow-[0_15px_55px_rgba(24,50,31,.06)] sm:p-7">
            <Media product={product}/>
            <div className="mt-5 flex items-center justify-center gap-2 text-xs font-medium text-[#728477]">
              <ShieldCheck className="h-4 w-4 text-[#2d7750]"/> Fotografías del catálogo de la tienda
            </div>
          </div>
          <div className="space-y-6 lg:sticky lg:top-24">
            <section className="space-y-4">
              <p className="text-[11px] font-extrabold uppercase tracking-[.23em] text-[#538366]">Selección de {data.workspaceName}</p>
              <h1 className="text-[32px] font-black leading-[1.09] tracking-tight text-[#142c20] sm:text-[43px]">
                {plainProductText(product.name,110)}
              </h1>
              {description && <p className="max-w-xl text-[15px] leading-7 text-[#6d7e72] sm:text-base">{description}</p>}
              {highlights.length>0 && (
                <div className="grid gap-2 border-l-[3px] border-[#84b28d] pl-4">
                  {highlights.map((line,index)=>(
                    <div key={index} className="flex items-start gap-2 text-[13px] leading-6 text-[#45604d]">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-[#398757]"/><span>{line}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <div className="overflow-hidden rounded-[1.75rem] border border-[#dfe9dc] bg-white p-5 shadow-[0_15px_50px_rgba(24,50,31,.09)] sm:p-7">
              <div className="mb-5 flex items-center justify-between gap-3 border-b border-[#edf0e9] pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.21em] text-[#74927b]">Configurá tu pedido</p>
                  <p className="mt-1 text-lg font-black text-[#173b2b]">Elegí y comprá fácilmente</p>
                </div>
                <span className="rounded-full bg-[#ebf4eb] px-3 py-1.5 text-xs font-bold text-[#2e7849]">Compra directa</span>
              </div>
              <PriceSelector product={typedProduct} phone={data.phone}/>
            </div>
            <TrustBenefits deliveryInfo={product.delivery_info}/>
          </div>
        </div>
      </main>
      <footer className="mt-12 border-t border-[#284a38] bg-[#143827] px-5 py-9 text-center text-white">
        <p className="text-lg font-black">{data.workspaceName}</p>
        <p className="mt-2 text-xs text-[#b7d0bd]">Tu selección, directo a WhatsApp. Confirmá disponibilidad y entrega.</p>
      </footer>
    </div>
  );
}
