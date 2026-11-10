import { createFileRoute } from '@tanstack/react-router';

/** «Completar con mi entrenamiento» de las fichas (no guarda nada). */
export const Route = createFileRoute('/api/sales-rules/import')({
  server: { handlers: { POST: async ({ request }) => {
    const { authUser } = await import('@/lib/push.server');
    const user = await authUser(request);
    if (!user) return Response.json({ error: 'Iniciá sesión en el bot.' }, { status: 401 });
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: profile } = await supabaseAdmin.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle();
    if (!profile?.workspace_id) return Response.json({ error: 'Tu usuario no tiene una tienda.' }, { status: 403 });
    try {
      const { suggestSalesRulesFromTraining } = await import('@/lib/sales-rules-import.server');
      const result = await suggestSalesRulesFromTraining(profile.workspace_id);
      return Response.json({ ok: true, ...result });
    } catch (error) {
      console.error('[BOT_SKY_SALES_RULES_IMPORT]', error instanceof Error ? error.message : String(error));
      return Response.json({ error: 'No se pudo leer tu entrenamiento. Probá de nuevo o completá las fichas a mano.' }, { status: 500 });
    }
  } } },
});
