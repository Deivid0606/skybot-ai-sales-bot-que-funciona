import { createFileRoute } from '@tanstack/react-router';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { sendWhatsAppText } from '@/lib/whatsapp.server';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MS = 20 * 60 * 1000;
const MAX_JOBS = 12;
type Job = {
  delivery_id: string; workspace_id: string; conversation_id: string;
  owner_user_id: string; phone: string; product_id: string;
  phase: number; inbound_message_id: string; inbound_at: string;
};
const asError = (e: unknown) => e instanceof Error ? e.message : String(e);

async function setDelivery(id: string, status: 'sent'|'failed'|'skipped', detail?: string, wamid?: string|null) {
  const {error} = await supabaseAdmin.from('bot_followup_deliveries').update({
    status, failure_reason: detail?.slice(0,500) ?? null,
    ...(status === 'sent' ? {sent_at:new Date().toISOString(),wamid:wamid??null} : {}),
  }).eq('id',id);
  if(error) console.error('[followups] No se pudo actualizar entrega',id,error.message);
}
async function handleJob(job: Job, baseUrl: string) {
  // Revalidar la venta y el último inbound *después* de reclamar la oportunidad.
  const {data: conv,error:convError} = await supabaseAdmin.from('conversations')
    .select('id,workspace_id,sale_closed,is_closed,ai_paused,product_id,user_id')
    .eq('workspace_id',job.workspace_id).eq('id',job.conversation_id).single();
  if(convError || !conv || conv.sale_closed || conv.is_closed || conv.ai_paused || conv.product_id !== job.product_id) {
    await setDelivery(job.delivery_id,'skipped','Conversación cerrada, pausada o producto cambiado'); return;
  }
  const {data: recent,error:msgError} = await supabaseAdmin.from('messages')
    .select('id,body,created_at').eq('workspace_id',job.workspace_id)
    .eq('conversation_id',job.conversation_id).eq('direction','inbound')
    .eq('sender','customer').order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(msgError || !recent || recent.id !== job.inbound_message_id ||
    Date.now() >= new Date(recent.created_at).getTime()+WINDOW_MS-SAFETY_MS) {
    await setDelivery(job.delivery_id,'skipped','Cliente respondió o venció ventana segura'); return;
  }
  // No hacer una segunda venta si un pedido se guardó entre el claim y el envío.
  const {data: order,error:orderError}=await supabaseAdmin.from('orders')
    .select('id').eq('workspace_id',job.workspace_id).eq('conversation_id',job.conversation_id)
    .gte('created_at',recent.created_at).limit(1).maybeSingle();
  if(orderError || order) {await setDelivery(job.delivery_id,'skipped','Pedido existente o error verificándolo');return;}
  const {data:conn,error:connError}=await supabaseAdmin.from('whatsapp_connections')
    .select('phone_number_id,access_token').eq('workspace_id',job.workspace_id).maybeSingle();
  if(connError || !conn?.phone_number_id || !conn.access_token) {
    await setDelivery(job.delivery_id,'failed','Conexión de WhatsApp ausente');return;
  }
  const {data:product,error:productError}=await supabaseAdmin.from('products')
    .select('id,name,is_active,followup_enabled,followup_message,followup_second_message,pain_point')
    .eq('workspace_id',job.workspace_id).eq('id',job.product_id).maybeSingle();
  if(productError || !product?.is_active || !product.followup_enabled) {
    await setDelivery(job.delivery_id,'skipped','Producto sin seguimiento activo'); return;
  }
  const defaultFirst='¡Hola! 😊 ¿Te gustaría continuar con tu pedido? Estoy para ayudarte.';
  const defaultSecond='¡Hola de nuevo! 😊 ¿Todavía te interesa el producto que consultaste? Podemos ayudarte a finalizar tu pedido.';
  // Mensaje PERSONAL (relación con el cliente): nombre, producto y el problema que le resuelve.
  // Se usa cuando el vendedor dejó el texto genérico de siempre o no cargó uno propio.
  const {data:who}=await supabaseAdmin.from('conversations').select('contacts(name)').eq('id',job.conversation_id).maybeSingle();
  const rawName=String((who as {contacts?:{name?:string|null}|null}|null)?.contacts?.name ?? '').replace(/[^\p{L} ]/gu,' ').trim().split(/\s+/)[0] ?? '';
  const firstName=rawName.length>=2 && rawName.length<=15 ? rawName.charAt(0).toUpperCase()+rawName.slice(1).toLowerCase() : '';
  const productName=String((product as {name?:string|null}).name ?? '').replace(/\*+/g,'').trim();
  const pain=String((product as {pain_point?:string|null}).pain_point ?? '').trim().replace(/[.!]+$/,'');
  const personalFirst=`¡Hola${firstName?` ${firstName}`:''}! 😊 Te escribo por ${productName||'el producto que consultaste'}.${pain?` Es ideal si ${pain.charAt(0).toLowerCase()+pain.slice(1)}.`:''} ¿Te quedó alguna duda? Contame y te ayudo, o si querés te lo preparo hoy mismo.`;
  const personalSecond=`${firstName?`${firstName}, `:''}¿cómo estás? 🙌 No quería que te quedes sin ${productName||'tu pedido'}. Si algo te frenó (precio, entrega o cómo se usa), decime y lo vemos juntos 😊`;
  const custom=job.phase === 2 ? product.followup_second_message : product.followup_message;
  const isGeneric=(text:string|null|undefined)=>!text?.trim() || text.trim()===defaultFirst || text.trim()===defaultSecond ||
    /^¡hola( de nuevo)?! 😊 ¿(te gustar[ií]a continuar con tu pedido|todav[ií]a te interesa el producto que consultaste)/i.test(text.trim());
  const followup=String(isGeneric(custom) ? (job.phase===2 ? personalSecond : personalFirst) : custom).trim();
  if(!followup) {await setDelivery(job.delivery_id,'skipped','Mensaje vacío');return;}
  const catalogUrl = `${baseUrl.replace(/\/$/,'')}/c/${encodeURIComponent(job.workspace_id)}`;
  const body=`${followup.slice(0,1200)}\n\n🛍️ Mirá nuestro catálogo: ${catalogUrl}`;
  // ÚLTIMA validación antes de llamar a Meta (no confiar en el cron).
  const {data:latest}=await supabaseAdmin.from('messages').select('id')
    .eq('workspace_id',job.workspace_id).eq('conversation_id',job.conversation_id)
    .eq('direction','inbound').eq('sender','customer')
    .order('created_at',{ascending:false}).limit(1).maybeSingle();
  const {data:stillOpen}=await supabaseAdmin.from('conversations')
    .select('sale_closed,is_closed,ai_paused').eq('workspace_id',job.workspace_id)
    .eq('id',job.conversation_id).maybeSingle();
  if(latest?.id!==job.inbound_message_id || !stillOpen || stillOpen.sale_closed || stillOpen.is_closed || stillOpen.ai_paused ||
     Date.now() >= new Date(job.inbound_at).getTime()+WINDOW_MS-SAFETY_MS) {
    await setDelivery(job.delivery_id,'skipped','Cambio de estado antes del envío');return;
  }
  // Si Meta acepta pero falla el guardado, NO reintentamos: evita duplicar mensajes.
  const wamid=await sendWhatsAppText(conn,job.phone,body);
  const {error:insertError}=await supabaseAdmin.from('messages').insert({
    workspace_id:job.workspace_id,user_id:job.owner_user_id,
    conversation_id:job.conversation_id,direction:'outbound',sender:'ai',
    response_origin:'ai',body,wamid,status:'sent'
  });
  if(insertError) console.error('[followups] WhatsApp enviado, falló auditoría messages',insertError.message);
  await setDelivery(job.delivery_id,'sent',undefined,wamid);
}

