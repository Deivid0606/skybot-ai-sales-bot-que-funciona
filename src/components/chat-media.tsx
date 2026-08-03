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
import type { BucketName } from "@/lib/storage";

type ChatMediaProps = {
  path: string;
  type: string | null;
  bucket?: BucketName;
  alt?: string;
  className?: string;
};

function isCompleteUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    value.startsWith("blob:") ||
    value.startsWith("data:")
  );
}

/**
 * Evita rutas como:
 * product-media/workspace-id/archivo.jpg
 *
 * Supabase espera solamente:
 * workspace-id/archivo.jpg
 */
function normalizeStoragePath(bucket: BucketName, path: string): string {
  let normalizedPath = path.trim().replace(/^\/+/, "");

  const bucketPrefix = `${bucket}/`;

  if (normalizedPath.startsWith(bucketPrefix)) {
    normalizedPath = normalizedPath.slice(bucketPrefix.length);
  }

  return normalizedPath;
}

async function resolveUrl(
  bucket: BucketName,
  path: string,
): Promise<string> {
  const cleanPath = path.trim();

  if (!cleanPath) {
    throw new Error("La ruta del archivo está vacía");
  }

  /*
   * Si ya recibimos una URL completa, no hace falta firmarla.
   */
  if (isCompleteUrl(cleanPath)) {
    return cleanPath;
  }

  const storagePath = normalizeStoragePath(bucket, cleanPath);

  if (!storagePath) {
    throw new Error("La ruta del archivo no es válida");
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    console.error("[ChatMedia] No se pudo generar la URL firmada", {
      bucket,
      originalPath: cleanPath,
      storagePath,
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
  bucket = "chat-media",
  alt = "Archivo enviado en la conversación",
  className,
}: ChatMediaProps) {
  const normalizedType = type?.trim().toLowerCase() ?? "document";
  const hasPath = Boolean(path?.trim());

  const {
    data: url,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["storage-media", bucket, path],
    queryFn: () => resolveUrl(bucket, path),
    enabled: hasPath,
    staleTime: 50 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  if (!hasPath) {
    return (
      <div className="mb-1 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Archivo sin ruta
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mb-1 flex h-20 w-44 max-w-full items-center justify-center rounded-lg bg-muted/50">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (isError || !url) {
    return (
      <div className="mb-1 flex max-w-64 flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
        <div className="flex items-start gap-2 text-xs">
          {normalizedType === "image" ? (
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

            <p className="mt-1 break-all opacity-50">
              Bucket: {bucket}
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

  if (normalizedType === "image") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`mb-1 block max-w-full overflow-hidden rounded-lg ${
          className ?? ""
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="max-h-80 w-full cursor-zoom-in rounded-lg bg-card object-contain"
          onError={(event) => {
            console.error(
              "[ChatMedia] El navegador no pudo cargar la imagen",
              {
                bucket,
                path,
                url,
              },
            );

            event.currentTarget.style.display = "none";
          }}
        />
      </a>
    );
  }

  if (normalizedType === "video") {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        className={`mb-1 max-h-80 w-full rounded-lg bg-card ${
          className ?? ""
        }`}
        onClick={(event) => event.stopPropagation()}
        onError={() => {
          console.error("[ChatMedia] No se pudo reproducir el video", {
            bucket,
            path,
            url,
          });
        }}
      >
        Tu navegador no puede reproducir este video.
      </video>
    );
  }

  if (normalizedType === "audio") {
    return (
      <div
        className={`mb-1 w-72 max-w-full rounded-lg bg-background/10 p-1 ${
          className ?? ""
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-full"
          onError={() => {
            console.error("[ChatMedia] No se pudo reproducir el audio", {
              bucket,
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
      className={`mb-1 flex max-w-64 items-center gap-2 rounded-lg bg-background/10 px-3 py-2 text-xs underline ${
        className ?? ""
      }`}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">Abrir archivo</span>
    </a>
  );
}
