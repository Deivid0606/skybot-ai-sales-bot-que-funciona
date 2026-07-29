import { useState } from "react";
import { formatGs } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Edit, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deletePlan, savePlan } from "@/lib/plans.functions";

export const Route = createFileRoute("/_authenticated/admin/planes")({
  head: () => ({
    meta: [
      { title: "Planes — BOT SKY Admin" },
      { name: "description", content: "Crea y edita los planes de conversaciones disponibles para los vendedores." },
      { property: "og:title", content: "Planes — BOT SKY Admin" },
      { property: "og:description", content: "Gestión de planes de recarga de BOT SKY." },
    ],
  }),
  component: AdminPlansPage,
});

const emptyPlan = {
  id: "",
  name: "",
  price: "",
  conversations: "",
  duration_days: "",
  benefits: "",
  is_active: true,
};

function AdminPlansPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyPlan);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").order("price");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        id: form.id || undefined,
        name: form.name.trim(),
        price: Number(form.price),
        conversations: Number(form.conversations),
        duration_days: Number(form.duration_days),
        benefits: form.benefits
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean)
          .slice(0, 10),
        is_active: form.is_active,
      };
      await savePlan({ data: payload });
    },
    onSuccess: () => {
      toast.success(form.id ? "Plan actualizado" : "Plan creado");
      setDialogOpen(false);
      setForm(emptyPlan);
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deletePlan({ data: { id } });
    },
    onSuccess: () => {
      toast.success("Plan eliminado");
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = () => {
    setForm(emptyPlan);
    setDialogOpen(true);
  };

  const openEdit = (plan: NonNullable<typeof plans>[number]) => {
    setForm({
      id: plan.id,
      name: plan.name,
      price: String(plan.price),
      conversations: String(plan.conversations),
      duration_days: String(plan.duration_days),
      benefits: (plan.benefits ?? []).join("\n"),
      is_active: plan.is_active,
    });
    setDialogOpen(true);
  };

  const isValid =
    form.name.trim() &&
    Number(form.price) >= 0 &&
    Number(form.conversations) >= 1 &&
    Number(form.duration_days) >= 1;

  return (
    <PageShell>
      <PageHeader
        title="Planes"
        description="Define los planes de conversaciones que los vendedores pueden comprar."
        actions={
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo plan
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !plans?.length ? (
        <EmptyState
          title="Sin planes"
          description="Crea el primer plan para que los vendedores puedan recargar saldo."
          action={
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> Crear plan
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className={plan.is_active ? "" : "opacity-70"}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                    <p className="font-display text-2xl font-bold text-primary">
                      {formatGs(plan.price)}
                    </p>
                  </div>
                  <Badge variant={plan.is_active ? "default" : "secondary"}>
                    {plan.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {plan.conversations} conversaciones · {plan.duration_days} días
                </p>
                <ul className="space-y-1 text-sm">
                  {(plan.benefits ?? []).map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(plan)}>
                    <Edit className="mr-1.5 h-4 w-4" /> Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-3 text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm("¿Eliminar este plan?")) remove.mutate(plan.id);
                    }}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar plan" : "Nuevo plan"}</DialogTitle>
            <DialogDescription>
              Completa los datos del plan. Los beneficios se escriben uno por línea.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Plan 100 conversaciones"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="price">Precio (₲)</Label>
                <Input
                  id="price"
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conversations">Conversaciones</Label>
                <Input
                  id="conversations"
                  type="number"
                  min={1}
                  value={form.conversations}
                  onChange={(e) => setForm({ ...form, conversations: e.target.value })}
                  placeholder="100"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="duration_days">Duración (días)</Label>
              <Input
                id="duration_days"
                type="number"
                min={1}
                value={form.duration_days}
                onChange={(e) => setForm({ ...form, duration_days: e.target.value })}
                placeholder="30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="benefits">Beneficios (uno por línea)</Label>
              <Textarea
                id="benefits"
                value={form.benefits}
                onChange={(e) => setForm({ ...form, benefits: e.target.value })}
                placeholder="Soporte prioritario&#10;Sin límite de productos"
                rows={4}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="is_active"
                checked={form.is_active}
                onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
              />
              <Label htmlFor="is_active" className="cursor-pointer">
                Plan activo
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={!isValid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {form.id ? "Guardar cambios" : "Crear plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
