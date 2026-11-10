import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { defaultSalesRules, normalizeSalesRules, type SalesRules } from "@/lib/sales-rules";

/** Una ficha: título, interruptor opcional y datos que aparecen al prenderla. */
function Ficha({ icon, title, hint, checked, onChange, children, alwaysShow }: {
  icon: string; title: string; hint: string; checked?: boolean; onChange?: (v: boolean) => void; children?: ReactNode; alwaysShow?: boolean;
}) {
  const showChildren = children && (onChange && !alwaysShow ? checked : true);
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{icon} {title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {onChange && (
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <span className={checked ? "font-semibold text-primary" : "text-muted-foreground"}>{checked ? "SÍ" : "NO"}</span>
            <Switch checked={Boolean(checked)} onCheckedChange={onChange} aria-label={title} />
          </div>
        )}
      </div>
      {showChildren && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
}

export function SalesRulesCards({ workspaceId, activeTrainingCount }: { workspaceId: string | null; activeTrainingCount: number }) {
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<SalesRules | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const autoImported = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ["sales-rules", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data: row, error } = await (supabase as any).from("workspace_sales_rules").select("rules").eq("workspace_id", workspaceId).maybeSingle();
      if (error) throw error;
      return { saved: Boolean(row), rules: row ? normalizeSalesRules(row.rules) : defaultSalesRules() };
    },
  });
  useEffect(() => { if (data && !rules) setRules(data.rules); }, [data, rules]);

  const importTraining = useMutation({
    mutationFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch("/api/sales-rules/import", {
        method: "POST", headers: { Authorization: `Bearer ${session.session?.access_token ?? ""}` },
      });
      const result = await response.json().catch(() => null) as { error?: string; rules?: SalesRules; source?: string } | null;
      if (!response.ok || !result?.rules) throw new Error(result?.error ?? "No se pudo leer tu entrenamiento");
      return result;
    },
    onSuccess: (result) => {
      setRules(normalizeSalesRules(result.rules));
      toast.success(result.source === "ia"
        ? "Completé las fichas con lo que tenías escrito. Revisalas y tocá «Guardar fichas»."
        : "No encontré entrenamiento escrito: completá las fichas a mano.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Primera vez: completar solas con lo que la tienda ya tiene escrito.
  useEffect(() => {
    if (data && !data.saved && activeTrainingCount > 0 && !autoImported.current) {
      autoImported.current = true;
      importTraining.mutate();
    }
  }, [data, activeTrainingCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !rules) throw new Error("Sesión no válida");
      if (rules.discounts.enabled && !rules.discounts.max_percent) throw new Error("Escribí el descuento máximo o apagá «Descuentos».");
      const { error } = await (supabase as any).from("workspace_sales_rules").upsert({
        workspace_id: workspaceId, rules: normalizeSalesRules(rules), updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-rules"] });
      toast.success("Fichas guardadas. El bot ya las usa en los próximos mensajes.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Sesión no válida");
      const { error } = await supabase.from("training_entries").update({ is_active: false } as never)
        .eq("workspace_id", workspaceId).eq("is_active", true);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training", workspaceId] });
      toast.success("Entrenamientos escritos pausados. Podés volver a activarlos cuando quieras.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !rules) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando fichas…</p>;
  }
  const set = <K extends keyof SalesRules>(key: K, value: SalesRules[K]) => setRules(r => r ? { ...r, [key]: value } : r);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Reglas de la tienda</p>
            <p className="text-sm text-muted-foreground">Prendé o apagá cada regla. Tienen prioridad sobre cualquier texto escrito.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={importTraining.isPending} onClick={() => importTraining.mutate()}>
              {importTraining.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1 h-4 w-4" />}
              Completar con mi entrenamiento
            </Button>
            <Button size="sm" disabled={save.isPending || importTraining.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar fichas
            </Button>
          </div>
        </div>

        {!data?.saved && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Todavía no guardaste las fichas{importTraining.isPending ? "; las estoy completando con tu entrenamiento…" : "."} El bot las usa recién cuando tocás <b>«Guardar fichas»</b>.</p>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <Ficha icon="🧾" alwaysShow title="Factura legal" hint="Si es SÍ, el bot pide el RUC solo a quien quiere factura."
            checked={rules.invoice.enabled} onChange={v => set("invoice", { enabled: v, pending: false })}>
            {!rules.invoice.enabled && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={Boolean(rules.invoice.pending)}
                  onChange={e => set("invoice", { enabled: false, pending: e.target.checked })} />
                Todavía no lo sé: el bot dice que lo consulta con el encargado
              </label>
            )}
          </Ficha>
          <Ficha icon="💳" title="Tarjeta de crédito" hint="Con link de pago. Nunca pide datos de la tarjeta."
            checked={rules.card.enabled} onChange={v => set("card", { ...rules.card, enabled: v })}>
            <Input placeholder="Link de pago (opcional)" value={rules.card.link} maxLength={500}
              onChange={e => set("card", { ...rules.card, link: e.target.value })} />
          </Ficha>
          <Ficha icon="📲" title="Pago con QR" hint="El cliente puede pagar escaneando un QR."
            checked={rules.qr.enabled} onChange={v => set("qr", { enabled: v })} />
          <Ficha icon="🪪" title="Cédula en encomienda" hint="Se pide el número de cédula de quien recibe, siempre después de confirmar el pedido."
            checked={rules.encomienda_ci.enabled} onChange={v => set("encomienda_ci", { enabled: v })} />
          <Ficha icon="📦" title="Catálogo al saludar" hint="Si el cliente saluda sin nombrar un producto, el bot le manda tu catálogo."
            checked={rules.catalog_on_greeting.enabled} onChange={v => set("catalog_on_greeting", { enabled: v })} />
          <Ficha icon="🏬" title="Retiro en local" hint="El cliente puede pasar a buscar su pedido."
            checked={rules.pickup.enabled} onChange={v => set("pickup", { ...rules.pickup, enabled: v })}>
            <Input placeholder="Dirección del local" value={rules.pickup.address} maxLength={300}
              onChange={e => set("pickup", { ...rules.pickup, address: e.target.value })} />
            <Input placeholder="Horario (ej. lunes a viernes de 8 a 17)" value={rules.pickup.hours} maxLength={120}
              onChange={e => set("pickup", { ...rules.pickup, hours: e.target.value })} />
          </Ficha>
          <Ficha icon="🔁" title="Cambios y garantía" hint="Si es NO, el bot no promete garantía."
            checked={rules.warranty.enabled} onChange={v => set("warranty", { ...rules.warranty, enabled: v })}>
            <Input type="number" min={1} placeholder="Días de garantía" value={rules.warranty.days ?? ""}
              onChange={e => set("warranty", { ...rules.warranty, days: e.target.value ? Number(e.target.value) : null })} />
            <Input placeholder="Condiciones (opcional)" value={rules.warranty.note} maxLength={300}
              onChange={e => set("warranty", { ...rules.warranty, note: e.target.value })} />
          </Ficha>
          <Ficha icon="💸" title="Descuentos" hint="Si es NO, el bot nunca baja el precio fuera de las promociones del catálogo."
            checked={rules.discounts.enabled} onChange={v => set("discounts", { ...rules.discounts, enabled: v })}>
            <div className="flex items-center gap-2 text-sm">
              Hasta <Input type="number" min={1} max={90} className="w-24" value={rules.discounts.max_percent ?? ""}
                onChange={e => set("discounts", { ...rules.discounts, max_percent: e.target.value ? Number(e.target.value) : null })} /> %
            </div>
          </Ficha>
          <Ficha icon="🛒" title="Venta mayorista" hint="Para quien compra en cantidad."
            checked={rules.wholesale.enabled} onChange={v => set("wholesale", { ...rules.wholesale, enabled: v })}>
            <Input type="number" min={2} placeholder="Desde cuántas unidades" value={rules.wholesale.min_qty ?? ""}
              onChange={e => set("wholesale", { ...rules.wholesale, min_qty: e.target.value ? Number(e.target.value) : null })} />
            <Input placeholder="Condiciones (opcional)" value={rules.wholesale.note} maxLength={300}
              onChange={e => set("wholesale", { ...rules.wholesale, note: e.target.value })} />
          </Ficha>
          <Ficha icon="👤" title="Pasar a una persona" hint="Cuándo el bot avisa que lo atiende alguien de la tienda."
            checked={rules.human_handoff.enabled} onChange={v => set("human_handoff", { ...rules.human_handoff, enabled: v })}>
            <Input placeholder="WhatsApp de la persona (opcional)" value={rules.human_handoff.phone} maxLength={40}
              onChange={e => set("human_handoff", { ...rules.human_handoff, phone: e.target.value })} />
            <Input placeholder="Cuándo (ej. reclamos o pedidos de más de 10 unidades)" value={rules.human_handoff.when} maxLength={200}
              onChange={e => set("human_handoff", { ...rules.human_handoff, when: e.target.value })} />
          </Ficha>
          <Ficha icon="📍" title="«¿De dónde son?»" hint="Cómo responde el bot si preguntan dónde está la tienda.">
            <Input placeholder="Ej. Somos una tienda online de Asunción, Paraguay" value={rules.store_location} maxLength={200}
              onChange={e => set("store_location", e.target.value)} />
          </Ficha>
          <Ficha icon="🚫" title="Producto que no vendemos" hint="Lo que responde el bot si piden algo que no está en tu catálogo.">
            <Textarea rows={2} value={rules.not_sold_message} maxLength={500}
              onChange={e => set("not_sold_message", e.target.value)} />
          </Ficha>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <b>El cierre de la venta es fijo</b> (pedir la ciudad, los datos según la modalidad, registrar el pedido y enviar «✅ PEDIDO CONFIRMADO»).
            Nombre de la tienda y horarios van en <b>Mi negocio</b>; ciudades en <b>Zonas de cobertura</b>; cuentas en <b>Datos bancarios</b>;
            precios, promociones y datos de cada producto en <b>Productos</b> (campo «Instrucciones específicas para la IA»).
          </p>
        </div>

        {data?.saved && activeTrainingCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <p>Tenés <b>{activeTrainingCount}</b> entrenamiento{activeTrainingCount === 1 ? "" : "s"} escrito{activeTrainingCount === 1 ? "" : "s"} activo{activeTrainingCount === 1 ? "" : "s"}. Con las fichas ya no hacen falta.</p>
            <Button variant="outline" size="sm" disabled={deactivate.isPending} onClick={() => setConfirmDeactivate(true)}>
              {deactivate.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Pausar entrenamientos escritos
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Pausar los entrenamientos escritos?</AlertDialogTitle>
            <AlertDialogDescription>
              El bot va a usar solo las fichas y las otras pestañas. No se borra nada: podés volver a activarlos uno por uno.
              Si alguno tiene datos de un producto (talles, modo de uso…), copialos antes en Productos → «Instrucciones específicas para la IA».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivate.mutate()}>Pausar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
