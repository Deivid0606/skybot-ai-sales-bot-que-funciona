import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/push/unsubscribe')({
  server:{handlers:{POST:async ({request})=>{
    const {authUser} = await import('@/lib/push.server');
    const {supabaseAdmin} = await import('@/integrations/supabase/client.server');
    const user=await authUser(request);
    if(!user) return Response.json({error:'No autorizado'},{status:401});
    const {endpoint}=await request.json().catch(()=>({endpoint:null}));
    if(typeof endpoint!=='string') return Response.json({error:'Endpoint requerido'},{status:400});
    const {error}=await supabaseAdmin.from('botsky_push_subscriptions').delete().eq('user_id',user.id).eq('endpoint',endpoint);
    return error ? Response.json({error:error.message},{status:500}):Response.json({ok:true});
  }}}
});
