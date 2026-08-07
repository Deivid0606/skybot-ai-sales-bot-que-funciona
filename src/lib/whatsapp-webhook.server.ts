import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { formatGs } from "@/lib/format";
import { buildWorkspaceAiContext } from "@/lib/ai-context.server";
import { generateAiReply } from "@/lib/ai.server";
import { sendWhatsAppText } from "@/lib/whatsapp.server";
import { detectComplaint, COMPLAINT_REASON_LABELS } from "@/lib/complaints";

type MediaPart = { id?: string; mime_type?: string; caption?: string; voice?: boolean };

type IncomingMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  referral?: {
    source_id?: string;
    source_url?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
    media_type?: string;
  };
  image?: MediaPart;
  audio?: MediaPart;
  voice?: MediaPart;
  video?: MediaPart;
  document?: MediaPart & { filename?: string };
  sticker?: MediaPart;
};

type WebhookPayload = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: IncomingMessage[];
      };
    }[];
  }[];
};

function textOf(message: IncomingMessage) {
  if (message.text?.body) return message.text.body;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  return `[${message.type}]`;
}

function mediaOf(message: IncomingMessage) {
  const map: [string, MediaPart | undefined][] = [
    ["image", message.image ?? message.sticker],
    ["audio", message.audio ?? message.voice],
    ["video", message.video],
    ["document", message.document],
  ];
  for (const [type, part] of map) {
    if (part?.id) return { type: type as "image" | "audio" | "video" | "document", part };
  }
  return null;
}


type ReferralData = {
  adId: string | null;
  adName: string | null;
  adUrl: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
};

function referralOf(message: IncomingMessage): ReferralData {
  const referral = message.referral;

  if (!referral) {
    return {
      adId: null,
      adName: null,
      adUrl: null,
      mediaUrl: null,
      mediaType: null,
    };
  }

  const videoUrl = referral.video_url?.trim() || null;
  const imageUrl =
    referral.image_url?.trim() ||
    referral.thumbnail_url?.trim() ||
    null;

  const rawMediaType = referral.media_type?.trim().toLowerCase() || "";
  const mediaType: "image" | "video" | null =
    videoUrl || rawMediaType.startsWith("video")
      ? "video"
      : imageUrl || rawMediaType.startsWith("image")
        ? "image"
        : null;

  return {
    adId: referral.source_id?.trim() || null,
    adName: referral.headline?.trim() || null,
    adUrl: referral.source_url?.trim() || null,
    mediaUrl: videoUrl ?? imageUrl,
    mediaType,
  };
}

function normalizeIntentText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detecta cuando un cliente que ya cerró una venta realmente quiere iniciar
 * otra compra. Mensajes posteriores como ubicación, forma de pago o un
 * agradecimiento no deben abrir una nueva venta ni crear otro pedido.
 */
function isNewPurchaseIntent(text: string, hasReferral: boolean) {
  if (hasReferral) return true;

  const normalized = normalizeIntentText(text);
  if (!normalized || normalized.startsWith("[location")) return false;

  const phrases = [
    "quiero comprar",
    "quiero pedir",
    "quiero llevar",
    "quiero otro",
    "quiero otra",
    "quiero uno mas",
    "quiero una mas",
    "otro pedido",
    "otra compra",
    "nuevo pedido",
    "nueva compra",
    "volver a comprar",
    "comprar nuevamente",
    "comprar de nuevo",
    "pedir nuevamente",
    "pedir de nuevo",
    "me interesa",
    "deseo comprar",
    "deseo pedir",
    "necesito otro",
    "necesito otra",
  ];

  return phrases.some((phrase) => normalized.includes(phrase));
}

