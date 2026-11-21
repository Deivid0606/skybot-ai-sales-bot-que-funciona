import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * «Tu API se quedó sin saldo»: cuando el proveedor de IA rechaza por falta de crédito,
 * se guarda la alerta en ai_settings (cartel rojo en el panel), se crea una notificación
 * en la campanita y se envía un push al celular. Se repite como máximo cada 3 horas
 * y se borra sola apenas la IA vuelve a responder.
 */
export type AiCreditAlert = { provider: "openai" | "gemini" | "ia"; at: string; detail: string };
const REPEAT_MS = 3 * 60 * 60 * 1000;

export function isCreditError(message: string): boolean {
  return /\b402\b|no credits|credits? (?:are )?depleted|insufficient[_ ]quota|exceeded your current quota|billing|prepayment|saldo/i.test(message);
}

function providerOf(message: string): AiCreditAlert["provider"] {
  if (/openai/i.test(message)) return "openai";
  if (/gemini|ai\.studio|generativelanguage/i.test(message)) return "gemini";
  return "ia";
}

export const PROVIDER_LABEL: Record<AiCreditAlert["provider"], string> = { openai: "OpenAI", gemini: "Gemini", ia: "IA" };

export async function reportAiCreditProblem(workspaceId: string, ownerId: string, errorMessage: string): Promise<void> {
  if (!isCreditError(errorMessage)) return;
  try {
    const { data } = await supabaseAdmin.from("ai_settings").select("ai_credit_alert").eq("workspace_id", workspaceId).maybeSingle();
    const current = (data as { ai_credit_alert?: AiCreditAlert | null } | null)?.ai_credit_alert ?? null;
    const provider = providerOf(errorMessage);
    if (current && current.provider === provider && Date.now() - new Date(current.at).getTime() < REPEAT_MS) return;
    const alert: AiCreditAlert = { provider, at: current?.provider === provider ? current.at : new Date().toISOString(), detail: errorMessage.slice(0, 300) };
    await supabaseAdmin.from("ai_settings").update({ ai_credit_alert: alert } as never).eq("workspace_id", workspaceId);
    const label = PROVIDER_LABEL[provider];
    const title = `⚠️ Tu API de ${label} se quedó sin saldo`;
    const body = `El bot NO está respondiendo a tus clientes. Recargá saldo en ${provider === "openai" ? "platform.openai.com → Billing" : provider === "gemini" ? "AI Studio (Gemini) → Billing" : "tu proveedor de IA"} o cargá otra clave en Configuraciones.`;
    await supabaseAdmin.from("notifications").insert({
      workspace_id: workspaceId, user_id: ownerId, type: "ia", title, body, link: "/configuraciones", audience: "user",
    } as never);
    // Tabla fuera de los tipos generados (igual que en push.server.ts).
    await (supabaseAdmin as unknown as { from: (t: string) => { insert: (v: unknown) => Promise<unknown> } }).from("botsky_push_outbox").insert({
      user_id: ownerId, event_type: "ai_credit", title, body, click_url: "/configuraciones",
    } as never);
  } catch (e) {
    console.error("[BOT_SKY_AI_CREDIT_ALERT]", e instanceof Error ? e.message : String(e));
  }
}

/** La IA volvió a responder: apagar el cartel (no escribe nada si no había alerta). */
export async function clearAiCreditProblem(workspaceId: string): Promise<void> {
  await supabaseAdmin.from("ai_settings").update({ ai_credit_alert: null } as never)
    .eq("workspace_id", workspaceId).not("ai_credit_alert", "is", null);
}
