import { Link } from "@tanstack/react-router";
import { MessageCircle, Music, ShoppingBag } from "lucide-react";
import { formatGs } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CatalogData, CatalogProduct } from "@/lib/catalog.functions";

export function buyMessage(product: CatalogProduct) {
  const keyword = product.keywords[0] ?? product.name;
  const hasPromo = product.promo_price !== null && product.promo_price > 0;
  const price = formatGs(hasPromo ? product.promo_price : product.price);
  return `Hola! Quiero comprar este producto: ${product.name} de ${price}. ¿Cómo lo puedo obtener?\n\n${keyword}`;
}

export function buyLink(phone: string | null, product: CatalogProduct) {
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(buyMessage(product))}`;
}

function BuyButton({ phone, product }: { phone: string | null; product: CatalogProduct }) {
  const href = buyLink(phone, product);
  if (!href) return null;
  return (
    <Button asChild className="w-full">
      <a href={href} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="mr-2 h-4 w-4" />
        Tocá aquí para comprar
      </a>
    </Button>
  );
}

function Media({ product }: { product: CatalogProduct }) {
  const images = product.media.filter((m) => m.media_type === "image");
  const videos = product.media.filter((m) => m.media_type === "video");
  const audios = product.media.filter((m) => m.media_type === "audio");
  return (
    <div className="space-y-2">
      {images.length > 0 ? (
        <img
          src={images[0].url}
          alt={product.name}
          loading="lazy"
          className="aspect-square w-full rounded-lg object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted">
          <ShoppingBag className="h-10 w-10 text-muted-foreground" />
        </div>
      )}
      {images.length > 1 && (
        <div className="grid grid-cols-4 gap-1">
          {images.slice(1, 5).map((m) => (
            <img
              key={m.id}
              src={m.url}
              alt={product.name}
              loading="lazy"
              className="aspect-square w-full rounded-md object-cover"
            />
          ))}
        </div>
      )}
      {videos.map((m) => (
        <video key={m.id} src={m.url} controls preload="none" className="w-full rounded-lg" />
      ))}
      {audios.map((m) => (
        <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
          <Music className="h-4 w-4 text-muted-foreground" />
          <audio src={m.url} controls preload="none" className="w-full" />
        </div>
      ))}
    </div>
  );
}

function Price({ product }: { product: CatalogProduct }) {
  const hasPromo = product.promo_price !== null && product.promo_price > 0;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-lg font-bold text-primary">
        {formatGs(hasPromo ? product.promo_price : product.price)}
      </span>
      {hasPromo && (
        <span className="text-sm text-muted-foreground line-through">{formatGs(product.price)}</span>
      )}
    </div>
  );
}

export function CatalogDisabled({ name }: { name: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">Catálogo no disponible</h1>
      <p className="text-sm text-muted-foreground">
        {name ? `${name} desactivó su catálogo público.` : "Este catálogo no existe o fue desactivado."}
      </p>
    </div>
  );
}

export function CatalogGrid({ data, workspaceId }: { data: CatalogData; workspaceId: string }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <h1 className="text-2xl font-bold">{data.workspaceName}</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo online · {data.products.length} producto{data.products.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {data.products.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Todavía no hay productos publicados.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.products.map((p) => (
              <Card key={p.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <Media product={p} />
                  <div className="flex-1 space-y-2">
                    <Link
                      to="/c/$workspaceId/$productId"
                      params={{ workspaceId, productId: p.id }}
                      className="text-base font-semibold hover:underline"
                    >
                      {p.name}
                    </Link>
                    <Price product={p} />
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {(p.sales_copy || p.description || "").slice(0, 260)}
                    </p>
                    {p.delivery_info && (
                      <p className="text-xs text-muted-foreground">🚚 {p.delivery_info}</p>
                    )}
                  </div>
                  <BuyButton phone={data.phone} product={p} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Powered by BOT SKY
      </footer>
    </div>
  );
}

export function CatalogDetail({
  data,
  workspaceId,
  product,
}: {
  data: CatalogData;
  workspaceId: string;
  product: CatalogProduct;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link to="/c/$workspaceId" params={{ workspaceId }} className="text-sm hover:underline">
            ← {data.workspaceName}
          </Link>
        </div>
      </header>
      <main className="mx-auto grid max-w-4xl gap-6 px-4 py-6 md:grid-cols-2">
        <Media product={product} />
        <div className="space-y-3">
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <Price product={product} />
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {product.sales_copy || product.description || ""}
          </p>
          {product.delivery_info && (
            <p className="text-sm text-muted-foreground">🚚 {product.delivery_info}</p>
          )}
          {product.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {product.keywords.map((k) => (
                <Badge key={k} variant="secondary">
                  {k}
                </Badge>
              ))}
            </div>
          )}
          <BuyButton phone={data.phone} product={product} />
        </div>
      </main>
    </div>
  );
}
