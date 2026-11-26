import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
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
   CATÁLOGO EDITORIAL — DISEÑO PREMIUM 2026
   La portada utiliza únicamente fotografías reales del catálogo.
   Cada tienda conserva su propio nombre, productos y WhatsApp.
========================================================= */

function StoreMark({name}:{name:string}) {
  const initials=name.trim().split(/\s+/).slice(0,2).map(word=>word[0]?.toUpperCase()??"").join("")||"S";
  return <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#14201D] text-sm font-black tracking-widest text-[#DDF69B] shadow-sm">{initials}</span>;
}

function StoreHeader({name,workspaceId,phone,onSearchClick}:{name:string;workspaceId:string;phone:string|null;onSearchClick?:()=>void}) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#E8E9E1] bg-[#FEFEFC]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-7">
        <Link to="/c/$workspaceId" params={{workspaceId}} aria-label={`Ir al catálogo de ${name}`} className="flex min-w-0 items-center gap-3">
          <StoreMark name={name}/>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-black tracking-tight text-[#14201D] sm:text-[18px]">{name}</span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.22em] text-[#829087]">Tienda online</span>
          </span>
        </Link>
        <nav aria-label="Accesos de la tienda" className="flex shrink-0 items-center gap-2">
          {onSearchClick&&<button type="button" onClick={onSearchClick} aria-label="Buscar productos" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#E6E9E1] bg-white text-[#14201D] transition hover:bg-[#EEF3E5]"><Search className="h-5 w-5"/></button>}
          <Link to="/c/$workspaceId" params={{workspaceId}} className="hidden rounded-full px-4 py-2 text-sm font-semibold text-[#34423B] transition hover:bg-[#F1F3EB] sm:inline-flex">Productos</Link>
          {phone&&<a href={`https://wa.me/${String(phone).replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-[#14201D] px-4 text-xs font-bold text-white transition hover:bg-[#30463B] sm:text-sm"><MessageCircle className="h-4 w-4"/> <span className="hidden sm:inline">Consultanos</span><span className="sm:hidden">WhatsApp</span></a>}
        </nav>
      </div>
    </header>
  );
}

function StoreFooter({name}:{name:string}) {
  return (
    <footer className="bg-[#14201D] text-white">
      <div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-6 px-5 py-10 sm:flex-row sm:items-center sm:px-7">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#DDF69B] text-lg font-black text-[#14201D]">{name[0]?.toUpperCase()||"S"}</span><div><p className="text-lg font-bold">{name}</p><p className="text-xs text-[#B8C5BA]">Comprá fácil. Atención directa.</p></div></div>
        <p className="text-xs text-[#B8C5BA]">Los precios y presentaciones se confirman con la tienda por WhatsApp.</p>
      </div>
    </footer>
  );
}

function EditorialProductCard({product,workspaceId}:{product:CatalogProductWithPrices;workspaceId:string}) {
  const prices=getProductPrices(product);
  const lowest=prices.length?Math.min(...prices.map(p=>p.price)):0;
  const image=product.media?.find(item=>item.media_type==="image")?.url;
  const savings=prices.some(price=>getSavings(product,prices,price)>0);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[22px] border border-[#E5E8DD] bg-white transition-all duration-300 hover:-translate-y-1 hover:border-[#C3D1B8] hover:shadow-[0_22px_55px_-25px_rgba(20,32,29,0.25)]">
      <Link to="/c/$workspaceId/$productId" params={{workspaceId,productId:product.id}} className="relative block aspect-[4/4.5] overflow-hidden bg-[#F0F1E9] sm:aspect-[4/4.25]" aria-label={`Ver ${product.name}`}>
        {image
          ? <img src={image} alt={plainProductText(product.name,120)} loading="lazy" className="h-full w-full object-contain p-3 transition-transform duration-500 group-hover:scale-105 sm:p-5"/>
          : <div className="flex h-full w-full items-center justify-center"><ShoppingBag className="h-16 w-16 text-[#B8C4B5]"/></div>}
        {savings&&<span className="absolute left-3 top-3 rounded-full bg-[#DDF69B] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[#20321E]">Ahorrá en combo</span>}
        <span className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#1D2C25] shadow-sm transition group-hover:bg-[#DDF69B]"><ArrowUpRight className="h-5 w-5"/></span>
      </Link>
      <div className="flex flex-1 flex-col px-3 pb-4 pt-4 sm:px-5 sm:pb-5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#75857B]">Selección de la tienda</p>
        <Link to="/c/$workspaceId/$productId" params={{workspaceId,productId:product.id}} className="line-clamp-2 min-h-[44px] text-[16px] font-extrabold leading-[1.35] tracking-tight text-[#18251D] transition hover:text-[#597344] sm:text-[19px]">{plainProductText(product.name,110)}</Link>
        {productSummary(product)&&<p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#6F786F] sm:text-[13px]">{productSummary(product)}</p>}
        <div className="mt-auto border-t border-[#EFF0E9] pt-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#829087]">{prices.length>1?"Presentaciones desde":"Precio"}</p>
          <p className="mt-1 text-[20px] font-black tracking-tight text-[#14201D] sm:text-[24px]">{lowest?formatGs(lowest):"Consultar"}</p>
          <Link to="/c/$workspaceId/$productId" params={{workspaceId,productId:product.id}} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#14201D] text-[13px] font-bold text-white transition hover:bg-[#2A4335]">Elegir opción <ArrowRight className="h-4 w-4"/></Link>
        </div>
      </div>
    </article>
  );
}

export function CatalogGrid({data,workspaceId}:{data:CatalogData;workspaceId:string}) {
  const products=data.products as CatalogProductWithPrices[];
  const [search,setSearch]=useState("");
  const [discountOnly,setDiscountOnly]=useState(false);
  const searchRef=useRef<HTMLInputElement>(null);
  const normalized=search.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const visible=products.filter(p=>{
    const searchable=[p.name,p.description,p.sales_copy,...(p.keywords??[])].join(" ")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    if(normalized&&!searchable.includes(normalized))return false;
    if(discountOnly){
      const prices=getProductPrices(p);
      return prices.some(o=>getSavings(p,prices,o)>0);
    }
    return true;
  });
  const heroProduct=products.find(p=>p.media?.some(m=>m.media_type==="image"))??products[0];
  const heroPhoto=heroProduct?.media?.find(m=>m.media_type==="image")?.url;
  const heroPrices=heroProduct?getProductPrices(heroProduct):[];
  const heroPrice=heroPrices.length?Math.min(...heroPrices.map(p=>p.price)):null;
  const focusSearch=()=>{searchRef.current?.focus();searchRef.current?.scrollIntoView({behavior:"smooth",block:"center"});};
  return (
    <div className="min-h-screen bg-[#F6F5F0] text-[#14201D]">
      <div className="bg-[#14201D] px-3 py-2 text-center text-[11px] font-semibold tracking-wide text-[#E4F5C0] sm:text-xs">Descubrí nuestros productos · Elegí tu opción · Comprá por WhatsApp</div>
      <StoreHeader name={data.workspaceName} workspaceId={workspaceId} phone={data.phone} onSearchClick={focusSearch}/>
      <main>
        {products.length>0&&heroProduct&&(
          <section className="relative overflow-hidden bg-[#172821]">
            <div className="pointer-events-none absolute -left-24 top-10 h-96 w-96 rounded-full bg-[#4A6651]/25 blur-3xl"/>
            <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#A0C07C]/15 blur-3xl"/>
            <div className="relative mx-auto grid max-w-[1240px] items-center gap-0 px-4 py-10 sm:px-7 sm:py-14 lg:min-h-[500px] lg:grid-cols-2 lg:py-16">
              <div className="relative z-10 max-w-xl space-y-5 pb-6 text-white lg:pb-0">
                <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#E0F3B7]"><span className="h-2 w-2 rounded-full bg-[#DDF69B]"/> Catálogo de {data.workspaceName}</p>
                <h1 className="max-w-[650px] text-[clamp(2.55rem,6vw,5.4rem)] font-black leading-[0.99] tracking-[-0.065em]">Lo bueno para tu <span className="text-[#DDF69B]">día a día.</span></h1>
                <p className="max-w-md text-sm leading-7 text-[#C9D6C8] sm:text-base">Productos útiles, opciones claras y una compra sin complicaciones. Elegí lo que necesitás y pedilo directamente a la tienda.</p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <button type="button" onClick={()=>document.getElementById("catalog-products")?.scrollIntoView({behavior:"smooth"})} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#DDF69B] px-6 text-sm font-extrabold text-[#15251C] transition hover:bg-[#EEFFBE]">Explorar productos <ArrowDownRight className="h-4 w-4"/></button>
                  {data.phone&&<a href={`https://wa.me/${String(data.phone).replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-5 text-sm font-semibold text-white transition hover:bg-white/10"><MessageCircle className="h-4 w-4"/> Hacer una consulta</a>}
                </div>
              </div>
              <div className="relative mx-auto flex w-full max-w-[540px] items-center justify-center lg:ml-auto">
                <div className="absolute inset-x-10 bottom-6 top-3 rounded-full bg-[#B4D694]/20 blur-3xl"/>
                <div className="relative aspect-[1.25/1] w-full overflow-hidden rounded-[32px] border border-white/10 bg-[#E9EDE2] shadow-[0_30px_65px_-25px_rgba(0,0,0,0.5)] sm:aspect-[1.3/1]">
                  {heroPhoto?<img src={heroPhoto} alt={heroProduct.name} loading="eager" className="h-full w-full object-contain p-5 sm:p-8"/>:<div className="flex h-full items-center justify-center"><ShoppingBag className="h-20 w-20 text-[#A7B6A2]"/></div>}
                  <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-2xl bg-white/95 px-4 py-3 shadow-md backdrop-blur">
                    <div className="min-w-0"><p className="truncate text-[12px] font-bold text-[#14201D] sm:text-sm">{plainProductText(heroProduct.name,70)}</p><p className="text-xs text-[#738176]">{heroPrice? `Desde ${formatGs(heroPrice)}`:"Consultá el precio"}</p></div>
                    <Link to="/c/$workspaceId/$productId" params={{workspaceId,productId:heroProduct.id}} aria-label="Ver producto destacado" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#DDF69B] text-[#15251C]"><ArrowUpRight className="h-5 w-5"/></Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
        <div className="mx-auto max-w-[1240px] px-4 pb-20 pt-9 sm:px-7 sm:pt-14">
          <div className="mb-10 grid gap-3 sm:grid-cols-3">
            {[
              {icon:ShieldCheck,title:"Elegí con confianza",subtitle:"Precios y opciones a la vista"},
              {icon:MessageCircle,title:"Atención directa",subtitle:"Consultá con la tienda por WhatsApp"},
              {icon:ShoppingBag,title:"Sin vueltas",subtitle:"Elegí tu opción y hacé tu pedido"},
            ].map(item=><div key={item.title} className="flex items-center gap-3 rounded-2xl border border-[#E6E8DF] bg-white px-4 py-4 sm:px-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFF4E5]"><item.icon className="h-5 w-5 text-[#47603D]"/></span><span><span className="block text-[13px] font-extrabold text-[#18251E]">{item.title}</span><span className="block text-[11px] text-[#758176]">{item.subtitle}</span></span></div>)}
          </div>
          <section id="catalog-products" className="scroll-mt-28">
            <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div><p className="mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-[#678051]">Explorá la colección</p><h2 className="text-[30px] font-black leading-tight tracking-[-0.045em] text-[#172620] sm:text-[42px]">Elegí tu próximo favorito<span className="text-[#A6C67A]">.</span></h2><p className="mt-2 text-sm text-[#748176]">{products.length} {products.length===1?"producto disponible en el catálogo":"productos disponibles en el catálogo"}</p></div>
              <div className="relative w-full max-w-md"><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#718070]"/><input ref={searchRef} type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="¿Qué estás buscando?" aria-label="Buscar productos" className="h-[54px] w-full rounded-2xl border border-[#DCE2D5] bg-white pl-12 pr-5 text-sm text-[#172620] shadow-sm outline-none placeholder:text-[#849184] focus:border-[#9DBD77] focus:ring-2 focus:ring-[#DDF69B]"/></div>
            </div>
            <div className="mb-7 flex items-center gap-2">
              <button type="button" onClick={()=>setDiscountOnly(false)} aria-pressed={!discountOnly} className={`rounded-full px-5 py-2.5 text-xs font-extrabold transition ${discountOnly?"border border-[#DDE3D8] bg-white text-[#354639]":"bg-[#14201D] text-white"}`}>Todos</button>
              <button type="button" onClick={()=>setDiscountOnly(true)} aria-pressed={discountOnly} className={`rounded-full px-5 py-2.5 text-xs font-extrabold transition ${discountOnly?"bg-[#14201D] text-white":"border border-[#DDE3D8] bg-white text-[#354639]"}`}>Combos con ahorro</button>
              <span className="ml-auto text-xs font-semibold text-[#778479]">{visible.length} resultados</span>
            </div>
            {products.length===0?<div className="rounded-3xl bg-white p-16 text-center"><ShoppingBag className="mx-auto mb-4 h-10 w-10 text-[#8DA48C]"/><h3 className="text-xl font-bold">Todavía no hay productos publicados</h3><p className="mt-2 text-sm text-[#6B786E]">Volvé pronto para conocer nuestras novedades.</p></div>
            :visible.length===0?<div className="rounded-3xl bg-white p-14 text-center"><Search className="mx-auto mb-3 h-10 w-10 text-[#9AAC98]"/><h3 className="text-lg font-extrabold">No encontramos coincidencias</h3><p className="mt-2 text-sm text-[#788279]">Probá otra búsqueda.</p><button type="button" onClick={()=>{setSearch("");setDiscountOnly(false)}} className="mt-5 rounded-full bg-[#DDF69B] px-6 py-3 text-xs font-extrabold">Ver todos los productos</button></div>
            :<div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">{visible.map(p=><EditorialProductCard key={p.id} product={p} workspaceId={workspaceId}/>)}</div>}
          </section>
        </div>
      </main>
      <StoreFooter name={data.workspaceName}/>
    </div>
  );
}

export function CatalogDetail({data,workspaceId,product}:{data:CatalogData;workspaceId:string;product:CatalogProduct}) {
  const typedProduct=product as CatalogProductWithPrices;
  const description=productSummary(product);
  const highlights=productHighlights(product).filter(h=>h.toLowerCase()!==description.toLowerCase());
  return (
    <div className="min-h-screen bg-[#F6F5F0] text-[#14201D]">
      <div className="bg-[#14201D] px-3 py-2 text-center text-[11px] font-semibold tracking-wide text-[#E4F5C0]">Atención directa por WhatsApp · Elegí tu presentación</div>
      <StoreHeader name={data.workspaceName} workspaceId={workspaceId} phone={data.phone}/>
      <main className="mx-auto max-w-[1240px] px-4 pb-28 pt-6 sm:px-7 sm:pt-9 lg:pb-14">
        <div className="mb-7 flex items-center gap-2 text-xs font-semibold text-[#6F7F73]">
          <Link to="/c/$workspaceId" params={{workspaceId}} className="transition hover:text-[#14201D]">Productos</Link><ChevronLeft className="h-3 w-3 rotate-180"/><span className="max-w-[70%] truncate text-[#14201D]">{plainProductText(product.name,100)}</span>
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-12">
          <section aria-label="Galería de producto" className="min-w-0 rounded-[28px] bg-[#E8EDE4] p-3 shadow-[0_15px_35px_-25px_rgba(20,32,29,0.3)] sm:p-5">
            <Media product={product}/>
          </section>
          <section className="min-w-0 space-y-6">
            <div className="space-y-4">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#789263]">Selección de {data.workspaceName}</p>
              <h1 className="text-[clamp(2rem,4.8vw,3.7rem)] font-black leading-[1.07] tracking-[-0.055em] text-[#14201D]">{plainProductText(product.name,110)}</h1>
              {description&&<p className="max-w-xl text-[15px] leading-7 text-[#637267] sm:text-base">{description}</p>}
              {highlights.length>0&&<div className="grid gap-2 border-t border-[#DDE3D7] pt-4">{highlights.map((h,i)=><div key={i} className="flex items-start gap-3 text-sm text-[#435549]"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#DAECB8]"><Check className="h-3.5 w-3.5"/></span><span>{h}</span></div>)}</div>}
            </div>
            <div className="rounded-[26px] border border-[#DFE6DA] bg-white p-5 shadow-[0_15px_35px_-25px_rgba(20,32,29,0.3)] sm:p-7">
              <PriceSelector product={typedProduct} phone={data.phone}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-2xl border border-[#E1E7DD] bg-white p-4"><MessageCircle className="h-5 w-5 shrink-0 text-[#477A50]"/><span className="text-xs font-semibold text-[#405145]">Atención directa por WhatsApp</span></div>
              <div className="flex items-center gap-3 rounded-2xl border border-[#E1E7DD] bg-white p-4"><ShieldCheck className="h-5 w-5 shrink-0 text-[#477A50]"/><span className="text-xs font-semibold text-[#405145]">Confirmación de tu pedido</span></div>
            </div>
            {product.delivery_info&&<div className="flex gap-3 rounded-2xl border border-[#E1E7DD] bg-white p-4"><Truck className="mt-0.5 h-5 w-5 shrink-0 text-[#477A50]"/><div><p className="text-sm font-bold">Información de entrega</p><p className="mt-1 text-xs leading-6 text-[#6B7A6F]">{plainProductText(product.delivery_info,260)}</p></div></div>}
          </section>
        </div>
      </main>
      <StoreFooter name={data.workspaceName}/>
    </div>
  );
}
