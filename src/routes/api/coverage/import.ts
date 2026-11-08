import { createFileRoute } from '@tanstack/react-router';

/** «Importar desde mi entrenamiento» de la pestaña Zonas de cobertura (no guarda nada). */
export const Route = createFileRoute('/api/coverage/import')({
  server: { handlers: { POST: async ({ request }) => {
    const { authUser } = await import('@/lib/push.server');
    const user = await authUser(request);
    if (!user) return Response.json({ error: 'Iniciá sesión en el bot.' }, { status: 401 });
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: profile } = await supabaseAdmin.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle();
    if (!profile?.workspace_id) return Response.json({ error: 'Tu usuario no tiene una tienda.' }, { status: 403 });
    try {
      const { importCoverageFromTraining } = await import('@/lib/coverage-import.server');
      const result = await importCoverageFromTraining(profile.workspace_id);
      return Response.json({ ok: true, ...result });
    } catch (error) {
      console.error('[BOT_SKY_COVERAGE_IMPORT]', error instanceof Error ? error.message : String(error));
      return Response.json({ error: 'No se pudo leer la cobertura de tu entrenamiento. Probá de nuevo o cargala a mano.' }, { status: 500 });
    }
  } } },
});
