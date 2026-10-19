
function isAiQuotaFailure(error: unknown): boolean {
  const e = error as {status?:number;code?:string;message?:string};
  const msg = String(e?.message ?? error ?? "").toLowerCase();
  return e?.status === 429 || /(?:insufficient[_ ]quota|resource[_ ]exhausted|quota exceeded|rate[_ -]?limit|credit[s]? exhausted|sin cr[eé]ditos|saldo de ia|429)/i.test(msg);
}
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendWhatsAppText } from "@/lib/whatsapp.server";
import { reconcileOrderWithSaleState, recoverSaleStateFromHistory, isValidCustomerName, isValidDeliveryAddress } from "@/lib/sale-reconciliation.server";
import { buildRegisteredOrderConfirmation } from "@/lib/order-confirmation.server";

const SendInput = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export const sendManualMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id, workspace_id, contact_id, contacts(phone)")
      .eq("id", data.conversationId)
      .single();
    if (error || !conversation) throw new Error("Conversación no encontrada");

    const { data: conn } = await supabase
      .from("whatsapp_connections")
      .select("phone_number_id, access_token")
      .eq("workspace_id", conversation.workspace_id)
      .maybeSingle();

    let wamid: string | null = null;
    let sendError: string | null = null;
    const phone = conversation.contacts?.phone;

    if (conn?.phone_number_id && conn.access_token && phone) {
      try {
        wamid = await sendWhatsAppText(conn, phone, data.body);
      } catch (e) {
        sendError = e instanceof Error ? e.message : "Error de envío";
      }
    } else {
      sendError = "WhatsApp no está conectado";
    }

    const { error: insertError } = await supabase.from("messages").insert({
      workspace_id: conversation.workspace_id,
      user_id: userId,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: "agent",
      body: data.body,
      status: sendError ? "failed" : "sent",
      error: sendError,
      wamid,
    });
    if (insertError) throw insertError;

    await supabase
      .from("conversations")
      .update({
        last_message: data.body,
        last_message_at: new Date().toISOString(),
        ai_paused: true,
      })
      .eq("id", conversation.id);

    if (sendError) throw new Error(sendError);
    return { ok: true, wamid };
  });

const TestInput = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(40)
    .optional(),
  activeProductId: z.string().uuid().nullable().optional(),
  sentTemplateIds: z.array(z.string().uuid()).max(50).optional(),
});

export const testAiReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TestInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
    const { generateAiReply } = await import("@/lib/ai.server");
    const { buildKeywordTemplate } = await import("@/lib/catalog-template.server");
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("workspace_id")
      .eq("id", userId)
      .single();
    if (!profile?.workspace_id) throw new Error("Sin workspace");

    const template = await buildKeywordTemplate(
      supabase as never,
      profile.workspace_id,
      data.message,
    );
    const showTemplate =
      template && !(data.sentTemplateIds ?? []).includes(template.productId) ? template : null;

    const ctx = await buildWorkspaceAiContext(
      supabase,
      profile.workspace_id,
      [...(data.history ?? []), { role: "user" as const, content: data.message }].slice(-24),
      template?.productId ?? data.activeProductId ?? null,
    );
    const result = await generateAiReply(ctx);
    return { ...result, product_id: result.product_id ?? template?.productId ?? null, template: showTemplate };
  });



/** Recuperación MANUAL: el agente revisa todos los campos antes del INSERT.
 * Nunca se confía en cantidades/precios del navegador: se consultan del catálogo.
 * El mensaje de WhatsApp no se envía automáticamente desde este botón.
 */
const RecoveryInput = z.object({
  conversationId: z.string().uuid(),
  productId: z.string().uuid(),
  optionId: z.string().uuid().nullable(),
  promoCount: z.number().int().min(1).max(25),
  customerName: z.string().trim().min(3).max(160),
  city: z.string().trim().min(2).max(120),
  department: z.string().trim().min(2).max(120),
  street: z.string().trim().max(600),
  paymentMethod: z.enum(["contraentrega", "anticipado"]),
  sourceMessageId: z.string().uuid(),
});

export const registerPendingSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RecoveryInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
    const { verifiedCoverage, parseCoverage } = await import("@/lib/rule-sales.server");
    const { createOrderFromAi } = await import("@/lib/whatsapp-webhook.server");
    const { data: convo, error: convoError } = await supabase.from("conversations")
      .select("id,workspace_id,user_id,contact_id,ad_id,contacts(phone)")
      .eq("id",data.conversationId).single();
    if(convoError || !convo)throw new Error("Conversación no encontrada");
    // Verificar acceso al workspace con la sesión autenticada.
    const { data: profile, error: profileError }=await supabase.from("profiles")
      .select("workspace_id").eq("id",userId).single();
    if(profileError || profile?.workspace_id !== convo.workspace_id)throw new Error("Acceso no autorizado al vendedor");
    if(!convo.contacts?.phone)throw new Error("Falta teléfono del cliente");
    const {data: source,error: sourceError}=await supabase.from("messages")
      .select("id,direction,created_at").eq("id",data.sourceMessageId)
      .eq("workspace_id",convo.workspace_id).eq("conversation_id",convo.id).single();
    if(sourceError || !source || source.direction!=="inbound")throw new Error("Elegí un mensaje real del cliente para la recuperación");
    const {data: existing,error: existingError}=await supabase.from("orders")
      .select("id,order_number,status,created_at").eq("workspace_id",convo.workspace_id)
      .eq("conversation_id",convo.id).order("created_at",{ascending:false}).limit(20);
    if(existingError)throw existingError;
    // Si existen pedidos, no adivinar si esta venta ya se registró.
    // En casos de compras múltiples requieren revisión humana de los pedidos.
    if((existing??[]).some(o=>o.status!=="cancelado"))
      throw new Error("Este chat ya tiene pedidos registrados. Revisá PEDIDOS para evitar duplicados antes de recuperar otra venta.");
    const ctx=await buildWorkspaceAiContext(supabase,convo.workspace_id,[],data.productId,convo.contacts.phone);
    const product=ctx.products.find(p=>p.id===data.productId);
    if(!product)throw new Error("Producto no activo en este vendedor");
    const match=verifiedCoverage(data.city,data.department,parseCoverage(ctx.training));
    if(!match)throw new Error("La ciudad y el departamento no coinciden con la lista del vendedor");
    if(!match.active && !(data.paymentMethod==="anticipado" && /ANTICIPADO|TRANSFERENCIA/i.test(match.method)))
      throw new Error("No hay modalidad habilitada para esta ciudad. Configurá la encomienda en cobertura antes de registrar.");
    if(data.paymentMethod==="contraentrega" && !match.active)
      throw new Error("No hay contraentrega para esta ciudad");
    if(match.addressRequired && !isValidDeliveryAddress(data.street))throw new Error("La dirección es obligatoria para esta ciudad según tu entrenamiento");
    const options=[...(product.product_prices??[])].sort((a,b)=>a.sort_order-b.sort_order);
    const option=options.find(o=>o.id===data.optionId)??null;
    if(options.length && !option)throw new Error("Seleccioná una presentación válida del catálogo");
    if(!options.length && data.optionId)throw new Error("Este producto no tiene esa promoción");
    const units=(option?.quantity??1)*data.promoCount;
    if (!isValidCustomerName(data.customerName)) throw new Error("Ingresá nombre y apellido reales del cliente");
    if (data.street && !isValidDeliveryAddress(data.street)) throw new Error("Dirección inválida: ingresá calle/referencia concreta o ubicación Google Maps");
    const order={customer_name:data.customerName,phone:convo.contacts.phone,
      city:match.city,departamento:match.department,street:data.street||undefined,
      quantity:units,promo_quantity:data.promoCount,product_price_id:option?.id,
      price_option_label:option?.label,payment_method:data.paymentMethod,
      observations:"Pedido recuperado manualmente desde Inbox; revisar conversación original"};
    const created=await createOrderFromAi({workspaceId:convo.workspace_id,ownerId:convo.user_id,
      conversationId:convo.id,contactId:convo.contact_id,phone:convo.contacts.phone,
      adId:convo.ad_id??null,productId:data.productId,
      sourceMessageId:`manual-recovery:${data.sourceMessageId}`,order,products:ctx.products});
    const {error: stateError}=await supabase.from("bot_sale_states").delete()
      .eq("workspace_id",convo.workspace_id).eq("conversation_id",convo.id);
    if(stateError)console.error("Se registró el pedido, pero no se pudo limpiar el estado",stateError);
    return {ok:true,orderId:created.id,orderNumber:created.order_number};
  });

