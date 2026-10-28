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
import { isEncomiendaAdvanceOrder, sellerRequiresEncomiendaCi, isValidRecipientCi, enforceVerifiedPaymentReply, type SaleState } from "@/lib/rule-sales.server";
import { buildRegisteredOrderConfirmation } from "@/lib/order-confirmation.server";
import { handlePostSaleRecipientCi, shouldAskPostSaleCi } from "./recipient-ci.server";

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
    if(match.addressRequired && !isEncomiendaAdvanceOrder(ctx.training,data.city,data.department,data.paymentMethod) && !isValidDeliveryAddress(data.street))
      throw new Error("La dirección es obligatoria para esta ciudad según tu entrenamiento");
    const options=[...(product.product_prices??[])].sort((a,b)=>a.sort_order-b.sort_order);
    const option=options.find(o=>o.id===data.optionId)??null;
    if(options.length && !option)throw new Error("Seleccioná una presentación válida del catálogo");
    if(!options.length && data.optionId)throw new Error("Este producto no tiene esa promoción");
    const units=(option?.quantity??1)*data.promoCount;
    if (!isValidCustomerName(data.customerName)) throw new Error("Ingresá nombre y apellido reales del cliente");
    if (data.street && !isEncomiendaAdvanceOrder(ctx.training,data.city,data.department,data.paymentMethod) && !isValidDeliveryAddress(data.street))
      throw new Error("Dirección inválida: ingresá calle/referencia concreta o ubicación Google Maps");
    const order={customer_name:data.customerName,phone:convo.contacts.phone,
      city:match.city,departamento:match.department,      street:isEncomiendaAdvanceOrder(ctx.training,data.city,data.department,data.paymentMethod) ? undefined : data.street||undefined,
      quantity:units,promo_quantity:data.promoCount,product_price_id:option?.id,
      price_option_label:option?.label,payment_method:data.paymentMethod,
      observations:"Pedido recuperado manualmente desde Inbox; revisar conversación original"};
    const created=await createOrderFromAi({workspaceId:convo.workspace_id,ownerId:convo.user_id,
      conversationId:convo.id,contactId:convo.contact_id,phone:convo.contacts.phone,
      adId:convo.ad_id??null,productId:data.productId,
      sourceMessageId:`manual-recovery:${data.sourceMessageId}`,order,products:ctx.products,training:ctx.training});
    const {error: stateError}=await supabase.from("bot_sale_states").delete()
      .eq("workspace_id",convo.workspace_id).eq("conversation_id",convo.id);
    if(stateError)console.error("Se registró el pedido, pero no se pudo limpiar el estado",stateError);
    return {ok:true,orderId:created.id,orderNumber:created.order_number};
  });

/**
 * Guardarraíl de continuidad para "Responder con IA" desde Inbox.
 * La IA conserva el contenido comercial y el entrenamiento de cada vendedor.
 * El servidor solamente asegura que no se salte un dato obligatorio ni anuncie
 * una venta inexistente. No crea archivos ni un flujo de venta independiente.
 */
type InboxCheckoutStage = "variant" | "quantity" | "city" | "name" | "address";

function pendingInboxCheckoutQuestion(state: SaleState): {stage: InboxCheckoutStage; text: string} | null {
  if (!state.productId) return null;
  if (state.awaiting === "variant")
    return {stage: "variant", text: "😊 Para preparar tu pedido, ¿qué presentación del producto querés llevar?"};
  if (state.awaiting === "quantity")
    return {stage: "quantity", text: "😊 ¿Cuántas unidades querés llevar?"};
  if (state.awaiting === "city" && !state.cityVerified)
    return {stage: "city", text: "📍 ¿En qué ciudad querés recibir tu pedido?"};
  if (state.awaiting === "name" && state.cityVerified && !isValidCustomerName(state.customerName))
    return {stage: "name", text: "😊 Para completar tu pedido, ¿me pasás tu nombre y apellido?"};
  if (state.awaiting === "address" && state.cityVerified &&
      state.paymentMethod === "contraentrega" && isValidCustomerName(state.customerName) &&
      !isValidDeliveryAddress(state.street) && !isValidDeliveryAddress(state.locationUrl)) {
    const firstName = String(state.customerName).trim().split(/\s+/)[0];
    return {stage: "address", text: `¡Gracias, ${firstName}! 😊 Para completar tu pedido, ¿me pasás tu dirección con una referencia o tu ubicación de Google Maps? 📍`};
  }
  return null;
}

