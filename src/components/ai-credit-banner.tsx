import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

type Alert = { provider: "openai" | "gemini" | "ia"; at: string; detail?: string };
const LABEL = { openai: "OpenAI", gemini: "Gemini", ia: "IA" } as const;
const BILLING_URL = {
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  gemini: "https://aistudio.google.com/",
  ia: "",
} as const;

/** Cartel rojo «Tu API se quedó sin saldo»: aparece en todas las pantallas hasta que la IA vuelve a responder. */
export function AiCreditBanner() {
  const { profile } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const qc = useQueryClient();
  const { data: alert } = useQuery({
    queryKey: ["ai-credit-alert", workspaceId],
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("ai_settings").select("ai_credit_alert").eq("workspace_id", workspaceId!).maybeSingle();
      return ((data as { ai_credit_alert?: Alert | null } | null)?.ai_credit_alert ?? null) as Alert | null;
    },
  });
  if (!alert) return null;
  const since = new Date(alert.at).toLocaleString("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  const billing = BILLING_URL[alert.provider];

  async function dismiss() {
    await supabase.from("ai_settings").update({ ai_credit_alert: null } as never).eq("workspace_id", workspaceId!);
    await qc.invalidateQueries({ queryKey: ["ai-credit-alert", workspaceId] });
  }

  return (
    <div role="alert" className="border-b border-red-500/40 bg-red-600 px-3 py-2.5 text-white sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Tu API de {LABEL[alert.provider]} se quedó sin saldo</p>
          <p className="text-white/90">El bot NO está respondiendo a tus clientes desde el {since}. Recargá saldo o cargá otra clave para que vuelva a vender.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {billing ? (
            <Button asChild size="sm" variant="secondary" className="h-8">
              <a href={billing} target="_blank" rel="noreferrer">Recargar saldo <ExternalLink className="ml-1 h-3.5 w-3.5" /></a>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline" className="h-8 border-white/60 bg-transparent text-white hover:bg-white/10 hover:text-white">
            <Link to="/configuraciones"><Settings className="mr-1 h-3.5 w-3.5" /> Configuraciones</Link>
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-white hover:bg-white/10 hover:text-white" onClick={() => void dismiss()}>
            Ya recargué
          </Button>
        </div>
      </div>
    </div>
  );
}
