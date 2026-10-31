import { createFileRoute } from "@tanstack/react-router";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El E-commerce avisa aquí cuando cambia el estado de un pedido que vino del bot
 * (trigger en su base de datos). Requiere la clave compartida en
 * «x-botsky-secret». Acepta un pedido o una lista en «orders».
 */
export const Route = createFileRoute("/api/public/ecommerce/order-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { validEcommerceSecret, botStateForEcommerceStatus } = await import("@/lib/ecommerce-status.server");
        if (!validEcommerceSecret(request.headers.get("x-botsky-secret"))) return json({ error: "unauthorized" }, 401);
        const payload = await request.json().catch(() => null) as
          | { source_order_id?: string; status?: string; orders?: Array<{ source_order_id?: string; status?: string }> }
          | null;
        const items = (payload?.orders ?? (payload ? [payload] : []))
          .filter(item => typeof item?.source_order_id === "string" && UUID_RE.test(item.source_order_id) && typeof item.status === "string" && item.status.trim())
          .slice(0, 500);
        if (!items.length) return json({ error: "sin pedidos válidos" }, 400);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const results: Array<{ source_order_id: string; updated: boolean; status: string | null }> = [];
        for (const item of items) {
          const ecommerceStatus = item.status!.trim().slice(0, 80);
          const botState = botStateForEcommerceStatus(ecommerceStatus);
          const patch: Record<string, unknown> = { ecommerce_status: ecommerceStatus, ecommerce_status_at: new Date().toISOString() };
          if (botState) patch.status = botState;
          const { data, error } = await supabaseAdmin.from("orders").update(patch as never)
            .eq("id", item.source_order_id!).select("id").maybeSingle();
          if (error) console.error("[BOT_SKY_ECOMMERCE_STATUS]", item.source_order_id, error.message);
          results.push({ source_order_id: item.source_order_id!, updated: Boolean(data && !error), status: botState });
        }
        console.info("[BOT_SKY_ECOMMERCE_STATUS]", JSON.stringify({ received: items.length, updated: results.filter(r => r.updated).length }));
        return json({ ok: true, results });
      },
    },
  },
});