/** Descarga el archivo de WhatsApp, lo guarda y deja que la IA lo interprete. */
async function ingestMedia(args: {
  workspaceId: string;
  accessToken: string;
  mediaId: string;
  type: "image" | "audio" | "video" | "document";
}) {
  const { downloadWhatsAppMediaUrl } = await import("@/lib/whatsapp.server");
  const { transcribeAudio, describeImage, toBase64 } = await import(
    "@/lib/media-ai.server"
  );

  const emptyResult = {
    storagePath: null as string | null,
    transcript: null as string | null,
  };

  try {
    const mediaUrl = await downloadWhatsAppMediaUrl(
      args.mediaId,
      args.accessToken,
    );

    if (!mediaUrl) {
      console.error("[WhatsApp media] Meta no devolvió una URL", {
        mediaId: args.mediaId,
        type: args.type,
      });

      return emptyResult;
    }

    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
      },
    });

    if (!response.ok) {
      console.error("[WhatsApp media] Error descargando desde Meta", {
        mediaId: args.mediaId,
        type: args.type,
        status: response.status,
        statusText: response.statusText,
      });

      return emptyResult;
    }

    const rawMime =
      response.headers.get("content-type") ||
      "application/octet-stream";

    const mime = rawMime.split(";")[0].trim().toLowerCase();
    const bytes = await response.arrayBuffer();

    if (bytes.byteLength === 0) {
      console.error("[WhatsApp media] Meta devolvió un archivo vacío", {
        mediaId: args.mediaId,
        type: args.type,
        mime,
      });

      return emptyResult;
    }

    const extensionByMime: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",

      "audio/ogg": "ogg",
      "audio/opus": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "audio/wav": "wav",
      "audio/x-wav": "wav",

      "video/mp4": "mp4",
      "video/3gpp": "3gp",
      "video/webm": "webm",

      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        "docx",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        "xlsx",
    };

    const fallbackExtension =
      mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";

    const extension = extensionByMime[mime] || fallbackExtension;
    const safeMediaId = args.mediaId.replace(/[^a-zA-Z0-9_-]/g, "");

    const storagePath =
      `${args.workspaceId}/inbound/` +
      `${Date.now()}-${safeMediaId}.${extension}`;

    const { data: uploadedFile, error: uploadError } =
      await supabaseAdmin.storage
        .from("chat-media")
        .upload(storagePath, bytes, {
          contentType: mime,
          upsert: false,
        });

    if (uploadError) {
      console.error("[WhatsApp media] Error subiendo a chat-media", {
        mediaId: args.mediaId,
        type: args.type,
        storagePath,
        mime,
        size: bytes.byteLength,
        error: uploadError.message,
      });

      return emptyResult;
    }

    if (!uploadedFile?.path) {
      console.error("[WhatsApp media] Supabase no devolvió la ruta subida", {
        mediaId: args.mediaId,
        type: args.type,
        storagePath,
      });

      return emptyResult;
    }

    let transcript: string | null = null;

    try {
      const base64 = toBase64(bytes);

      if (args.type === "audio") {
        const result = await transcribeAudio(base64, mime);
        transcript = result?.trim() || null;

        if (!transcript) {
          console.warn("[WhatsApp media] Audio sin transcripción", {
            mediaId: args.mediaId,
            mime,
          });
        }
      } else if (args.type === "image") {
        const result = await describeImage(base64, mime);
        transcript = result?.trim() || null;

        if (!transcript) {
          console.warn("[WhatsApp media] Imagen sin interpretación", {
            mediaId: args.mediaId,
            mime,
          });
        }
      }
    } catch (error) {
      console.error("[WhatsApp media] Error procesando archivo con IA", {
        mediaId: args.mediaId,
        type: args.type,
        mime,
        error,
      });
    }

    return {
      storagePath: uploadedFile.path,
      transcript,
    };
  } catch (error) {
    console.error("[WhatsApp media] Error inesperado procesando archivo", {
      mediaId: args.mediaId,
      type: args.type,
      error,
    });

    return emptyResult;
  }
}

export async function handleWhatsAppWebhook(payload: WebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const messages = value?.messages ?? [];
      if (!phoneNumberId || messages.length === 0) continue;

      const { data: conn } = await supabaseAdmin
        .from("whatsapp_connections")
        .select("workspace_id, user_id, phone_number_id, access_token")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (!conn) continue;

      for (const message of messages) {
        await processMessage(conn, value?.contacts?.[0]?.profile?.name ?? null, message);
      }
    }
  }
}

/**
 * Alias de compatibilidad para rutas antiguas o imports con otros nombres.
 * Todos ejecutan exactamente el mismo webhook principal.
 */
export const processWhatsAppWebhook = handleWhatsAppWebhook;
export const processWebhook = handleWhatsAppWebhook;
export const handleWebhook = handleWhatsAppWebhook;
export const whatsappWebhookHandler = handleWhatsAppWebhook;

export default handleWhatsAppWebhook;

type Conn = {
  workspace_id: string;
  user_id: string;
  phone_number_id: string | null;
  access_token: string | null;
};

