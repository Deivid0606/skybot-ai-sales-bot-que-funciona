import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGeminiCandidates, isKeyTemporarilyUnavailable, markKeyUnavailable, wellFormedJson } from "@/lib/ai.server";

/**
 * Seguimientos que no aburren: la IA lee el chat de ESE cliente y escribe un mensaje
 * corto, humano y distinto cada vez. Nunca inventa precios, descuentos, regalos, stock
 * ni plazos de entrega: si lo hace, se descarta y se usa una plantilla variada.
 */
export type FollowupWriterInput = {
  workspaceId: string;
  conversationId: string;
  phase: number;
  firstName: string;
  productName: string;
  pain: string;
  discoveryQuestion: string;
  sellerText: string; // texto propio del vendedor ('' si es el genérico)
};

const AI_TIMEOUT_MS = 9_000;

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** «CEPILLO ELECTRICO 9 EN 1 | EXTRA» → «Cepillo electrico 9 en 1»: un nombre gritado suena a robot. */
export function friendlyProductName(name: string): string {
  const main = name.split("|")[0].replace(/[!¡]+/g, "").replace(/\s+/g, " ").trim();
  const letters = main.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  if (letters.length >= 4 && upper / letters.length > 0.6) {
    const low = main.toLowerCase();
    return low.charAt(0).toUpperCase() + low.slice(1);
  }
  return main;
}

/** Nombre de perfil de WhatsApp usable para saludar («Gracias», «doradiazalfonso» o «Ventas» no lo son). */
const NOT_A_NAME = new Set([
  "gracias", "hola", "buenas", "buen", "bendiciones", "bendicion", "dios", "amor", "cliente", "usuario", "whatsapp",
  "mama", "mami", "papa", "papi", "senora", "senor", "sra", "sr", "tia", "tio", "info", "ventas", "venta", "tienda",
  "store", "shop", "negocio", "familia", "casa", "ok", "yo", "mi", "la", "el", "don", "dona", "lic", "ing", "prof",
]);
export function usableFirstName(name: string): string {
  const n = name.trim();
  const plain = n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n.length < 3 || n.length > 12 || NOT_A_NAME.has(plain) || !/[aeiou]/.test(plain) || /(.)\1\1/.test(plain)) return "";
  return n;
}

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Plantillas de respaldo: varias por fase, elegidas por conversación para no repetir siempre la misma. */
export function templateFollowup(i: FollowupWriterInput): string {
  const n = i.firstName;
  const p = friendlyProductName(i.productName) || "el producto que consultaste";
  const pain = i.pain.replace(/[.!]+$/, "");
  const first = [
    `¡Hola${n ? ` ${n}` : ""}! 😊 Me quedé pensando en tu consulta por ${p}.${pain ? ` Si ${lower(pain)}, de verdad te va a cambiar el día a día.` : ""} ¿Te quedó alguna duda que te pueda aclarar?`,
    `${n ? `${n}, ` : ""}¿cómo va todo? 🙌 Te escribo cortito por ${p}. ${i.discoveryQuestion || "¿Para qué lo estabas pensando usar?"}`,
    `¡Hola${n ? ` ${n}` : ""}! 👋 ¿Pudiste ver bien lo de ${p}? Muchos clientes nos dicen que les resolvió${pain ? ` justo eso de que ${lower(pain)}` : " un problemón"} 😄 ¿Querés que te cuente cómo se usa?`,
    `${n ? `¡${n}! ` : "¡Hola! "}😊 No me quiero quedar sin ayudarte con ${p}. ¿Qué te gustaría saber antes de decidir: cómo funciona, la entrega o la forma de pago?`,
  ];
  const second = [
    `${n ? `${n}, ` : ""}último mensajito, prometido 🙏 ¿Hubo algo que te frenó con ${p}? Contame sin compromiso y lo vemos juntos 😊`,
    `¡Hola${n ? ` ${n}` : ""}! 🌟 Solo quería saber si todavía te interesa ${p}. Si fue por el precio, la entrega o alguna duda, decime y te ayudo 🙌`,
    `${n ? `${n} 😊 ` : "😊 "}Te dejo este mensaje por si se te pasó: ${p} sigue disponible para vos. ¿Lo dejamos para otra ocasión o te lo preparo?`,
  ];
  const pool = i.phase === 2 ? second : first;
  return pool[hash(i.conversationId + i.phase) % pool.length];
}

