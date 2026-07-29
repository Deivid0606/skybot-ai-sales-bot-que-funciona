import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode !== "subscribe" || !token) return new Response("Bad request", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("whatsapp_connections")
          .select("id")
          .eq("verify_token", token)
          .maybeSingle();
        if (!data) return new Response("Forbidden", { status: 403 });
        return new Response(challenge ?? "", { status: 200 });
      },

      POST: async ({ request }) => {
        const payload = await request.json().catch(() => null);
        if (!payload) return new Response("ok");
        const { handleWhatsAppWebhook } = await import("@/lib/whatsapp-webhook.server");
        try {
          await handleWhatsAppWebhook(payload);
        } catch (e) {
          console.error("whatsapp webhook error", e);
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});
