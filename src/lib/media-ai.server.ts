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
  apiKey,
}: {
  audioBase64: string;
  mime: string;
  apiKey: string;
}): Promise<string> {
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

/**
 * Transcribe una nota de voz o audio recibido desde WhatsApp.
 */
export async function transcribeAudio(
  base64: string,
  mime: string,
  workspaceId?: string,
): Promise<string> {
  if (!base64?.trim()) throw new Error("El audio no contiene datos");
  const normalizedMime = normalizeMime(mime) || "audio/ogg";
  // Consultar credenciales del propietario del WhatsApp, no de otra tienda.
  const providers = await visionProviders(workspaceId);
  const openAiKeys = providers.filter(p => p.kind === "openai");
  const geminiKeys = providers.filter(p => p.kind === "gemini");
  if (!providers.length && process.env.OPENAI_API_KEY?.trim() && !workspaceId) {
    openAiKeys.push({ kind: "openai", key: process.env.OPENAI_API_KEY.trim(), model: "whisper-1", label: "openai_global" });
  }
  if (!geminiKeys.length && !openAiKeys.length) {
    throw new Error("Este vendedor no tiene una API compatible para transcribir audios");
  }
  for (const provider of geminiKeys) {
    // Modelo multimedia de transcripción; el modelo de chat no siempre admite audio.
    const candidates = [...new Set([provider.model, GEMINI_MODEL].filter(Boolean))];
    for (const model of candidates) {
      try {
        const transcript = await transcribeAudioWithGemini({ apiKey: provider.key, model, audioBase64: base64, mime: normalizedMime });
        const cleaned = clean(transcript);
        if (cleaned && cleaned !== "__GEMINI_QUOTA_EXCEEDED__" && cleaned.toUpperCase() !== "AUDIO_INCOMPRENSIBLE") {
          return cleaned.replace(/^["']|["']$/g, "");
        }
        if (cleaned === "AUDIO_INCOMPRENSIBLE") break;
      } catch (error) {
        console.warn("[Media AI] Falló proveedor Gemini del vendedor", { label: provider.label, model, error: String(error).slice(0, 180) });
      }
    }
  }
  for (const provider of openAiKeys) {
    const result = await transcribeAudioWithOpenAI({ audioBase64: base64, mime: normalizedMime, apiKey: provider.key });
    if (result) return result;
  }
  throw new Error("Ningún proveedor configurado pudo transcribir este audio; revisar logs de Media AI");
}

/**
 * Interpreta una imagen enviada por un cliente.
 * El resultado se guarda como transcript y entra al contexto de la IA.
 */

/** Claves aisladas por workspace; nunca se reciben desde el navegador. */
type VisionProvider = {kind:"gemini"|"openai"; key:string; model:string; label:string};
async function visionProviders(workspaceId?: string): Promise<VisionProvider[]> {
  const providers: VisionProvider[] = [];
  if (workspaceId) {
    const {supabaseAdmin} = await import("@/integrations/supabase/client.server");
    const {data, error} = await supabaseAdmin.from("ai_settings")
      .select("gemini_api_key,gemini_api_key_2,gemini_api_key_3,openai_api_key,model,provider_models,provider_order")
      .eq("workspace_id",workspaceId).maybeSingle();
    if (error) throw new Error("No se pudo consultar la configuración de IA del vendedor: " + error.message);
    if (data) {
      const model = String(data.model ?? "").trim().replace(/^models\//, "") || "gemini-3.5-flash-lite";
      const keys = [data.gemini_api_key,data.gemini_api_key_2,data.gemini_api_key_3];
      keys.forEach((k,i)=> {if (typeof k === "string" && k.trim()) providers.push({kind:"gemini",key:k.trim(),model,label:`gemini${i+1}`});});
      const openKey = data.openai_api_key;
      if (typeof openKey === "string" && openKey.trim()) providers.push({kind:"openai",key:openKey.trim(),model:"gpt-4o-mini",label:"openai"});
    }
  }
  // Retrocompatibilidad para otras funciones sin workspace configurado.
  // Nunca dar prioridad a una clave global inválida sobre las claves del vendedor.
  if (!workspaceId && !providers.length && process.env.GEMINI_API_KEY?.trim()) providers.push({kind:"gemini",key:process.env.GEMINI_API_KEY.trim(),model:GEMINI_MODEL,label:"gemini_global"});
  return providers;
}

async function callOpenAiImage(apiKey:string, model:string, mime:string, base64:string, instruction:string):Promise<string> {
  const response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({model,temperature:0,max_tokens:800,messages:[{role:"user",content:[
      {type:"text",text:instruction},
      {type:"image_url",image_url:{url:`data:${mime};base64,${base64}`,detail:"high"}}
    ]}]})
  });
  if(!response.ok) {console.warn("[Media AI] Respaldo OpenAI falló",{status:response.status});throw new Error(`OpenAI imagen HTTP ${response.status}`);}
  const data=await response.json();
  return clean(data?.choices?.[0]?.message?.content);
}

export async function describeImage(
  base64: string,
  mime: string,
  workspaceId?: string,
): Promise<string> {
  if (!base64?.trim()) {
    throw new Error("La imagen no contiene datos");
  }

  const normalizedMime = normalizeMime(mime) || "image/jpeg";

  if (!normalizedMime.startsWith("image/")) {
    throw new Error(`El archivo no es una imagen válida: ${normalizedMime}`);
  }

  const providers = await visionProviders(workspaceId);
  if (!providers.length) throw new Error("El vendedor no tiene claves de IA para analizar imágenes");

  console.log("[Media AI] Analizando imagen", {
    model: providers[0].model,
    mime: normalizedMime,
    base64Length: base64.length,
  });

  const requestImage = (model: string, apiKey: string) => callGemini({
    apiKey,
    model,
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
              "Si es un comprobante de pago o de transferencia (AUNQUE sea una captura de pantalla de la app del banco o de Eko/billetera), es COMPROBANTE:",
              "- diferenciar claramente cuenta de destino de cuenta de origen y beneficiario de remitente",
              "- no confundir saldo, precio anunciado, comisiones o números de referencia con monto transferido",
              "- La PRIMERA línea debe ser exactamente COMPROBANTE.",
              "- Después respondé SOLO con estas claves, una por línea, sin Markdown:",
              "MONTO_GS: [importe exacto de la transferencia, solo dígitos; o NO_LEGIBLE]",
              "BENEFICIARIO: [nombre que figura bajo PARA / destinatario, o NO_LEGIBLE]",
              "CUENTA_DESTINO: [número de cuenta del beneficiario visible bajo PARA, o NO_LEGIBLE]",
              "ALIAS_DESTINO: [alias / CI utilizado para transferir al destinatario, si se muestra como identificador de pago; o NO_LEGIBLE]",
              "EMISOR: [nombre que figura bajo DE / remitente, o NO_LEGIBLE]",
              "BANCO: [nombre visible, o NO_LEGIBLE]",
              "OPERACION: [número de referencia único si es legible, o NO_LEGIBLE]",
              "FECHA: [fecha y hora visibles, o NO_LEGIBLE]",
              "- MONTO_GS es lo transferido, NO el precio del producto, saldo disponible ni total de un pedido.",
              "- Nunca confundas EMISOR con BENEFICIARIO, ni cuenta de origen con CUENTA_DESTINO.",
              "- Si el comprobante identifica el destino mediante ALIAS, número de cédula o ID de transferencia, conservalo literalmente en ALIAS_DESTINO: no lo marques ilegible por no ser un número de cuenta.",
              "- No conviertas la cédula del remitente en alias de destino; solo informar si aparece vinculada explícitamente a PARA / destinatario.",
              "- No infieras los últimos dígitos si un número está parcialmente oculto.",
              "- Si hay varios montos o destinatarios y no está claro cuál corresponde, usá NO_LEGIBLE.",
              "- No declares que el pago se acreditó ni que el documento es auténtico.",
              "",
              "Si es un producto:",
              "- comienza exactamente con PRODUCTO",
              "- describe qué producto es",
              "- color, marca, modelo, estado y detalles visibles",
              "",
              "Si es una captura, consulta o texto que NO es un comprobante de pago:",
              "- comienza exactamente con CONSULTA",
              "- resume lo importante visible",
              "",
              "Para cualquier otra imagen:",
              "- comienza exactamente con IMAGEN",
              "- describe brevemente qué se observa",
              "",
              "Para comprobantes mantené todas las líneas indicadas arriba; para otras imágenes usa como máximo 6 líneas.",
            ].join("\n"),
          },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 1024,
  });
  const instructions = [
    "Analizá esta imagen de WhatsApp. No inventes datos no visibles.",
    "Si es comprobante de pago o transferencia (aunque sea captura de pantalla de la app del banco), la primera línea EXACTA es COMPROBANTE y luego, una línea por clave:",
    "MONTO_GS: [dígitos del importe transferido o NO_LEGIBLE]",
    "BENEFICIARIO: [nombre bajo PARA o NO_LEGIBLE]",
    "CUENTA_DESTINO: [número de cuenta bajo PARA o NO_LEGIBLE]",
    "ALIAS_DESTINO: [alias / cédula como identificador de destino bajo PARA o NO_LEGIBLE]",
    "EMISOR: [nombre bajo DE o NO_LEGIBLE]",
    "BANCO: [banco o NO_LEGIBLE]",
    "OPERACION: [referencia u operación o NO_LEGIBLE]",
    "FECHA: [fecha visible o NO_LEGIBLE]",
    "Si el banco muestra alias / CI en vez de número de cuenta para el destinatario, colocalo en ALIAS_DESTINO; no inventes CUENTA_DESTINO.",
    "Nunca uses precio del catálogo como MONTO_GS ni confundas remitente con destinatario.",
    "Para otras imágenes, comenzá PRODUCTO, CONSULTA o IMAGEN y describí brevemente."
  ].join("\n");
  let response = "";
  const failures:string[]=[];
  for(const provider of providers) {
    try {
      const next=provider.kind === "gemini"
        ? await requestImage(provider.model,provider.key)
        : await callOpenAiImage(provider.key,provider.model,normalizedMime,base64,instructions);
      if(next && next !== "__GEMINI_QUOTA_EXCEEDED__") {response=next; console.info("[Media AI] Imagen interpretada",{provider:provider.label,model:provider.model});break;}
      failures.push(`${provider.label}:sin_respuesta_o_cuota`);
    } catch(error) {
      // No registrar la API key, respuesta completa del proveedor ni contenido sensible.
      failures.push(`${provider.label}:${error instanceof Error?error.message.slice(0,80):"error"}`);
      console.warn("[Media AI] Proveedor de imagen no disponible",{provider:provider.label});
    }
  }
  if(!response) throw new Error("No se pudo interpretar la imagen con las IA configuradas: "+failures.join("; "));
  const cleanDescription = clean(response);

  if (!cleanDescription) {
    throw new Error("No se pudo interpretar la imagen");
  }

  return cleanDescription;
}
/**
 * Segunda lectura SOLO de comprobante, para cuando la primera interpretación
 * clasificó una captura bancaria como consulta/imagen y no trajo los campos.
 */
