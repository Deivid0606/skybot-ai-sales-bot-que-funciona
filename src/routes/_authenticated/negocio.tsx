import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, Store, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import {
  DAY_NAMES, assistantNameFromTraining, defaultGreeting, nextDeliveryText, profileFromRow, suggestedProfile,
  type BusinessProfile, type Tone,
} from "@/lib/business-profile";

export const Route = createFileRoute("/_authenticated/negocio")({
  head: () => ({
    meta: [
      { title: "Mi negocio — BOT SKY" },
      { name: "description", content: "Nombre de la tienda, asistente y horarios de entrega." },
    ],
  }),
  component: BusinessPage,
});

const TONES: { value: Tone; label: string }[] = [
  { value: "amable", label: "Amable y breve" },
  { value: "formal", label: "Formal (usted)" },
  { value: "emojis", label: "Con muchos emojis" },
];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function BusinessPage() {
  const { profile } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BusinessProfile | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["business-profile", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const [row, settings, workspace, training, ai] = await Promise.all([
        (supabase as any).from("workspace_business_profile").select("*").eq("workspace_id", workspaceId).maybeSingle(),
        supabase.from("user_settings").select("business_name").eq("workspace_id", workspaceId!).maybeSingle(),
        supabase.from("workspaces").select("name").eq("id", workspaceId!).maybeSingle(),
        supabase.from("training_entries").select("content").eq("workspace_id", workspaceId!).eq("is_active", true),
        supabase.from("ai_settings").select("system_instruction").eq("workspace_id", workspaceId!).maybeSingle(),
      ]);
      if (row.error) throw row.error;
      const storeName = String(settings.data?.business_name ?? "").trim() || String(workspace.data?.name ?? "").trim();
      // Si el entrenamiento ya dice «Tu nombre es Laura», se sugiere ese nombre.
      const trained = assistantNameFromTraining([String((ai.data as any)?.system_instruction ?? ""), ...((training.data ?? []) as any[]).map(t => String(t.content ?? ""))]);
      const fallback = suggestedProfile(workspaceId!, storeName, trained);
      return { saved: Boolean(row.data), profile: profileFromRow(row.data, fallback) };
    },
  });

  useEffect(() => { if (data && !form) setForm(data.profile); }, [data, form]);

  const next = useMemo(() => form ? nextDeliveryText(form) : null, [form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !form) throw new Error("Sesión no válida");
      if (!form.store_name?.trim()) throw new Error("Escribí el nombre de la tienda.");
      if (!form.assistant_name?.trim()) throw new Error("Escribí el nombre de la asistente.");
      for (const d of form.delivery_days) {
        if (d.active && !(/^\d{2}:\d{2}$/.test(d.from) && /^\d{2}:\d{2}$/.test(d.to) && d.from < d.to)) {
          throw new Error(`Revisá el horario del ${DAY_NAMES[d.day].toLowerCase()}: «desde» tiene que ser antes que «hasta».`);
        }
      }
      const { error } = await (supabase as any).from("workspace_business_profile").upsert({
        workspace_id: workspaceId,
        store_name: form.store_name.trim(), assistant_name: form.assistant_name.trim(), tone: form.tone,
        greeting: form.greeting?.trim() || null, delivery_days: form.delivery_days,
        cutoff_time: form.cutoff_time || null, no_holiday_delivery: form.no_holiday_delivery,
        bot_always_on: form.bot_always_on, updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id" });
      if (error) throw error;
      // Mantener igual el «Nombre del negocio» de Configuraciones.
      await supabase.from("user_settings").update({ business_name: form.store_name.trim() } as never).eq("workspace_id", workspaceId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-profile"] });
      toast.success("Guardado. El bot ya usa estos datos en los próximos mensajes.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !form) {
    return <PageShell><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p></PageShell>;
  }
  const set = (patch: Partial<BusinessProfile>) => setForm(f => f ? { ...f, ...patch } : f);
  const setDay = (day: number, patch: Partial<{ active: boolean; from: string; to: string }>) => {
    const exists = form.delivery_days.some(d => d.day === day);
    const days = exists ? form.delivery_days : [...form.delivery_days, { day, active: false, from: "08:00", to: "18:00" }];
    set({ delivery_days: days.map(d => d.day === day ? { ...d, ...patch } : d) });
  };

  return (
    <PageShell>
      <PageHeader
        title="Mi negocio"
        description="Cómo se presenta tu bot y cuándo entregás. Tiene prioridad sobre lo escrito en el entrenamiento."
        actions={
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
          </Button>
        }
      />

      {!data?.saved && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Estos son <b>datos sugeridos</b>. El nombre de la tienda y de la asistente ya los usa tu bot; los <b>horarios de entrega</b> se usan recién cuando toques «Guardar». Cambiá lo que quieras.</p>
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <p className="flex items-center gap-2 font-semibold"><Store className="h-4 w-4 text-primary" /> Identidad</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nombre de la tienda</Label>
              <Input value={form.store_name ?? ""} maxLength={80} onChange={e => set({ store_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Nombre de la asistente</Label>
              <Input value={form.assistant_name ?? ""} maxLength={40} onChange={e => set({ assistant_name: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Forma de hablar</Label>
            <div className="flex flex-wrap gap-2">
              {TONES.map(t => (
                <Button key={t.value} type="button" size="sm" variant={form.tone === t.value ? "default" : "outline"} onClick={() => set({ tone: t.value })}>
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Saludo de bienvenida</Label>
            <div className="flex flex-wrap gap-2">
              <Input className="min-w-[14rem] flex-1" value={form.greeting ?? ""} maxLength={200} onChange={e => set({ greeting: e.target.value })} />
              <Button type="button" variant="outline" size="sm" onClick={() => set({ greeting: defaultGreeting(form.assistant_name || "Sofi", form.store_name || "la tienda") })}>
                Usar sugerido
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">La IA lo usa como guía en el primer mensaje; después habla según tu entrenamiento.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <p className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-primary" /> Horarios de entrega</p>
          <div className="divide-y rounded-lg border">
            {DAY_ORDER.map(dayNumber => {
              const d = form.delivery_days.find(x => x.day === dayNumber) ?? { day: dayNumber, active: false, from: "08:00", to: "18:00" };
              return (
                <div key={dayNumber} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <Switch checked={d.active} onCheckedChange={v => setDay(dayNumber, { active: v })} aria-label={`Entregas el ${DAY_NAMES[dayNumber]}`} />
                  <span className={`w-24 text-sm ${d.active ? "font-medium" : "text-muted-foreground"}`}>{DAY_NAMES[dayNumber]}</span>
                  {d.active ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Input type="time" className="h-9 w-28" value={d.from} onChange={e => setDay(dayNumber, { from: e.target.value })} />
                      <span>a</span>
                      <Input type="time" className="h-9 w-28" value={d.to} onChange={e => setDay(dayNumber, { to: e.target.value })} />
                    </div>
                  ) : <span className="text-sm text-muted-foreground">Sin entregas</span>}
                </div>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Hora de corte</Label>
              <Input type="time" className="w-32" value={form.cutoff_time ?? ""} onChange={e => set({ cutoff_time: e.target.value || null })} />
              <p className="text-xs text-muted-foreground">Lo confirmado antes sale ese día; después, el siguiente día de entrega.</p>
            </div>
            <div className="space-y-3 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.no_holiday_delivery} onCheckedChange={v => set({ no_holiday_delivery: v })} /> No hay entregas en feriados
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.bot_always_on} onCheckedChange={v => set({ bot_always_on: v })} /> El bot atiende las 24 horas (recomendado)
              </label>
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <b>Vista previa:</b> si alguien confirma un pedido ahora, el bot dice que llega{" "}
            <b>{next ? next.replace(/^HOY/, "hoy").replace(/^MAÑANA/, "mañana") : "— (no hay días de entrega activos)"}</b>.
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
