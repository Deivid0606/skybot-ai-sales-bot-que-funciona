import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** «Probar voz» en Configuraciones: genera un audio de muestra con la voz elegida (MP3 para que suene en el iPhone). */
export const testVoiceReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; voice: string; instructions: string; text?: string }) => input)
  .handler(async ({ data, context }) => {
    const { synthesizeSpeech, VOICE_OPTIONS, DEFAULT_VOICE_INSTRUCTIONS } = await import("@/lib/voice-reply.server");
    // Con el cliente del usuario: solo lee la configuración de una tienda a la que tiene acceso.
    const { data: row } = await context.supabase.from("ai_settings").select("openai_api_key")
      .eq("workspace_id", data.workspaceId).maybeSingle();
    const openaiKey = String((row as { openai_api_key?: string | null } | null)?.openai_api_key ?? "").trim();
    if (!openaiKey) throw new Error("Cargá y guardá primero la API Key de OpenAI de esta tienda.");
    const voice = (VOICE_OPTIONS as readonly string[]).includes(data.voice) ? data.voice : "coral";
    const text = (data.text?.trim() ||
      "¡Hola! ¿Cómo estás? Te cuento que este producto es ideal para vos. Si querés, te lo preparo hoy mismo y lo pagás al recibir. ¿Para qué ciudad sería?").slice(0, 400);
    const audio = await synthesizeSpeech(
      { openaiKey, voice, instructions: data.instructions?.trim() || DEFAULT_VOICE_INSTRUCTIONS }, text, "mp3");
    return { base64: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" };
  });
