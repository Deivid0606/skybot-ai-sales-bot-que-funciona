import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/datos-bancarios")({
  head: () => ({
    meta: [
      { title: "Datos bancarios — BOT SKY" },
      { name: "description", content: "Cuentas para pagos anticipados y encomiendas." },
    ],
  }),
  component: BankPage,
});

type Account = {
  id?: string; bank: string; holder: string; account_number: string; alias: string;
  document: string; note: string; active: boolean; sort_order: number;
};
const EMPTY: Account = { bank: "", holder: "", account_number: "", alias: "", document: "", note: "", active: true, sort_order: 0 };

function BankPage() {
  const { profile } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Account | null>(null);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["workspace-bank-accounts", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("workspace_bank_accounts")
        .select("id, bank, holder, account_number, alias, document, note, active, sort_order")
        .eq("workspace_id", workspaceId).order("sort_order").order("created_at");
      if (error) throw error;
      return (data ?? []).map((a: any) => ({ ...EMPTY, ...a, account_number: a.account_number ?? "", alias: a.alias ?? "",
        document: a.document ?? "", note: a.note ?? "" })) as Account[];
    },
  });

  const save = useMutation({
    mutationFn: async (a: Account) => {
      if (!workspaceId) throw new Error("Sesión no válida");
      if (!a.bank.trim() || !a.holder.trim()) throw new Error("Completá el banco y el titular.");
      if (!a.account_number.trim() && !a.alias.trim()) throw new Error("Cargá el número de cuenta o el alias.");
      const payload = {
        workspace_id: workspaceId, bank: a.bank.trim(), holder: a.holder.trim(),
        account_number: a.account_number.trim() || null, alias: a.alias.trim() || null,
        document: a.document.trim() || null, note: a.note.trim() || null, active: a.active,
        sort_order: a.sort_order || (accounts?.length ?? 0), updated_at: new Date().toISOString(),
      };
      const query = a.id
        ? (supabase as any).from("workspace_bank_accounts").update(payload).eq("id", a.id).eq("workspace_id", workspaceId)
        : (supabase as any).from("workspace_bank_accounts").insert(payload);
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["workspace-bank-accounts"] });
      toast.success("Datos bancarios guardados. El bot los usa solo en encomienda o pago anticipado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (a: Account) => {
      const { error } = await (supabase as any).from("workspace_bank_accounts")
        .update({ active: !a.active, updated_at: new Date().toISOString() }).eq("id", a.id).eq("workspace_id", workspaceId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-bank-accounts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (a: Account) => {
      const { error } = await (supabase as any).from("workspace_bank_accounts").delete().eq("id", a.id).eq("workspace_id", workspaceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-bank-accounts"] });
      toast.success("Cuenta eliminada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const field = (key: keyof Account, label: string, placeholder = "") => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={String(form?.[key] ?? "")} placeholder={placeholder} maxLength={120}
        onChange={e => setForm(f => f ? { ...f, [key]: e.target.value } : f)} />
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title="Datos bancarios"
        description="Cuentas para pagos anticipados y encomiendas. El bot las muestra SOLO cuando la venta es por encomienda o pago anticipado, nunca en contraentrega."
        actions={!form && (
          <Button onClick={() => setForm({ ...EMPTY })}><Plus className="mr-2 h-4 w-4" /> Agregar cuenta</Button>
        )}
      />

      {form && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="font-semibold">{form.id ? "Editar cuenta" : "Nueva cuenta"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {field("bank", "Banco", "Ej. Banco Itaú")}
              {field("holder", "Titular", "Nombre del titular")}
              {field("account_number", "Número de cuenta", "Ej. 123456789")}
              {field("alias", "Alias", "Ej. 0981 123 456 o CI")}
              {field("document", "Cédula o RUC del titular", "Ej. 4.567.890")}
              {field("note", "Nota para el cliente", "Ej. Enviá la captura del comprobante por este chat")}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.active} onCheckedChange={v => setForm(f => f ? { ...f, active: v } : f)} /> Cuenta activa
            </label>
            <div className="flex gap-2">
              <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
              </Button>
              <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : !accounts?.length ? (
        !form && <EmptyState title="Todavía no cargaste cuentas" description="Mientras no cargues una, el bot usa los datos bancarios escritos en tu entrenamiento." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map(a => (
            <Card key={a.id} className={a.active ? "" : "opacity-60"}>
              <CardContent className="space-y-1 p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-primary" /> {a.bank}</p>
                  <Switch checked={a.active} onCheckedChange={() => toggle.mutate(a)} aria-label="Cuenta activa" />
                </div>
                <p>👤 {a.holder}</p>
                {a.account_number && <p>🔢 Cuenta: {a.account_number}</p>}
                {a.alias && <p>🔑 Alias: {a.alias}</p>}
                {a.document && <p>🪪 CI/RUC: {a.document}</p>}
                {a.note && <p className="text-muted-foreground">📝 {a.note}</p>}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => setForm(a)}><Pencil className="mr-1 h-3.5 w-3.5" /> Editar</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                    if (confirm(`¿Eliminar la cuenta de ${a.bank}?`)) remove.mutate(a);
                  }}><Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
