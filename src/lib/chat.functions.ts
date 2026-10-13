import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendWhatsAppText } from "@/lib/whatsapp.server";

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
    const { createOrderFromAi, isOrderReady, isUnambiguousPriceSelection,
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
      chatHistory, conversation.product_id, conversation.contacts?.phone ?? null);
    const mode = aiSettings?.hybrid_mode === "ai_first" || aiSettings?.hybrid_mode === "rules_only"
      ? aiSettings.hybrid_mode : "hybrid";
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
      const reply = attached
        ? "📍 ¡Perfecto! 😊 Guardé tu ubicación en tu pedido ya registrado. No necesitás volver a confirmar la ciudad. ¡Gracias! 🚚💚"
        : "📍 Recibí tu ubicación. Tu pedido ya está registrado; un asesor verificará que quede asociada a la entrega. 💚";
      const {data:conn} = await supabase.from("whatsapp_connections")
        .select("phone_number_id,access_token")
        .eq("workspace_id",conversation.workspace_id).maybeSingle();
      const phone = conversation.contacts?.phone;
      if(!phone || !conn?.phone_number_id || !conn.access_token)throw new Error("WhatsApp no conectado");
      const wamid=await sendWhatsAppText(conn,phone,reply);
      const {error:insertError}=await supabase.from("messages").insert({
        workspace_id:conversation.workspace_id,user_id:conversation.user_id,
        conversation_id:conversation.id,direction:"outbound",sender:"ai",body:reply,
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
      catch(error){console.error("[Inbox postventa] IA no disponible",error);reply="Entiendo tu consulta. 🙏 Un asesor debe revisar el estado real del pedido para confirmar la entrega.";}
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
    const previous=(saved?.state??{}) as import("@/lib/rule-sales.server").SaleState;
    const savedSaleReadyForFinalization=Boolean(locationReminder && previous.locationUrl && previous.cityVerified && previous.customerName && previous.productId && previous.quantity);
    if(savedSaleReadyForFinalization)bypassSale=false;
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
    const answerContext = isGpsMessage ? {...orderContext,systemInstruction:orderContext.systemInstruction+
      `\nUBICACIÓN RECIBIDA. GPS guardado: ${Boolean(previous.locationUrl)}. Ciudad verificada: ${previous.cityVerified?previous.city:"NO VERIFICADA"}. Cobertura: ${previous.coverageStatus??"unknown"}. No inventes ciudad ni cobertura. Sin verificación pedí ciudad, sin ofrecer pago anticipado. No crees pedidos por una ubicación.`}
      : bypassSale && mode !== "rules_only"
      ? addPendingSaleContext(orderContext, previous) : orderContext;
    const saleText=isGpsMessage ? `📍 Ubicación compartida${previous.locationUrl?`\n${previous.locationUrl}`:""}` : savedSaleReadyForFinalization ? "Confirmo mis datos para registrar el pedido" : text;
    let step=mode!=="ai_first"&&!bypassSale?advanceRuleSale(ctx,saleText,previous, (newest.media_type === "image" || newest.media_type === "document") ? newest.media_url : null,previous.locationUrl):null;
    const decision=(!isGpsMessage || mode==="rules_only")&&step&&!step.needsAi?{reply:step.reply,productId:step.productId}:((intent==="complex"||intent==="order_status"||intent==="price")&&mode!=="rules_only"?null:decideHybridReply({ctx,text,mode}));
    let result: Awaited<ReturnType<typeof generateAiReply>>;
    let fromRules=Boolean(step&&!step.needsAi);
    const gpsReply = previous.cityVerified && previous.city
      ? `📍 ¡Recibí y guardé tu ubicación! 😊 Ciudad confirmada: *${previous.city}*. Seguimos con tu pedido. 💚`
      : "📍 ¡Recibí y guardé tu ubicación! 😊🚚 Para confirmar nuestra cobertura, ¿me indicás *en qué ciudad* estás?";
    if (isGpsMessage) result={reply:gpsReply,product_id:previous.productId??conversation.product_id,sale_closed:false,order:null};
    else if (locationReminder && bypassSale && previous.locationUrl && mode !== "ai_first") {
      const missing=!previous.cityVerified?"Solo falta confirmar tu ciudad para verificar la cobertura.":!previous.customerName?"Solo me falta tu nombre y apellido para completar el pedido.":"Ya tengo la ubicación guardada para tu compra; voy a revisar los demás datos.";
      result={reply:`Tenés razón, disculpame. 🙏📍 *Tu ubicación ya está guardada*, no hace falta reenviarla. ${missing}`,product_id:previous.productId??conversation.product_id,sale_closed:false,order:null};
    }
    else if (decision) result={reply:decision.reply,product_id:decision.productId,sale_closed:false,order:null};
    else if (mode === "rules_only") {
      const back=decideHybridReply({ctx,text,mode,fallback:true});
      result={reply:back?.reply??"Un asesor debe revisar tu consulta.",product_id:back?.productId??conversation.product_id,sale_closed:false,order:null};
    } else {
      try {result=await generateAiReply(answerContext);}
      catch (err) {
        if(aiSettings?.hybrid_fallback_enabled===false)throw err;
        step=bypassSale?null:advanceRuleSale(ctx,saleText,previous, (newest.media_type === "image" || newest.media_type === "document") ? newest.media_url : null,previous.locationUrl);
        const back=step&&!step.needsAi?{reply:step.reply,productId:step.productId}:decideHybridReply({ctx,text,mode,fallback:true});
        if(!back)throw err;
        result={reply:back.reply,product_id:back.productId,sale_closed:false,order:null};
        fromRules=Boolean(step&&!step.needsAi);
      }
    }
    if(isGpsMessage) result={reply:gpsReply,product_id:previous.productId??conversation.product_id,sale_closed:false,order:null};
    if(bypassSale || isGpsMessage)result={...result,sale_closed:false,order:null};
    if(fromRules&&step&&!step.needsAi){
      const {error: stateSaveError}=await supabase.from("bot_sale_states").upsert({
        workspace_id:conversation.workspace_id,conversation_id:conversation.id,
        state:step.state,updated_at:new Date().toISOString()
      },{onConflict:"workspace_id,conversation_id"});
      if(stateSaveError)throw stateSaveError;
      if(step.complete && !isGpsMessage){const st=step.state;
        result={reply:step.reply,product_id:step.productId,sale_closed:true,
          order:{customer_name:st.customerName!,city:st.city!,departamento:st.department!,
            street:st.street??undefined,quantity:st.quantity!,product_price_id:st.optionId??undefined,
            payment_method:st.paymentMethod!,phone:conversation.contacts?.phone??""}};
      }
    }
    const detectedProduct = result.product_id && ctx.products.some(p => p.id === result.product_id)
      ? result.product_id : conversation.product_id;
    const phone = conversation.contacts?.phone;
    if (!phone) throw new Error("El contacto no tiene teléfono");

    // Los pedidos desde Inbox deben guardar primero, confirmar después.
    // NUNCA reutilizar la compra de una conversación ya cerrada.
    let createdOrder: { id: string; order_number: string } | null = null;
    const orderCoverage=result.order ? verifiedCoverage(
      String(result.order.city??""),String(result.order.departamento??""),parseCoverage(ctx.training)) : null;
    const valid = !conversation.sale_closed && !isGpsMessage && Boolean(orderCoverage?.active) && (!previous.city || (previous.cityVerified && previous.coverageStatus === "covered")) && Boolean(result.order) &&
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
    const reply = createdOrder
      ? `✅ PEDIDO REGISTRADO\n📦 N.º ${createdOrder.order_number}\n${(result.order?.payment_method ?? "").toLowerCase().includes("anticip") ? "💳 Comprobante sujeto a verificación por el vendedor." : "¡Gracias por tu compra!"}`
      : needsVariant
        ? `¿Cuál variante preferís?\n${options.map(o => `• ${o.label}: Gs. ${o.price.toLocaleString("es-PY")}`).join("\n")}`
        : result.reply.replace(/(?:✅\s*)?PEDIDO CONFIRMADO/gi, "Estamos verificando los datos del pedido");
    const wamid = await sendWhatsAppText(conn, phone, reply);
    const { error: insertError } = await supabase.from("messages").insert({
      workspace_id: conversation.workspace_id, user_id: conversation.user_id,
      conversation_id: conversation.id, direction: "outbound", sender: "ai", body: reply,
      wamid, status: "sent",
    });
    if (insertError) throw insertError;
    await supabase.from("conversations").update({
      last_message: reply, last_message_at: new Date().toISOString(),
      unread_count: 0, product_id: detectedProduct,
    }).eq("id", conversation.id).eq("workspace_id", conversation.workspace_id);
    return { reply, orderId: createdOrder?.id ?? null };
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
