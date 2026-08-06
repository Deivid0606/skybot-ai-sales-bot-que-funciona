import {
  ExternalLink,
  ImageOff,
  Megaphone,
  Play,
} from "lucide-react";
import { formatDate } from "@/lib/format";

type Props = {
  adId: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  copy?: string | null;
  date?: string | null;
};

function normalizeUrl(value?: string | null) {
  const url = value?.trim();

  if (!url) return null;

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `https://${url}`;
}

function detectVideo(mediaUrl?: string | null, mediaType?: string | null) {
  const normalizedType = mediaType?.trim().toLowerCase();

  if (
    normalizedType === "video" ||
    normalizedType === "video/mp4" ||
    normalizedType?.startsWith("video/")
  ) {
    return true;
  }

  return /\.(mp4|webm|ogg|mov|m4v)(?:\?.*)?$/i.test(mediaUrl ?? "");
}

function getFallbackAdUrl(adId: string) {
  const cleanAdId = adId.trim();

  if (!cleanAdId) return null;

  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(cleanAdId)}`;
}

export function AdOriginCard({
  adId,
  mediaUrl,
  mediaType,
  sourceUrl,
  title,
  copy,
  date,
}: Props) {
  const directUrl = normalizeUrl(sourceUrl);
  const targetUrl = directUrl ?? getFallbackAdUrl(adId);
  const isVideo = detectVideo(mediaUrl, mediaType);

  const openAd = () => {
    if (!targetUrl) return;

    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!targetUrl) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAd();
    }
  };

  return (
    <article
      role={targetUrl ? "link" : undefined}
      tabIndex={targetUrl ? 0 : undefined}
      onClick={openAd}
      onKeyDown={handleKeyDown}
      className={[
        "mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        targetUrl
          ? "cursor-pointer transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Megaphone className="h-4 w-4 shrink-0 text-primary" />

        <span className="text-sm font-medium">Anuncio</span>

        <span className="ml-auto max-w-[55%] truncate text-[11px] text-muted-foreground">
          {adId}
        </span>

        {targetUrl && (
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </div>

      <div className="flex gap-3 p-3">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-muted">
          {mediaUrl ? (
            isVideo ? (
              <>
                <video
                  src={mediaUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                />

                <span className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white shadow">
                  <Play className="h-3.5 w-3.5 fill-current" />
                </span>
              </>
            ) : (
              <img
                src={mediaUrl}
                alt={title ? `Anuncio ${title}` : "Creatividad del anuncio"}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            )
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImageOff className="h-6 w-6" />
              <span className="text-[10px]">Sin multimedia</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {title || "Anuncio sin nombre"}
          </p>

          <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">
            {copy || "El cliente inició la conversación desde este anuncio."}
          </p>

          {targetUrl && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openAd();
              }}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Ver anuncio
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {date && (
        <p className="border-t border-border px-3 py-2 text-right text-[10px] text-muted-foreground">
          {formatDate(date)}
        </p>
      )}
    </article>
  );
}