function hasQuestionForInboxStage(reply: string, stage: InboxCheckoutStage): boolean {
  const questions = reply.match(/¿[^?\n]{1,220}\?|[^\n¿?]{1,220}\?/g) ?? [];
  const key: Record<InboxCheckoutStage, RegExp> = {
    variant: /(?:presentaci[oó]n|modelo|variante|opci[oó]n)/i,
    quantity: /(?:cu[aá]ntas?\s+unidades|cantidad|cu[aá]ntos?\s+(?:quer[eé]s|llev[aá]s))/i,
    city: /(?:ciudad|localidad|d[oó]nde.*(?:recibir|entregar|enviar))/i,
    name: /(?:nombre|apellido|c[oó]mo\s+te\s+llam[aá]s|qui[eé]n.*recibe)/i,
    address: /(?:direcci[oó]n|calle|referencia|ubicaci[oó]n|google\s+maps|domicilio)/i,
  };
  return questions.some(question => key[stage].test(question));
}

function ensureInboxCheckoutProgress(
  reply: string, pending: ReturnType<typeof pendingInboxCheckoutQuestion>, prematureClose: boolean,
): string {
  if (!pending) return prematureClose
    ? "Tu pedido todavía no pudo registrarse. Necesitamos revisar un dato antes de confirmarlo; por favor, contactá a la tienda para completar la gestión."
    : reply;
  // Nunca repetir un cierre ficticio. Preguntar inmediatamente el dato faltante.
  if (prematureClose || /(?:estoy|estamos)\s+verificando|te\s+(?:aviso|confirmo)\s+(?:en\s+breve|despu[eé]s)/i.test(reply))
    return pending.text;
  if (hasQuestionForInboxStage(reply, pending.stage)) return reply;
  const safe = reply.replace(/\s*¿\s*(?:seguimos|est[aá]\s+bien|as[ií]\s+est[aá]\s+bien|confirm[aá]s\s+(?:tu|el)\s+pedido|te\s+parece)\s*\?[\s😊🙂👍]*$/iu, "").trim();
  return safe ? `${safe}\n\n${pending.text}` : pending.text;
}

const AiNowInput = z.object({ conversationId: z.string().uuid() });

