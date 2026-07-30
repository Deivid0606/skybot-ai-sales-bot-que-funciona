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

const TestInput = z.object({ message: z.string().trim().min(1).max(2000) });

export const testAiReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TestInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
    const { generateAiReply } = await import("@/lib/ai.server");
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("workspace_id")
      .eq("id", userId)
      .single();
    if (!profile?.workspace_id) throw new Error("Sin workspace");

    const ctx = await buildWorkspaceAiContext(supabase, profile.workspace_id, [
      { role: "user", content: data.message },
    ]);
    const result = await generateAiReply(ctx);
    return result;
  });

const AiNowInput = z.object({ conversationId: z.string().uuid() });

export const aiReplyNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AiNowInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildWorkspaceAiContext } = await import("@/lib/ai-context.server");
    const { generateAiReply } = await import("@/lib/ai.server");
    const { supabase, userId } = context;

    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id, workspace_id, product_id, contacts(phone)")
      .eq("id", data.conversationId)
      .single();
    if (error || !conversation) throw new Error("Conversación no encontrada");

    const { data: history } = await supabase
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

    if (chatHistory.length === 0) throw new Error("No hay mensajes para responder");

    const ctx = await buildWorkspaceAiContext(
      supabase,
      conversation.workspace_id,
      chatHistory,
      conversation.product_id,
    );
    const result = await generateAiReply(ctx);

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
        wamid = await sendWhatsAppText(conn, phone, result.reply);
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
      sender: "ai",
      body: result.reply,
      wamid,
      status: sendError ? "failed" : "sent",
      error: sendError,
    });
    if (insertError) throw insertError;

    await supabase
      .from("conversations")
      .update({
        last_message: result.reply,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

    if (sendError) throw new Error(sendError);
    return { reply: result.reply };
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