const AiNowInput = z.object({ conversationId: z.string().uuid() });

export const aiReplyNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AiNowInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
    const { generateAiReply } = await import("@/lib/ai.server");
    const { decideHybridReply } = await import("@/lib/hybrid-rules.server");
    const { advanceRuleSale } = await import("@/lib/rule-sales.server");
    const { classifyCustomerIntent, addVerifiedOrderContext, addPendingSaleContext } = await import("@/lib/hybrid-intent.server");
    const { createOrderFromAi, isOrderReady, isUnambiguousPriceSelection, applySellerFirstOffer,
      recoverRecentPaymentReceiptForOrder } = await import("@/lib/whatsapp-webhook.server");
    const { supabase } = context;
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id, workspace_id, user_id, contact_id, product_id, ad_id, ai_paused, is_closed, sale_closed, contacts(phone)")
      .eq("id", data.conversationId).single();
    if (error || !conversation) throw new Error("Conversación no encontrada");
    if (conversation.ai_paused || conversation.is_closed) return { skipped: true, reply: "" };

    const { data: history, error: historyError } = await supabase.from("messages")
      .select("id, wamid, sender, direction, body, media_url, media_type, created_at")
      .eq("workspace_id", conversation.workspace_id)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false }).limit(24);
    if (historyError) throw historyError;
    const newest = history?.[0];
    if (!newest || newest.direction !== "inbound" || newest.sender !== "customer") {
      return { skipped: true, reply: "" };
    }
    // No responder de nuevo si otro trabajador ya respondió a este inbound.
    const chatHistory = [...(history ?? [])].reverse().filter(m => Boolean(m.body)).map(m => ({
      role: m.sender === "customer" ? ("user" as const) : ("assistant" as const),
      content: m.body as string,
    }));
    const { data: aiSettings } = await supabase.from("ai_settings")
      .select("ai_enabled, hybrid_mode, hybrid_fallback_enabled")
      .eq("workspace_id", conversation.workspace_id).maybeSingle();
    if (!aiSettings?.ai_enabled) return { skipped: true, reply: "" };
    const ctx = await buildWorkspaceAiContext(supabase, conversation.workspace_id,
      chatHistory, conversation.product_id, conversation.contacts?.phone ?? null, conversation.id);
    const mode: "hybrid" = "hybrid"; // Responde la IA; el entrenamiento activo del workspace define las preguntas.
    const text = String(newest.body ?? "");
    const {coordinatesFromText}=await import("@/lib/hybrid-intent.server");
    const {parseCoverage,verifiedCoverage}=await import("@/lib/rule-sales.server");
    const coordinates=coordinatesFromText(text);
    const isGpsMessage=Boolean(coordinates || /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[^\s/]+\/maps)/i.test(text));
    if (conversation.sale_closed && isGpsMessage) {
      const {attachPostSaleGpsToLatestOrder} = await import("@/lib/whatsapp-webhook.server");
      const postSaleUrl = coordinates
        ? `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`
        : text.match(/https?:\/\/\S+/i)?.[0] ?? null;
      let attached = false;
      if(postSaleUrl) {
        try { attached = await attachPostSaleGpsToLatestOrder({
          workspaceId:conversation.workspace_id,conversationId:conversation.id,gpsUrl:postSaleUrl,
        }); } catch(error){ console.error("[Inbox postventa] GPS no asociado",error); }
      }
      const gpsCtx=await addVerifiedOrderContext(supabase,ctx,conversation.workspace_id,conversation.contacts?.phone);
      let reply:string;
      try {reply=(await generateAiReply({...gpsCtx,systemInstruction:gpsCtx.systemInstruction+
        `\nRESULTADO REAL DE GPS: ${attached?"ubicación guardada en orders":"no fue posible guardar la ubicación"}. Contestá el último mensaje sin inventar acciones.`})).reply;}
      catch(error){console.error("[Inbox GPS IA] Sin respuesta",error);return {skipped:true,reason:"IA no disponible"};}
      const {data:conn} = await supabase.from("whatsapp_connections")
        .select("phone_number_id,access_token")
        .eq("workspace_id",conversation.workspace_id).maybeSingle();
      const phone = conversation.contacts?.phone;
      if(!phone || !conn?.phone_number_id || !conn.access_token)throw new Error("WhatsApp no conectado");
      const wamid=await sendWhatsAppText(conn,phone,reply);
      const {error:insertError}=await supabase.from("messages").insert({
        workspace_id:conversation.workspace_id,user_id:conversation.user_id,
        conversation_id:conversation.id,direction:"outbound",sender:"ai",response_origin:"ai",body:reply,
        wamid,status:"sent",
      });
      if(insertError)throw insertError;
      await supabase.from("conversations").update({
        last_message:reply,last_message_at:new Date().toISOString(),unread_count:0,
      }).eq("workspace_id",conversation.workspace_id).eq("id",conversation.id);
      return {reply,orderId:null};
    }
    if(conversation.sale_closed) {
      const verified=await addVerifiedOrderContext(supabase,ctx,conversation.workspace_id,conversation.contacts?.phone);
      const safeCtx={...verified,systemInstruction:verified.systemInstruction+"\nPOSTVENTA PRIORITARIA: YA hay pedido registrado. Respondé sobre ese pedido sin promociones, sin nuevas ventas ni pedir datos otra vez. No prometas entregas ni acciones logísticas sin verificación. Si es saludo, respondé breve."};
      let reply:string;
      try {reply=(await generateAiReply(safeCtx)).reply?.trim() || "";}
      catch(error){console.error("[Inbox postventa] IA no disponible",error);return {skipped:true,reason:"IA no disponible"};}
      if(!reply)reply="Un asesor debe verificar el estado actual de tu pedido. Gracias por tu paciencia. 🙏";
      const {data:conn}=await supabase.from("whatsapp_connections").select("phone_number_id,access_token").eq("workspace_id",conversation.workspace_id).maybeSingle();
      if(!conn?.phone_number_id||!conn.access_token||!conversation.contacts?.phone)throw new Error("WhatsApp no conectado");
      const wamid=await sendWhatsAppText(conn,conversation.contacts.phone,reply);
      const {error:insertError}=await supabase.from("messages").insert({workspace_id:conversation.workspace_id,user_id:conversation.user_id,conversation_id:conversation.id,direction:"outbound",sender:"ai",body:reply,wamid,status:"sent"});
      if(insertError)throw insertError;
      await supabase.from("conversations").update({last_message:reply,last_message_at:new Date().toISOString(),unread_count:0}).eq("workspace_id",conversation.workspace_id).eq("id",conversation.id);
      return {reply,orderId:null};
    }
    const intent = isGpsMessage ? "checkout" : classifyCustomerIntent(text);
    const reminderText=text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const locationReminder=!isGpsMessage && /\b(?:ya (?:te|le|les) (?:pase|envie|mande)|ya (?:comparti|envie)|ahi ya (?:te|le) pase)\b/.test(reminderText) && /\b(?:ubicacion|gps|maps|localizacion)\b/.test(reminderText);
    let bypassSale = intent !== "checkout";
    const orderContext = intent === "order_status" && mode !== "rules_only"
      ? await addVerifiedOrderContext(supabase,ctx,conversation.workspace_id,conversation.contacts?.phone)
      : ctx;
    const {data: saved, error: stateError} = await supabase.from("bot_sale_states")
      .select("state").eq("workspace_id",conversation.workspace_id)
      .eq("conversation_id",conversation.id).maybeSingle();
    if(stateError)throw stateError;
    const previous=recoverSaleStateFromHistory(ctx,(saved?.state??{}) as import("@/lib/rule-sales.server").SaleState,chatHistory);
    // Nunca convertir una respuesta de IA sobre un comprobante en acreditación bancaria.
    // La verificación documental y el bloqueo de creación se realizan en el webhook. 
    // Imagen de pago: continuar el checkout aunque el clasificador la considere
    // consulta general. Se requiere compra anticipada ya iniciada.
    if (previous.productId && /anticip|transfer|deposit|giro/i.test(String(previous.paymentMethod ?? "")) &&
        newest.media_url && (newest.media_type === "image" || newest.media_type === "document")) bypassSale = false;
    if (!conversation.sale_closed) {
      const { error: recoveredStateError } = await supabase.from("bot_sale_states").upsert({
        workspace_id: conversation.workspace_id, conversation_id: conversation.id,
        state: previous, updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,conversation_id" });
      if (recoveredStateError) throw recoveredStateError;
    }
    if (previous.productId && (["name", "details", "address", "quantity", "variant", "city"].includes(String(previous.awaiting ?? "")) || /(?:calle|barrio|casi|esquina|avenida|ruta|direccion|ubicacion)/i.test(text)) &&
      !/\b(?:gracias|chau|adios|no quiero|cancelar|reclamo|mi pedido|donde esta)\b/i.test(text.toLowerCase())) {
      bypassSale=false;
    }
    const savedSaleReadyForFinalization=Boolean(locationReminder && previous.locationUrl && previous.cityVerified && previous.customerName && previous.productId && previous.quantity);
    if(savedSaleReadyForFinalization)bypassSale=false;
    // Respuestas cortas de ciudad/nombre son datos de checkout aunque el clasificador
    // de intención no las catalogue como "checkout".
    if (!conversation.sale_closed && previous.productId &&
        (previous.cityVerified || previous.customerName) &&
        !/\b(?:gracias|chau|adios|no quiero|cancelar|reclamo|mi pedido|donde esta)\b/i.test(text)) {
      const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (/^(?:de |para |soy de |ciudad )?[\p{L} ]{3,55}$/u.test(normalized) &&
          normalized.split(/\s+/).length <= 5) bypassSale = false;
    }

    if(isGpsMessage){
      if(!previous.cityVerified){previous.city=null;previous.department=null;previous.coverageStatus="unknown";previous.awaiting="city";}
      if(coordinates){
        previous.locationUrl=`https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`;
        // La ciudad se confirma por el cliente; no la deducimos del GPS.

      } else previous.locationUrl=text.match(/https?:\/\/\S+/i)?.[0]??previous.locationUrl;
      const {error:gpserror}=await supabase.from("bot_sale_states").upsert({
        workspace_id:conversation.workspace_id,conversation_id:conversation.id,
        state:previous,updated_at:new Date().toISOString()
      },{onConflict:"workspace_id,conversation_id"});
      if(gpserror)throw gpserror;
    }
    orderContext.saleState = previous;
    const answerContext = isGpsMessage ? {...orderContext,systemInstruction:orderContext.systemInstruction+
      `\nUBICACIÓN RECIBIDA. GPS guardado: ${Boolean(previous.locationUrl)}. Ciudad verificada: ${previous.cityVerified?previous.city:"NO VERIFICADA"}. Cobertura: ${previous.coverageStatus??"unknown"}. No inventes ciudad ni cobertura. Sin verificación pedí ciudad, sin ofrecer pago anticipado. No crees pedidos por una ubicación.`}
      : bypassSale && mode !== "rules_only"
      ? addPendingSaleContext(orderContext, previous) : orderContext;
    const saleText=isGpsMessage ? `📍 Ubicación compartida${previous.locationUrl?`\n${previous.locationUrl}`:""}` : savedSaleReadyForFinalization ? "Confirmo mis datos para registrar el pedido" : text;
    let step=mode!=="ai_first"&&!bypassSale?advanceRuleSale(ctx,saleText,previous, (newest.media_type === "image" || newest.media_type === "document") ? newest.media_url : null,previous.locationUrl):null;
    const ruleMustAnswer=mode==="rules_only";
    const decision=(!isGpsMessage||mode==="rules_only")&&step&&!step.needsAi&&ruleMustAnswer
      ?{reply:step.reply,productId:step.productId}
      :(mode==="hybrid"?null:((intent==="complex"||intent==="order_status"||intent==="price")&&mode!=="rules_only"
        ?null:decideHybridReply({ctx,text,mode})));
    let result: Awaited<ReturnType<typeof generateAiReply>>;
    let fromRules=Boolean(step&&!step.needsAi&&decision);
    const gpsReply = previous.cityVerified && previous.city
      ? `📍 ¡Recibí y guardé tu ubicación! 😊 Ciudad confirmada: *${previous.city}*. Seguimos con tu pedido. 💚`
      : "📍 ¡Recibí y guardé tu ubicación! 😊🚚 Para confirmar nuestra cobertura, ¿me indicás *en qué ciudad* estás?";
    if (isGpsMessage && mode === "rules_only") result={reply:gpsReply,product_id:previous.productId??conversation.product_id,sale_closed:false,order:null};
    else if (locationReminder && bypassSale && previous.locationUrl && mode === "rules_only") {
      const missing=!previous.cityVerified?"Solo falta confirmar tu ciudad para verificar la cobertura.":!previous.customerName?"Solo me falta tu nombre y apellido para completar el pedido.":"Ya tengo la ubicación guardada para tu compra; voy a revisar los demás datos.";
      result={reply:`Tenés razón, disculpame. 🙏📍 *Tu ubicación ya está guardada*, no hace falta reenviarla. ${missing}`,product_id:previous.productId??conversation.product_id,sale_closed:false,order:null};
    }
    else if (decision) result={reply:decision.reply,product_id:decision.productId,sale_closed:false,order:null};
    else if (mode === "rules_only") {
      const back=decideHybridReply({ctx,text,mode,fallback:true});
      result={reply:back?.reply??"Un asesor debe revisar tu consulta.",product_id:back?.productId??conversation.product_id,sale_closed:false,order:null};
    } else {
      const verifiedSale=step?.state??previous;
      const aiContext=mode==="hybrid"?{...answerContext,systemInstruction:answerContext.systemInstruction+
        `\nHÍBRIDO: El código ya presentó catálogo/precios. Desde la siguiente respuesta vendé con IA, sin repetir lista de precios ni preguntas ya contestadas. Datos de la venta actual verificados por código: ${JSON.stringify({productId:verifiedSale.productId,optionId:verifiedSale.optionId,quantity:verifiedSale.quantity,city:verifiedSale.city,department:verifiedSale.department,cityVerified:verifiedSale.cityVerified===true,coverageStatus:verifiedSale.coverageStatus,customerName:verifiedSale.customerName,gpsReceived:Boolean(verifiedSale.locationUrl),addressReceived:Boolean(verifiedSale.street)})}. No inventes cobertura, datos ni pedido registrado. El código validará y guardará pedidos. Respetá el orden de preguntas del entrenamiento del vendedor y no repitas datos ya conocidos. No exijas dirección escrita cuando ya hay GPS válido. Preguntá solo lo pendiente.`}:answerContext;
      aiContext.saleState = verifiedSale;
      try {result=await generateAiReply(aiContext);}
      catch (err) {
        console.error("[BOT SKY Inbox IA] Proveedor no disponible; mensaje sigue pendiente",err);
        return {skipped:true,reason:"IA no disponible; no se envió respuesta automática de código"};
      }
    }
    // En híbrido, no sobrescribir la respuesta de la IA con el mensaje genérico de GPS.
    // Si el código completó el pedido, el INSERT decidirá la confirmación.
    if(bypassSale && !result.order)result={...result,sale_closed:false,order:null};
    // Persistir los datos capturados por reglas incluso si la IA redacta la respuesta.
    if(step){
      const {error: stateSaveError}=await supabase.from("bot_sale_states").upsert({
        workspace_id:conversation.workspace_id,conversation_id:conversation.id,
        state:step.state,updated_at:new Date().toISOString()
      },{onConflict:"workspace_id,conversation_id"});
      if(stateSaveError)throw stateSaveError;
      if(step.complete && mode === "rules_only"){const st=step.state;
        fromRules=mode === "rules_only";
        result={reply:mode === "rules_only" ? step.reply : result.reply,product_id:step.productId,sale_closed:true,
          order:{customer_name:st.customerName!,city:st.city!,departamento:st.department!,
            street:isValidDeliveryAddress(st.street) ? st.street : (isValidDeliveryAddress(result.order?.street) ? result.order?.street : undefined),quantity:(result.order?.promo_quantity ?? 1) > 1 ? result.order?.quantity : st.quantity!,
             promo_quantity:result.order?.promo_quantity,product_price_id:(result.order?.promo_quantity ?? 1) > 1 ? result.order?.product_price_id : st.optionId??undefined,
            payment_method:st.paymentMethod!,phone:conversation.contacts?.phone??""}};
      }
    }
    const detectedProduct = result.product_id && ctx.products.some(p => p.id === result.product_id)
      ? result.product_id : conversation.product_id;
    result.order=applySellerFirstOffer(result.order,detectedProduct,ctx.products,ctx.training,chatHistory);
    result.order=reconcileOrderWithSaleState(result.order,step?.state??previous,ctx.training);
    const phone = conversation.contacts?.phone;
    if (!phone) throw new Error("El contacto no tiene teléfono");

    // Los pedidos desde Inbox deben guardar primero, confirmar después.
    // NUNCA reutilizar la compra de una conversación ya cerrada.
    let createdOrder: { id: string; order_number: string } | null = null;
    if (result.order && !result.order.street?.trim() && (step?.state.locationUrl || previous.locationUrl)) {
      result.order.street = step?.state.locationUrl || previous.locationUrl || undefined;
    }
    const orderCoverage=result.order ? verifiedCoverage(
      String(result.order.city??""),String(result.order.departamento??""),parseCoverage(ctx.training)) : null;
    const isAdvanceInbox = /anticip|transfer|deposit|giro/i.test(result.order?.payment_method ?? "");
    const paymentState = step?.state?.receiptDocuments?.length ? step.state : previous;
    const receiptTotal = (paymentState.receiptDocuments ?? []).reduce((sum,r)=>sum+r.amountGs,0);
    const productForAmount = ctx.products.find(p=>p.id===detectedProduct);
    const selectedPrice = productForAmount?.product_prices?.find(p=>p.id===result.order?.product_price_id);
    const promoCount = Number(result.order?.promo_quantity ?? 1);
    const expectedAmount = selectedPrice && Number.isSafeInteger(promoCount) && promoCount>0 ? Number(selectedPrice.price)*promoCount : null;
    const receiptVerifiedAsFile = Boolean(paymentState.receiptPath && !paymentState.receiptReview &&
      expectedAmount !== null && Number.isFinite(expectedAmount) && receiptTotal >= expectedAmount);
    const workspaceTrainingText = ctx.training.map(t=>String(t.content??"")).join("\n");
    const nationwideAdvanceApproved = isAdvanceInbox && Boolean(previous.cityVerified && previous.city && previous.department) &&
      /(?:todo\s+(?:el\s+)?paraguay|(?:cualquier|todas\s+las)\s+ciudad(?:es)?\s+(?:del\s+)?paraguay|env[ií]os?\s+nacionales?)/i.test(workspaceTrainingText) &&
      /encomienda/i.test(workspaceTrainingText) &&
      /(?:pago\s+anticipado|transferencia|pagar\s+antes)/i.test(workspaceTrainingText);
    const valid = (!isAdvanceInbox || receiptVerifiedAsFile) && !conversation.sale_closed && Boolean(orderCoverage?.active || (isAdvanceInbox && /ENCOMIENDA|ANTICIPADO|TRANSFERENCIA/i.test(orderCoverage?.method ?? "")) || nationwideAdvanceApproved) &&
      ((isAdvanceInbox && nationwideAdvanceApproved && !orderCoverage?.active) ||
       !orderCoverage?.addressRequired || Boolean(isValidDeliveryAddress(result.order?.street) || isValidDeliveryAddress(step?.state.locationUrl) || isValidDeliveryAddress(previous.locationUrl))) && Boolean(result.order) &&
      isOrderReady(result.order, detectedProduct) &&
      (Boolean(step?.state.cartLines?.length) || isUnambiguousPriceSelection(result.order, detectedProduct, ctx.products, chatHistory));
    if (valid && result.order && detectedProduct) {
      createdOrder = await createOrderFromAi({
        workspaceId: conversation.workspace_id,
        ownerId: conversation.user_id,
        conversationId: conversation.id,
        contactId: conversation.contact_id,
        phone,
        adId: conversation.ad_id ?? null,
        productId: detectedProduct,
        sourceMessageId: newest.wamid || newest.id,
        order: { ...result.order, phone },
        products: ctx.products,
        cartLines: step?.state.cartLines,
      });
      await recoverRecentPaymentReceiptForOrder({
        workspaceId: conversation.workspace_id,
        ownerId: conversation.user_id,
        conversationId: conversation.id,
        orderId: createdOrder.id,
      });
      await supabase.from("bot_sale_states").delete()
        .eq("workspace_id",conversation.workspace_id).eq("conversation_id",conversation.id);
    }

    const { data: conn } = await supabase.from("whatsapp_connections")
      .select("phone_number_id, access_token")
      .eq("workspace_id", conversation.workspace_id).maybeSingle();
    if (!conn?.phone_number_id || !conn.access_token) throw new Error("WhatsApp no conectado");

    // Si falta una variante, no repetir un falso cierre.
    const needsVariant = Boolean(result.order && detectedProduct &&
      (ctx.products.find(p => p.id === detectedProduct)?.product_prices?.length ?? 0) > 1 &&
      !isUnambiguousPriceSelection(result.order, detectedProduct, ctx.products, chatHistory));
    const options = ctx.products.find(p => p.id === detectedProduct)?.product_prices ?? [];
    const candidateReply = result.reply
      .replace(/\bya\s+(?:tenemos|tengo)\s+tu\s+pedido\b/gi, "Estamos preparando los datos de tu pedido")
      .replace(/(?:✅\s*)?PEDIDO\s+(?:CONFIRMADO|REGISTRADO)/gi, "Pedido pendiente de revisión");
    const falselyConfirmed = /(?:pedido|compra)\s+(?:ya\s+)?(?:qued[oó]|est[aá])\s+(?:registrad[oa]|confirmad[oa])|gracias\s+por\s+tu\s+compra|(?:tu|su)\s+pedido[\s\S]{0,35}(?:registrad[oa]|confirmad[oa])|te\s+llegar[aá]\s+en\s+breve/i.test(candidateReply);
    let confirmedInboxMessage: string | null = null;
    if (createdOrder && result.order) {
      const { data: savedOrder, error: readError } = await supabase.from("orders")
        .select("id,order_number,customer_name,phone,total,quantity,street,payment_method,payment_status")
        .eq("workspace_id",conversation.workspace_id).eq("id",createdOrder.id).single();
      if (readError || !savedOrder) throw readError || new Error("El pedido no aparece en Supabase");
      const selected = ctx.products.find(p=>p.id===detectedProduct);
      const option = selected?.product_prices?.find(o=>o.id===result.order?.product_price_id);
      confirmedInboxMessage = buildRegisteredOrderConfirmation({
        created:savedOrder,
        order:{...result.order,payment_method:savedOrder.payment_method},
        productName:selected?.name??"Producto del pedido",
        productOption:option?.label??result.order.price_option_label,
        savedQuantity:Number(savedOrder.quantity),
        address:savedOrder.street,
        paymentStatus:savedOrder.payment_status,
        deliveryMethod:orderCoverage?.method,
      });
    }
    const rawReply = createdOrder
      ? confirmedInboxMessage!
      : falselyConfirmed || result.sale_closed
        ? "Recibí tus datos, pero tu pedido todavía no está registrado. Estoy verificando la información."
        : candidateReply;
    const priceOptions = ctx.products.find(p=>p.id===detectedProduct)?.product_prices ?? [];
    const catalogSafe = rawReply.replace(/(?:Gs\.?\s*|₲\s*)(\d[\d.,]{3,})/gi,(full,digits:string)=>{
      const amount=Number(digits.replace(/[^0-9]/g,""));
      const prices=priceOptions.map(o=>Math.round(Number(o.price))).filter(n=>Math.abs(n-amount)===1);
      return prices.length===1 ? full.replace(digits,prices[0].toLocaleString("es-PY")) : full;
    });
    const reply = createdOrder ? rawReply : catalogSafe; // No reemplazar preguntas formuladas por IA.
    const wamid = await sendWhatsAppText(conn, phone, reply);
    const { error: insertError } = await supabase.from("messages").insert({
      workspace_id: conversation.workspace_id, user_id: conversation.user_id,
      conversation_id: conversation.id, direction: "outbound", sender: "ai",
      response_origin: mode === "rules_only" ? "code" : "ai",
      body: reply, wamid, status: "sent",
    } as any);
    if (insertError) throw insertError;
    await supabase.from("conversations").update({
      last_message: reply, last_message_at: new Date().toISOString(),
      unread_count: 0, product_id: detectedProduct,
      ...(createdOrder ? {sale_closed:true,status:"vendida"} : {}),
    }).eq("id", conversation.id).eq("workspace_id", conversation.workspace_id);
    return { reply, orderId: createdOrder?.id ?? null };
  });

