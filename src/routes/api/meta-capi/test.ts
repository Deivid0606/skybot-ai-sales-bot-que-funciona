import { createFileRoute } from '@tanstack/react-router';

/** «Enviar evento de prueba» de la pestaña Ventas a Meta. */
export const Route = createFileRoute('/api/meta-capi/test')({
  server: { handlers: { POST: async ({ request }) => {
    const { authUser } = await import('@/lib/push.server');
    const user = await authUser(request);
    if (!user) return Response.json({ error: 'Iniciá sesión en el bot.' }, { status: 401 });
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: profile } = await supabaseAdmin.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle();
    if (!profile?.workspace_id) return Response.json({ error: 'Tu usuario no tiene una tienda.' }, { status: 403 });
    const body = await request.json().catch(() => ({})) as { testCode?: string };
    const testCode = String(body.testCode ?? '').trim().slice(0, 40);
    if (!/^TEST[0-9A-Za-z]+$/.test(testCode)) return Response.json({ error: 'Pegá el código de prueba de Meta (empieza con TEST).' }, { status: 400 });
    try {
      const { sendTestPurchase } = await import('@/lib/meta-capi.server');
      const result = await sendTestPurchase(profile.workspace_id, testCode);
      return Response.json(result, { status: result.ok ? 200 : 422 });
    } catch (error) {
      console.error('[BOT_SKY_META_CAPI_TEST]', error instanceof Error ? error.message : String(error));
      return Response.json({ error: 'No se pudo enviar el evento de prueba.' }, { status: 500 });
    }
  } } },
});
