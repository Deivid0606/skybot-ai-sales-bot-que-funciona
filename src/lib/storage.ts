import { supabase } from "@/integrations/supabase/client";

export type BucketName = "product-media" | "chat-media" | "receipts";

export async function uploadWorkspaceFile(
  bucket: BucketName,
  workspaceId: string,
  file: File,
  folder = "",
) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${workspaceId}/${folder ? folder + "/" : ""}${Date.now()}-${safeName}`;
  // Algunos audios (.opus, .amr de WhatsApp o del iPhone) llegan sin tipo: se deduce por la extensión.
  const contentType = file.type || mimeFromFileName(file.name) || undefined;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType });
  if (error) throw error;
  return path;
}

export async function getSignedUrl(bucket: BucketName, path: string, expiresIn = 60 * 60) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

const EXTENSION_MIME: Record<string, string> = {
  mp3: "audio/mpeg", mpga: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg",
  opus: "audio/ogg", wav: "audio/wav", amr: "audio/amr", flac: "audio/flac", wma: "audio/x-ms-wma",
  aif: "audio/aiff", aiff: "audio/aiff", weba: "audio/webm", caf: "audio/x-caf",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp", mkv: "video/x-matroska",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
};

export function mimeFromFileName(name: string): string {
  return EXTENSION_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

export function guessMediaType(file: File) {
  const type = file.type || mimeFromFileName(file.name);
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "document";
}

/** Formatos de audio que se pueden elegir (el iPhone deja en gris los que no están listados). */
export const AUDIO_ACCEPT = "audio/*,.mp3,.mpga,.m4a,.aac,.ogg,.oga,.opus,.wav,.amr,.flac,.wma,.aif,.aiff,.weba,.caf";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Archivos de productos: sin límite de duración; el único tope es el tamaño (50 MB ≈ 50 min de MP3).
export const MAX_PRODUCT_MEDIA_BYTES = 50 * 1024 * 1024;
