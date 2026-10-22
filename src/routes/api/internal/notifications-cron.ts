import { createFileRoute } from '@tanstack/react-router';

/**
 * Endpoint privado invocado por Supabase Cron mediante POST.
 * Requiere BOTSKY_CRON_SECRET en Vercel y botsky_cron_secret en Supabase Vault.
 */
export const Route = createFileRoute('/api/internal/notifications-cron')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const configuredSecret = process.env.BOTSKY_CRON_SECRET;
        const authorization = request.headers.get('authorization');

        if (!configuredSecret) {
          console.error('[BOTSKY_CRON] Falta BOTSKY_CRON_SECRET');
          return Response.json({ error: 'Configuración del servidor incompleta' }, { status: 503 });
        }
        if (authorization !== `Bearer ${configuredSecret}`) {
          return Response.json({ error: 'No autorizado' }, { status: 401 });
        }

        try {
          const { processBotSkyNotificationBatch } = await import('@/lib/whatsapp-notification-worker.server');
          // El worker actual reclama hasta 20 registros por llamada.
          const results = await processBotSkyNotificationBatch();
          return Response.json({
            claimed: results.length,
            processed: results.filter((result) => result.status === 'sent').length,
            failed: results.filter((result) => result.status === 'failed').length,
            retries: results.filter((result) => result.status === 'retry').length,
            skipped: results.filter((result) => result.status === 'skipped').length,
          });
        } catch (error) {
          console.error('[BOTSKY_CRON] Error procesando notificaciones:', error);
          return Response.json({ error: 'Error procesando notificaciones' }, { status: 500 });
        }
      },
    },
  },
});
