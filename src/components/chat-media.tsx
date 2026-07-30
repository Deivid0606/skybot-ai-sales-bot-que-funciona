import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

async function resolveUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  const { data, error } = await supabase.storage
    .from("chat-media")
    .createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export function ChatMedia({
  path,
  type,
}: {
  path: string;
  type: string | null;
}) {
  const { data: url, isLoading } = useQuery({
    queryKey: ["chat-media", path],
    queryFn: () => resolveUrl(path),
    staleTime: 50 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex h-16 w-40 items-center justify-center rounded-lg bg-muted/50">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (!url) return <p className="text-xs opacity-70">[{type ?? "archivo"}]</p>;

  if (type === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img
          src={url}
          alt="Imagen enviada en la conversación"
          loading="lazy"
          className="mb-1 max-h-64 rounded-lg object-cover"
        />
      </a>
    );
  }
  if (type === "video") {
    return <video src={url} controls className="mb-1 max-h-64 rounded-lg" />;
  }
  if (type === "audio") {
    return <audio src={url} controls className="mb-1 w-56 max-w-full" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-2 text-xs underline"
    >
      <FileText className="h-4 w-4" /> Abrir archivo
    </a>
  );
}
