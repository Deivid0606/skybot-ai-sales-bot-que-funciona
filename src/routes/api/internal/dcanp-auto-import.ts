import { createFileRoute } from '@tanstack/react-router';

// Lo llama cada 2 minutos la tarea programada «botsky-dcanp-auto-import» (pg_cron).
export const Route = createFileRoute('/api/internal/dcanp-auto-import')({
  server: { handlers: { POST: async ({ request }) => {
    const expected = process.env.BOTSKY_CRON_SECRET;
    if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }
    try {
      const { runDcanpAutoImport } = await import('@/lib/dcanp-auto-import.server');
      return Response.json(await runDcanpAutoImport());
    } catch (e) {
      console.error('[BOT_SKY_DCANP_AUTO] cron', e);
      return Response.json({ error: 'Error en la carga automática a DCANP' }, { status: 500 });
    }
  } } },
});
