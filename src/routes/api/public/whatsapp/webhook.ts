import { createFileRoute } from "@tanstack/react-router";

const textResponse = (
  body: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...extraHeaders,
    },
  });

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      /**
       * Meta utiliza GET para verificar el webhook.
       *
       * Envía:
       * - hub.mode
       * - hub.verify_token
       * - hub.challenge
       *
       * Debemos devolver únicamente hub.challenge con estado 200.
       */
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);

          const mode = url.searchParams.get("hub.mode");
          const receivedToken = url.searchParams.get("hub.verify_token");
          const challenge = url.searchParams.get("hub.challenge");

          console.log("[WhatsApp webhook] Solicitud de verificación", {
            mode,
            hasToken: Boolean(receivedToken),
            hasChallenge: Boolean(challenge),
          });

          if (mode !== "subscribe") {
            console.warn("[WhatsApp webhook] Modo inválido:", mode);
            return textResponse("Invalid mode", 400);
          }

          if (!receivedToken) {
            console.warn("[WhatsApp webhook] Falta hub.verify_token");
            return textResponse("Missing verify token", 400);
          }

          if (!challenge) {
            console.warn("[WhatsApp webhook] Falta hub.challenge");
            return textResponse("Missing challenge", 400);
          }

          /*
           * Primera opción: validar con la variable de entorno.
           * Esta es la forma más estable para la verificación de Meta.
           */
          const environmentToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();

          if (
            environmentToken &&
            receivedToken.trim() === environmentToken
          ) {
            console.log(
              "[WhatsApp webhook] Verificación correcta mediante variable de entorno",
            );

            return textResponse(challenge, 200);
          }

          /*
           * Segunda opción: buscar el token en Supabase.
           * Esto permite utilizar tokens distintos por conexión.
           */
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const { data, error } = await supabaseAdmin
            .from("whatsapp_connections")
            .select("id")
            .eq("verify_token", receivedToken.trim())
            .maybeSingle();

          if (error) {
            console.error(
              "[WhatsApp webhook] Error consultando Supabase:",
              {
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint,
              },
            );

            return textResponse("Database verification error", 500);
          }

          if (!data) {
            console.warn(
              "[WhatsApp webhook] Token de verificación no encontrado",
            );

            return textResponse("Forbidden", 403);
          }

          console.log(
            "[WhatsApp webhook] Verificación correcta mediante Supabase",
            {
              connectionId: data.id,
            },
          );

          return textResponse(challenge, 200);
        } catch (error) {
          console.error(
            "[WhatsApp webhook] Error inesperado durante la verificación:",
            error,
          );

          return textResponse("Internal server error", 500);
        }
      },

      /**
       * Meta utiliza POST para enviar mensajes entrantes
       * y actualizaciones de estado.
       */
      POST: async ({ request }) => {
        try {
          const payload = await request.json().catch((error) => {
            console.error(
              "[WhatsApp webhook] JSON inválido recibido:",
              error,
            );

            return null;
          });

          /*
           * Respondemos 200 incluso cuando el cuerpo no contiene JSON válido,
           * para evitar reintentos innecesarios de Meta.
           */
          if (!payload) {
            return textResponse("ok", 200);
          }

          const { handleWhatsAppWebhook } = await import(
            "@/lib/whatsapp-webhook.server"
          );

          try {
            await handleWhatsAppWebhook(payload);
          } catch (error) {
            /*
             * Registramos el error, pero devolvemos 200.
             * Si devolvemos 500, Meta puede reenviar el mismo webhook.
             */
            console.error(
              "[WhatsApp webhook] Error procesando el evento:",
              error,
            );
          }

          return textResponse("ok", 200);
        } catch (error) {
          console.error(
            "[WhatsApp webhook] Error inesperado en POST:",
            error,
          );

          /*
           * Se devuelve 200 para evitar que Meta reintente indefinidamente
           * el mismo evento.
           */
          return textResponse("ok", 200);
        }
      },
    },
  },
});
