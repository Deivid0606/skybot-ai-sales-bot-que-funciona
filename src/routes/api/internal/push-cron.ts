import {createFileRoute} from '@tanstack/react-router';
export const Route = createFileRoute('/api/internal/push-cron')({
 server:{handlers:{POST:async ({request})=>{
   const expected=process.env.BOTSKY_CRON_SECRET;
   if(!expected || request.headers.get('authorization')!==`Bearer ${expected}`) {
     return Response.json({error:'No autorizado'},{status:401});
   }
   try {
     const {processPushBatch}=await import('@/lib/push.server');
     return Response.json(await processPushBatch());
   } catch (e:any) {
     console.error('BOT SKY push cron',e);
     return Response.json({error:'Error procesando cola push'},{status:500});
   }
 }}}
});
