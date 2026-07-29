import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildWorkspaceAiContext } from "@/lib/ai-context.server";
import { generateAiReply } from "@/lib/ai.server";
import { sendWhatsAppText } from "@/lib/whatsapp.server";

type IncomingMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  referral?: { source_id?: string; image_url?: string; video_url?: string; headline?: string };
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
  const body = textOf(message);

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

  await supabaseAdmin.from("messages").insert({
    workspace_id: workspaceId,
    user_id: ownerId,
    conversation_id: conversation.id,
    direction: "inbound",
    sender: "customer",
    body,
    wamid: message.id,
    status: "received",
  });

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message: body,
      last_message_at: new Date().toISOString(),
      unread_count: 1,
    })
    .eq("id", conversation.id);

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
