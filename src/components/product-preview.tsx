import { Music, Video } from "lucide-react";
import { formatGs } from "@/lib/format";
import { guessMediaType } from "@/lib/storage";
import { useSignedMedia, type ExistingMedia } from "@/components/product-media-manager";

export function ProductPreview({
  name,
  salesCopy,
  description,
  price,
  promoPrice,
  deliveryInfo,
  keywords,
  existing,
  pending,
}: {
  name: string;
  salesCopy: string;
  description: string;
  price: string;
  promoPrice: string;
  deliveryInfo: string;
  keywords: string;
  existing: ExistingMedia[];
  pending: File[];
}) {
  const urls = useSignedMedia(existing);
  const images = [
    ...existing.filter((m) => m.media_type === "image" && urls[m.id]).map((m) => urls[m.id]),
    ...pending.filter((f) => guessMediaType(f) === "image").map((f) => URL.createObjectURL(f)),
  ].slice(0, 5);
  const videos =
    existing.filter((m) => m.media_type === "video").length +
    pending.filter((f) => guessMediaType(f) === "video").length;
  const audios =
    existing.filter((m) => m.media_type === "audio").length +
    pending.filter((f) => guessMediaType(f) === "audio").length;

  const kw = keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const body = salesCopy.trim() || description.trim();
  const finalPrice = Number(promoPrice) || Number(price) || 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Vista previa del cliente</p>
        <p className="text-xs text-muted-foreground">
          {kw.length
            ? `Se activa con: ${kw.join(", ")}`
            : "Agrega palabras clave para activar este mensaje"}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-3">
        <div className="max-w-[320px] space-y-2 rounded-2xl rounded-tl-sm bg-card p-3 shadow-sm">
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-1">
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`Imagen ${i + 1} de ${name || "producto"}`}
                  className="aspect-square w-full rounded-md object-cover"
                />
              ))}
            </div>
          )}
          <p className="text-sm font-semibold">{name || "Nombre del producto"}</p>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {body || "Aquí aparecerá tu copy de venta…"}
          </p>
          <p className="text-sm font-semibold text-primary">{formatGs(finalPrice)}</p>
          {deliveryInfo.trim() && (
            <p className="text-xs text-muted-foreground">🚚 {deliveryInfo.trim()}</p>
          )}
          {(videos > 0 || audios > 0) && (
            <div className="flex flex-wrap gap-2 pt-1 text-[11px] text-muted-foreground">
              {videos > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                  <Video className="h-3 w-3" /> {videos} video(s)
                </span>
              )}
              {audios > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                  <Music className="h-3 w-3" /> {audios} audio(s)
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
