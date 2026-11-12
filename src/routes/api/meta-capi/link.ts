import { createFileRoute } from '@tanstack/react-router';

/** «Obtener el de mi WhatsApp»: pide a Meta el conjunto de datos de la cuenta de WhatsApp Business y lo guarda. */
export const Route = createFileRoute('/api/meta-capi/link')({
  server: { handlers: { POST: async ({ request }) => {
    const { authUser } = await import('@/lib/push.server');
    const user = await authUser(request);
    if (!user) return Response.json({ error: 'Iniciá sesión en el bot.' }, { status: 401 });
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: profile } = await supabaseAdmin.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle();
    if (!profile?.workspace_id) return Response.json({ error: 'Tu usuario no tiene una tienda.' }, { status: 403 });
    try {
      const { ensureWabaDataset } = await import('@/lib/meta-capi.server');
      const result = await ensureWabaDataset(profile.workspace_id);
      return Response.json(result, { status: result.ok ? 200 : 422 });
    } catch (error) {
      console.error('[BOT_SKY_META_CAPI_LINK]', error instanceof Error ? error.message : String(error));
      return Response.json({ error: 'No se pudo obtener el conjunto de datos.' }, { status: 500 });
    }
  } } },
});
