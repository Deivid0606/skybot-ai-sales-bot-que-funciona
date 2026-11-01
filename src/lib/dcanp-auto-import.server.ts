import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Carga automática a DCANP: para cada vendedor con el interruptor activo y su
 * cuenta de DCANP vinculada (la vincula el administrador), manda los pedidos
 * «Nuevo»/«Confirmado» todavía no cargados. DCANP aplica las mismas revisiones
 * que la carga manual y solo carga si el vendedor abrió DCANP ese día.
 */
const DCANP_IMPORT_URL = process.env.DCANP_IMPORT_URL || "https://mnpbwoknqwsjtiyrrxbm.supabase.co/functions/v1/botsky-import";
// Pedidos de hasta 3 días antes de activar la carga automática; los más viejos se cargan a mano.
const BACKLOG_MS = 3 * 24 * 60 * 60 * 1000;
// Un pedido que DCANP rechazó se reintenta cada 30 minutos (por si se corrigió el catálogo o las tarifas).
const RETRY_MS = 30 * 60 * 1000;
const BATCH = 50;

type DcanpResult = { source_order_id: string; status: "created" | "already_exists" | "error"; message?: string };
type WorkspaceRow = { id: string; dcanp_email: string; dcanp_auto_since: string | null };

function isAdvancePayment(order: { payment_method?: string | null; payment_status?: string | null; tags?: string[] | null }): boolean {
  const method = String(order.payment_method ?? "").toLowerCase();
  return order.payment_status === "anticipado" ||
    /anticip|transfer|dep[oó]sito|giro|encomienda/.test(method) ||
    (order.tags ?? []).some(tag => /pago anticipado/i.test(tag));
}

async function callDcanp(body: unknown): Promise<{ status: number; data: any }> {
  const secret = process.env.DCANP_IMPORT_SECRET;
  if (!secret) throw new Error("Falta DCANP_IMPORT_SECRET");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(DCANP_IMPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-botsky-secret": secret },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Verifica UNA vez el correo y la contraseña de DCANP (DCANP los comprueba; no se guardan). */
export async function linkDcanpAccount(email: string, password: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const response = await callDcanp({ seller_email: email, action: "link", password });
  if (response.status === 200 && response.data?.linked) return { ok: true };
  const message = String(response.data?.message ?? "No se pudo verificar la cuenta de DCANP.");
  return { ok: false, status: response.status === 401 || response.status === 403 || response.status === 404 ? response.status : 502, message };
}

async function setWorkspaceStatus(workspaceId: string, status: string) {
  await supabaseAdmin.from("workspaces")
    .update({ dcanp_auto_status: status.slice(0, 300), dcanp_auto_checked_at: new Date().toISOString() } as never)
    .eq("id", workspaceId);
}

async function importWorkspace(ws: WorkspaceRow) {
  const since = new Date(new Date(ws.dcanp_auto_since ?? Date.now()).getTime() - BACKLOG_MS).toISOString();
  const retryBefore = new Date(Date.now() - RETRY_MS).toISOString();
  const { data: orders, error } = await supabaseAdmin.from("orders")
    .select("id,order_number,customer_name,phone,city,departamento,street,district,sku,product_title,quantity,total,payment_method,payment_status,receipt_url,observations,status,tags,ecommerce_sync_error,ecommerce_sync_attempted_at" as never)
    .eq("workspace_id", ws.id)
    .in("status", ["nuevo", "confirmado"])
    .is("ecommerce_synced_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  const rows = ((orders ?? []) as any[]).filter(order =>
    // No van en la carga automática (quedan para cargar a mano):
    // - pagos anticipados;
    // - pedidos sin SKU;
    // - varias presentaciones del mismo producto (artículos separados).
    !isAdvancePayment(order) &&
    String(order.sku ?? "").trim() !== "" &&
    !String(order.observations ?? "").includes("MULTIVARIANTE (MISMO PRODUCTO)") &&
    (!order.ecommerce_sync_error || !order.ecommerce_sync_attempted_at || order.ecommerce_sync_attempted_at < retryBefore))
    .slice(0, BATCH);

  if (!rows.length) {
    // Igual se informa si el vendedor abrió DCANP hoy, para mostrarlo en Pedidos.
    const check = await callDcanp({ seller_email: ws.dcanp_email, check_only: true, linked: true });
    await setWorkspaceStatus(ws.id, check.status === 200
      ? "Activa: no hay pedidos nuevos para cargar."
      : String(check.data?.message ?? `DCANP respondió ${check.status}`));
    return { workspace: ws.id, sent: 0 };
  }

  const response = await callDcanp({
    seller_email: ws.dcanp_email,
    linked: true,
    orders: rows.map(o => ({
      source_order_id: o.id, order_number: o.order_number, customer_name: o.customer_name, phone: o.phone,
      city: o.city, departamento: o.departamento, street: o.street, district: o.district, email: "", obs: "",
      sku: o.sku, product_title: o.product_title, quantity: o.quantity, total: o.total,
      payment_method: o.payment_method, payment_status: o.payment_status, receipt_url: o.receipt_url,
    })),
  });
  if (response.status !== 200 || !Array.isArray(response.data?.results)) {
    // Vendedor sin abrir DCANP hoy, sin permisos o error: no se toca ningún pedido.
    await setWorkspaceStatus(ws.id, String(response.data?.message ?? response.data?.error ?? `DCANP respondió ${response.status}`));
    return { workspace: ws.id, sent: 0, status: response.status };
  }

  const now = new Date().toISOString();
  let loaded = 0, failed = 0;
  for (const result of response.data.results as DcanpResult[]) {
    if (!rows.some(o => o.id === result.source_order_id)) continue;
    if (result.status === "created" || result.status === "already_exists") {
      loaded++;
      await supabaseAdmin.from("orders").update({
        status: "cargado", ecommerce_synced_at: now, ecommerce_sync_error: null, ecommerce_sync_attempted_at: now,
      } as never).eq("workspace_id", ws.id).eq("id", result.source_order_id).in("status", ["nuevo", "confirmado"]);
    } else {
      failed++;
      await supabaseAdmin.from("orders").update({
        ecommerce_sync_error: String(result.message ?? "No se pudo cargar en DCANP").slice(0, 500), ecommerce_sync_attempted_at: now,
      } as never).eq("workspace_id", ws.id).eq("id", result.source_order_id);
    }
  }
  await setWorkspaceStatus(ws.id, `Activa: ${loaded} cargado${loaded === 1 ? "" : "s"} en la última revisión${failed ? `, ${failed} con observaciones (cargar a mano)` : ""}.`);
  console.info("[BOT_SKY_DCANP_AUTO]", JSON.stringify({ workspace: ws.id, sent: rows.length, loaded, failed }));
  return { workspace: ws.id, sent: rows.length, loaded, failed };
}

export async function runDcanpAutoImport() {
  const { data: workspaces, error } = await supabaseAdmin.from("workspaces")
    .select("id,dcanp_email,dcanp_auto_since" as never)
    .eq("dcanp_auto_import" as never, true)
    .not("dcanp_email" as never, "is", null)
    .not("dcanp_verified_at" as never, "is", null);
  if (error) throw error;
  const summary = [];
  for (const ws of (workspaces ?? []) as unknown as WorkspaceRow[]) {
    if (!ws.dcanp_email?.trim()) continue;
    try {
      summary.push(await importWorkspace(ws));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[BOT_SKY_DCANP_AUTO]", ws.id, message);
      await setWorkspaceStatus(ws.id, `Error temporal: ${message}`);
      summary.push({ workspace: ws.id, error: message });
    }
  }
  return { workspaces: summary.length, summary };
}