async function processMessage(conn: Conn, profileName: string | null, message: IncomingMessage) {
  const workspaceId = conn.workspace_id;
  const ownerId = conn.user_id;
  const phone = String(message.from ?? "").replace(/\D/g, "");

  if (!phone) {
    console.warn("[WhatsApp webhook] Mensaje sin teléfono válido", {
      workspaceId,
      wamid: message.id,
    });
    return;
  }

  const media = mediaOf(message);
  const referral = referralOf(message);
  let body = media?.part.caption?.trim() || textOf(message);
  let mediaPath: string | null = null;
  let transcript: string | null = null;

  /*
   * Meta puede reenviar el mismo webhook. Si el wamid ya existe,
   * no volvemos a procesar ni responder el mensaje.
   */
  const { data: existingMessage, error: existingMessageError } =
    await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("wamid", message.id)
      .maybeSingle();

  if (existingMessageError) throw existingMessageError;
  if (existingMessage) return;

  /*
   * Un contacto es único por workspace + teléfono normalizado.
   * Requiere el índice único indicado en la migración SQL.
   */
  const normalizedProfileName = profileName?.trim() || null;

  const { data: contact, error: contactError } = await supabaseAdmin
    .from("contacts")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: ownerId,
        phone,
        ...(normalizedProfileName ? { name: normalizedProfileName } : {}),
      },
      {
        onConflict: "workspace_id,phone",
        ignoreDuplicates: false,
      },
    )
    .select("id, name")
    .single();

  if (contactError) throw contactError;

  /*
   * Siempre reutilizamos una sola conversación por contacto.
   * Nunca se crea otro chat por venir desde un anuncio ni por tener
   * una venta anterior marcada como cerrada.
   */
  let { data: conversation, error: conversationLookupError } =
    await supabaseAdmin
      .from("conversations")
      .select("id, ai_paused, product_id, is_closed, sale_closed")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  if (conversationLookupError) throw conversationLookupError;

  let isNewConversation = false;

  if (!conversation) {
    const { data: created, error: createConversationError } =
      await supabaseAdmin
        .from("conversations")
        .insert({
          workspace_id: workspaceId,
          user_id: ownerId,
          contact_id: contact.id,
          status: "abierta",
          sale_closed: false,
          is_closed: false,
          product_id: null,
          ad_id: referral.adId,
          ad_name: referral.adName,
          ad_url: referral.adUrl,
          ad_media_url: referral.mediaUrl,
          ad_media_type: referral.mediaType,
        })
        .select("id, ai_paused, product_id, is_closed, sale_closed")
        .single();

    if (createConversationError) {
      /*
       * Si dos webhooks llegaron juntos, el índice único puede hacer
       * que uno de los inserts falle con 23505. En ese caso recuperamos
       * la conversación que creó el otro proceso.
       */
      if (createConversationError.code !== "23505") {
        throw createConversationError;
      }

      const { data: concurrentConversation, error: concurrentLookupError } =
        await supabaseAdmin
          .from("conversations")
          .select("id, ai_paused, product_id, is_closed, sale_closed")
          .eq("workspace_id", workspaceId)
          .eq("contact_id", contact.id)
          .single();

      if (concurrentLookupError) throw concurrentLookupError;
      conversation = concurrentConversation;
    } else {
      conversation = created;
      isNewConversation = true;
    }
  } else {
    /*
     * Una conversación vendida solamente vuelve a habilitar una venta cuando
     * el cliente expresa una intención clara de comprar otra vez o entra desde
     * un anuncio nuevo. Ubicación, forma de pago y mensajes de seguimiento
     * conservan sale_closed=true para impedir órdenes duplicadas.
     */
    const startsNewPurchase =
      conversation.sale_closed &&
      isNewPurchaseIntent(body, Boolean(referral.adId));

    const { data: reopened, error: reopenError } = await supabaseAdmin
      .from("conversations")
      .update({
        status: startsNewPurchase
          ? "abierta"
          : conversation.sale_closed
            ? "vendida"
            : "abierta",
        is_closed: false,
        ...(startsNewPurchase
          ? {
              sale_closed: false,
              product_id: null,
            }
          : {}),
        ...(referral.adId ? { ad_id: referral.adId } : {}),
        ...(referral.adName ? { ad_name: referral.adName } : {}),
        ...(referral.adUrl ? { ad_url: referral.adUrl } : {}),
        ...(referral.mediaUrl ? { ad_media_url: referral.mediaUrl } : {}),
        ...(referral.mediaType ? { ad_media_type: referral.mediaType } : {}),
      })
      .eq("id", conversation.id)
      .eq("workspace_id", workspaceId)
      .select("id, ai_paused, product_id, is_closed, sale_closed")
      .single();

    if (reopenError) throw reopenError;
    conversation = reopened;
  }

  if (!conversation) {
    throw new Error("No se pudo crear ni recuperar la conversación");
  }

  if (media) {
    if (!conn.access_token) {
      console.error("[WhatsApp media] La conexión no tiene access_token", {
        workspaceId,
        mediaId: media.part.id,
        type: media.type,
      });
    } else {
      const ingested = await ingestMedia({
        workspaceId,
        accessToken: conn.access_token,
        mediaId: media.part.id!,
        type: media.type,
      });

      mediaPath = ingested.storagePath;
      transcript = ingested.transcript;

      if (transcript) {
        body =
          media.type === "audio"
            ? transcript
            : `${body && body !== `[${message.type}]` ? body + "\n" : ""}[imagen] ${transcript}`;
      }
    }
  }

  const { data: savedMessage } = await supabaseAdmin
    .from("messages")
    .insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      direction: "inbound",
      sender: "customer",
      body,
      transcript,
      media_url: mediaPath,
      media_type: media?.type ?? null,
      wamid: message.id,
      status: "received",
    })
    .select("id")
    .single();

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message: body,
      last_message_at: new Date().toISOString(),
      unread_count: 1,
    })
    .eq("id", conversation.id);

  const complaint = detectComplaint(body);
  if (complaint) {
    await supabaseAdmin.from("complaints").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      contact_id: contact.id,
      message_id: savedMessage?.id ?? null,
      phone,
      contact_name: contact.name,
      body,
      reason: complaint.reason,
      severity: complaint.severity,
      status: "nuevo",
    });

    await supabaseAdmin.from("notifications").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      type: "reclamo",
      title: `Reclamo detectado · ${phone}`,
      body: `${COMPLAINT_REASON_LABELS[complaint.reason] ?? "Reclamo"}: ${body.slice(0, 160)}`,
      link: "/reclamos",
      audience: "user",
    });
  }

  // Balance: one conversation credit per new conversation
  const { data: balance } = await supabaseAdmin
    .from("conversation_balances")
    .select("id, available, consumed")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (isNewConversation) {
    if (!balance || balance.available <= 0) {
      await supabaseAdmin.from("notifications").insert({
        workspace_id: workspaceId,
        user_id: ownerId,
        type: "saldo",
        title: "Sin conversaciones disponibles",
        body: "Tu bot no respondió porque tu saldo se agotó. Recarga un plan para continuar.",
        link: "/planes",
        audience: "user",
      });
      return;
    }
    await supabaseAdmin
      .from("conversation_balances")
      .update({ available: balance.available - 1, consumed: balance.consumed + 1 })
      .eq("id", balance.id);
    await supabaseAdmin.from("conversation_usage").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      amount: 1,
      reason: "nueva_conversacion",
      wamid: message.id,
    });
  } else if (!balance || balance.available <= 0) {
    return;
  }

  const { data: aiSettings } = await supabaseAdmin
    .from("ai_settings")
    .select("ai_enabled, reply_delay_seconds")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!aiSettings?.ai_enabled || conversation.ai_paused || conversation.is_closed) return;

  // Palabra clave → envía la plantilla del producto (multimedia + copy).
  // Si el catálogo fue enviado AHORA, terminamos este turno para evitar que
  // generateAiReply() vuelva a mandar el mismo copy en el mismo webhook.
  const catalogResult = await sendCatalogByKeyword({
    workspaceId,
    ownerId,
    conversationId: conversation.id,
    conn,
    phone,
    text: body,
  });

  if (catalogResult) {
    conversation.product_id = catalogResult.productId;

    if (catalogResult.sent) {
      return;
    }
  }

  const { data: history } = await supabaseAdmin
    .from("messages")
    .select("sender, body")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(24);

  const chatHistory = (history ?? [])
    .reverse()
    .filter((m) => Boolean(m.body))
    .map((m) => ({
      role: m.sender === "customer" ? ("user" as const) : ("assistant" as const),
      content: m.body as string,
    }));

  try {
    const ctx = await buildWorkspaceAiContext(
      supabaseAdmin,
      workspaceId,
      chatHistory,
      conversation.product_id,
      phone,
    );
    const result = await generateAiReply(ctx);

    const detectedProduct =
      result.product_id && ctx.products.some((p) => p.id === result.product_id)
        ? result.product_id
        : conversation.product_id;

    // Segunda barrera anti-repetición:
    // si la IA intenta volver a mandar prácticamente el mismo copy largo del
    // catálogo, lo reemplazamos por una oferta breve con los precios reales.
    const safeReply = buildSafeAiReply({
      reply: result.reply,
      history: chatHistory,
      products: ctx.products,
      productId: detectedProduct,
      lastCustomerMessage: body,
    });

    const wamid = await sendWhatsAppText(conn, phone, safeReply);

    await supabaseAdmin.from("messages").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: "ai",
      body: safeReply,
      wamid,
      status: "sent",
    });

    await supabaseAdmin
      .from("conversations")
      .update({
        last_message: safeReply,
        last_message_at: new Date().toISOString(),
        product_id: detectedProduct,
        unread_count: 0,
      })
      .eq("id", conversation.id);

    const orderReady = isOrderReady(result.order, detectedProduct);

    /*
     * No dependemos solamente de sale_closed.
     * Si Gemini entregó todos los datos obligatorios, el backend crea el
     * pedido aunque el modelo haya olvidado marcar sale_closed=true.
     */
    /*
     * Si la conversación ya tiene una venta cerrada, la IA puede seguir
     * devolviendo el pedido anterior por el historial. En ese caso no se crea
     * otra orden. Una compra nueva primero reinicia sale_closed=false mediante
     * isNewPurchaseIntent() y recién entonces puede registrar otro pedido.
     */
    if (!conversation.sale_closed && result.order && orderReady) {
      const completedOrder = {
        ...result.order,
        phone,
      };

      await createOrderFromAi({
        workspaceId,
        ownerId,
        conversationId: conversation.id,
        contactId: contact.id,
        phone,
        productId: detectedProduct,
        sourceMessageId: message.id,
        order: completedOrder,
        products: ctx.products,
      });
    } else if (result.sale_closed && !result.order) {
      await logOrderIssue({
        workspaceId,
        ownerId,
        message:
          `La IA marcó sale_closed=true pero devolvió order=null. ` +
          `Conversación: ${conversation.id}. Producto: ${detectedProduct ?? "sin producto"}.`,
      });
    } else if (result.sale_closed && result.order && !orderReady) {
      await logOrderIssue({
        workspaceId,
        ownerId,
        message:
          `La IA marcó la venta como cerrada, pero faltan datos obligatorios. ` +
          `Conversación: ${conversation.id}. ` +
          `Producto: ${detectedProduct ?? "sin producto"}. ` +
          `Pedido recibido: ${JSON.stringify(result.order)}`,
      });
    }
  } catch (e) {
    const messageText = e instanceof Error ? e.message : "error";
    await supabaseAdmin.from("integration_logs").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      integration: "ai",
      level: "error",
      message: messageText,
    });
  }
}

