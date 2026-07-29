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
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export async function getSignedUrl(bucket: BucketName, path: string, expiresIn = 60 * 60) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export function guessMediaType(file: File) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
