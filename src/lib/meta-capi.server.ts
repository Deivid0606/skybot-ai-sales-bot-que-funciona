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

/** Datos del cliente cifrados (SHA-256) como pide Meta para unir la venta con la persona. */
function hashedCustomer(phone: string | null, customerName?: string | null) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const parts = String(customerName ?? "").toLowerCase().normalize("NFC").replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return {
    ...(digits.length >= 8 ? { ph: [sha256(digits)], external_id: [sha256(digits)] } : {}),
    ...(parts.length >= 1 && parts[0] !== "cliente" ? { fn: [sha256(parts[0])] } : {}),
    ...(parts.length >= 2 ? { ln: [sha256(parts[parts.length - 1])] } : {}),
    country: [sha256("py")],
  };
}

/**
 * Venta SIN código de clic (el cliente escribió directo o el anuncio no lo mandó):
 * igual se informa como compra por chat, con el teléfono y el nombre cifrados.
 */
export function buildChatPurchaseEvent(args: {
  orderId: string; total: number; currency: string; phone: string | null; customerName?: string | null; eventTime?: number;
}) {
  return {
    event_name: "Purchase",
    event_time: args.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: args.orderId,
    action_source: "chat",
    user_data: hashedCustomer(args.phone, args.customerName),
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

/** Meta: «el conjunto de datos no tiene ninguna cuenta de WhatsApp Business vinculada». */
const NOT_LINKED = /2804132|ninguna cuenta de WhatsApp Business vinculada|no WhatsApp Business account|Unsupported post request|does not exist, cannot be loaded/i;
/** Meta: la cuenta de WhatsApp no coincide con la del clic. */
const CLID_MISMATCH = /2804117|no coincide con el identificador de clic/i;

/**
 * Pide a Meta el conjunto de datos PROPIO de la cuenta de WhatsApp Business
 * (POST /{waba_id}/dataset: lo devuelve o lo crea) y lo guarda para la tienda.
 * Usa el token de WhatsApp, que tiene permiso sobre esa cuenta.
 */
export async function ensureWabaDataset(workspaceId: string): Promise<{ ok: boolean; datasetId?: string; message: string }> {
  const { data: conn } = await (supabaseAdmin as any).from("whatsapp_connections").select("waba_id, access_token")
    .eq("workspace_id", workspaceId).limit(1).maybeSingle();
  const wabaId = String(conn?.waba_id ?? "").trim();
  const token = String(conn?.access_token ?? "").trim();
  if (!wabaId) return { ok: false, message: "Tu conexión de WhatsApp todavía no tiene el ID de la cuenta de WhatsApp Business. Se guarda solo con el próximo mensaje que reciba el bot; probá de nuevo después." };
  if (!token) return { ok: false, message: "Tu WhatsApp no tiene token conectado." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/dataset`, {
      method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => null) as { id?: string; error?: { message?: string; error_user_msg?: string } } | null;
    const datasetId = String(body?.id ?? "").trim();
    if (!res.ok || !/^\d+$/.test(datasetId)) {
      return { ok: false, message: `Meta respondió ${res.status}: ${body?.error?.error_user_msg || body?.error?.message || "sin conjunto de datos"}` };
    }
    await (supabaseAdmin as any).from("workspace_meta_capi").upsert(
      { workspace_id: workspaceId, dataset_id: datasetId, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
    return { ok: true, datasetId, message: `✅ Listo: el conjunto de datos de tu WhatsApp es ${datasetId} y ya quedó guardado.` };
  } finally { clearTimeout(timer); }
}

async function record(row: { order_id: string; workspace_id: string; conversation_id: string | null; status: string; http_status?: number | null; detail?: string | null; value?: number | null }) {
  await (supabaseAdmin as any).from("meta_capi_events").upsert(row, { onConflict: "order_id" });
}

type OrderForMeta = { id: string; total: number | string | null; phone: string | null; customer_name: string | null; created_at: string; conversation_id: string | null; status?: string | null };

/**
 * Informa UNA venta a Meta. Con código de clic → compra atribuida al anuncio
 * (business_messaging). Sin código → compra por chat con datos cifrados.
 * Corrige solo el conjunto de datos si no es el de la cuenta de WhatsApp.
 */
async function deliverOrder(workspaceId: string, order: OrderForMeta, setup?: Awaited<ReturnType<typeof loadSetup>>): Promise<string | null> {
  const st = setup ?? await loadSetup(workspaceId);
  const { cfg, token, wabaId } = st;
  let datasetId = st.datasetId;
  if (!cfg || cfg.enabled === false || !datasetId) return null; // la tienda no lo activó
  const base = { order_id: order.id, workspace_id: workspaceId, conversation_id: order.conversation_id, value: Number(order.total) || 0 };
  if (!token) { await record({ ...base, status: "error", detail: "Falta el token de acceso." }); return "error"; }
  const { data: conv } = order.conversation_id
    ? await (supabaseAdmin as any).from("conversations").select("ctwa_clid").eq("id", order.conversation_id).maybeSingle()
    : { data: null };
  const ctwaClid = String(conv?.ctwa_clid ?? "").trim();
  const eventTime = Math.min(Math.floor(Date.now() / 1000), Math.floor(new Date(order.created_at).getTime() / 1000) || Math.floor(Date.now() / 1000));
  const chatEvent = buildChatPurchaseEvent({ orderId: order.id, total: Number(order.total) || 0, currency: "PYG", phone: order.phone, customerName: order.customer_name, eventTime });
  let event: unknown = ctwaClid && wabaId
    ? { ...buildPurchaseEvent({ orderId: order.id, total: Number(order.total) || 0, currency: "PYG", ctwaClid, wabaId, phone: order.phone, eventTime }),
        user_data: { ...hashedCustomer(order.phone, order.customer_name), whatsapp_business_account_id: wabaId, ctwa_clid: ctwaClid } }
    : chatEvent;
  let withClick = event !== chatEvent;
  const testCode = cfg.test_event_code?.trim() || null;
  let res = await postEvents(datasetId, token, [event], testCode);
  if (!res.ok && NOT_LINKED.test(res.body)) {
    const linked = await ensureWabaDataset(workspaceId);
    if (linked.ok && linked.datasetId) { datasetId = linked.datasetId; res = await postEvents(datasetId, token, [event], testCode); }
  }
  // El clic no coincide con la cuenta: igual se informa la venta (sin atribución directa al anuncio).
  if (!res.ok && withClick && CLID_MISMATCH.test(res.body)) {
    event = chatEvent; withClick = false;
    res = await postEvents(datasetId, token, [event], testCode);
  }
  const status = res.ok ? (withClick ? "enviado" : "enviado_sin_anuncio") : "error";
  await record({ ...base, status, http_status: res.status, detail: res.ok ? null : res.body });
  if (!res.ok) console.warn("[BOT_SKY_META_CAPI]", JSON.stringify({ workspaceId, orderId: order.id, status: res.status }));
  return status;
}

/** Se llama una sola vez por pedido nuevo. Nunca lanza errores ni frena el pedido. */
export async function reportWhatsAppPurchase(args: {
  workspaceId: string; orderId: string; conversationId: string | null; total: number; phone: string | null; currency?: string | null;
}): Promise<void> {
  try {
    const setup = await loadSetup(args.workspaceId);
    if (!setup.cfg || setup.cfg.enabled === false || !setup.datasetId) return;
    const { data: order } = await (supabaseAdmin as any).from("orders")
      .select("id, total, phone, customer_name, created_at, conversation_id, status").eq("id", args.orderId).maybeSingle();
    await deliverOrder(args.workspaceId, order ?? {
      id: args.orderId, total: args.total, phone: args.phone, customer_name: null,
      created_at: new Date().toISOString(), conversation_id: args.conversationId,
    }, setup);
    // De paso, reintentar pocas ventas que hayan quedado sin enviar.
    await retryFailedPurchases(args.workspaceId, 2);
  } catch (error) {
    console.warn("[BOT_SKY_META_CAPI]", error instanceof Error ? error.message : String(error));
    try { await record({ order_id: args.orderId, workspace_id: args.workspaceId, conversation_id: args.conversationId, status: "error", detail: error instanceof Error ? error.message.slice(0, 300) : "Error" }); } catch { /* sin efecto en la venta */ }
  }
}

/**
 * Botón «Enviar evento de prueba». Meta solo acepta códigos de clic (ctwa_clid)
 * reales, así que se usa el del último cliente que llegó desde un anuncio. Si
 * todavía no hay ninguno, un rechazo SOLO por el ctwa_clid confirma que el
 * token, el conjunto de datos y la cuenta de WhatsApp están bien.
 */
export async function sendTestPurchase(workspaceId: string, testCode: string): Promise<{ ok: boolean; message: string }> {
  const { cfg, datasetId, token, wabaId } = await loadSetup(workspaceId);
  if (!cfg || !datasetId) return { ok: false, message: "Guardá primero el ID del conjunto de datos." };
  if (!token) return { ok: false, message: "Falta el token de acceso (y tampoco hay token de WhatsApp conectado)." };
  if (!wabaId) return { ok: false, message: "Tu conexión de WhatsApp todavía no tiene el ID de la cuenta de WhatsApp Business. Se guarda solo con el próximo mensaje que reciba el bot; probá de nuevo después." };
  const { data: lastAdChat } = await (supabaseAdmin as any).from("conversations").select("ctwa_clid")
    .eq("workspace_id", workspaceId).not("ctwa_clid", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const realClid = String(lastAdChat?.ctwa_clid ?? "").trim();
  const event = buildPurchaseEvent({ orderId: `prueba-${Date.now()}`, total: 1000, currency: "PYG", ctwaClid: realClid || "PRUEBA_BOT_SKY", wabaId, phone: null });
  let res = await postEvents(datasetId, token, [event], testCode);
  let note = "";
  if (!res.ok && NOT_LINKED.test(res.body)) {
    const linked = await ensureWabaDataset(workspaceId);
    if (!linked.ok) return { ok: false, message: `El conjunto de datos no está vinculado a tu WhatsApp y no se pudo obtener el correcto. ${linked.message}` };
    note = ` Cambié el conjunto de datos por el de tu WhatsApp (${linked.datasetId}): buscá la prueba ahí.`;
    res = await postEvents(linked.datasetId!, token, [event], testCode);
  }
  if (res.ok) return { ok: true, message: "✅ Meta recibió la compra de prueba. Mirala en Administrador de eventos → Probar eventos." + note };
  let detail = res.body;
  try { const err = JSON.parse(res.body)?.error; detail = err?.error_user_msg || err?.message || res.body; } catch { /* texto */ }
  if (!realClid && /ctwa_clid/i.test(detail)) {
    return { ok: true, message: note + " ✅ Conexión correcta: Meta aceptó tu token, tu conjunto de datos y tu cuenta de WhatsApp. Todavía no hay clientes que hayan llegado desde un anuncio; cuando entre el primero, vas a poder repetir la prueba y ver la compra en «Probar eventos». Las ventas reales ya se informan solas." };
  }
  if (/2804117|no coincide con el identificador de clic/i.test(res.body)) {
    return { ok: false, message: "El ID de tu cuenta de WhatsApp Business guardado en el bot no es el de tu número. El bot lo corrige solo con el próximo mensaje que reciba tu WhatsApp (y reenvía las ventas que fallaron). Probá de nuevo en unos minutos." };
  }
  return { ok: false, message: `Meta respondió ${res.status}: ${detail}` };
}


/** Meta acepta eventos de hasta 7 días: se reenvían las ventas que quedaron con error o sin enviar. */
export async function retryFailedPurchases(workspaceId: string, limit = 200): Promise<{ retried: number; sent: number }> {
  const since = new Date(Date.now() - 6.5 * 24 * 3600 * 1000).toISOString();
  const { data: pending } = await (supabaseAdmin as any).from("meta_capi_events")
    .select("order_id").eq("workspace_id", workspaceId).in("status", ["error", "sin_anuncio"]).gte("created_at", since)
    .order("created_at", { ascending: true }).limit(limit);
  if (!pending?.length) return { retried: 0, sent: 0 };
  const setup = await loadSetup(workspaceId);
  if (!setup.cfg || setup.cfg.enabled === false || !setup.datasetId) return { retried: 0, sent: 0 };
  let sent = 0;
  for (const row of pending as Array<{ order_id: string }>) {
    const { data: order } = await (supabaseAdmin as any).from("orders")
      .select("id, total, phone, customer_name, created_at, conversation_id, status").eq("id", row.order_id).maybeSingle();
    if (!order || order.status === "cancelado") continue;
    const status = await deliverOrder(workspaceId, order, setup);
    if (status?.startsWith("enviado")) sent++;
  }
  return { retried: pending.length, sent };
}

/**
 * La cuenta de WhatsApp Business guardada no era la del número: se pide a Meta el
 * conjunto de datos de la cuenta correcta y se reenvían las ventas que fallaron.
 */
export async function resyncAfterWabaChange(workspaceId: string): Promise<void> {
  const { data: cfg } = await (supabaseAdmin as any).from("workspace_meta_capi").select("dataset_id, enabled").eq("workspace_id", workspaceId).maybeSingle();
  if (!cfg || cfg.enabled === false) return;
  const linked = await ensureWabaDataset(workspaceId);
  if (!linked.ok) { console.warn("[BOT_SKY_META_CAPI_RESYNC]", JSON.stringify({ workspaceId, message: linked.message.slice(0, 200) })); return; }
  const result = await retryFailedPurchases(workspaceId);
  console.info("[BOT_SKY_META_CAPI_RESYNC]", JSON.stringify({ workspaceId, datasetId: linked.datasetId, ...result }));
}
