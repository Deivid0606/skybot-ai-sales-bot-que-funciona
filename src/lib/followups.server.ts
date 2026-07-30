import { sendWhatsAppText } from "@/lib/whatsapp.server";

type Step = { step: number; delay_minutes: number; message: string };

export async function runDueFollowups() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: conversations, error } = await supabaseAdmin
    .from("conversations")
    .select("id, workspace_id, user_id, contact_id, product_id, last_message_at")
    .eq("is_closed", false)
    .eq("sale_closed", false)
    .eq("followups_paused", false)
    .not("product_id", "is", null)
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: true })
    .limit(200);

  if (error) throw error;
  if (!conversations?.length) return { checked: 0, sent: 0 };

  let sent = 0;

  for (const conv of conversations) {
    const productId = conv.product_id as string;

    const [{ data: product }, { data: customSteps }, { data: already }] = await Promise.all([
      supabaseAdmin
        .from("products")
        .select("followup_enabled, followup_message, followup_minutes")
        .eq("id", productId)
        .maybeSingle(),
      supabaseAdmin
        .from("product_followups")
        .select("step, delay_minutes, message")
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("step", { ascending: true }),
      supabaseAdmin
        .from("followup_sends")
        .select("step")
        .eq("conversation_id", conv.id)
        .eq("product_id", productId),
    ]);

    let steps: Step[] = (customSteps ?? []) as Step[];
    if (steps.length === 0 && product?.followup_enabled && product.followup_message) {
      steps = [
        { step: 1, delay_minutes: product.followup_minutes ?? 60, message: product.followup_message },
      ];
    }
    if (steps.length === 0) continue;

    const done = new Set((already ?? []).map((r) => r.step));
    const elapsedMin =
      (Date.now() - new Date(conv.last_message_at as string).getTime()) / 60000;

    const pending = steps
      .filter((s) => !done.has(s.step) && elapsedMin >= s.delay_minutes)
      .sort((a, b) => a.step - b.step)[0];
    if (!pending) continue;

    const [{ data: conn }, { data: contact }] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_connections")
        .select("phone_number_id, access_token")
        .eq("workspace_id", conv.workspace_id)
        .maybeSingle(),
      supabaseAdmin.from("contacts").select("phone").eq("id", conv.contact_id).maybeSingle(),
    ]);

    if (!conn?.phone_number_id || !conn.access_token || !contact?.phone) continue;

    try {
      const wamid = await sendWhatsAppText(conn, contact.phone, pending.message);
      await supabaseAdmin.from("messages").insert({
        workspace_id: conv.workspace_id,
        conversation_id: conv.id,
        user_id: conv.user_id,
        wamid,
        direction: "outbound",
        sender: "system",
        body: pending.message,
        status: "sent",
      });
      await supabaseAdmin.from("followup_sends").insert({
        workspace_id: conv.workspace_id,
        conversation_id: conv.id,
        product_id: productId,
        step: pending.step,
      });
      sent += 1;
    } catch (e) {
      await supabaseAdmin.from("integration_logs").insert({
        workspace_id: conv.workspace_id,
        user_id: conv.user_id,
        integration: "followups",
        level: "error",
        message: e instanceof Error ? e.message : "Error enviando seguimiento",
      });
    }
  }

  return { checked: conversations.length, sent };
}
