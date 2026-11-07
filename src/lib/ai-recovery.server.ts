import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildWorkspaceAiContext } from "@/lib/ai-context.server";
import { generateAiReply } from "@/lib/ai.server";
import { sendWhatsAppText } from "@/lib/whatsapp.server";
import type { SaleState } from "@/lib/rule-sales.server";

/**
 * Recovery queue for failed AI turns.
 *
 * Guarantees:
 * - one claimed pending record at a time; avoids duplicate outbound messages
 * - no outbound if a human or another automation already answered that turn
 * - no contact outside WhatsApp's 24h service window
 * - no order/payment confirmations (checkout verification is done by the webhook)
 * - no cross-workspace contact, training, keys or products
 * - skips manual code testing and shops which disabled recovery
 */
const SERVICE_WINDOW_MS = 23 * 60 * 60 * 1000;
const CLAIM_LIMIT = 4;
const AI_RECOVERY_BATCH_LIMIT = 2;

function isFalseConfirmation(text: string) {
  return /(?:pedido|compra)\s+(?:ya\s+)?(?:confirmad|registrad)|(?:✅\s*)?PEDIDO CONFIRMADO|\bBS-[A-F0-9]{6,}|pago\s+(?:acreditad|confirmad|verificad)|recibimos\s+tu\s+dinero|(?:tu|su)\s+pedido\s+(?:ya\s+)?(?:qued[oó]|est[aá])\s+(?:listo|confirmado|registrado)/i.test(text);
}
function reasonIsProviderFailure(reason: string) {
  return /gemini_error|gemini_key_unavailable|openai HTTP|todos los proveedores fallaron|insufficient_quota|resource_exhausted|quota exceeded|credit_balance_exhausted|\b(?:401|402|403|429|500|502|503|504)\b/i.test(reason);
}
function isCustomerOptOut(text: string) {
  return /\b(?:no me (?:escribas|escriban|contactes|contacten)|no quiero (?:mas|más) mensajes|no me contacten|no me molesten|dejen de escribirme|cancelar pedido)\b/i.test(text);
}
export async function processAiRecoveryBatch() {
  const outcome={checked:0,recovered:0,skipped:0,pending:0,failed:0};
  const {data:records,error}=await supabaseAdmin.from("ai_failed_messages")
    .select("id,workspace_id,user_id,conversation_id,wamid,created_at,error_message")
    .eq("status","pending")
    .lte("updated_at",new Date(Date.now()-2*60*1000).toISOString())
    .gte("created_at",new Date(Date.now()-SERVICE_WINDOW_MS).toISOString())
    .order("created_at",{ascending:true}).limit(CLAIM_LIMIT);
  if(error) throw error;
  const seenConversations=new Set<string>();
  for(const item of records??[]) {
    if(outcome.checked>=AI_RECOVERY_BATCH_LIMIT)break;
    const unique=`${item.workspace_id}:${item.conversation_id}`;
    if(seenConversations.has(unique))continue;
    seenConversations.add(unique);
    const {data:settings}=await supabaseAdmin.from("ai_settings")
      .select("emergency_mode,emergency_recover_pending,ai_enabled")
      .eq("workspace_id",item.workspace_id).maybeSingle();
    if(settings?.emergency_mode!=="automatico" || settings?.emergency_recover_pending===false ||
       settings?.ai_enabled===false || !reasonIsProviderFailure(item.error_message??"")){
      outcome.skipped++;continue;
    }
    const {data:claimed}=await supabaseAdmin.from("ai_failed_messages")
      .update({status:"processing",updated_at:new Date().toISOString()})
      .eq("id",item.id).eq("workspace_id",item.workspace_id).eq("status","pending")
      .select("id").maybeSingle();
    if(!claimed)continue;
    outcome.checked++;
    try{
      const {data:conversation}=await supabaseAdmin.from("conversations")
        .select("id,contact_id,product_id,ai_paused,is_closed,sale_closed")
        .eq("workspace_id",item.workspace_id).eq("id",item.conversation_id).maybeSingle();
      const {data:inbound}=await supabaseAdmin.from("messages")
        .select("created_at,body").eq("workspace_id",item.workspace_id)
        .eq("conversation_id",item.conversation_id).eq("wamid",item.wamid).maybeSingle();
      if(!conversation || !inbound || conversation.ai_paused || conversation.is_closed ||
         conversation.sale_closed || isCustomerOptOut(inbound.body??"") ||
         Date.now()-Date.parse(inbound.created_at)>SERVICE_WINDOW_MS){
        await supabaseAdmin.from("ai_failed_messages").update({status:"resolved",updated_at:new Date().toISOString()})
          .eq("id",item.id).eq("workspace_id",item.workspace_id);
        outcome.skipped++;continue;
      }
      // Never write after this turn if seller, client or another bot message has advanced.
      const {data:laterMessages}=await supabaseAdmin.from("messages").select("id")
        .eq("workspace_id",item.workspace_id).eq("conversation_id",item.conversation_id)
        .gt("created_at",inbound.created_at).limit(1);
      if(laterMessages?.length){
        await supabaseAdmin.from("ai_failed_messages").update({status:"resolved",updated_at:new Date().toISOString()})
          .eq("id",item.id).eq("workspace_id",item.workspace_id);
        outcome.skipped++;continue;
      }
      const [{data:contact},{data:wa},{data:saleState},{data:messages}]=await Promise.all([
        supabaseAdmin.from("contacts").select("phone").eq("workspace_id",item.workspace_id)
          .eq("id",conversation.contact_id).maybeSingle(),
        supabaseAdmin.from("whatsapp_connections").select("access_token,phone_number_id")
          .eq("workspace_id",item.workspace_id).maybeSingle(),
        supabaseAdmin.from("bot_sale_states").select("state")
          .eq("workspace_id",item.workspace_id).eq("conversation_id",item.conversation_id).maybeSingle(),
        supabaseAdmin.from("messages").select("sender,body")
          .eq("workspace_id",item.workspace_id).eq("conversation_id",item.conversation_id)
          .order("created_at",{ascending:false}).limit(16),
      ]);
      if(!contact?.phone || !wa?.access_token || !wa.phone_number_id){
        await supabaseAdmin.from("ai_failed_messages").update({status:"pending",updated_at:new Date().toISOString()})
          .eq("id",item.id).eq("workspace_id",item.workspace_id);
        outcome.pending++;continue;
      }
      const st=(saleState?.state??{}) as SaleState;
      const history=(messages??[]).reverse().filter(x=>x.body).map(x=>({
        role:x.sender==="customer"?("user" as const):("assistant" as const),
        content:String(x.body),
      }));
      const ctx=await buildWorkspaceAiContext(supabaseAdmin,item.workspace_id,history,
        st.productId??conversation.product_id,contact.phone,conversation.id);
      const hasReceipt=Boolean(st.receiptPath||st.receiptDocuments?.length);
      const recoveryPrompt=hasReceipt
        ? "RECUPERACIÓN TRAS ERROR DE API: Hay un comprobante recibido de una compra anticipada. Respondé únicamente con IA, en español paraguayo y usando el entrenamiento vigente. No asegures que el dinero se acreditó ni que el pedido se registró. Si no existe una revisión bancaria verificable, indicá brevemente que el comprobante quedó recibido y requiere revisión de la tienda. No pidas otra transferencia ni inventes importes, número de pedido o saldo a favor. No confirmes venta."
        : "RECUPERACIÓN TRAS ERROR DE API: Respondé con el contexto del último mensaje de este cliente y el entrenamiento ACTIVO. No repitas copy, imagen o promociones ya enviadas ni preguntes datos que el cliente dio. Si falta algún dato concreto para el checkout, preguntá solo por eso. No confirmes ni registres pedidos: no se ha ejecutado la validación ni el INSERT en este turno. No inventes número de pedido ni condiciones de pago.";
      const result=await generateAiReply({...ctx,systemInstruction:ctx.systemInstruction+"\n\n"+recoveryPrompt});
      const response=String(result.reply??"").trim();
      if(!response || isFalseConfirmation(response) || /\b(?:te aviso|un momento|voy a verificar)\b/i.test(response)){
        // Unsafe drafts never leave the server; let a seller inspect the saved case.
        await supabaseAdmin.from("notifications").insert({
          workspace_id:item.workspace_id,user_id:item.user_id,type:"ia",
          title:"Recuperación de IA necesita revisión",
          body:"La IA volvió a responder, pero no se envió un mensaje inseguro al cliente.",
          link:"/inbox",audience:"user",
        });
        await supabaseAdmin.from("ai_failed_messages").update({status:"resolved",updated_at:new Date().toISOString()})
          .eq("id",item.id).eq("workspace_id",item.workspace_id);
        outcome.skipped++;continue;
      }
      // Repeat the concurrency check immediately before sending to Meta.
      const {data:newer}=await supabaseAdmin.from("messages").select("id")
        .eq("workspace_id",item.workspace_id).eq("conversation_id",item.conversation_id)
        .gt("created_at",inbound.created_at).limit(1);
      if(newer?.length){
        await supabaseAdmin.from("ai_failed_messages").update({status:"resolved",updated_at:new Date().toISOString()})
          .eq("id",item.id).eq("workspace_id",item.workspace_id);
        outcome.skipped++;continue;
      }
      const wamid=await sendWhatsAppText(wa,contact.phone,response);
      await supabaseAdmin.from("messages").insert({
        workspace_id:item.workspace_id,user_id:item.user_id,conversation_id:item.conversation_id,
        direction:"outbound",sender:"ai",response_origin:"ai",body:response,
        wamid,status:"sent",
      } as any);
      await supabaseAdmin.from("conversations").update({
        last_message:response,last_message_at:new Date().toISOString(),
      }).eq("workspace_id",item.workspace_id).eq("id",item.conversation_id);
      await supabaseAdmin.from("ai_failed_messages").update({status:"resolved",updated_at:new Date().toISOString()})
        .eq("id",item.id).eq("workspace_id",item.workspace_id);
      await supabaseAdmin.from("ai_settings").update({emergency_active_until:null})
        .eq("workspace_id",item.workspace_id);
      outcome.recovered++;
    }catch(e){
      const detail=e instanceof Error?e.message:String(e);
      console.warn("[BOT_SKY_AI_RECOVERY_FAILED]",{
        workspaceId:item.workspace_id,conversationId:item.conversation_id,
        detail:detail.slice(0,180),
      });
      // Leave a retryable record. Recovery never sends a second reply to an
      // existing outbound message because every retry re-checks the history.
      await supabaseAdmin.from("ai_failed_messages").update({
        status:"pending",updated_at:new Date().toISOString(),
      }).eq("id",item.id).eq("workspace_id",item.workspace_id);
      outcome.failed++;
    }
  }
  return outcome;
}
