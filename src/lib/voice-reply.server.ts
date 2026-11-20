import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { wellFormedJson } from "@/lib/ai.server";

/**
 * Respuestas con nota de voz (OpenAI TTS). Solo para respuestas conversacionales:
 * precios, datos bancarios, resúmenes y links van SIEMPRE en texto para que el
 * cliente pueda leerlos y copiarlos.
 */
const GRAPH = "https://graph.facebook.com/v21.0";
export const VOICE_OPTIONS = ["coral", "nova", "shimmer", "sage", "alloy", "ash", "ballad", "echo", "onyx", "verse"] as const;
const MALE_VOICES = new Set(["ash", "ballad", "echo", "onyx", "verse"]);
/** Pronunciación paraguaya (no argentina, mexicana ni española), con el género de la voz elegida. */
export function voiceInstructionsFor(voice: string): string {
  const who = MALE_VOICES.has(voice) ? "un vendedor paraguayo de Asunción" : "una vendedora paraguaya de Asunción";
  return `Hablás como ${who}, en una nota de voz de WhatsApp a un cliente. ` +
    "ACENTO PARAGUAYO: la «ll» y la «y» se pronuncian como una «y» suave (NUNCA como la «sh» de Argentina), " +
    "la «r» suave, las «s» completas, entonación cálida, tranquila y un poco cantada, típica de Paraguay. " +
    "NO uses acento argentino, porteño, mexicano ni de España. Voseo natural (vos, querés, contame). " +
    "Ritmo pausado y amable, como alguien de confianza; nada de locutor ni de robot.";
}
export const DEFAULT_VOICE_INSTRUCTIONS = voiceInstructionsFor("coral");
const MAX_SPOKEN_CHARS = 600;
const TTS_TIMEOUT_MS = 15_000;

export type VoiceSettings = { enabled: boolean; voice: string; instructions: string; openaiKey: string };

export async function loadVoiceSettings(workspaceId: string): Promise<VoiceSettings | null> {
  const { data } = await supabaseAdmin
    .from("ai_settings")
    .select("voice_reply_enabled,voice_name,voice_instructions,openai_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const row = data as unknown as {
    voice_reply_enabled?: boolean; voice_name?: string | null; voice_instructions?: string | null; openai_api_key?: string | null;
  } | null;
  const openaiKey = String(row?.openai_api_key ?? "").trim();
  if (!row?.voice_reply_enabled || !openaiKey) return null;
  return {
    enabled: true,
    voice: VOICE_OPTIONS.includes(String(row.voice_name) as (typeof VOICE_OPTIONS)[number]) ? String(row.voice_name) : "coral",
    instructions: String(row.voice_instructions ?? "").trim() ||
      voiceInstructionsFor(VOICE_OPTIONS.includes(String(row.voice_name) as (typeof VOICE_OPTIONS)[number]) ? String(row.voice_name) : "coral"),
    openaiKey,
  };
}

/** ¿Se puede decir en audio? No si lleva precios, montos, datos bancarios, links o un resumen de pedido. */
/** Datos que el cliente tiene que poder LEER o copiar: precios, montos, cuentas, links, resúmenes. */
export function hasDataToRead(text: string): boolean {
  return /\d{3,}|\d[.,]\d{3}|₲|\bgs\b|%|https?:\/\/|www\.|@/i.test(text) ||
    /\b(?:alias|cuenta|banco|titular|transferencia|c[eé]dula|ruc|comprobante|total|subtotal|pedido confirmado|precios? disponibles?)\b/i.test(text);
}

export function canBeSpoken(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_SPOKEN_CHARS || hasDataToRead(t)) return false;
  // Listas o resúmenes con viñetas no se escuchan bien.
  if ((t.match(/\n\s*(?:[•\-*]|\d+[.)])/g) ?? []).length >= 2) return false;
  return true;
}

