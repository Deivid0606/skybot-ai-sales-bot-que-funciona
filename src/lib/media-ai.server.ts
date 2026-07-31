const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * Lovable documenta Gemini 3 Flash como modelo predeterminado.
 * Puedes sobrescribirlo con LOVABLE_MEDIA_MODEL sin modificar el código.
 */
const MODEL =
  process.env.LOVABLE_MEDIA_MODEL?.trim() || "google/gemini-3-flash";

function requireKey(): string {
  const key = process.env.LOVABLE_API_KEY?.trim();

  if (!key) {
    throw new Error("Falta la variable de entorno LOVABLE_API_KEY");
  }

  return key;
}

type TextBlock = {
  type: "text";
  text: string;
};

type ImageBlock = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

type AudioBlock = {
  type: "input_audio";
  input_audio: {
    data: string;
    format: string;
  };
};

type Block = TextBlock | ImageBlock | AudioBlock;

type GatewayContent =
  | string
  | Array<{
      type?: string;
      text?: string;
    }>;

type GatewayResponse = {
  choices?: Array<{
    message?: {
      content?: GatewayContent;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

function extractContent(json: GatewayResponse): string {
  const content = json.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text?.trim() || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

async function ask(blocks: Block[]): Promise<string> {
  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": requireKey(),
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: blocks,
        },
      ],
      temperature: 0.1,
    }),
  });

  const rawResponse = await response.text();

  let json: GatewayResponse | null = null;

  try {
    json = JSON.parse(rawResponse) as GatewayResponse;
  } catch {
    json = null;
  }

  if (response.status === 429) {
    throw new Error("Lovable AI alcanzó el límite de solicitudes");
  }

  if (response.status === 402) {
    throw new Error("Los créditos de Lovable AI están agotados");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "LOVABLE_API_KEY inválida o sin permiso para usar Lovable AI",
    );
  }

  if (!response.ok) {
    const gatewayMessage =
      json?.error?.message ||
      rawResponse.slice(0, 500) ||
      response.statusText;

    throw new Error(
      `media_ai_error (${response.status}): ${gatewayMessage}`,
    );
  }

  if (!json) {
    throw new Error("Lovable AI devolvió una respuesta que no es JSON válido");
  }

  const result = extractContent(json);

  if (!result) {
    throw new Error("Lovable AI no devolvió contenido");
  }

  return result;
}

function normalizeMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
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

  const format = audioFormatFromMime(mime);

  console.log("[Media AI] Transcribiendo audio", {
    model: MODEL,
    mime,
    format,
    base64Length: base64.length,
  });

  try {
    const transcript = await ask([
      {
        type: "text",
        text:
          "Escucha este audio enviado por un cliente mediante WhatsApp. " +
          "Transcribe literalmente todo lo que dice en español. " +
          "Devuelve únicamente la transcripción, sin títulos, comentarios, " +
          "explicaciones ni comillas. Si no hay voz comprensible, devuelve AUDIO_INCOMPRENSIBLE.",
      },
      {
        type: "input_audio",
        input_audio: {
          data: base64,
          format,
        },
      },
    ]);

    const cleanTranscript = transcript
      .replace(/^["']|["']$/g, "")
      .trim();

    if (
      !cleanTranscript ||
      cleanTranscript.toUpperCase() === "AUDIO_INCOMPRENSIBLE"
    ) {
      throw new Error("No se pudo entender el audio");
    }

    return cleanTranscript;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";

    if (
      /input_audio|unsupported|audio.*not.*support|content.*type/i.test(message)
    ) {
      throw new Error(
        "El modelo configurado en Lovable AI no admite input_audio. " +
          "Configura LOVABLE_MEDIA_MODEL con un modelo compatible con audio " +
          "o utiliza un servicio específico de transcripción.",
      );
    }

    throw error;
  }
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

  console.log("[Media AI] Analizando imagen", {
    model: MODEL,
    mime: normalizedMime,
    base64Length: base64.length,
  });

  const description = await ask([
    {
      type: "text",
      text: [
        "Analiza esta imagen enviada por un cliente mediante WhatsApp.",
        "Responde en español, con información útil para que un asistente de ventas pueda contestarle.",
        "No inventes ningún dato que no sea visible.",
        "",
        "Si es un comprobante de pago:",
        "- comienza exactamente con COMPROBANTE",
        "- extrae monto, fecha, hora, banco o billetera, número de operación y titular, solo si son visibles",
        "",
        "Si es un producto:",
        "- comienza exactamente con PRODUCTO",
        "- identifica el tipo de producto",
        "- describe color, marca, modelo, estado y detalles visibles",
        "",
        "Si es una captura de pantalla o consulta:",
        "- comienza exactamente con CONSULTA",
        "- describe el contenido y cualquier texto importante visible",
        "",
        "Para cualquier otra imagen:",
        "- comienza exactamente con IMAGEN",
        "- describe brevemente qué se observa",
        "",
        "Usa un máximo de 6 líneas.",
      ].join("\n"),
    },
    {
      type: "image_url",
      image_url: {
        url: `data:${normalizedMime};base64,${base64}`,
      },
    },
  ]);

  const cleanDescription = description.trim();

  if (!cleanDescription) {
    throw new Error("No se pudo interpretar la imagen");
  }

  return cleanDescription;
}
