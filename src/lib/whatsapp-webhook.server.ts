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
  referral?: { source_id?: string; image_url?: string; video_url?: string; headline?: string };
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

/**
 * Normaliza texto para clasificar mensajes sin depender de tildes o mayúsculas.
 */
function normalizeMessageText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Después de una venta cerrada, estos mensajes continúan en la conversación
 * anterior porque corresponden a postventa y no a un pedido nuevo.
 */
function isPostSaleMessage(value: string): boolean {
  const text = normalizeMessageText(value);
  if (!text) return false;

  const postSalePatterns = [
    "gracias",
    "muchas gracias",
    "cuando llega",
    "cuando entregan",
    "cuando me llega",
    "donde esta mi pedido",
    "estado de mi pedido",
    "seguimiento",
    "numero de guia",
    "comprobante de despacho",
    "quiero factura",
    "necesito factura",
    "mi factura",
    "cambiar direccion",
    "cambiar la direccion",
    "cambiar ubicacion",
    "cambiar la ubicacion",
    "cambiar nombre",
    "cambiar telefono",
    "corregir direccion",
    "corregir ubicacion",
    "cancelar pedido",
    "cancelar mi pedido",
    "problema con mi pedido",
    "reclamo",
    "no me llego",
    "ya pague",
    "envie el comprobante",
  ];

  return postSalePatterns.some((pattern) => text.includes(pattern));
}

/**
 * Decide si un mensaje recibido después de una venta debe iniciar otra compra.
 *
 * - Una referencia de anuncio siempre inicia una conversación comercial nueva.
 * - Los mensajes claramente de postventa permanecen en la venta anterior.
 * - Cualquier otro mensaje abre una conversación nueva para permitir que el
 *   mismo número compre nuevamente.
 */
function shouldStartNewConversation(
  message: IncomingMessage,
  body: string,
): boolean {
  if (message.referral?.source_id) return true;
  return !isPostSaleMessage(body);
}

async function processMessage(conn: Conn, profileName: string | null, message: IncomingMessage) {
  const workspaceId = conn.workspace_id;
  const ownerId = conn.user_id;
  const phone = message.from;
  const media = mediaOf(message);
  let body = media?.part.caption?.trim() || textOf(message);
  let mediaPath: string | null = null;
  let transcript: string | null = null;

  const { data: existingMessage } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("wamid", message.id)
    .maybeSingle();
  if (existingMessage) return;

  let { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .maybeSingle();

  if (!contact) {
    const { data: created, error } = await supabaseAdmin
      .from("contacts")
      .insert({ workspace_id: workspaceId, user_id: ownerId, phone, name: profileName })
      .select("id, name")
      .single();
    if (error) throw error;
    contact = created;
  }

  let { data: conversation, error: conversationLookupError } =
    await supabaseAdmin
      .from("conversations")
      .select("id, ai_paused, product_id, is_closed, sale_closed")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (conversationLookupError) throw conversationLookupError;

  let isNewConversation = false;
  const startsAnotherPurchase =
    Boolean(conversation?.sale_closed) &&
    shouldStartNewConversation(message, body);

  /*
   * Un mismo contacto puede realizar varias compras.
   * Cada venta nueva recibe su propia conversación y, por lo tanto, su propio
   * conversation_id. Los mensajes de postventa siguen asociados al pedido
   * anterior y no generan pedidos duplicados.
   */
  if (!conversation || startsAnotherPurchase) {
    const { data: created, error } = await supabaseAdmin
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        user_id: ownerId,
        contact_id: contact.id,
        status: "abierta",
        sale_closed: false,
        is_closed: false,
        product_id: null,
        ad_id: message.referral?.source_id ?? null,
        ad_media_url:
          message.referral?.image_url ??
          message.referral?.video_url ??
          null,
      })
      .select("id, ai_paused, product_id, is_closed, sale_closed")
      .single();

    if (error) throw error;

    conversation = created;
    isNewConversation = true;
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

  // Palabra clave → envía la plantilla del producto (multimedia + copy)
  const keywordProductId = await sendCatalogByKeyword({
    workspaceId,
    ownerId,
    conversationId: conversation.id,
    conn,
    phone,
    text: body,
  });
  if (keywordProductId) conversation.product_id = keywordProductId;

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

    const wamid = await sendWhatsAppText(conn, phone, result.reply);

    await supabaseAdmin.from("messages").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: "ai",
      body: result.reply,
      wamid,
      status: "sent",
    });

    const detectedProduct =
      result.product_id && ctx.products.some((p) => p.id === result.product_id)
        ? result.product_id
        : conversation.product_id;

    await supabaseAdmin
      .from("conversations")
      .update({
        last_message: result.reply,
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
    if (result.order && orderReady) {
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
  order: NonNullable<Awaited<ReturnType<typeof generateAiReply>>["order"]>;
  products: {
    id: string;
    name: string;
    price: number;
    promo_price: number | null;
  }[];
}) {
  /*
   * Evita pedidos duplicados si Meta reintenta un webhook o llegan
   * dos mensajes casi al mismo tiempo.
   */
  const { data: existingOrder, error: existingOrderError } = await supabaseAdmin
    .from("orders")
    .select("id, order_number")
    .eq("workspace_id", args.workspaceId)
    .eq("conversation_id", args.conversationId)
    .limit(1)
    .maybeSingle();

  if (existingOrderError) {
    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `No se pudo comprobar si ya existía un pedido. ` +
        `${existingOrderError.message} | ` +
        `${existingOrderError.details ?? ""} | ` +
        `${existingOrderError.hint ?? ""} | ` +
        `${existingOrderError.code ?? ""}`,
    });

    throw existingOrderError;
  }

  if (existingOrder) {
    await supabaseAdmin
      .from("conversations")
      .update({
        sale_closed: true,
        status: "vendida",
      })
      .eq("id", args.conversationId);

    console.info("[Pedidos] Pedido ya existente", {
      conversationId: args.conversationId,
      orderId: existingOrder.id,
      orderNumber: existingOrder.order_number,
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

  const unitPrice = Number(product.promo_price ?? product.price);

  const parsedQuantity = Number(args.order.quantity);
  const quantity =
    Number.isFinite(parsedQuantity) && parsedQuantity > 0
      ? Math.floor(parsedQuantity)
      : 1;

  const orderNumber = `BS-${Date.now().toString(36).toUpperCase()}`;

  const customerName = cleanOrderText(args.order.customer_name) || "Cliente";

  const city = cleanOrderText(args.order.city);
  const departamento = cleanOrderText(args.order.departamento) || null;
  const district = cleanOrderText(args.order.district) || null;
  const street = cleanOrderText(args.order.street);
  const observations = cleanOrderText(args.order.observations) || null;
  const paymentMethod = cleanOrderText(args.order.payment_method);

  const orderPayload = {
    workspace_id: args.workspaceId,
    user_id: args.ownerId,
    conversation_id: args.conversationId,
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
    total: unitPrice * quantity,
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
          quantity,
          total: unitPrice * quantity,
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
    workspaceId: args.workspaceId,
  });

  return created;
}

/**
 * Detecta palabras clave del catálogo en el mensaje del cliente y envía
 * la plantilla del producto (multimedia + copy) una sola vez por conversación.
 * Devuelve el id del producto detectado, o null.
 */
async function sendCatalogByKeyword(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  conn: Conn;
  phone: string;
  text: string;
}): Promise<string | null> {
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

  if (alreadySent) return productId;

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