/** Una respuesta larga (p. ej. el anuncio con beneficios) se convierte en un audio corto y natural. */
export async function spokenSummary(openaiKey: string, text: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      signal: controller.signal,
      body: wellFormedJson({
        model: "gpt-4o-mini",
        temperature: 0.6,
        max_completion_tokens: 250,
        messages: [{
          role: "user",
          content: "Convertí este mensaje de WhatsApp de una tienda en lo que diría una persona que vende en Paraguay en una NOTA DE VOZ corta: " +
            "3 o 4 frases naturales (menos de 450 caracteres), con voseo, sin emojis, sin listas y sin números ni precios. " +
            "Español de Paraguay, cálido y respetuoso: podés empezar con «Mirá, te cuento…» o «Sí, claro…». " +
            "PROHIBIDO: «che», «nde», palabras en guaraní, «viste», «re» como intensificador, «posta», «laburo» y cualquier modismo argentino. " +
            "Contá lo más importante para el cliente y TERMINÁ con la misma pregunta final del mensaje. No inventes nada que no esté en el mensaje. " +
            "Respondé SOLO con el texto a decir.\n\nMensaje:\n" + text.slice(0, 2500),
        }],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const out = String(data.choices?.[0]?.message?.content ?? "").replace(/^["“«]+|["”»]+$/g, "").trim();
    return out || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Texto limpio para leer en voz alta: sin emojis, asteriscos ni saltos raros. */
export function textForSpeech(text: string): string {
  return text
    // «Che» o «nde» suenan forzados en la voz: se quitan.
    .replace(/,\s*(?:che|nde)\b/gi, "")
    .replace(/(^|[¡¿.!?]\s*)(?:che|nde)\b[,!]?\s*/gi, "$1")
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}‍]/gu, "")
    .replace(/[*_~`#>]/g, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

/** Genera el audio (OGG/Opus, el formato de las notas de voz de WhatsApp). */
export async function synthesizeSpeech(settings: Pick<VoiceSettings, "openaiKey" | "voice" | "instructions">, text: string, format: "opus" | "mp3" = "opus"): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.openaiKey}` },
      signal: controller.signal,
      body: wellFormedJson({
        model: "gpt-4o-mini-tts",
        voice: settings.voice,
        input: textForSpeech(text).slice(0, 1500),
        instructions: settings.instructions,
        response_format: format,
      }),
    });
    if (!response.ok) throw new Error(`openai tts HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

/** Sube el audio a WhatsApp y lo envía como nota de voz. Devuelve el wamid. */
export async function sendWhatsAppVoice(
  conn: { phone_number_id: string | null; access_token: string | null },
  to: string,
  audio: ArrayBuffer,
): Promise<string | null> {
  if (!conn.phone_number_id || !conn.access_token) throw new Error("La conexión de WhatsApp no está configurada");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "audio/ogg");
  form.append("file", new Blob([audio], { type: "audio/ogg" }), "voz.ogg");
  const upload = await fetch(`${GRAPH}/${conn.phone_number_id}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.access_token}` },
    body: form,
  });
  const uploaded = (await upload.json()) as { id?: string; error?: { message?: string } };
  if (!upload.ok || !uploaded.id) throw new Error(uploaded.error?.message ?? "No se pudo subir el audio a WhatsApp");
  const res = await fetch(`${GRAPH}/${conn.phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "audio", audio: { id: uploaded.id } }),
  });
  const json = (await res.json()) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "No se pudo enviar el audio por WhatsApp");
  return json.messages?.[0]?.id ?? null;
}

/**
 * Intenta responder con nota de voz. Devuelve el wamid si salió como audio, o null
 * si corresponde texto (desactivado, no apto para audio o falló la voz).
 */
export async function tryVoiceReply(args: {
  workspaceId: string;
  conn: { phone_number_id: string | null; access_token: string | null };
  phone: string;
  text: string;
  customerSentAudio: boolean;
}): Promise<{ wamid: string | null; spoken: string } | null> {
  // Precios, cuentas o links: siempre en texto para que se puedan leer.
  if (!args.customerSentAudio || !args.text.trim() || hasDataToRead(args.text)) return null;
  try {
    const settings = await loadVoiceSettings(args.workspaceId);
    if (!settings) return null;
    let spoken = args.text;
    if (!canBeSpoken(spoken)) {
      const summary = await spokenSummary(settings.openaiKey, args.text);
      if (!summary || !canBeSpoken(summary)) return null;
      spoken = summary;
    }
    const audio = await synthesizeSpeech(settings, spoken);
    return { wamid: await sendWhatsAppVoice(args.conn, args.phone, audio), spoken };
  } catch (e) {
    console.warn("[BOT_SKY_VOICE] Se responde en texto", e instanceof Error ? e.message.slice(0, 200) : String(e));
    return null;
  }
}