export const aiReplyNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AiNowInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
    const { generateAiReply } = await import("@/lib/ai.server");
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
    if (conversation.ai_paused || conversation.is_closed) return { skipped: true, reply: "", reason: "El chat está pausado o cerrado" };

    const { data: history, error: historyError } = await supabase.from("messages")
      .select("id, wamid, sender, direction, body, media_url, media_type, created_at")
      .eq("workspace_id", conversation.workspace_id)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false }).limit(24);
    if (historyError) throw historyError;
    const newest = history?.[0];
    if (!newest || newest.direction !== "inbound" || newest.sender !== "customer") {
      return { skipped: true, reply: "", reason: "El último mensaje no es del cliente" };
    }
    // No responder de nuevo si otro trabajador ya respondió a este inbound.
    const chatHistory = [...(history ?? [])].reverse().filter(m => Boolean(m.body)).map(m => ({
      role: m.sender === "customer" ? ("user" as const) : ("assistant" as const),
      content: m.body as string,
    }));
    const { data: aiSettings } = await supabase.from("ai_settings")
      .select("ai_enabled, hybrid_mode, hybrid_fallback_enabled")
      .eq("workspace_id", conversation.workspace_id).maybeSingle();
    if (!aiSettings?.ai_enabled) return { skipped: true, reply: "", reason: "La IA está apagada en Configuraciones" };
    const ctx = await buildWorkspaceAiContext(supabase, conversation.workspace_id,
      chatHistory, conversation.product_id, conversation.contacts?.phone ?? null, conversation.id);
    // La respuesta comercial se genera siempre por IA + entrenamiento.
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
      const ciResult=await handlePostSaleRecipientCi({client:supabase,workspaceId:conversation.workspace_id,
        conversationId:conversation.id,training:ctx.training,
        customerText:newest.media_url ? "" : text});
      if(ciResult) {
        const {data:ciConn}=await supabase.from("whatsapp_connections").select("phone_number_id,access_token").eq("workspace_id",conversation.workspace_id).maybeSingle();
        if(!ciConn?.phone_number_id || !ciConn.access_token || !conversation.contacts?.phone)throw new Error("WhatsApp no conectado");
        const wamid=await sendWhatsAppText(ciConn,conversation.contacts.phone,ciResult.reply);
        const {error:ciMessageError}=await supabase.from("messages").insert({workspace_id:conversation.workspace_id,user_id:conversation.user_id,conversation_id:conversation.id,direction:"outbound",sender:"ai",body:ciResult.reply,wamid,status:"sent"});
        if(ciMessageError)throw ciMessageError;
        await supabase.from("conversations").update({last_message:ciResult.reply,last_message_at:new Date().toISOString(),unread_count:0}).eq("workspace_id",conversation.workspace_id).eq("id",conversation.id);
        return {reply:ciResult.reply,orderId:null};
      }
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
    const orderContext = intent === "order_status"
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
      : bypassSale
      ? addPendingSaleContext(orderContext, previous) : orderContext;
    const saleText=isGpsMessage ? `📍 Ubicación compartida${previous.locationUrl?`\n${previous.locationUrl}`:""}` : savedSaleReadyForFinalization ? "Confirmo mis datos para registrar el pedido" : text;
    let step=!bypassSale?advanceRuleSale(ctx,saleText,previous, (newest.media_type === "image" || newest.media_type === "document") ? newest.media_url : null,previous.locationUrl):null;
    let result: Awaited<ReturnType<typeof generateAiReply>>;
    const verifiedSale=step?.state??previous;
    const aiContext={...answerContext,saleState:verifiedSale,
      systemInstruction:answerContext.systemInstruction+
        `\nDATOS TÉCNICOS DEL PEDIDO ACTUAL: ${JSON.stringify({productId:verifiedSale.productId,
        optionId:verifiedSale.optionId,quantity:verifiedSale.quantity,city:verifiedSale.city,
        department:verifiedSale.department,cityVerified:verifiedSale.cityVerified===true,
        coverageStatus:verifiedSale.coverageStatus,customerName:verifiedSale.customerName,
        receiptStored:Boolean(verifiedSale.receiptPath),receiptReview:verifiedSale.receiptReview,
        recipientCiPresent:Boolean(verifiedSale.recipientCi)})}. La conversación y las preguntas comerciales provienen solo de IA + entrenamiento; no pidas datos ya suministrados. No confirmes sin registro en Supabase.`};
    const {deliveryPolicyForCity,sellerAllowsNationwideAdvance}=await import("@/lib/rule-sales.server");
    const policy=verifiedSale.cityVerified?deliveryPolicyForCity(verifiedSale.city,verifiedSale.department,ctx.training):null;
    if(policy?.paymentMethod)verifiedSale.paymentMethod=policy.paymentMethod;
    aiContext.systemInstruction+=sellerAllowsNationwideAdvance(ctx.training)
      ? "\nEl vendedor autoriza encomienda nacional anticipada fuera de contraentrega, sujeta a confirmar costo y transporte. No la niegues por ausencia de contraentrega."
      : "\nNo existe autorización para encomienda nacional en el entrenamiento disponible.";
    if(policy?.paymentMethod)aiContext.systemInstruction+=
      `\nModalidad VERIFICADA para ${policy.city}: ${policy.method}; pago ${policy.paymentMethod}.`;
    try {result=await generateAiReply(aiContext);}
    catch(error){console.error("[BOT SKY Inbox] IA no disponible",error);return {skipped:true,reason:"IA no disponible; respuesta pendiente"};}
    // Corregir rechazos comerciales que contradicen la encomienda nacional
    // autorizada por este vendedor; el texto lo redacta la IA.
    {
      const known = (step?.state??previous);
      const listed=known.cityVerified ? verifiedCoverage(String(known.city??""),String(known.department??""),parseCoverage(ctx.training)) : null;
      if(sellerAllowsNationwideAdvance(ctx.training) && !listed?.active &&
          !/(?:s[ií] (?:hacemos|enviamos|trabajamos|podemos|ofrecemos)|(?:trabajamos|ofrecemos|enviamos|podemos (?:enviar|gestionar))[^.!?]*encomienda|encomienda[^.!?]*pago anticipado)/i.test(result.reply) &&
          /(?:no (?:hacemos|realizamos|podemos|tenemos|ofrecemos|enviamos|llegamos)|tampoco (?:hacemos|enviamos|llegamos)|no es posible|no se puede|lamentablemente)/i.test(result.reply) &&
          /(?:env[ií]os?|entregas?|cobertura|encomienda|interior|anticipad[oa])/i.test(result.reply)) {
        const correctedCtx={...answerContext,saleState:known,
          systemInstruction:answerContext.systemInstruction+
          "\nPRIORIDAD: este vendedor SÍ autoriza encomienda nacional anticipada en ciudades sin contraentrega. No afirmes que es imposible enviar solo por estar fuera del listado de contraentrega. Contestá nuevamente con IA; disponibilidad logística y costo sujetos a verificar. No inventes transportista ni fechas. Pedí solo ciudad/departamento si no están confirmados."};
        try {
          const revised=await generateAiReply(correctedCtx);
          if (/(?:no (?:hacemos|realizamos|podemos|tenemos|ofrecemos|enviamos|llegamos)|tampoco (?:hacemos|enviamos|llegamos))/i.test(revised.reply))
            return {skipped:true,reason:"IA reiteró rechazo contrario a encomienda autorizada"};
          result={...result,reply:revised.reply};
        } catch(error){console.error("[BOT SKY Inbox encomienda] Error corrigiendo IA",error);return {skipped:true,reason:"IA no disponible"};}
      }
    }
    // Mismo control en Inbox: ciudad de entrega antes de solicitar datos posteriores.
    const cityVerifiedNow = Boolean((step?.state ?? previous).cityVerified);
    const checkoutProductNow = Boolean((step?.state ?? previous).productId);
    if (!bypassSale && checkoutProductNow && !cityVerifiedNow &&
        /\b(?:nombre|apellido|direcci[oó]n|domicilio|ubicaci[oó]n|google maps|transferencia|pago anticipado|m[eé]todo de pago)\b/i.test(result.reply) &&
        (/[¿?]/.test(result.reply) || /pas[aá]me|indic[aá]me|confirm[aá]me|envi[aá]me|necesito|falta/i.test(result.reply))) {
      try {
        const cityContext = {...answerContext,
          saleState: step?.state ?? previous,
          systemInstruction:answerContext.systemInstruction+
            "\nREGLA CRÍTICA: Ciudad de entrega AÚN NO VERIFICADA. El vendedor exige ciudad antes " +
            "de nombre, dirección, GPS o pago. Responde de forma natural desde el entrenamiento; " +
            "pedí únicamente la ciudad si corresponde, sin datos posteriores."};
        const corrected = await generateAiReply(cityContext);
        if (/\b(?:nombre|apellido|direcci[oó]n|domicilio|ubicaci[oó]n|google maps|transferencia|pago anticipado|m[eé]todo de pago)\b/i.test(corrected.reply) &&
            (/[¿?]/.test(corrected.reply) || /pas[aá]me|indic[aá]me|confirm[aá]me|envi[aá]me|necesito|falta/i.test(corrected.reply)))
          result={...result,reply:"¡Gracias! 😊 Para confirmarte la entrega, ¿me indicás en qué ciudad te lo enviamos?"};
        else result={...result,reply:corrected.reply};
      } catch(error){console.error("[Inbox City Guard]",error);return {skipped:true,reason:"IA no disponible"};}
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
      if(step.complete && !result.order){
        const st=step.state;
        // Construcción técnica desde estado verificado: NO redacta diálogo comercial.
        result={reply:result.reply,product_id:step.productId,sale_closed:true,
          order:{customer_name:st.customerName!,city:st.city!,departamento:st.department!,
            street:isValidDeliveryAddress(st.street)?st.street:undefined,
            quantity:st.quantity!,product_price_id:st.optionId??undefined,
            recipient_ci:isValidRecipientCi(st.recipientCi)?st.recipientCi!.replace(/\D/g,""):undefined,
            payment_method:st.paymentMethod!,phone:conversation.contacts?.phone??""}};
      }
    }
    // En un mensaje de nombre/dirección la IA suele omitir product_id.
    // Recuperarlo del estado técnico evita perder la venta por ese motivo.
    const detectedProduct = [step?.productId, result.product_id, previous.productId, conversation.product_id]
      .find(id => Boolean(id && ctx.products.some(p => p.id === id))) ?? null;
    result.order=applySellerFirstOffer(result.order,detectedProduct,ctx.products,ctx.training,chatHistory);
    result.order=reconcileOrderWithSaleState(result.order,step?.state??previous,ctx.training);
    // Validación de modalidad oficial por workspace antes de registrar.
    if (result.order) {
      const {deliveryPolicyForCity}=await import("@/lib/rule-sales.server");
      const policy=deliveryPolicyForCity(result.order.city,result.order.departamento,ctx.training);
      if(policy?.paymentMethod)result.order.payment_method=policy.paymentMethod;
    }
    const phone = conversation.contacts?.phone;
    if (!phone) throw new Error("El contacto no tiene teléfono");

    // Los pedidos desde Inbox deben guardar primero, confirmar después.
    // NUNCA reutilizar la compra de una conversación ya cerrada.
    let createdOrder: { id: string; order_number: string } | null = null;
    if (result.order && isEncomiendaAdvanceOrder(ctx.training,result.order.city,result.order.departamento,result.order.payment_method))
      delete result.order.street;
    if (result.order && !isEncomiendaAdvanceOrder(ctx.training,result.order.city,result.order.departamento,result.order.payment_method) &&
        !result.order.street?.trim() && (step?.state.locationUrl || previous.locationUrl)) {
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
    const nationalState=step?.state??previous;
    const nationwideAdvanceApproved = isAdvanceInbox && Boolean(nationalState.cityVerified && nationalState.city && nationalState.department) &&
      sellerAllowsNationwideAdvance(ctx.training);
    const valid = (!isAdvanceInbox || receiptVerifiedAsFile) && !conversation.sale_closed && Boolean(orderCoverage?.active || (isAdvanceInbox && /ENCOMIENDA|ANTICIPADO|TRANSFERENCIA/i.test(orderCoverage?.method ?? "")) || nationwideAdvanceApproved) &&
      (isEncomiendaAdvanceOrder(ctx.training,result.order?.city,result.order?.departamento,result.order?.payment_method) ||
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
        training: ctx.training,
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
    const falselyConfirmed = /(?:✅\s*)?PEDIDO\s+(?:CONFIRMADO|REGISTRADO)|(?:pedido|compra)\s+(?:ya\s+)?(?:qued[oó]|est[aá])\s+(?:registrad[oa]|confirmad[oa])|gracias\s+por\s+tu\s+compra|(?:tu|su)\s+pedido[\s\S]{0,35}(?:registrad[oa]|confirmad[oa])|te\s+llegar[aá]\s+en\s+breve/i.test(result.reply);
    let confirmedInboxMessage: string | null = null;
    if (createdOrder && result.order) {
      const { data: savedOrder, error: readError } = await supabase.from("orders")
        .select("id,order_number,customer_name,phone,total,quantity,street,payment_method,payment_status,observations")
        .eq("workspace_id",conversation.workspace_id).eq("id",createdOrder.id).single();
      if (readError || !savedOrder) throw readError || new Error("El pedido no aparece en Supabase");
      const selected = ctx.products.find(p=>p.id===detectedProduct);
      const option = selected?.product_prices?.find(o=>o.id===result.order?.product_price_id);
      confirmedInboxMessage = buildRegisteredOrderConfirmation({
        created:savedOrder,
        requestRecipientCi:shouldAskPostSaleCi(ctx.training,result.order,savedOrder.observations),
        order:{...result.order,payment_method:savedOrder.payment_method},
        productName:selected?.name??"Producto del pedido",
        productOption:option?.label??result.order.price_option_label,
        savedQuantity:Number(savedOrder.quantity),
        address:savedOrder.street,
        paymentStatus:savedOrder.payment_status,
        deliveryMethod:orderCoverage?.method,
      });
    }
    const savedCheckoutState = step?.state ?? previous;
    const prematurelyClosed = !createdOrder && (falselyConfirmed || Boolean(result.sale_closed));
    const pendingCheckout = !createdOrder && !bypassSale
      ? pendingInboxCheckoutQuestion(savedCheckoutState) : null;
    if (prematurelyClosed) console.warn("[BOT_SKY_INBOX_PREMATURE_CLOSE]", JSON.stringify({
      conversationId: conversation.id, awaiting: savedCheckoutState.awaiting ?? null,
      hasVerifiedCity: Boolean(savedCheckoutState.cityVerified),
      hasValidName: isValidCustomerName(savedCheckoutState.customerName),
      hasValidAddress: Boolean(isValidDeliveryAddress(savedCheckoutState.street) || isValidDeliveryAddress(savedCheckoutState.locationUrl)),
      productSelected: Boolean(detectedProduct),
    }));
    const rawReply = createdOrder
      ? confirmedInboxMessage!
      : ensureInboxCheckoutProgress(candidateReply, pendingCheckout, prematurelyClosed);
    const priceOptions = ctx.products.find(p=>p.id===detectedProduct)?.product_prices ?? [];
    const catalogSafe = rawReply.replace(/(?:Gs\.?\s*|₲\s*)(\d[\d.,]{3,})/gi,(full,digits:string)=>{
      const amount=Number(digits.replace(/[^0-9]/g,""));
      const prices=priceOptions.map(o=>Math.round(Number(o.price))).filter(n=>Math.abs(n-amount)===1);
      return prices.length===1 ? full.replace(digits,prices[0].toLocaleString("es-PY")) : full;
    });
    const checkedInboxReply = createdOrder ? {reply: rawReply, corrected:false, paymentMethod:null} : enforceVerifiedPaymentReply({
      reply: catalogSafe, city:savedCheckoutState.city, department:savedCheckoutState.department,
      cityVerified:savedCheckoutState.cityVerified, training:ctx.training,
      saleState:savedCheckoutState, productId:detectedProduct, products:ctx.products,
    });
    if (checkedInboxReply.corrected) console.warn("[BOT_SKY_COVERAGE_OUTPUT_GUARD]",JSON.stringify({
      conversationId:conversation.id,paymentMethod:checkedInboxReply.paymentMethod,channel:"inbox"
    }));
    let reply = checkedInboxReply.reply;
    if(checkedInboxReply.corrected && !createdOrder) {
      const known=step?.state??previous;
      const corrected=await generateAiReply({...answerContext,saleState:known,
        systemInstruction:answerContext.systemInstruction+
          `\nLa respuesta anterior contradecía la modalidad de pago del vendedor. Destino declarado: ${known.city??"sin confirmar"}. Modalidad verificada: ${checkedInboxReply.paymentMethod??"pendiente"}. Redactá otra respuesta desde el entrenamiento sin textos comerciales programados.`});
      const second=enforceVerifiedPaymentReply({reply:corrected.reply,city:known.city,department:known.department,
        cityVerified:known.cityVerified,training:ctx.training,saleState:known});
      if(second.corrected)return {skipped:true,reason:"La IA no corrigió la modalidad de pago"};
      reply=second.reply;
    }
    // La segunda respuesta IA (corrección de cobertura) también debe continuar
    // el checkout, nunca terminar en un resumen sin la siguiente pregunta.
    if (!createdOrder) reply = ensureInboxCheckoutProgress(reply, pendingCheckout, prematurelyClosed);
    const wamid = await sendWhatsAppText(conn, phone, reply);
    const { error: insertError } = await supabase.from("messages").insert({
      workspace_id: conversation.workspace_id, user_id: conversation.user_id,
      conversation_id: conversation.id, direction: "outbound", sender: "ai",
      response_origin: "ai",
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

/** Endpoint antiguo conservado por compatibilidad. Prohibido enviar preguntas
 * o respuestas de venta desde reglas. La bandeja usa aiReplyNow para reintentos.
 */
export const recoverPendingWithRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AiNowInput.parse(input))
  .handler(async () => ({skipped:true,reason:"Recuperación por código deshabilitada; utilizar reintento con IA + entrenamiento"}));

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
      .select("id, workspace_id, media_url, media_type, transcript")
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
        ? await describeImage(base64, mime, message.workspace_id)
        : await transcribeAudio(base64, mime);

    await supabase.from("messages").update({ transcript }).eq("id", message.id);
    return { transcript };
  });
