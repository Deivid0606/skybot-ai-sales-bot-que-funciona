import { createFileRoute } from '@tanstack/react-router';

/**
 * «Conectar con DCANP»: el vendedor (con sesión en el bot) envía su correo y
 * contraseña de DCANP UNA vez. DCANP los verifica; la contraseña no se guarda.
 * Si es correcta, la cuenta queda vinculada para siempre y se activa la carga automática.
 */
export const Route = createFileRoute('/api/dcanp/link')({
  server: { handlers: { POST: async ({ request }) => {
    const { authUser } = await import('@/lib/push.server');
    const user = await authUser(request);
    if (!user) return Response.json({ error: 'Iniciá sesión en el bot.' }, { status: 401 });
    const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      return Response.json({ error: 'Ingresá tu correo y contraseña de DCANP.' }, { status: 400 });
    }
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: profile } = await supabaseAdmin.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle();
    if (!profile?.workspace_id) return Response.json({ error: 'Tu usuario no tiene una tienda.' }, { status: 403 });

    const { linkDcanpAccount } = await import('@/lib/dcanp-auto-import.server');
    const result = await linkDcanpAccount(email, password);
    if (!result.ok) return Response.json({ error: result.message }, { status: result.status });

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from('workspaces').update({
      dcanp_email: email, dcanp_verified_at: now, dcanp_auto_import: true, dcanp_auto_since: now,
      dcanp_auto_status: 'Cuenta de DCANP conectada. Se revisa cada 2 minutos.',
    } as never).eq('id', profile.workspace_id);
    if (error) return Response.json({ error: 'No se pudo guardar la conexión.' }, { status: 500 });
    return Response.json({ ok: true, email });
  } } },
});
