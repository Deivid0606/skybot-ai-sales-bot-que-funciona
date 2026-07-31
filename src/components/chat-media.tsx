import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  FileText,
  ImageOff,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

async function resolveUrl(path: string): Promise<string> {
  const cleanPath = path.trim();

  if (!cleanPath) {
    throw new Error("La ruta del archivo está vacía");
  }

  // Los archivos enviados por catálogo pueden guardar una URL completa.
  if (/^https?:\/\//i.test(cleanPath)) {
    return cleanPath;
  }

  const { data, error } = await supabase.storage
    .from("chat-media")
    .createSignedUrl(cleanPath, 60 * 60);

  if (error) {
    console.error("[ChatMedia] No se pudo generar la URL firmada:", {
      path: cleanPath,
      message: error.message,
    });

    throw new Error(`No se pudo abrir el archivo: ${error.message}`);
  }

  if (!data?.signedUrl) {
    throw new Error("Supabase no devolvió una URL firmada");
  }

  return data.signedUrl;
}

export function ChatMedia({
  path,
  type,
}: {
  path: string;
  type: string | null;
}) {
  const {
    data: url,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["chat-media", path],
    queryFn: () => resolveUrl(path),
    enabled: Boolean(path?.trim()),
    staleTime: 50 * 60 * 1000,
    retry: 1,
  });

  if (!path?.trim()) {
    return (
      <div className="mb-1 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <AlertCircle className="h-4 w-4" />
        Archivo sin ruta
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mb-1 flex h-20 w-44 items-center justify-center rounded-lg bg-muted/50">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (isError || !url) {
    return (
      <div className="mb-1 flex max-w-64 flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
        <div className="flex items-start gap-2 text-xs">
          {type === "image" ? (
            <ImageOff className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}

          <div className="min-w-0">
            <p className="font-medium">No se pudo abrir el archivo</p>
            <p className="mt-1 break-words opacity-70">
              {error instanceof Error
                ? error.message
                : "Comprueba que el archivo exista en Storage."}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 self-start text-xs"
          disabled={isFetching}
          onClick={(event) => {
            event.stopPropagation();
            void refetch();
          }}
        >
          {isFetching ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          Reintentar
        </Button>
      </div>
    );
  }

  if (type === "image") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mb-1 block overflow-hidden rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={url}
          alt="Imagen enviada en la conversación"
          loading="lazy"
          className="max-h-80 max-w-full cursor-zoom-in rounded-lg object-contain"
          onError={(event) => {
            console.error("[ChatMedia] El navegador no pudo cargar la imagen", {
              path,
              url,
            });

            event.currentTarget.style.display = "none";
          }}
        />
      </a>
    );
  }

  if (type === "video") {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        className="mb-1 max-h-80 max-w-full rounded-lg"
        onClick={(event) => event.stopPropagation()}
        onError={() => {
          console.error("[ChatMedia] No se pudo reproducir el video", {
            path,
            url,
          });
        }}
      >
        Tu navegador no puede reproducir este video.
      </video>
    );
  }

  if (type === "audio") {
    return (
      <div
        className="mb-1 w-72 max-w-full rounded-lg bg-background/10 p-1"
        onClick={(event) => event.stopPropagation()}
      >
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-full"
          onError={() => {
            console.error("[ChatMedia] No se pudo reproducir el audio", {
              path,
              url,
            });
          }}
        >
          Tu navegador no puede reproducir este audio.
        </audio>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="mb-1 flex max-w-64 items-center gap-2 rounded-lg bg-background/10 px-3 py-2 text-xs underline"
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">Abrir archivo</span>
    </a>
  );
}
