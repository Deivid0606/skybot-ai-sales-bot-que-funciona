const GEMINI_MODEL =
  process.env.GEMINI_MEDIA_MODEL?.trim() || "gemini-2.5-flash";

function requireGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();

  if (!key) {
    throw new Error("Falta la variable de entorno GEMINI_API_KEY");
  }

  return key;
}

function normalizeMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

function clean(value: any): string {
  return String(value || "").trim();
}

function isGeminiQuotaErrorPayload(data: any): boolean {
  const raw = JSON.stringify(data || {}).toLowerCase();

  return (
    raw.includes("quota") ||
    raw.includes("rate limit") ||
    raw.includes("rate_limit") ||
    raw.includes("resource_exhausted") ||
    raw.includes("exceeded") ||
    raw.includes("429")
  );
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

async function callGemini({
  apiKey,
  model,
  system,
  contents,
  temperature = 0.1,
  maxTokens = 1024,
}: {
  apiKey: string;
  model: string;
  system?: string;
  contents: GeminiContent[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const body: any = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95,
      topK: 40,
    },
  };

  if (clean(system)) {
    body.systemInstruction = {
      parts: [{ text: clean(system) }],
    };
  }

  if (String(model).includes("2.5")) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("[Media AI] Gemini error:", JSON.stringify(data).slice(0, 1000));

    if (response.status === 429 || isGeminiQuotaErrorPayload(data)) {
      return "__GEMINI_QUOTA_EXCEEDED__";
    }

    throw new Error(
      `Gemini error (${response.status}): ${JSON.stringify(data).slice(0, 500)}`,
    );
  }

  const text = clean(
    data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join(""),
  );

  return text;
}

export function audioFormatFromMime(mime: string): string {
  const normalized = normalizeMime(mime);

  const formats: Record<string, string> = {
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

  return formats[normalized] ?? "ogg";
}

export function toBase64(bytes: ArrayBuffer): string {
  const array = new Uint8Array(bytes);

  if (array.byteLength === 0) {
    throw new Error("El archivo multimedia está vacío");
  }

  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < array.length; index += chunkSize) {
    binary += String.fromCharCode(
      ...array.subarray(index, index + chunkSize),
    );
  }

  return btoa(binary);
}

async function transcribeAudioWithGemini({
  apiKey,
  model,
  audioBase64,
  mime,
}: {
  apiKey: string;
  model: string;
  audioBase64: string;
  mime: string;
}): Promise<string> {
  return callGemini({
    apiKey,
    model,
    system: "Transcribí el audio al español. Devolvé solo texto plano.",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: mime,
              data: audioBase64,
            },
          },
          {
            text:
              "Transcribí literalmente este audio enviado por un cliente de WhatsApp. " +
              "Devolvé solamente la transcripción en español, sin comentarios ni comillas. " +
              "Si no se entiende, devolvé AUDIO_INCOMPRENSIBLE.",
          },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 1024,
  });
}

async function transcribeAudioWithOpenAI({
  audioBase64,
  mime,
}: {
  audioBase64: string;
  mime: string;
}): Promise<string> {
  const apiKey = clean(process.env.OPENAI_API_KEY || "");
  if (!apiKey) return "";

  try {
    const ext = mime.includes("mpeg")
      ? "mp3"
      : mime.includes("mp4")
        ? "mp4"
        : mime.includes("wav")
          ? "wav"
          : mime.includes("webm")
            ? "webm"
            : "ogg";

    const buffer = Buffer.from(audioBase64, "base64");

    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("language", "es");
    form.append("response_format", "json");
    form.append(
      "file",
      new Blob([buffer], { type: mime || "audio/ogg" }),
      `audio.${ext}`,
    );

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      },
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        "[Media AI] OpenAI Whisper error:",
        JSON.stringify(data).slice(0, 1000),
      );
      return "";
    }

    return clean(data?.text || "");
  } catch (error) {
    console.error("[Media AI] OpenAI Whisper exception:", error);
    return "";
  }
}

