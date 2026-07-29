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