export async function readReceiptImage(base64: string, mime: string, workspaceId?: string): Promise<string | null> {
  const normalizedMime = normalizeMime(mime) || "image/jpeg";
  if (!base64?.trim() || !normalizedMime.startsWith("image/")) return null;
  const providers = await visionProviders(workspaceId);
  const instructions = [
    "Esta imagen es un comprobante de pago o transferencia (puede ser captura de pantalla de la app del banco). Extraé SOLO lo visible.",
    "Primera línea EXACTA: COMPROBANTE. Si de verdad no es un comprobante de pago, respondé solo: NO_COMPROBANTE.",
    "Luego una línea por clave, sin Markdown:",
    "MONTO_GS: [importe transferido/debitado, solo dígitos, o NO_LEGIBLE]",
    "BENEFICIARIO: [nombre del destinatario (Destino/Para), o NO_LEGIBLE]",
    "CUENTA_DESTINO: [cuenta del destinatario tal como se ve, incluso con asteriscos, o NO_LEGIBLE]",
    "ALIAS_DESTINO: [alias / CI del destinatario, o NO_LEGIBLE]",
    "EMISOR: [nombre del que paga (Origen/De), o NO_LEGIBLE]",
    "BANCO: [entidad, o NO_LEGIBLE]",
    "OPERACION: [número de comprobante/operación, o NO_LEGIBLE]",
    "FECHA: [fecha y hora, o NO_LEGIBLE]",
    "Nunca confundas Origen con Destino ni el saldo con el monto.",
  ].join("\n");
  for (const provider of providers) {
    try {
      const out = provider.kind === "gemini"
        ? await callGemini({ apiKey: provider.key, model: provider.model,
            system: "Extraés datos de comprobantes de pago paraguayos con exactitud.",
            contents: [{ role: "user", parts: [{ inlineData: { mimeType: normalizedMime, data: base64 } }, { text: instructions }] }],
            temperature: 0, maxTokens: 600 })
        : await callOpenAiImage(provider.key, provider.model, normalizedMime, base64, instructions);
      const text = clean(out ?? "");
      if (text && text !== "__GEMINI_QUOTA_EXCEEDED__") return /^NO_COMPROBANTE/i.test(text) ? null : text;
    } catch {
      console.warn("[Media AI] Lectura de comprobante no disponible", { provider: provider.label });
    }
  }
  return null;
}