function cleanOrderText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isOrderReady(
  order: Awaited<ReturnType<typeof generateAiReply>>["order"],
  productId: string | null,
): order is NonNullable<Awaited<ReturnType<typeof generateAiReply>>["order"]> {
  if (!order || !productId) return false;

  const customerName = cleanOrderText(order.customer_name);
  const city = cleanOrderText(order.city);
  const paymentMethod = cleanOrderText(order.payment_method);
  const quantity = Number(order.quantity);

  /*
   * La dirección es opcional para contraentrega y transportadora.
   * El pedido puede crearse con producto, nombre, ciudad, forma de pago y
   * cantidad válidos. Si existe una dirección, igualmente se guarda.
   */
  return Boolean(
    customerName &&
      city &&
      paymentMethod &&
      Number.isFinite(quantity) &&
      quantity > 0,
  );
}

async function logOrderIssue(args: {
  workspaceId: string;
  ownerId: string;
  message: string;
}) {
  console.error("[Pedidos]", args.message);

  const { error } = await supabaseAdmin.from("integration_logs").insert({
    workspace_id: args.workspaceId,
    user_id: args.ownerId,
    integration: "orders",
    level: "error",
    message: args.message.slice(0, 2000),
  });

  if (error) {
    console.error("[Pedidos] No se pudo guardar integration_logs", {
      error: error.message,
    });
  }
}

