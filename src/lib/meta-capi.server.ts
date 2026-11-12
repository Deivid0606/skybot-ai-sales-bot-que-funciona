/**
 * «Ventas a Meta»: avisa a Meta (API de Conversiones, mensajería de empresas)
 * cada venta registrada por el bot, para que el Administrador de anuncios
 * muestre compras e ingresos por anuncio. No hace falta ser partner de Meta:
 * se usa el conjunto de datos y el token de la propia cuenta del vendedor.
 * Nunca bloquea ni hace fallar el registro del pedido.
 */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v21.0";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export type CapiConfig = { dataset_id: string | null; access_token: string | null; enabled: boolean; test_event_code: string | null };

/** Arma el evento «Purchase» de WhatsApp tal como lo pide Meta. */
export function buildPurchaseEvent(args: {
  orderId: string; total: number; currency: string; ctwaClid: string; wabaId: string; phone: string | null; eventTime?: number;
}) {
  const digits = String(args.phone ?? "").replace(/\D/g, "");
  return {
    event_name: "Purchase",
    event_time: args.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: args.orderId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: {
      whatsapp_business_account_id: args.wabaId,
      ctwa_clid: args.ctwaClid,
      ...(digits.length >= 8 ? { ph: [sha256(digits)] } : {}),
    },
    custom_data: { currency: args.currency, value: Math.round(Number(args.total) || 0) },
  };
}

async function postEvents(datasetId: string, token: string, events: unknown[], testCode: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(datasetId)}/events`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: events, ...(testCode ? { test_event_code: testCode } : {}) }),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
  } finally { clearTimeout(timer); }
}

async function loadSetup(workspaceId: string) {
  const [{ data: cfg }, { data: conn }] = await Promise.all([
    (supabaseAdmin as any).from("workspace_meta_capi").select("dataset_id, access_token, enabled, test_event_code").eq("workspace_id", workspaceId).maybeSingle(),
    (supabaseAdmin as any).from("whatsapp_connections").select("waba_id, access_token").eq("workspace_id", workspaceId).limit(1).maybeSingle(),
  ]);
  const datasetId = String(cfg?.dataset_id ?? "").trim();
  // Sin token propio se usa el de WhatsApp (sirve si ese usuario del sistema tiene acceso al conjunto de datos).
  const token = String(cfg?.access_token ?? "").trim() || String(conn?.access_token ?? "").trim();
  const wabaId = String(conn?.waba_id ?? "").trim();
  return { cfg: cfg as CapiConfig | null, datasetId, token, wabaId };
}

async function record(row: { order_id: string; workspace_id: string; conversation_id: string | null; status: string; http_status?: number | null; detail?: string | null; value?: number | null }) {
  await (supabaseAdmin as any).from("meta_capi_events").upsert(row, { onConflict: "order_id" });
}

/** Se llama una sola vez por pedido nuevo. Nunca lanza errores. */
export async function reportWhatsAppPurchase(args: {
  workspaceId: string; orderId: string; conversationId: string | null; total: number; phone: string | null; currency?: string | null;
}): Promise<void> {
  try {
    const { cfg, datasetId, token, wabaId } = await loadSetup(args.workspaceId);
    if (!cfg || cfg.enabled === false || !datasetId) return; // el vendedor no lo activó
    const { data: conv } = args.conversationId
      ? await (supabaseAdmin as any).from("conversations").select("ctwa_clid").eq("id", args.conversationId).maybeSingle()
      : { data: null };
    const ctwaClid = String(conv?.ctwa_clid ?? "").trim();
    const base = { order_id: args.orderId, workspace_id: args.workspaceId, conversation_id: args.conversationId, value: Number(args.total) || 0 };
    if (!ctwaClid) { await record({ ...base, status: "sin_anuncio", detail: "El cliente no llegó desde un anuncio de WhatsApp." }); return; }
    if (!token || !wabaId) { await record({ ...base, status: "error", detail: !wabaId ? "Falta el ID de la cuenta de WhatsApp Business." : "Falta el token de acceso." }); return; }
    const event = buildPurchaseEvent({ orderId: args.orderId, total: args.total, currency: args.currency || "PYG", ctwaClid, wabaId, phone: args.phone });
    const res = await postEvents(datasetId, token, [event], cfg.test_event_code?.trim() || null);
    await record({ ...base, status: res.ok ? "enviado" : "error", http_status: res.status, detail: res.ok ? null : res.body });
    if (!res.ok) console.warn("[BOT_SKY_META_CAPI]", JSON.stringify({ workspaceId: args.workspaceId, orderId: args.orderId, status: res.status }));
  } catch (error) {
    console.warn("[BOT_SKY_META_CAPI]", error instanceof Error ? error.message : String(error));
    try { await record({ order_id: args.orderId, workspace_id: args.workspaceId, conversation_id: args.conversationId, status: "error", detail: error instanceof Error ? error.message.slice(0, 300) : "Error" }); } catch { /* sin efecto en la venta */ }
  }
}

/** Botón «Enviar evento de prueba»: manda una compra de prueba con el código de prueba de Meta. */
export async function sendTestPurchase(workspaceId: string, testCode: string): Promise<{ ok: boolean; message: string }> {
  const { cfg, datasetId, token, wabaId } = await loadSetup(workspaceId);
  if (!cfg || !datasetId) return { ok: false, message: "Guardá primero el ID del conjunto de datos." };
  if (!token) return { ok: false, message: "Falta el token de acceso (y tampoco hay token de WhatsApp conectado)." };
  if (!wabaId) return { ok: false, message: "Tu conexión de WhatsApp no tiene el ID de la cuenta de WhatsApp Business." };
  const event = buildPurchaseEvent({ orderId: `prueba-${Date.now()}`, total: 1000, currency: "PYG", ctwaClid: "PRUEBA_BOT_SKY", wabaId, phone: null });
  const res = await postEvents(datasetId, token, [event], testCode);
  if (res.ok) return { ok: true, message: "Meta recibió el evento de prueba. Miralo en Administrador de eventos → Probar eventos." };
  let detail = res.body;
  try { detail = JSON.parse(res.body)?.error?.error_user_msg || JSON.parse(res.body)?.error?.message || res.body; } catch { /* texto */ }
  return { ok: false, message: `Meta respondió ${res.status}: ${detail}` };
}