async function transcribeAudioSmart({
  apiKey,
  model,
  audioBase64,
  mime,
}: {
  apiKey: string;
  model: string;
  audioBase64: string;
  mime: string;
}): Promise<{ text: string; reason: string }> {
  try {
    const geminiText = await transcribeAudioWithGemini({
      apiKey,
      model,
      audioBase64,
      mime,
    });

    if (
      geminiText &&
      geminiText !== "__GEMINI_QUOTA_EXCEEDED__" &&
      geminiText.toUpperCase() !== "AUDIO_INCOMPRENSIBLE"
    ) {
      return {
        text: clean(geminiText.replace(/^["']|["']$/g, "")),
        reason: "gemini",
      };
    }

    if (geminiText === "__GEMINI_QUOTA_EXCEEDED__") {
      const openAiText = await transcribeAudioWithOpenAI({
        audioBase64,
        mime,
      });

      if (openAiText) {
        return {
          text: clean(openAiText),
          reason: "openai_whisper",
        };
      }

      return { text: "", reason: "gemini_quota" };
    }
  } catch (error) {
    console.error("[Media AI] Gemini transcription exception:", error);
  }

  const openAiText = await transcribeAudioWithOpenAI({
    audioBase64,
    mime,
  });

  if (openAiText) {
    return {
      text: clean(openAiText),
      reason: "openai_whisper",
    };
  }

  return { text: "", reason: "transcription_failed" };
}

/**
 * Transcribe una nota de voz o audio recibido desde WhatsApp.
 */
export async function transcribeAudio(
  base64: string,
  mime: string,
): Promise<string> {
  if (!base64?.trim()) {
    throw new Error("El audio no contiene datos");
  }

  const normalizedMime = normalizeMime(mime) || "audio/ogg";
  const apiKey = requireGeminiKey();

  console.log("[Media AI] Transcribiendo audio", {
    model: GEMINI_MODEL,
    mime: normalizedMime,
    base64Length: base64.length,
  });

  const result = await transcribeAudioSmart({
    apiKey,
    model: GEMINI_MODEL,
    audioBase64: base64,
    mime: normalizedMime,
  });

  if (!result.text) {
    throw new Error(`No se pudo transcribir el audio (${result.reason})`);
  }

  return clean(result.text);
}

/**
 * Interpreta una imagen enviada por un cliente.
 * El resultado se guarda como transcript y entra al contexto de la IA.
 */
export async function describeImage(
  base64: string,
  mime: string,
): Promise<string> {
  if (!base64?.trim()) {
    throw new Error("La imagen no contiene datos");
  }

  const normalizedMime = normalizeMime(mime) || "image/jpeg";

  if (!normalizedMime.startsWith("image/")) {
    throw new Error(`El archivo no es una imagen válida: ${normalizedMime}`);
  }

  const apiKey = requireGeminiKey();

  console.log("[Media AI] Analizando imagen", {
    model: GEMINI_MODEL,
    mime: normalizedMime,
    base64Length: base64.length,
  });

  const response = await callGemini({
    apiKey,
    model: GEMINI_MODEL,
    system:
      "Analizá imágenes enviadas por clientes de WhatsApp y devolvé texto claro, útil y breve en español.",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: normalizedMime,
              data: base64,
            },
          },
          {
            text: [
              "Analiza esta imagen enviada por un cliente mediante WhatsApp.",
              "Responde en español, con información útil para que un asistente de ventas pueda contestarle.",
              "No inventes datos que no sean visibles.",
              "",
              "Si es un comprobante de pago:",
              "- comienza exactamente con COMPROBANTE",
              "- extrae monto, fecha, hora, banco o billetera, número de operación y titular, solo si son visibles",
              "",
              "Si es un producto:",
              "- comienza exactamente con PRODUCTO",
              "- describe qué producto es",
              "- color, marca, modelo, estado y detalles visibles",
              "",
              "Si es una captura, consulta o texto:",
              "- comienza exactamente con CONSULTA",
              "- resume lo importante visible",
              "",
              "Para cualquier otra imagen:",
              "- comienza exactamente con IMAGEN",
              "- describe brevemente qué se observa",
              "",
              "Usa un máximo de 6 líneas.",
            ].join("\n"),
          },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 1024,
  });

  if (!response || response === "__GEMINI_QUOTA_EXCEEDED__") {
    throw new Error("No se pudo interpretar la imagen con Gemini");
  }

  const cleanDescription = clean(response);

  if (!cleanDescription) {
    throw new Error("No se pudo interpretar la imagen");
  }

  return cleanDescription;
}