async function createOrderFromAi(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  contactId: string;
  phone: string;
  productId: string | null;
  sourceMessageId: string;
  order: NonNullable<Awaited<ReturnType<typeof generateAiReply>>["order"]>;
  products: {
    id: string;
    name: string;
    price: number;
    promo_price: number | null;
    product_prices?: {
      id: string;
      label: string;
      quantity: number;
      price: number;
      sort_order: number;
    }[];
  }[];
}) {
  /*
   * Cada compra se identifica por el mensaje de WhatsApp que terminó de
   * confirmar el pedido. El número generado es determinista: si Meta reenvía
   * exactamente el mismo webhook, recuperamos el mismo pedido; si el cliente
   * realiza otra compra en otro mensaje, se crea una orden nueva aunque se
   * reutilicen el contacto y la conversación.
   */
  const sourceMessageId = cleanOrderText(args.sourceMessageId);

  if (!sourceMessageId) {
    const error = new Error(
      "No se puede crear el pedido porque falta el ID del mensaje de origen",
    );

    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message: `${error.message}. Conversación: ${args.conversationId}.`,
    });

    throw error;
  }

  const orderKeyBytes = new TextEncoder().encode(
    `${args.workspaceId}:${sourceMessageId}`,
  );
  const orderKeyHash = await crypto.subtle.digest("SHA-256", orderKeyBytes);
  const orderKey = Array.from(new Uint8Array(orderKeyHash))
    .slice(0, 10)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const orderNumber = `BS-${orderKey}`;

  const { data: existingOrder, error: existingOrderError } = await supabaseAdmin
    .from("orders")
    .select("id, order_number")
    .eq("workspace_id", args.workspaceId)
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (existingOrderError) {
    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `No se pudo comprobar si el mensaje ya había creado un pedido. ` +
        `${existingOrderError.message} | ` +
        `${existingOrderError.details ?? ""} | ` +
        `${existingOrderError.hint ?? ""} | ` +
        `${existingOrderError.code ?? ""}`,
    });

    throw existingOrderError;
  }

  if (existingOrder) {
    /*
     * Si el pedido ya existía (por reintento del mismo webhook), aprovechamos
     * para reparar su relación con la conversación y el anuncio si faltaba.
     */
    const { data: existingConversation, error: existingConversationError } =
      await supabaseAdmin
        .from("conversations")
        .select("id, ad_id")
        .eq("id", args.conversationId)
        .eq("workspace_id", args.workspaceId)
        .maybeSingle();

    if (existingConversationError) {
      console.error("[Pedidos] No se pudo resolver el anuncio del pedido existente", {
        conversationId: args.conversationId,
        error: existingConversationError.message,
      });
    }

    const { error: repairExistingOrderError } = await supabaseAdmin
      .from("orders")
      .update({
        conversation_id: args.conversationId,
        ad_id: existingConversation?.ad_id ?? null,
      })
      .eq("id", existingOrder.id)
      .eq("workspace_id", args.workspaceId);

    if (repairExistingOrderError) {
      console.error("[Pedidos] No se pudo reparar la atribución del pedido existente", {
        orderId: existingOrder.id,
        conversationId: args.conversationId,
        error: repairExistingOrderError.message,
      });
    }

    console.info("[Pedidos] Mensaje de venta ya procesado", {
      conversationId: args.conversationId,
      sourceMessageId,
      orderId: existingOrder.id,
      orderNumber: existingOrder.order_number,
      adId: existingConversation?.ad_id ?? null,
    });

    return existingOrder;
  }

  const product =
    args.products.find((candidate) => candidate.id === args.productId) ?? null;

  if (!product || !args.productId) {
    const error = new Error(
      "No se puede crear el pedido porque no hay un producto válido detectado",
    );

    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `${error.message}. Conversación: ${args.conversationId}. ` +
        `productId recibido: ${args.productId ?? "null"}.`,
    });

    throw error;
  }

  /*
   * Los precios reales se guardan en product_prices.
   * Cada opción contiene:
   * - quantity: cantidad incluida en la presentación.
   * - price: precio TOTAL de esa presentación.
   *
   * Ejemplo:
   * 2 unidades -> 250000
   *
   * En orders guardamos:
   * - quantity = 2
   * - price = 125000 (precio unitario calculado)
   * - total = 250000
   */
  const parsedRequestedQuantity = Number(args.order.quantity);
  const requestedQuantity =
    Number.isFinite(parsedRequestedQuantity) &&
    parsedRequestedQuantity > 0
      ? Math.floor(parsedRequestedQuantity)
      : 1;

  const priceOptions = [...(product.product_prices ?? [])]
    .map((option) => ({
      id: option.id,
      label: cleanOrderText(option.label),
      quantity: Math.max(1, Math.floor(Number(option.quantity) || 1)),
      price: Number(option.price),
      sort_order: Number(option.sort_order) || 0,
    }))
    .filter(
      (option) =>
        option.label &&
        Number.isFinite(option.quantity) &&
        option.quantity > 0 &&
        Number.isFinite(option.price) &&
        option.price > 0,
    )
    .sort((a, b) => a.sort_order - b.sort_order);

  /*
   * Prioridad:
   * 1. Opción cuya cantidad coincide exactamente con la solicitada.
   * 2. Opción de una unidad.
   * 3. Primera opción válida.
   */
  const selectedPrice =
    priceOptions.find(
      (option) => option.quantity === requestedQuantity,
    ) ??
    priceOptions.find((option) => option.quantity === 1) ??
    priceOptions[0] ??
    null;

  /*
   * Compatibilidad con productos antiguos:
   * si todavía no tienen product_prices, se usan las columnas heredadas.
   */
  const legacyRegularPrice = Number(product.price);
  const legacyPromoPrice =
    product.promo_price === null || product.promo_price === undefined
      ? null
      : Number(product.promo_price);

  const legacyUnitPrice =
    legacyPromoPrice !== null &&
    Number.isFinite(legacyPromoPrice) &&
    legacyPromoPrice > 0
      ? legacyPromoPrice
      : legacyRegularPrice;

  let quantity: number;
  let unitPrice: number;
  let total: number;
  let selectedPriceLabel: string | null = null;

  if (selectedPrice) {
    quantity = selectedPrice.quantity;
    total = selectedPrice.price;
    unitPrice = total / quantity;
    selectedPriceLabel = selectedPrice.label;
  } else if (
    Number.isFinite(legacyUnitPrice) &&
    legacyUnitPrice > 0
  ) {
    quantity = requestedQuantity;
    unitPrice = legacyUnitPrice;
    total = unitPrice * quantity;
  } else {
    const error = new Error(
      `El producto "${product.name}" no tiene opciones de precio válidas`,
    );

    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `${error.message}. Conversación: ${args.conversationId}. ` +
        `Producto: ${product.id}. ` +
        `product_prices=${JSON.stringify(product.product_prices ?? [])}. ` +
        `price=${String(product.price)}. ` +
        `promo_price=${String(product.promo_price)}.`,
    });

    throw error;
  }

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0 ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    const error = new Error(
      `El producto "${product.name}" produjo un cálculo de precio inválido`,
    );

    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `${error.message}. Conversación: ${args.conversationId}. ` +
        `Producto: ${product.id}. ` +
        `Cantidad: ${quantity}. Precio unitario: ${unitPrice}. Total: ${total}.`,
    });

    throw error;
  }

  const customerName = cleanOrderText(args.order.customer_name) || "Cliente";

  const city = cleanOrderText(args.order.city);
  const departamento = cleanOrderText(args.order.departamento) || null;
  const district = cleanOrderText(args.order.district) || null;
  const street = cleanOrderText(args.order.street);
  const baseObservations =
    cleanOrderText(args.order.observations) || null;

  const observations = [
    baseObservations,
    selectedPriceLabel
      ? `Opción de precio: ${selectedPriceLabel}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ") || null;

  const paymentMethod = cleanOrderText(args.order.payment_method);

  /*
   * Resolvemos el anuncio directamente desde la conversación de origen.
   * Así cada pedido nuevo queda atribuido al anuncio correcto en el Dashboard.
   */
  const { data: orderConversation, error: orderConversationError } =
    await supabaseAdmin
      .from("conversations")
      .select("id, ad_id")
      .eq("id", args.conversationId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();

  if (orderConversationError) {
    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `No se pudo resolver el anuncio de la conversación antes de crear el pedido. ` +
        `Conversación: ${args.conversationId}. ${orderConversationError.message}`,
    });

    throw orderConversationError;
  }

  const orderPayload = {
    workspace_id: args.workspaceId,
    user_id: args.ownerId,
    conversation_id: args.conversationId,
    ad_id: orderConversation?.ad_id ?? null,
    contact_id: args.contactId,
    order_number: orderNumber,
    customer_name: customerName,
    phone: args.phone,
    city,
    departamento,
    district,
    street,
    observations,
    payment_method: paymentMethod,
    product_id: args.productId,
    product_title: product.name,
    quantity,
    price: unitPrice,
    total,
    status: "nuevo" as const,
    payment_status: "pendiente" as const,
  };

  const { data: created, error } = await supabaseAdmin
    .from("orders")
    .insert(orderPayload)
    .select("id, order_number, customer_name, phone, total")
    .single();

  if (error) {
    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `No se pudo crear el pedido. ` +
        `Mensaje: ${error.message}. ` +
        `Detalles: ${error.details ?? "-"}. ` +
        `Sugerencia: ${error.hint ?? "-"}. ` +
        `Código: ${error.code ?? "-"}. ` +
        `Payload: ${JSON.stringify(orderPayload)}`,
    });

    throw error;
  }

  const { error: conversationError } = await supabaseAdmin
    .from("conversations")
    .update({
      sale_closed: true,
      status: "vendida",
      product_id: args.productId,
    })
    .eq("id", args.conversationId);

  if (conversationError) {
    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `El pedido ${created.order_number} fue creado, pero no se pudo ` +
        `marcar la conversación como vendida. ${conversationError.message}`,
    });
  }

  const { error: notificationError } = await supabaseAdmin
    .from("notifications")
    .insert({
      workspace_id: args.workspaceId,
      user_id: args.ownerId,
      type: "venta",
      title: `Nueva venta ${created.order_number}`,
      body: `${created.customer_name} · ${formatGs(created.total)}`,
      link: "/pedidos",
      audience: "user",
    });

  if (notificationError) {
    console.error("[Pedidos] Error creando notificación", {
      orderNumber: created.order_number,
      error: notificationError.message,
    });
  }

  /*
   * Actualiza los datos básicos del contacto para que también aparezcan
   * correctamente en Inbox y Contactos.
   */
  const contactUpdate: {
    name?: string;
    city?: string;
  } = {};

  if (customerName && customerName !== "Cliente") {
    contactUpdate.name = customerName;
  }

  if (city) {
    contactUpdate.city = city;
  }

  if (Object.keys(contactUpdate).length > 0) {
    const { error: contactError } = await supabaseAdmin
      .from("contacts")
      .update(contactUpdate)
      .eq("id", args.contactId)
      .eq("workspace_id", args.workspaceId);

    if (contactError) {
      console.error("[Pedidos] Error actualizando contacto", {
        contactId: args.contactId,
        error: contactError.message,
      });
    }
  }

  const { data: settings } = await supabaseAdmin
    .from("user_settings")
    .select("apps_script_url")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  if (settings?.apps_script_url) {
    try {
      const response = await fetch(settings.apps_script_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_number: created.order_number,
          customer_name: customerName,
          phone: args.phone,
          city,
          departamento,
          district,
          street,
          product: product.name,
          price_option: selectedPriceLabel,
          quantity,
          unit_price: unitPrice,
          total,
          payment_method: paymentMethod,
          observations,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Apps Script respondió ${response.status}: ` +
            `${(await response.text()).slice(0, 500)}`,
        );
      }

      await supabaseAdmin.from("integration_logs").insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        integration: "apps_script",
        level: "info",
        message: `Pedido ${created.order_number} enviado a Google Sheets`,
      });
    } catch (error) {
      await supabaseAdmin.from("integration_logs").insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        integration: "apps_script",
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Error enviando a Apps Script",
      });
    }
  }

  console.info("[Pedidos] Pedido creado correctamente", {
    id: created.id,
    orderNumber: created.order_number,
    conversationId: args.conversationId,
    adId: orderConversation?.ad_id ?? null,
    workspaceId: args.workspaceId,
  });

  return created;
}

