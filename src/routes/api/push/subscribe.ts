import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/push/subscribe')({
  server: { handlers: {
    POST: async ({request}) => {
      const {authUser} = await import('@/lib/push.server');
      const {supabaseAdmin} = await import('@/integrations/supabase/client.server');
      const user = await authUser(request);
      if (!user) return Response.json({error:'No autorizado'}, {status:401});
      let subscription: any;
      try { subscription = await request.json(); } catch { return Response.json({error:'JSON inválido'},{status:400}); }
      if (typeof subscription?.endpoint !== 'string' || !subscription.endpoint.startsWith('https://') ||
          typeof subscription?.keys?.p256dh !== 'string' || typeof subscription?.keys?.auth !== 'string') {
        return Response.json({error:'Suscripción inválida'},{status:400});
      }
      // Upsert by endpoint (device); user ID comes from verified JWT, never client input.
      const {error} = await supabaseAdmin.from('botsky_push_subscriptions').upsert({
        user_id:user.id, endpoint:subscription.endpoint, subscription, updated_at:new Date().toISOString()
      } as any,{onConflict:'endpoint'});
      return error ? Response.json({error:error.message},{status:500}) : Response.json({ok:true});
    }
  }}
});