/** Recupera un mensaje comercial usando SOLO reglas: nunca invoca generateAiReply. */
export const recoverPendingWithRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AiNowInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
    const { decideHybridReply } = await import("@/lib/hybrid-rules.server");
    const { advanceRuleSale, parseCoverage, verifiedCoverage } = await import("@/lib/rule-sales.server");
    const { classifyCustomerIntent, coordinatesFromText } = await import("@/lib/hybrid-intent.server");
    const { createOrderFromAi, isOrderReady, isUnambiguousPriceSelection, applySellerFirstOffer, recoverRecentPaymentReceiptForOrder } = await import("@/lib/whatsapp-webhook.server");
    const { data: convo, error: conversationError } = await supabase.from("conversations")
      .select("id,workspace_id,user_id,contact_id,product_id,ad_id,ai_paused,is_closed,sale_closed,contacts(phone)")
      .eq("id", data.conversationId).single();
    if(conversationError || !convo) throw new Error("Conversación no encontrada");
    if(convo.ai_paused || convo.is_closed) return { skipped:true, reason:"Chat pausado o cerrado" };
    const {data: history, error: messagesError} = await supabase.from("messages")
      .select("id,wamid,sender,direction,body,media_url,media_type,latitude,longitude,created_at")
      .eq("workspace_id",convo.workspace_id).eq("conversation_id",convo.id)
      .order("created_at",{ascending:false}).limit(30);
    if(messagesError) throw messagesError;
    const newest=history?.[0];
    if(!newest || newest.direction!=="inbound" || newest.sender!=="customer")return {skipped:true,reason:"Ya respondido"};
    if(!convo.contacts?.phone)throw new Error("Contacto sin teléfono");
    const chatHistory=[...(history??[])].reverse().filter(m=>Boolean(m.body)).map(m=>({
      role:m.sender==="customer"?("user" as const):("assistant" as const), content:String(m.body)
    }));
    const ctx=await buildWorkspaceAiContext(supabase,convo.workspace_id,chatHistory,convo.product_id,convo.contacts.phone,convo.id);
    const {data:saved,error:stateError}=await supabase.from("bot_sale_states")
      .select("state").eq("workspace_id",convo.workspace_id).eq("conversation_id",convo.id).maybeSingle();
    if(stateError)throw stateError;
    const previous=(saved?.state??{}) as import("@/lib/rule-sales.server").SaleState;
    const text=String(newest.body??"");
    const coords=(newest.latitude!=null && newest.longitude!=null)
      ? {latitude:Number(newest.latitude),longitude:Number(newest.longitude)} : coordinatesFromText(text);
    const gpsUrl=coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)
      ? `https://www.google.com/maps/search/?api=1&query=${coords.latitude},${coords.longitude}`
      : text.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[^\s/]+\/maps)\S*/i)?.[0]??null;
    const isGpsMessage=Boolean(gpsUrl);
    // No reabrir pedidos cerrados por un recuperador comercial.
    if(convo.sale_closed)return {skipped:true,reason:"Postventa: requiere verificación"};
    const normalized=text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const reminder=/\b(?:ya (?:te|le|les) (?:pase|envie|mande)|ahi ya (?:te|le) pase)\b/.test(normalized)&&/\b(?:ubicacion|gps|maps)\b/.test(normalized);
    if(gpsUrl)previous.locationUrl=gpsUrl;
    const intent=isGpsMessage?"checkout":classifyCustomerIntent(text);
    const canFinalizeReminder=reminder&&previous.locationUrl&&previous.productId&&previous.quantity&&previous.cityVerified&&previous.customerName;
    const isSale=intent==="checkout" || canFinalizeReminder;
    const step=isSale?advanceRuleSale(ctx,canFinalizeReminder?"Confirmo mis datos para registrar el pedido":isGpsMessage?`📍 Ubicación compartida ${gpsUrl}`:text,
      previous, ["image","document"].includes(String(newest.media_type))?newest.media_url:null,previous.locationUrl):null;
    const decision=!step || step.needsAi ? decideHybridReply({ctx,text,mode:"rules_only",fallback:false}) : null;
    let reply=step&&!step.needsAi?step.reply:decision?.reply??null;
    if(isGpsMessage){
      reply=previous.cityVerified&&previous.city
        ? `📍 ¡Recibí tu ubicación! 😊 Ciudad confirmada: *${previous.city}*. Seguimos con tu pedido.`
        : "📍 ¡Recibí tu ubicación! 😊 Para verificar la entrega, ¿en qué ciudad estás?";
    }
    if(reminder && previous.locationUrl && !reply){
      reply=previous.cityVerified ? "📍 Ya tengo tu ubicación guardada. Si falta algún dato para finalizar el pedido, te lo solicitaré." : "📍 Ya tengo tu ubicación guardada. Solo falta confirmar tu ciudad.";
    }
    // Si exige razonamiento no inventar: permanecer pendiente para agente humano.
    if(!reply)return {skipped:true,reason:"Requiere atención humana o IA"};
    if(step && !isGpsMessage){
      const {error:saveError}=await supabase.from("bot_sale_states").upsert({
        workspace_id:convo.workspace_id,conversation_id:convo.id,state:step.state,updated_at:new Date().toISOString()
      },{onConflict:"workspace_id,conversation_id"});
      if(saveError)throw saveError;
    }else if(isGpsMessage){
      const {error:saveError}=await supabase.from("bot_sale_states").upsert({
        workspace_id:convo.workspace_id,conversation_id:convo.id,state:previous,updated_at:new Date().toISOString()
      },{onConflict:"workspace_id,conversation_id"});
      if(saveError)throw saveError;
    }
    // Verificar nuevamente después del cálculo: si otra respuesta salió, no duplicar.
    const {data:latest,error:latestError}=await supabase.from("messages").select("id,direction")
      .eq("workspace_id",convo.workspace_id).eq("conversation_id",convo.id)
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(latestError)throw latestError;
    if(latest?.id!==newest.id||latest.direction!=="inbound")return {skipped:true,reason:"Otro proceso ya respondió"};
    let createdOrder: {id:string;order_number:string}|null=null;
    if(step?.complete){
      const st=step.state;
      const order={customer_name:st.customerName!,city:st.city!,departamento:st.department!,street:st.street??undefined,
        quantity:st.quantity!,product_price_id:st.optionId??undefined,payment_method:st.paymentMethod!,phone:convo.contacts.phone};
      const productId=step.productId??st.productId??convo.product_id;
      const verified=verifiedCoverage(String(order.city),String(order.departamento),parseCoverage(ctx.training));
      // Ruta secundaria: nunca registrar un pago anticipado sin validación documental.
      // La autorización nacional viene SOLO del entrenamiento de este workspace.
      const trainingText = ctx.training.map(item=>String(item.content??"")).join("\n");
      const advance = /anticip|transfer|deposit|giro/i.test(String(order.payment_method??""));
      const nationwide = advance && st.cityVerified===true && Boolean(st.department) &&
        /(?:todo\s+(?:el\s+)?paraguay|(?:cualquier|todas\s+las)\s+ciudad(?:es)?\s+(?:del\s+)?paraguay|env[ií]os?\s+nacionales?)/i.test(trainingText) &&
        /encomienda/i.test(trainingText) && /(?:pago\s+anticipado|transferencia|pagar\s+antes)/i.test(trainingText);
      const documented = !advance || Boolean(st.receiptPath && !st.receiptReview && (st.receiptDocuments??[]).length);
      const canCreate=Boolean(documented && (verified.active || nationwide) &&
        ((nationwide && !verified.active) || !verified.addressRequired || isValidDeliveryAddress(order.street) || isValidDeliveryAddress(st.locationUrl)) && productId && isOrderReady(order,productId) &&
        (Boolean(st.cartLines?.length)||isUnambiguousPriceSelection(order,productId,ctx.products,chatHistory)));
      if(!canCreate)return {skipped:true,reason:"Pedido requiere revisión de cobertura o variante"};
      createdOrder=await createOrderFromAi({workspaceId:convo.workspace_id,ownerId:convo.user_id,conversationId:convo.id,
        contactId:convo.contact_id,phone:convo.contacts.phone,adId:convo.ad_id??null,productId:productId!,
        sourceMessageId:newest.wamid||newest.id,order,products:ctx.products,cartLines:st.cartLines});
      await recoverRecentPaymentReceiptForOrder({workspaceId:convo.workspace_id,ownerId:convo.user_id,
        conversationId:convo.id,orderId:createdOrder.id});
      const {data:savedOrder,error:readError}=await supabase.from("orders")
        .select("id,order_number,customer_name,phone,total,quantity,street,payment_method,payment_status")
        .eq("workspace_id",convo.workspace_id).eq("id",createdOrder.id).single();
      if(readError||!savedOrder)throw readError||new Error("No se encontró el pedido creado");
      const selectedProduct=ctx.products.find(p=>p.id===productId);
      const selectedOption=selectedProduct?.product_prices?.find(o=>o.id===order.product_price_id);
      reply=buildRegisteredOrderConfirmation({created:savedOrder,order:{...order,payment_method:savedOrder.payment_method},
        productName:selectedProduct?.name??"Producto del pedido",productOption:selectedOption?.label,
        savedQuantity:Number(savedOrder.quantity),address:savedOrder.street,paymentStatus:savedOrder.payment_status,
        deliveryMethod:verified.method});
    }
    const {data:conn}=await supabase.from("whatsapp_connections").select("phone_number_id,access_token")
      .eq("workspace_id",convo.workspace_id).maybeSingle();
    if(!conn?.phone_number_id||!conn.access_token)throw new Error("WhatsApp no conectado");
    const wamid=await sendWhatsAppText(conn,convo.contacts.phone,reply);
    const {error:insertError}=await supabase.from("messages").insert({workspace_id:convo.workspace_id,
      user_id:convo.user_id,conversation_id:convo.id,direction:"outbound",sender:"ai",response_origin:"code",
      body:reply,wamid,status:"sent"} as any);
    if(insertError)throw insertError;
    await supabase.from("conversations").update({last_message:reply,last_message_at:new Date().toISOString(),
      unread_count:0,product_id:step?.productId??decision?.productId??convo.product_id,
      ...(createdOrder?{sale_closed:true}:{})}).eq("id",convo.id).eq("workspace_id",convo.workspace_id);
    if(createdOrder)await supabase.from("bot_sale_states").delete().eq("workspace_id",convo.workspace_id).eq("conversation_id",convo.id);
    return {skipped:false,reply,orderId:createdOrder?.id??null};
  });

const DeleteInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

export const deleteMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("messages").delete().in("id", data.ids);
    if (error) throw error;
    return { deleted: data.ids.length };
  });

const MediaInput = z.object({
  conversationId: z.string().uuid(),
  storagePath: z.string().min(1),
  mediaType: z.enum(["image", "video", "audio", "document"]),
  caption: z.string().trim().max(1000).optional(),
});

async function getConversationAndConn(
  supabase: {
    from: (t: string) => any;
    storage: { from: (b: string) => any };
  },
  conversationId: string,
) {
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("id, workspace_id, contact_id, contacts(phone)")
    .eq("id", conversationId)
    .single();
  if (error || !conversation) throw new Error("Conversación no encontrada");
  const { data: conn } = await supabase
    .from("whatsapp_connections")
    .select("phone_number_id, access_token")
    .eq("workspace_id", conversation.workspace_id)
    .maybeSingle();
  return { conversation, conn };
}

/** Envía un archivo (imagen, video, audio o documento) al cliente. */
export const sendMediaMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MediaInput.parse(input))
  .handler(async ({ data, context }) => {
    const { sendWhatsAppMedia } = await import("@/lib/whatsapp.server");
    const { supabase, userId } = context;
    const { conversation, conn } = await getConversationAndConn(supabase as never, data.conversationId);

    const { data: signed, error: signError } = await supabase.storage
      .from("chat-media")
      .createSignedUrl(data.storagePath, 60 * 60 * 24 * 7);
    if (signError || !signed?.signedUrl) throw new Error("No se pudo preparar el archivo");

    let wamid: string | null = null;
    let sendError: string | null = null;
    const phone = conversation.contacts?.phone;

    if (conn?.phone_number_id && conn.access_token && phone) {
      try {
        wamid = await sendWhatsAppMedia(conn, phone, signed.signedUrl, data.mediaType, data.caption);
      } catch (e) {
        sendError = e instanceof Error ? e.message : "Error de envío";
      }
    } else {
      sendError = "WhatsApp no está conectado";
    }

    const label = data.caption?.trim() || `[${data.mediaType}]`;
    const { error: insertError } = await supabase.from("messages").insert({
      workspace_id: conversation.workspace_id,
      user_id: userId,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: "agent",
      body: label,
      media_url: data.storagePath,
      media_type: data.mediaType,
      status: sendError ? "failed" : "sent",
      error: sendError,
      wamid,
    });
    if (insertError) throw insertError;

    await supabase
      .from("conversations")
      .update({
        last_message: label,
        last_message_at: new Date().toISOString(),
        ai_paused: true,
      })
      .eq("id", conversation.id);

    if (sendError) throw new Error(sendError);
    return { ok: true };
  });

