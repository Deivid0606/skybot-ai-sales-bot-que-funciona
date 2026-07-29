import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAYMENT_STATES, DEPARTAMENTOS_PY, resolveDepartamento } from "@/lib/orders";
import type { Tables } from "@/integrations/supabase/types";

type Order = Tables<"orders">;

type Props = {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OrderEditDialog({ order, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(order);

  useEffect(() => {
    if (open) setForm(order);
  }, [open, order]);

  const set = <K extends keyof Order>(key: K, value: Order[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const quantity = Number(form.quantity) || 1;
      const price = Number(form.price) || 0;
      const { error } = await supabase
        .from("orders")
        .update({
          customer_name: form.customer_name,
          phone: form.phone,
          city: form.city,
          departamento: form.departamento,
          street: form.street,
          district: form.district,
          reference: form.reference,
          product_title: form.product_title,
          sku: form.sku,
          quantity,
          price,
          total: quantity * price,
          payment_method: form.payment_method,
          payment_status: form.payment_status,
          observations: form.observations,
        })
        .eq("id", order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido actualizado");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar pedido {order.order_number}</DialogTitle>
          <DialogDescription>Actualizá los datos del cliente y del producto.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Input value={form.customer_name ?? ""} onChange={(e) => set("customer_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Teléfono</Label>
            <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Ciudad</Label>
            <Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Departamento</Label>
            <Select
              value={resolveDepartamento(form.departamento, form.city) || undefined}
              onValueChange={(v) => set("departamento", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccioná el departamento" />
              </SelectTrigger>
              <SelectContent>
                {DEPARTAMENTOS_PY.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Calle</Label>
            <Input value={form.street ?? ""} onChange={(e) => set("street", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Barrio</Label>
            <Input value={form.district ?? ""} onChange={(e) => set("district", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Referencia</Label>
            <Input value={form.reference ?? ""} onChange={(e) => set("reference", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Producto</Label>
            <Input value={form.product_title ?? ""} onChange={(e) => set("product_title", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>SKU</Label>
            <Input value={form.sku ?? ""} onChange={(e) => set("sku", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Cantidad</Label>
            <Input
              type="number"
              min={1}
              value={form.quantity ?? 1}
              onChange={(e) => set("quantity", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Precio (₲)</Label>
            <Input
              type="number"
              min={0}
              value={form.price ?? 0}
              onChange={(e) => set("price", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Forma de pago</Label>
            <Input value={form.payment_method ?? ""} onChange={(e) => set("payment_method", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Estado del pago</Label>
            <Select
              value={form.payment_status}
              onValueChange={(v) => set("payment_status", v as Order["payment_status"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_STATES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Observaciones</Label>
            <Textarea
              rows={3}
              value={form.observations ?? ""}
              onChange={(e) => set("observations", e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