/** Lectura documental, nunca acreditación bancaria. Se evita inferir valores ausentes. */
export type ReceiptFields = {
  amountGs: number | null; beneficiary: string | null; destinationAccount: string | null;
  destinationAlias: string | null;
  sender: string | null; operation: string | null; bank: string | null; date: string | null;
};
export function parseReceiptFields(description: string | null | undefined): ReceiptFields | null {
  const raw = String(description ?? "").trim();
  const normalized = raw.replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```\s*$/i, "").trim().replace(/^\*\*(COMPROBANTE)\*\*/i, "$1");
  if (!/^(?:\uFEFF)?\s*(?:\[imagen\]\s*)?COMPROBANTE\b/i.test(normalized) &&
      !(/^\s*(?:[-*]\s*)?(?:\*\*)?MONTO_GS(?:\*\*)?\s*:/im.test(normalized) &&
        /^\s*(?:[-*]\s*)?(?:\*\*)?(?:BENEFICIARIO|CUENTA_DESTINO|ALIAS_DESTINO)(?:\*\*)?\s*:/im.test(normalized))) return null;
  const value = (key: string) => {
    const match = normalized.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${key}(?:\\*\\*)?\\s*:\\s*(.+)$`, "im"));
    const v = (match?.[1]?.trim() ?? "").replace(/^\*\*\s*/, "").replace(/\*\*\s*$/, "").trim();
    return v && !/^(?:NO_LEGIBLE|NO VISIBLE|DESCONOCIDO|N\/?A|null)$/i.test(v) ? v : null;
  };
  const amountText = value("MONTO_GS");
  const digits = amountText?.replace(/[^0-9]/g, "") ?? "";
  const amountGs = /^\d{1,12}$/.test(digits) && Number(digits) > 0 ? Number(digits) : null;
  return {amountGs,beneficiary:value("BENEFICIARIO"),destinationAccount:value("CUENTA_DESTINO"),
    destinationAlias:value("ALIAS_DESTINO"),
    sender:value("EMISOR"),operation:value("OPERACION"),bank:value("BANCO"),date:value("FECHA")};
}