type CatalogKeywordResult = {
  productId: string;
  /** true = el catálogo/copy fue enviado en ESTE turno. */
  sent: boolean;
};

function normalizeForDuplicateCheck(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string) {
  const aTokens = new Set(normalizeForDuplicateCheck(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeForDuplicateCheck(b).split(" ").filter(Boolean));

  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  return intersection / Math.min(aTokens.size, bTokens.size);
}

function looksLikeRepeatedCatalogCopy(
  reply: string,
  history: { role: "user" | "assistant"; content: string }[],
) {
  const normalizedReply = normalizeForDuplicateCheck(reply);

  // Las respuestas breves no se consideran repetición de un copy comercial.
  if (normalizedReply.length < 180) return false;

  const previousLongAssistantMessages = history
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .filter((content) => normalizeForDuplicateCheck(content).length >= 180)
    .slice(-6);

  return previousLongAssistantMessages.some((previous) => {
    const normalizedPrevious = normalizeForDuplicateCheck(previous);

    if (normalizedReply === normalizedPrevious) return true;
    if (normalizedReply.includes(normalizedPrevious)) return true;
    if (normalizedPrevious.includes(normalizedReply)) return true;

    return tokenSimilarity(reply, previous) >= 0.72;
  });
}

function isGreetingOrInitialInquiry(value: string) {
  const normalized = normalizeIntentText(value);

  const patterns = [
    "hola",
    "buen dia",
    "buenas",
    "buenas tardes",
    "buenas noches",
    "informacion",
    "info",
    "precio",
    "cuanto cuesta",
    "cuanto sale",
    "disponible",
    "me interesa",
    "quiero informacion",
  ];

  return patterns.some((pattern) => normalized.includes(pattern));
}

type AiContextProducts = Awaited<
  ReturnType<typeof buildWorkspaceAiContext>
>["products"];

function buildShortProductOffer(args: {
  products: AiContextProducts;
  productId: string | null;
  lastCustomerMessage: string;
}) {
  const product =
    args.products.find((candidate) => candidate.id === args.productId) ?? null;

  if (!product) {
    return "¡Claro! 😊 ¿Para qué ciudad sería el envío? 📍";
  }

  const options = [...(product.product_prices ?? [])]
    .map((option) => ({
      quantity: Math.max(1, Math.floor(Number(option.quantity) || 1)),
      price: Number(option.price),
      sortOrder: Number(option.sort_order) || 0,
    }))
    .filter(
      (option) =>
        Number.isFinite(option.quantity) &&
        option.quantity > 0 &&
        Number.isFinite(option.price) &&
        option.price > 0,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 5);

  let priceText = "";

  if (options.length === 1) {
    priceText = `a solo ${formatGs(options[0].price)}`;
  } else if (options.length > 1) {
    priceText = `! 🔥\n\n${options
      .map(
        (option) =>
          `${option.quantity} ${option.quantity === 1 ? "unidad" : "unidades"} — ${formatGs(option.price)}`,
      )
      .join("\n")}`;
  } else {
    const promoPrice = Number(product.promo_price);
    const regularPrice = Number(product.price);
    const effectivePrice =
      Number.isFinite(promoPrice) && promoPrice > 0 ? promoPrice : regularPrice;

    if (Number.isFinite(effectivePrice) && effectivePrice > 0) {
      priceText = `a solo ${formatGs(effectivePrice)}`;
    }
  }

  const question = isGreetingOrInitialInquiry(args.lastCustomerMessage)
    ? "¿Para qué ciudad sería el envío? 📍"
    : "¿Querés que avancemos con tu pedido? 📦";

  if (options.length > 1) {
    return `¡El ${product.name} está en súper oferta${priceText}\n\n${question}`;
  }

  if (priceText) {
    return `¡El ${product.name} está en súper oferta ${priceText}! 🔥\n\n${question}`;
  }

  return `¡El ${product.name} está en súper oferta! 🔥\n\n${question}`;
}

function buildSafeAiReply(args: {
  reply: string;
  history: { role: "user" | "assistant"; content: string }[];
  products: AiContextProducts;
  productId: string | null;
  lastCustomerMessage: string;
}) {
  const cleanReply = args.reply.trim();

  if (!cleanReply) {
    return buildShortProductOffer({
      products: args.products,
      productId: args.productId,
      lastCustomerMessage: args.lastCustomerMessage,
    });
  }

  if (!looksLikeRepeatedCatalogCopy(cleanReply, args.history)) {
    return cleanReply;
  }

  console.info("[IA] Copy repetido bloqueado; se envía respuesta comercial breve", {
    productId: args.productId,
  });

  return buildShortProductOffer({
    products: args.products,
    productId: args.productId,
    lastCustomerMessage: args.lastCustomerMessage,
  });
}

/**
 * Detecta palabras clave del catálogo en el mensaje del cliente y envía
 * la plantilla del producto (multimedia + copy) una sola vez por conversación.
 * Devuelve el producto detectado e indica si se envió en este turno.
 */
async function sendCatalogByKeyword(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  conn: Conn;
  phone: string;
  text: string;
}): Promise<CatalogKeywordResult | null> {
  const raw = (args.text ?? "").toLowerCase().trim();
  if (!raw) return null;

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const haystack = normalize(raw);

  const { data: keywords, error: keywordsError } = await supabaseAdmin
    .from("product_keywords")
    .select(
      "keyword, product_id, products!inner(id, name, price, promo_price, sales_copy, description, is_active)",
    )
    .eq("workspace_id", args.workspaceId);

  if (keywordsError) {
    console.error("[Catálogo] Error leyendo palabras clave", {
      workspaceId: args.workspaceId,
      error: keywordsError.message,
    });
    return null;
  }

  if (!keywords?.length) return null;

  type Row = (typeof keywords)[number] & {
    products: {
      id: string;
      name: string;
      sales_copy: string | null;
      description: string | null;
      is_active: boolean;
    } | null;
  };

  let match: Row | null = null;

  for (const row of keywords as Row[]) {
    if (!row.products || row.products.is_active === false) {
      continue;
    }

    const keyword = normalize(row.keyword ?? "");
    if (!keyword) continue;

    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const expression = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`,
      "u",
    );

    if (
      expression.test(haystack) &&
      (!match || keyword.length > normalize(match.keyword ?? "").length)
    ) {
      match = row;
    }
  }

  if (!match?.products) return null;

  const productId = match.products.id;

  const { data: alreadySent } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", args.conversationId)
    .eq("direction", "outbound")
    .eq("catalog_product_id", productId)
    .limit(1)
    .maybeSingle();

  if (alreadySent) {
    return { productId, sent: false };
  }

  const copy =
    match.products.sales_copy?.trim() ||
    `${match.products.name}
${match.products.description ?? ""}`.trim();

  const { sendWhatsAppMedia } = await import("@/lib/whatsapp.server");

  const { data: mediaRows, error: mediaError } = await supabaseAdmin
    .from("product_media")
    .select("url, storage_path, media_type, position")
    .eq("product_id", productId)
    .order("position", { ascending: true });

  if (mediaError) {
    console.error("[Catálogo] Error leyendo multimedia", {
      productId,
      error: mediaError.message,
    });
  }

  let copySentAsCaption = false;
  let copySent = false;
  let sentMediaCount = 0;

  for (const media of (mediaRows ?? []).slice(0, 8)) {
    let link =
      typeof media.url === "string" && media.url.trim()
        ? media.url.trim()
        : null;

    if (media.storage_path) {
      const { data: signed, error: signedError } = await supabaseAdmin.storage
        .from("product-media")
        .createSignedUrl(media.storage_path, 60 * 60 * 24 * 7);

      if (signedError) {
        console.error("[Catálogo] Error creando URL firmada", {
          productId,
          storagePath: media.storage_path,
          error: signedError.message,
        });
      }

      if (signed?.signedUrl) {
        link = signed.signedUrl;
      }
    }

    if (!link) continue;

    const rawType = String(media.media_type ?? "").toLowerCase();

    const type: "image" | "video" | "audio" | "document" = rawType.startsWith(
      "image",
    )
      ? "image"
      : rawType.startsWith("video")
        ? "video"
        : rawType.startsWith("audio")
          ? "audio"
          : "document";

    const caption =
      !copySentAsCaption && (type === "image" || type === "video")
        ? copy.slice(0, 1024)
        : undefined;

    try {
      const wamid = await sendWhatsAppMedia(
        args.conn,
        args.phone,
        link,
        type,
        caption,
      );

      sentMediaCount += 1;

      if (caption) {
        copySentAsCaption = true;
        copySent = true;
      }

      const { error: insertError } = await supabaseAdmin
        .from("messages")
        .insert({
          workspace_id: args.workspaceId,
          user_id: args.ownerId,
          conversation_id: args.conversationId,
          direction: "outbound",
          sender: "ai",
          body: caption || `[${type}] ${match.products.name}`,
          media_url: link,
          media_type: type,
          status: "sent",
          wamid,
          catalog_product_id: caption ? productId : null,
        });

      if (insertError) {
        console.error("[Catálogo] Error guardando multimedia", {
          productId,
          error: insertError.message,
        });
      }
    } catch (error) {
      console.error("[Catálogo] Meta rechazó el archivo", {
        productId,
        type,
        link,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!copySentAsCaption) {
    try {
      const wamid = await sendWhatsAppText(args.conn, args.phone, copy);
      copySent = true;

      const { error: copyError } = await supabaseAdmin.from("messages").insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        conversation_id: args.conversationId,
        direction: "outbound",
        sender: "ai",
        body: copy,
        catalog_product_id: productId,
        status: "sent",
        wamid,
      });

      if (copyError) {
        console.error("[Catálogo] Error guardando copy", {
          productId,
          error: copyError.message,
        });
      }
    } catch (error) {
      console.error("[Catálogo] Error enviando copy", {
        productId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (sentMediaCount === 0) {
        return null;
      }
    }
  }

  await supabaseAdmin
    .from("conversations")
    .update({
      product_id: productId,
      last_message: copy,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", args.conversationId);

  return productId;
}
