import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** «Probar voz» en Configuraciones: genera un audio de muestra con la voz elegida (MP3 para que suene en el iPhone). */
export const testVoiceReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; voice: string; instructions: string; text?: string; azureKey?: string; azureRegion?: string }) => input)
  .handler(async ({ data, context }) => {
    const { synthesizeSpeech, VOICE_OPTIONS, voiceInstructionsFor, isAzureVoice } = await import("@/lib/voice-reply.server");
    // Con el cliente del usuario: solo lee la configuración de una tienda a la que tiene acceso.
    const { data: row } = await context.supabase.from("ai_settings").select("openai_api_key,azure_speech_key,azure_speech_region")
      .eq("workspace_id", data.workspaceId).maybeSingle();
    const saved = row as { openai_api_key?: string | null; azure_speech_key?: string | null; azure_speech_region?: string | null } | null;
    const voice = (VOICE_OPTIONS as readonly string[]).includes(data.voice) ? data.voice : "coral";
    const openaiKey = String(saved?.openai_api_key ?? "").trim();
    const azureKey = String(data.azureKey ?? "").trim() || String(saved?.azure_speech_key ?? "").trim();
    const azureRegion = (String(data.azureRegion ?? "").trim() || String(saved?.azure_speech_region ?? "").trim()).toLowerCase();
    if (isAzureVoice(voice) && (!azureKey || !azureRegion)) throw new Error("Cargá la clave y la región de Azure Speech para usar las voces paraguayas.");
    if (!isAzureVoice(voice) && !openaiKey) throw new Error("Cargá y guardá primero la API Key de OpenAI de esta tienda.");
    const text = (data.text?.trim() ||
      "¡Hola! ¿Qué tal? Mirá, te cuento que este producto es ideal para vos: es muy práctico y te ahorra un montón de tiempo. Si querés, te lo preparamos y lo pagás al recibir. ¿Para qué ciudad sería?").slice(0, 400);
    const audio = await synthesizeSpeech(
      { openaiKey, azureKey, azureRegion, voice, instructions: data.instructions?.trim() || voiceInstructionsFor(voice) }, text, "mp3");
    return { base64: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" };
  });