async function handler({request}:{request:Request}) {
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret || request.headers.get('authorization')!==`Bearer ${secret}`)
    return new Response('Unauthorized',{status:401});
  const baseUrl=process.env.PUBLIC_SITE_URL?.trim();
  if(!baseUrl || !/^https:\/\//.test(baseUrl))
    return Response.json({error:'Configurá PUBLIC_SITE_URL=https://tu-dominio'}, {status:503});
  // Horario de descanso (Paraguay): no escribir a los clientes entre las 22:00 y las 7:00.
  const hourPy=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Asuncion',hour:'numeric',hourCycle:'h23'}).format(new Date()));
  if(hourPy>=22 || hourPy<7) return Response.json({claimed:0,processed:0,failed:0,quietHours:true});
  const {data,error}=await supabaseAdmin.rpc('bot_claim_followups',{p_limit:MAX_JOBS});
  if(error) return Response.json({error:error.message},{status:500});
  let processed=0,failed=0;
  for(const job of (data??[]) as Job[]) {
    try {await handleJob(job,baseUrl);processed++;}
    catch(e){failed++;await setDelivery(job.delivery_id,'failed',asError(e));console.error('[followups]',job.conversation_id,asError(e));}
  }
  return Response.json({claimed:(data??[]).length,processed,failed});
}
export const Route=createFileRoute('/api/followups')({
  server:{handlers:{GET:handler,POST:handler}}
});
