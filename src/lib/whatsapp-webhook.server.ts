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
  const { transcribeAudio, describeImage, toBase64 } = await import("@/lib/media-ai.server");

  const url = await downloadWhatsAppMediaUrl(args.mediaId, args.accessToken);
  if (!url) return { storagePath: null as string | null, transcript: null as string | null };

  const res = await fetch(url, { headers: { Authorization: `Bearer ${args.accessToken}` } });
  if (!res.ok) return { storagePath: null, transcript: null };
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  const bytes = await res.arrayBuffer();

  const ext = (mime.split(";")[0].split("/")[1] ?? "bin").replace(/[^a-z0-9]/gi, "");
  const storagePath = `${args.workspaceId}/inbound/${Date.now()}-${args.mediaId}.${ext}`;
  await supabaseAdmin.storage
    .from("chat-media")
    .upload(storagePath, bytes, { contentType: mime, upsert: false });

  let transcript: string | null = null;
  try {
    const base64 = toBase64(bytes);
    if (args.type === "audio") transcript = await transcribeAudio(base64, mime);
    else if (args.type === "image") transcript = await describeImage(base64, mime);
  } catch (e) {
    console.error("media ai error", e);
  }

  return { storagePath, transcript };
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

type Conn = {
  workspace_id: string;
  user_id: string;
  phone_number_id: string | null;
  access_token: string | null;
};

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

  let { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id, ai_paused, product_id, is_closed, sale_closed")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let isNewConversation = false;
  if (!conversation) {
    const { data: created, error } = await supabaseAdmin
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        user_id: ownerId,
        contact_id: contact.id,
        status: "abierta",
        ad_id: message.referral?.source_id ?? null,
        ad_media_url: message.referral?.image_url ?? message.referral?.video_url ?? null,
      })
      .select("id, ai_paused, product_id, is_closed, sale_closed")
      .single();
    if (error) throw error;
    conversation = created;
    isNewConversation = true;
  }

  if (media && conn.access_token) {
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

    if (result.sale_closed && result.order && !conversation.sale_closed) {
      await createOrderFromAi({
        workspaceId,
        ownerId,
        conversationId: conversation.id,
        contactId: contact.id,
        phone,
        productId: detectedProduct,
        order: result.order,
        products: ctx.products,
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

async function createOrderFromAi(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  contactId: string;
  phone: string;
  productId: string | null;
  order: NonNullable<Awaited<ReturnType<typeof generateAiReply>>["order"]>;
  products: { id: string; name: string; price: number; promo_price: number | null }[];
}) {
  const product = args.products.find((p) => p.id === args.productId) ?? null;
  const unitPrice = product ? (product.promo_price ?? product.price) : 0;
  const quantity = Number(args.order.quantity) > 0 ? Number(args.order.quantity) : 1;
  const orderNumber = `BS-${Date.now().toString(36).toUpperCase()}`;

  const { data: created, error } = await supabaseAdmin
    .from("orders")
    .insert({
      workspace_id: args.workspaceId,
      user_id: args.ownerId,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      order_number: orderNumber,
      customer_name: args.order.customer_name ?? "Cliente",
      phone: args.order.phone ?? args.phone,
      city: args.order.city ?? null,
      departamento: args.order.departamento ?? null,
      district: args.order.district ?? null,
      street: args.order.street ?? null,
      observations: args.order.observations ?? null,
      payment_method: args.order.payment_method ?? null,
      product_id: args.productId,
      product_title: product?.name ?? null,
      quantity,
      price: unitPrice,
      total: unitPrice * quantity,
      status: "nuevo",
      payment_status: "pendiente",
    })
    .select("id, order_number, customer_name, total")
    .single();
  if (error) throw error;

  await supabaseAdmin
    .from("conversations")
    .update({ sale_closed: true, status: "vendida" })
    .eq("id", args.conversationId);

  await supabaseAdmin.from("notifications").insert({
    workspace_id: args.workspaceId,
    user_id: args.ownerId,
    type: "venta",
    title: `Nueva venta ${created.order_number}`,
    body: `${created.customer_name} · ${formatGs(created.total)}`,
    link: "/pedidos",
    audience: "user",
  });

  const { data: settings } = await supabaseAdmin
    .from("user_settings")
    .select("apps_script_url")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  if (settings?.apps_script_url) {
    try {
      await fetch(settings.apps_script_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: created.order_number,
          customer_name: args.order.customer_name,
          phone: args.order.phone ?? args.phone,
          city: args.order.city,
          departamento: args.order.departamento,
          district: args.order.district,
          street: args.order.street,
          product: product?.name,
          quantity,
          total: unitPrice * quantity,
          payment_method: args.order.payment_method,
          observations: args.order.observations,
        }),
      });
      await supabaseAdmin.from("integration_logs").insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        integration: "apps_script",
        level: "info",
        message: `Pedido ${created.order_number} enviado a Google Sheets`,
      });
    } catch (e) {
      await supabaseAdmin.from("integration_logs").insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        integration: "apps_script",
        level: "error",
        message: e instanceof Error ? e.message : "Error enviando a Apps Script",
      });
    }
  }
}
