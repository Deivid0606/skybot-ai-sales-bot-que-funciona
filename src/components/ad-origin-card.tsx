import { Megaphone } from "lucide-react";
import { formatDate } from "@/lib/format";

type Props = {
  adId: string;
  mediaUrl?: string | null;
  title?: string | null;
  copy?: string | null;
  date?: string | null;
};

export function AdOriginCard({ adId, mediaUrl, title, copy, date }: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Anuncio</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground">{adId}</span>
      </div>
      <div className="flex gap-3">
        {mediaUrl ? (
          <img
            src={mediaUrl}
            alt={title ? `Anuncio ${title}` : "Creatividad del anuncio"}
            loading="lazy"
            className="h-24 w-24 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Megaphone className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {title && <p className="truncate text-sm font-medium">{title}</p>}
          <p className="line-clamp-5 whitespace-pre-wrap text-sm text-muted-foreground">
            {copy || "El cliente inició la conversación desde este anuncio."}
          </p>
        </div>
      </div>
      {date && (
        <p className="mt-2 text-right text-[10px] text-muted-foreground">{formatDate(date)}</p>
      )}
    </div>
  );
}