/** Rechaza datos que la IA podría inventar (lo que el vendedor escribió sí se permite). */
export function followupLooksSafe(text: string, i: FollowupWriterInput): boolean {
  const t = text.trim();
  if (t.length < 25 || t.length > 420) return false;
  const allowed = `${i.productName} ${i.sellerText}`.toLowerCase();
  const withoutAllowedNumbers = t.replace(/\d[\d.,]*/g, (num) => (allowed.includes(num) ? "" : num));
  if (/\d/.test(withoutAllowedNumbers)) return false;
  const risky = /\b(?:gs\.?|guaran[ií]|descuento|gratis|regalo|obsequio|oferta|promo\w*|stock|[uú]ltimas? unidades?|quedan pocos|env[ií]o sin costo|te llega (?:hoy|mañana)|llega (?:hoy|mañana)|garant[ií]a)\b|%|https?:\/\//i;
  const found = t.match(new RegExp(risky.source, "gi")) ?? [];
  if (found.some((w) => !allowed.includes(w.toLowerCase()))) return false;
  if (/seguimiento|no (?:me )?respondiste|como asistente|soy una ia|inteligencia artificial/i.test(t)) return false;
  return true;
}

function cleanAiText(raw: string): string {
  return raw
    .replace(/^```[a-z]*\s*|\s*```$/g, "")
    .replace(/^\s*(?:mensaje|respuesta)\s*:\s*/i, "")
    .replace(/^["“«]+|["”»]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function recentChat(workspaceId: string, conversationId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("messages")
    .select("body,direction,created_at")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? [])
    .reverse()
    .map((m) => `${m.direction === "inbound" ? "CLIENTE" : "TIENDA"}: ${String(m.body ?? "").replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
}

function buildPrompt(i: FollowupWriterInput, chat: string): string {
  return [
    "Sos una vendedora paraguaya de WhatsApp, cálida, simpática y con onda (voseo natural: «vos», «contame», «querés»).",
    "El cliente consultó y dejó de responder. Escribí UN mensaje de seguimiento que dé ganas de contestar.",
    "",
    `Producto: ${friendlyProductName(i.productName) || "(sin nombre)"} (nombralo de forma natural, nunca en mayúsculas)`,
    i.pain ? `Problema que le resuelve: ${i.pain}` : "",
    i.discoveryQuestion ? `Pregunta útil para conocer al cliente: ${i.discoveryQuestion}` : "",
    i.firstName ? `Nombre del cliente: ${i.firstName}` : "Nombre del cliente: (desconocido, no inventes uno)",
    i.sellerText ? `Mensaje base del vendedor (podés usar SUS datos, reescribilo con tu estilo): ${i.sellerText}` : "",
    i.phase === 2
      ? "Es el ÚLTIMO intento: tono liviano, sin presión; preguntá qué lo frenó (precio, entrega, cómo se usa) y ofrecé ayuda."
      : "Es el primer seguimiento: retomá lo último que habló el cliente si sirve, conectá con su problema y terminá con una pregunta fácil de responder.",
    "",
    "Últimos mensajes del chat:",
    chat || "(sin mensajes)",
    "",
    "REGLAS:",
    "- Máximo 3 frases cortas (menos de 300 caracteres), 1 o 2 emojis.",
    "- Nada de números, precios, descuentos, promociones, regalos, stock ni plazos de entrega, salvo que estén en el mensaje base del vendedor.",
    "- No digas que es un seguimiento ni que no respondió. No presiones. No uses links.",
    "- Español de Paraguay: nada de «che», «nde», palabras en guaraní ni modismos argentinos («re», «posta», «viste»).",
    "- Si el cliente ya preguntó algo concreto en el chat, mencionalo con naturalidad.",
    "- Terminá SIEMPRE con una pregunta.",
    "Respondé SOLO con el texto del mensaje.",
  ].filter(Boolean).join("\n");
}

async function callGemini(key: string, model: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: wellFormedJson({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.95 },
        }),
      },
    );
    if (!response.ok) throw new Error(`gemini HTTP ${response.status}`);
    const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAI(key: string, model: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: wellFormedJson({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        max_completion_tokens: 300,
      }),
    });
    if (!response.ok) throw new Error(`openai HTTP ${response.status}`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return String(data.choices?.[0]?.message?.content ?? "").trim();
  } finally {
    clearTimeout(timeout);
  }
}

/** Devuelve el texto del seguimiento y de dónde salió (ia | plantilla). */
export async function writeFollowup(input: FollowupWriterInput): Promise<{ text: string; source: "ia" | "plantilla" }> {
  const i = { ...input, firstName: usableFirstName(input.firstName) };
  try {
    const [{ data: settingsRaw }, chat] = await Promise.all([
      supabaseAdmin
        .from("ai_settings")
        .select("gemini_api_key,gemini_api_key_2,gemini_api_key_3,openai_api_key,provider_models,model")
        .eq("workspace_id", i.workspaceId)
        .maybeSingle(),
      recentChat(i.workspaceId, i.conversationId),
    ]);
    const settings = settingsRaw as unknown as {
      gemini_api_key?: string | null; gemini_api_key_2?: string | null; gemini_api_key_3?: string | null; model?: string | null;
      openai_api_key?: string | null; provider_models?: { openai?: string | null } | null;
    } | null;
    const keys = [settings?.gemini_api_key, settings?.gemini_api_key_2, settings?.gemini_api_key_3]
      .map((k) => String(k ?? "").trim())
      .filter((k, idx, all) => k && all.indexOf(k) === idx && !isKeyTemporarilyUnavailable(k));
    const model = getGeminiCandidates(settings?.model)[0];
    const prompt = buildPrompt(i, chat);
    // Gemini primero; OpenAI de respaldo (la mayoría de las tiendas solo tiene clave de OpenAI).
    const openaiKey = String(settings?.openai_api_key ?? "").trim();
    const openaiModel = /^(?:gpt-4o-mini|gpt-4o|gpt-4\.1-mini|gpt-4\.1-nano|gpt-4\.1)$/.test(String(settings?.provider_models?.openai ?? ""))
      ? String(settings?.provider_models?.openai) : "gpt-4o-mini";
    const attempts: Array<{ key: string; run: () => Promise<string> }> = [
      ...keys.slice(0, 2).map((key) => ({ key, run: () => callGemini(key, model, prompt) })),
      ...(openaiKey && !isKeyTemporarilyUnavailable(openaiKey) ? [{ key: openaiKey, run: () => callOpenAI(openaiKey, openaiModel, prompt) }] : []),
    ];
    for (const attempt of attempts) {
      try {
        const text = cleanAiText(await attempt.run());
        if (followupLooksSafe(text, i)) return { text, source: "ia" };
        console.warn("[followups] Texto IA descartado por seguridad", i.conversationId, text.slice(0, 160));
        break; // la IA respondió pero el texto no sirvió → texto del vendedor o plantilla
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn("[followups] Proveedor IA falló", i.conversationId, reason.slice(0, 120));
        markKeyUnavailable(attempt.key, reason);
      }
    }
  } catch (e) {
    console.warn("[followups] IA no disponible", e instanceof Error ? e.message : String(e));
  }
  // Sin IA: el texto propio del vendedor manda; si no tiene, plantilla variada.
  return { text: i.sellerText || templateFollowup(i), source: "plantilla" };
}
