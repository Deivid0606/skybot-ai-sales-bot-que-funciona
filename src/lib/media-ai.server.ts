const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

function requireKey() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Falta LOVABLE_API_KEY");
  return key;
}

type Block =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

async function ask(blocks: Block[]) {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": requireKey() },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: blocks }],
    }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("credits_exhausted");
  if (!res.ok) throw new Error(`media_ai_error: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

export function audioFormatFromMime(mime: string) {
  const m = mime.split(";")[0];
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/aac": "aac",
    "audio/flac": "flac",
  };
  return map[m] ?? "ogg";
}

export function toBase64(bytes: ArrayBuffer) {
  const arr = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Transcribe un audio (base64) a texto en español. */
export async function transcribeAudio(base64: string, mime: string) {
  return ask([
    {
      type: "text",
      text: "Transcribe literalmente este audio en español. Devuelve solo la transcripción, sin comentarios.",
    },
    { type: "input_audio", input_audio: { data: base64, format: audioFormatFromMime(mime) } },
  ]);
}

/** Interpreta una imagen: producto, comprobante de pago u otra. */
export async function describeImage(base64: string, mime: string) {
  return ask([
    {
      type: "text",
      text: `Analiza la imagen que envió un cliente por WhatsApp y responde en español, en máximo 4 líneas.
Si es un COMPROBANTE DE PAGO: indica "COMPROBANTE" y extrae monto, fecha, hora, banco/billetera, número de operación y titular si se ven.
Si es un PRODUCTO: indica "PRODUCTO" y describe qué es (tipo, color, marca, detalles visibles).
Si es otra cosa: describe brevemente qué se ve.`,
    },
    { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
  ]);
}
