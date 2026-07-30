import { supabase } from "@/integrations/supabase/client";

export type AppMessageKey = "pending" | "rejected" | "blocked" | "no_balance";

export type AppMessage = {
  key: string;
  title: string | null;
  body: string;
  updated_at: string;
};

export const APP_MESSAGE_LABELS: Record<AppMessageKey, { label: string; help: string }> = {
  pending: {
    label: "Registro nuevo (pendiente de aprobación)",
    help: "Se muestra a quien acaba de registrarse y espera la aprobación del administrador.",
  },
  rejected: {
    label: "Registro rechazado",
    help: "Se muestra cuando el administrador rechaza la solicitud de acceso.",
  },
  blocked: {
    label: "Cuenta bloqueada / suspendida",
    help: "Se muestra cuando bloqueás o suspendés a un vendedor.",
  },
  no_balance: {
    label: "Sin conversaciones disponibles",
    help: "Se muestra cuando el vendedor agotó los mensajes de su plan.",
  },
};

export const DEFAULT_APP_MESSAGES: Record<AppMessageKey, { title: string; body: string }> = {
  pending: {
    title: "Pendiente de aprobación",
    body: "Tu cuenta fue creada correctamente. Un administrador debe aprobarla antes de que puedas ingresar al panel.",
  },
  rejected: {
    title: "Registro rechazado",
    body: "El administrador rechazó tu solicitud de acceso.",
  },
  blocked: {
    title: "Cuenta bloqueada",
    body: "Tu acceso fue bloqueado temporalmente.",
  },
  no_balance: {
    title: "Sin conversaciones disponibles",
    body: "Se terminaron tus conversaciones. Recargá un plan para que la IA siga respondiendo.",
  },
};

export async function fetchAppMessages(): Promise<Record<string, AppMessage>> {
  const { data, error } = await supabase.from("app_messages").select("*");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((m) => [m.key, m as AppMessage]));
}

export function resolveMessage(
  messages: Record<string, AppMessage> | undefined,
  key: AppMessageKey,
) {
  const found = messages?.[key];
  return {
    title: found?.title?.trim() || DEFAULT_APP_MESSAGES[key].title,
    body: found?.body?.trim() || DEFAULT_APP_MESSAGES[key].body,
  };
}
