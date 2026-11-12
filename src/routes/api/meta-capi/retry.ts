import { createFileRoute } from '@tanstack/react-router';

/** «Reenviar ventas pendientes»: manda a Meta las ventas de los últimos días que quedaron sin enviar. */
export const Route = createFileRoute('/api/meta-capi/retry')({
  server: { handlers: { POST: async ({ request }) => {
    const { authUser } = await import('@/lib/push.server');
    const user = await authUser(request);
    if (!user) return Response.json({ error: 'Iniciá sesión en el bot.' }, { status: 401 });
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: profile } = await supabaseAdmin.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle();
    if (!profile?.workspace_id) return Response.json({ error: 'Tu usuario no tiene una tienda.' }, { status: 403 });
    try {
      const { retryFailedPurchases } = await import('@/lib/meta-capi.server');
      const result = await retryFailedPurchases(profile.workspace_id, 60);
      return Response.json({ ok: true, ...result });
    } catch (error) {
      console.error('[BOT_SKY_META_CAPI_RETRY]', error instanceof Error ? error.message : String(error));
      return Response.json({ error: 'No se pudieron reenviar las ventas.' }, { status: 500 });
    }
  } } },
});