const CatalogInput = z.object({
  conversationId: z.string().uuid(),
  productId: z.string().uuid(),
});

/** Envía el catálogo de un producto: copy de venta + su multimedia. */
export const sendProductCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CatalogInput.parse(input))
  .handler(async ({ data, context }) => {
    const { sendWhatsAppText, sendWhatsAppMedia } = await import("@/lib/whatsapp.server");
    const { supabase, userId } = context;
    const { conversation, conn } = await getConversationAndConn(supabase as never, data.conversationId);

    const { data: product, error: prodError } = await supabase
      .from("products")
      .select("id, name, price, promo_price, sales_copy, description, product_media(url, storage_path, media_type, position)")
      .eq("id", data.productId)
      .single();
    if (prodError || !product) throw new Error("Producto no encontrado");

    const phone = conversation.contacts?.phone;
    if (!conn?.phone_number_id || !conn.access_token || !phone) {
      throw new Error("WhatsApp no está conectado");
    }

    const text =
      product.sales_copy?.trim() ||
      `${product.name}\n${product.description ?? ""}`.trim();

    const media = [...(product.product_media ?? [])]
      .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
      .slice(0, 8);

    let sent = 0;
    for (const m of media) {
      let link = m.url as string;
      if (m.storage_path) {
        const { data: signed } = await supabase.storage
          .from("product-media")
          .createSignedUrl(m.storage_path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) link = signed.signedUrl;
      }
      const type = (["image", "video", "audio"].includes(m.media_type) ? m.media_type : "document") as
        | "image"
        | "video"
        | "audio"
        | "document";
      try {
        const wamid = await sendWhatsAppMedia(conn, phone, link, type);
        await supabase.from("messages").insert({
          workspace_id: conversation.workspace_id,
          user_id: userId,
          conversation_id: conversation.id,
          direction: "outbound",
          sender: "agent",
          body: `[${type}] ${product.name}`,
          media_url: link,
          media_type: type,
          status: "sent",
          wamid,
        });
        sent += 1;
      } catch {
        /* continua con el resto */
      }
    }

    const wamid = await sendWhatsAppText(conn, phone, text);
    await supabase.from("messages").insert({
      workspace_id: conversation.workspace_id,
      user_id: userId,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: "agent",
      body: text,
      status: "sent",
      wamid,
    });

    await supabase
      .from("conversations")
      .update({
        last_message: text,
        last_message_at: new Date().toISOString(),
        product_id: product.id,
      })
      .eq("id", conversation.id);

    return { sent };
  });

const TranscribeInput = z.object({ messageId: z.string().uuid() });

/** La IA transcribe un audio o interpreta una imagen de la conversación. */
export const transcribeMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TranscribeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { transcribeAudio, describeImage, toBase64 } = await import("@/lib/media-ai.server");
    const { supabase } = context;

    const { data: message, error } = await supabase
      .from("messages")
      .select("id, media_url, media_type, transcript")
      .eq("id", data.messageId)
      .single();
    if (error || !message?.media_url) throw new Error("El mensaje no tiene archivo");
    if (message.transcript) return { transcript: message.transcript };

    let url = message.media_url;
    if (!/^https?:\/\//.test(url)) {
      const { data: signed } = await supabase.storage
        .from("chat-media")
        .createSignedUrl(url, 60 * 10);
      if (!signed?.signedUrl) throw new Error("No se pudo leer el archivo");
      url = signed.signedUrl;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error("No se pudo descargar el archivo");
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    const base64 = toBase64(await res.arrayBuffer());

    const transcript =
      message.media_type === "image"
        ? await describeImage(base64, mime)
        : await transcribeAudio(base64, mime);

    await supabase.from("messages").update({ transcript }).eq("id", message.id);
    return { transcript };
  });
