import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Form = { dataset_id: string; access_token: string; enabled: boolean };
const STATUS_LABEL: Record<string, string> = {
  enviado: "Enviada a Meta (con clic del anuncio)", enviado_sin_anuncio: "Enviada a Meta (sin clic)", sin_anuncio: "Pendiente de reenviar", error: "Error",
};

/** Pestaña «Ventas a Meta»: cada venta registrada se informa a Meta (API de Conversiones). */
export function MetaCapiSettings({ workspaceId }: { workspaceId: string | null }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [testCode, setTestCode] = useState("");

  const { data } = useQuery({
    queryKey: ["meta-capi", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const [cfg, events] = await Promise.all([
        (supabase as any).from("workspace_meta_capi").select("dataset_id, access_token, enabled").eq("workspace_id", workspaceId).maybeSingle(),
        (supabase as any).from("meta_capi_events").select("order_id, status, detail, value, created_at").eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false }).limit(8),
      ]);
      if (cfg.error) throw cfg.error;
      return { saved: Boolean(cfg.data), cfg: cfg.data, events: (events.data ?? []) as any[] };
    },
  });
  useEffect(() => {
    if (data && !form) setForm({ dataset_id: data.cfg?.dataset_id ?? "", access_token: data.cfg?.access_token ?? "", enabled: data.cfg?.enabled !== false });
  }, [data, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !form) throw new Error("Sesión no válida");
      const datasetId = form.dataset_id.trim();
      if (datasetId && !/^\d{6,20}$/.test(datasetId)) throw new Error("El ID del conjunto de datos son solo números (lo copiás del Administrador de eventos).");
      const { error } = await (supabase as any).from("workspace_meta_capi").upsert({
        workspace_id: workspaceId, dataset_id: datasetId || null, access_token: form.access_token.trim() || null,
        enabled: form.enabled, updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id" });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["meta-capi"] }); toast.success("Guardado. Las próximas ventas se informan a Meta."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const link = useMutation({
    mutationFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch("/api/meta-capi/link", { method: "POST", headers: { Authorization: `Bearer ${session.session?.access_token ?? ""}` } });
      const result = await res.json().catch(() => null) as { ok?: boolean; datasetId?: string; message?: string; error?: string } | null;
      if (!res.ok || !result?.ok || !result.datasetId) throw new Error(result?.message ?? result?.error ?? "No se pudo obtener");
      return result;
    },
    onSuccess: (r) => {
      setForm(f => f ? { ...f, dataset_id: r.datasetId! } : f);
      queryClient.invalidateQueries({ queryKey: ["meta-capi"] });
      toast.success(r.message ?? "Listo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retry = useMutation({
    mutationFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch("/api/meta-capi/retry", { method: "POST", headers: { Authorization: `Bearer ${session.session?.access_token ?? ""}` } });
      const result = await res.json().catch(() => null) as { ok?: boolean; retried?: number; sent?: number; error?: string } | null;
      if (!res.ok || !result?.ok) throw new Error(result?.error ?? "No se pudo reenviar");
      return result;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["meta-capi"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(r.retried ? `Reenviadas ${r.sent} de ${r.retried} ventas pendientes.` : "No hay ventas pendientes de enviar.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch("/api/meta-capi/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token ?? ""}` },
        body: JSON.stringify({ testCode }),
      });
      const result = await res.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
      if (!res.ok || !result?.ok) throw new Error(result?.message ?? result?.error ?? "No se pudo enviar");
      return result.message ?? "Enviado";
    },
    onSuccess: (msg) => toast.success(msg),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!form) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>;

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div>
          <p className="font-semibold">Ventas a Meta</p>
          <p className="text-sm text-muted-foreground">
            Cada venta que el bot registra se informa a Meta. Así en el Administrador de anuncios ves cuántas ventas e ingresos trajo cada anuncio
            de WhatsApp, y podés optimizar campañas por compras. No hace falta ser partner de Meta.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>ID del conjunto de datos (dataset)</Label>
            <div className="flex flex-wrap gap-2">
              <Input className="min-w-[12rem] flex-1" inputMode="numeric" placeholder="Ej. 1234567890123456" value={form.dataset_id}
                onChange={e => setForm({ ...form, dataset_id: e.target.value })} />
              <Button type="button" variant="outline" disabled={link.isPending} onClick={() => link.mutate()}>
                {link.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Obtener el de mi WhatsApp
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Recomendado: tocá «Obtener el de mi WhatsApp». Meta exige el conjunto de datos vinculado a tu cuenta de WhatsApp Business
              (un píxel de tu web no sirve).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Token de acceso (opcional)</Label>
            <Input type="password" autoComplete="off" placeholder="Si lo dejás vacío se usa el token de WhatsApp" value={form.access_token}
              onChange={e => setForm({ ...form, access_token: e.target.value })} />
            <p className="text-xs text-muted-foreground">Token de un usuario del sistema con acceso a ese conjunto de datos.</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.enabled} onCheckedChange={v => setForm({ ...form, enabled: v })} /> Informar las ventas a Meta
        </label>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar
        </Button>

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-semibold">Probar la conexión</p>
          <p className="text-xs text-muted-foreground">En el Administrador de eventos abrí «Probar eventos», copiá el código (empieza con TEST) y pegalo acá.</p>
          <div className="flex flex-wrap gap-2">
            <Input className="w-48" placeholder="TEST12345" value={testCode} onChange={e => setTestCode(e.target.value)} />
            <Button variant="outline" disabled={test.isPending || !data?.saved} onClick={() => test.mutate()}>
              {test.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Enviar evento de prueba
            </Button>
          </div>
        </div>

        {!!data?.events.length && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Últimas ventas informadas</p>
              <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
                {retry.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Reenviar ventas pendientes
              </Button>
            </div>
            <div className="divide-y rounded-lg border text-sm">
              {data.events.map(e => (
                <div key={e.order_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="flex items-center gap-2">
                    {String(e.status).startsWith("enviado") ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className={`h-4 w-4 ${e.status === "error" ? "text-destructive" : "text-muted-foreground"}`} />}
                    {STATUS_LABEL[e.status] ?? e.status}
                  </span>
                  <span className="text-muted-foreground">Gs. {Math.round(Number(e.value) || 0).toLocaleString("es-PY")} · {new Date(e.created_at).toLocaleString("es-PY")}</span>
                  {e.status === "error" && e.detail && <p className="w-full text-xs text-destructive">{String(e.detail).slice(0, 200)}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
