import { useEffect, useState } from "react";
import { Image as ImageIcon, Music, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getSignedUrl, guessMediaType, MAX_FILE_BYTES } from "@/lib/storage";
import { toast } from "sonner";

export type ExistingMedia = { id: string; media_type: string; storage_path: string | null };
export type MediaKind = "image" | "video" | "audio";

export const MEDIA_LIMITS: Record<MediaKind, number> = { image: 5, video: 4, audio: 5 };

const KIND_META: Record<MediaKind, { label: string; accept: string; icon: typeof ImageIcon }> = {
  image: { label: "Imágenes", accept: "image/*", icon: ImageIcon },
  video: { label: "Videos", accept: "video/*", icon: Video },
  audio: { label: "Audios", accept: "audio/*", icon: Music },
};

export function useSignedMedia(items: ExistingMedia[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = items.map((i) => i.id).join(",");
  useEffect(() => {
    let cancel = false;
    (async () => {
      const entries = await Promise.all(
        items.map(async (i) => {
          if (!i.storage_path) return null;
          try {
            return [i.id, await getSignedUrl("product-media", i.storage_path)] as const;
          } catch {
            return null;
          }
        }),
      );
      if (!cancel) setUrls(Object.fromEntries(entries.filter(Boolean) as [string, string][]));
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

export function ProductMediaManager({
  existing,
  pending,
  onPendingChange,
  onRemoveExisting,
}: {
  existing: ExistingMedia[];
  pending: File[];
  onPendingChange: (files: File[]) => void;
  onRemoveExisting: (media: ExistingMedia) => void;
}) {
  const urls = useSignedMedia(existing);

  function countOf(kind: MediaKind) {
    return (
      existing.filter((m) => m.media_type === kind).length +
      pending.filter((f) => guessMediaType(f) === kind).length
    );
  }

  function addFiles(kind: MediaKind, list: FileList | null) {
    if (!list?.length) return;
    const next = [...pending];
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} supera 25MB`);
        continue;
      }
      const used =
        existing.filter((m) => m.media_type === kind).length +
        next.filter((f) => guessMediaType(f) === kind).length;
      if (used >= MEDIA_LIMITS[kind]) {
        toast.error(`Máximo ${MEDIA_LIMITS[kind]} ${KIND_META[kind].label.toLowerCase()}`);
        break;
      }
      next.push(file);
    }
    onPendingChange(next);
  }

  return (
    <div className="space-y-4">
      {(Object.keys(KIND_META) as MediaKind[]).map((kind) => {
        const { label, accept, icon: Icon } = KIND_META[kind];
        const used = countOf(kind);
        const full = used >= MEDIA_LIMITS[kind];
        const existingOfKind = existing.filter((m) => m.media_type === kind);
        const pendingOfKind = pending.filter((f) => guessMediaType(f) === kind);
        return (
          <div key={kind} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-2 text-sm">
                <Icon className="h-4 w-4" /> {label}
                <span className="text-xs text-muted-foreground">
                  {used}/{MEDIA_LIMITS[kind]}
                </span>
              </Label>
              <label>
                <input
                  type="file"
                  multiple
                  accept={accept}
                  className="hidden"
                  disabled={full}
                  onChange={(e) => {
                    addFiles(kind, e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button asChild size="sm" variant="outline" disabled={full}>
                  <span className={full ? "pointer-events-none opacity-50" : "cursor-pointer"}>
                    Subir {label.toLowerCase()}
                  </span>
                </Button>
              </label>
            </div>

            {existingOfKind.length + pendingOfKind.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin archivos.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {existingOfKind.map((m) => (
                  <div
                    key={m.id}
                    className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {kind === "image" && urls[m.id] ? (
                      <img
                        src={urls[m.id]}
                        alt="Archivo del producto"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    )}
                    <button
                      type="button"
                      aria-label="Quitar archivo"
                      onClick={() => onRemoveExisting(m)}
                      className="absolute inset-x-0 bottom-0 hidden justify-center bg-destructive/85 py-0.5 group-hover:flex"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive-foreground" />
                    </button>
                  </div>
                ))}
                {pendingOfKind.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-dashed border-primary/50 bg-muted"
                  >
                    {kind === "image" ? (
                      <img
                        src={URL.createObjectURL(f)}
                        alt={f.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    )}
                    <button
                      type="button"
                      aria-label="Quitar archivo"
                      onClick={() => onPendingChange(pending.filter((p) => p !== f))}
                      className="absolute inset-x-0 bottom-0 hidden justify-center bg-destructive/85 py-0.5 group-hover:flex"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
