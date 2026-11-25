import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from "lucide-react";
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
import { CityPicker } from "@/components/city-picker";
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
import { retryOrderLoadNow } from "@/lib/product-share.functions";

type Order = Tables<"orders"> & {order_items?: Array<{id:string;title:string;sku:string|null;quantity:number;price:number}>;
  unit_price?: number | null; ecommerce_synced_at?: string | null; dcanp_order_number?: string | null};

type Props = {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Una línea del pedido mientras se edita. `id` vacío = línea nueva. */
type Line = { key: string; id: string | null; product_id: string | null; title: string; sku: string; quantity: number; price: number };

type CatalogProduct = { id: string; name: string; sku: string | null; price: number;
  product_prices?: Array<{ id: string; label: string; quantity: number; price: number; sort_order: number }> };

const PAYMENT_METHODS = ["contraentrega", "anticipado", "transferencia"];
const gs = (n: number) => `₲ ${Math.round(n || 0).toLocaleString("es-PY")}`;
let keySeq = 0;
const newKey = () => `l${Date.now()}_${keySeq++}`;

export function OrderEditDialog({ order, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(order);
  const [lines, setLines] = useState<Line[]>([]);
  const [loadedIds, setLoadedIds] = useState<string[]>([]);

  // Líneas actuales (con product_id) leídas al abrir, para no trabajar con una copia vieja.
  const itemsQuery = useQuery({
    queryKey: ["order-edit-items", order.id, open],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("order_items")
        .select("id,product_id,title,sku,quantity,price").eq("order_id", order.id).order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const productsQuery = useQuery({
    queryKey: ["order-edit-products", order.workspace_id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("products")
        .select("id,name,sku,price,product_prices(id,label,quantity,price,sort_order)")
        .eq("workspace_id", order.workspace_id).order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CatalogProduct[];
    },
  });

  useEffect(() => {
    if (open) setForm(order);
  }, [open, order]);

  useEffect(() => {
    if (!open || !itemsQuery.data) return;
    const rows = itemsQuery.data;
    setLoadedIds(rows.map(r => r.id));
    setLines(rows.length
      ? rows.map(r => ({ key: newKey(), id: r.id, product_id: r.product_id ?? null, title: r.title, sku: r.sku ?? "",
          quantity: Number(r.quantity) || 1, price: Number(r.price) || 0 }))
      // Pedido antiguo sin líneas: se arma una con los datos del pedido.
      : [{ key: newKey(), id: null, product_id: order.product_id ?? null, title: order.product_title ?? "", sku: order.sku ?? "",
          quantity: Number(order.quantity) || 1,
          price: Number(order.unit_price ?? 0) || (Number(order.quantity) ? Number(order.total ?? order.price ?? 0) / Number(order.quantity) : Number(order.price ?? 0)) }]);
  }, [open, itemsQuery.data, order]);

  const set = <K extends keyof Order>(key: K, value: Order[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const pickProduct = (key: string, productId: string) => {
    const p = productsQuery.data?.find(x => x.id === productId);
    if (!p) return;
    const first = (p.product_prices ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)[0];
    const unit = first ? Number(first.price) / Math.max(1, Number(first.quantity) || 1) : Number(p.price) || 0;
    setLine(key, { product_id: p.id, title: p.name, sku: p.sku ?? "", price: Math.round(unit) });
  };

  const totals = useMemo(() => {
    const quantity = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
    const total = lines.reduce((n, l) => n + (Number(l.quantity) || 0) * (Number(l.price) || 0), 0);
    return { quantity, total };
  }, [lines]);

  const loadedToEcommerce = Boolean(order.ecommerce_synced_at || order.dcanp_order_number);

  const save = useMutation({
    mutationFn: async () => {
      const valid = lines.filter(l => l.title.trim());
      if (!valid.length) throw new Error("El pedido necesita al menos un artículo con nombre");
      if (valid.some(l => !(Number(l.quantity) >= 1))) throw new Error("La cantidad de cada artículo tiene que ser 1 o más");
      if (valid.some(l => !(Number(l.price) >= 0))) throw new Error("Revisá los precios: no pueden ser negativos");

      // 1) Artículos: borrar los quitados, actualizar los existentes y crear los nuevos.
      const keptIds = valid.filter(l => l.id).map(l => l.id as string);
      const removed = loadedIds.filter(id => !keptIds.includes(id));
      if (removed.length) {
        const { error } = await supabase.from("order_items").delete().in("id", removed).eq("order_id", order.id);
        if (error) throw error;
      }
      for (const l of valid.filter(x => x.id)) {
        const { error } = await supabase.from("order_items").update({
          product_id: l.product_id, title: l.title.trim(), sku: l.sku.trim() || null,
          quantity: Math.round(Number(l.quantity)), price: Number(l.price),
        }).eq("id", l.id as string).eq("order_id", order.id);
        if (error) throw error;
      }
      const fresh = valid.filter(x => !x.id);
      if (fresh.length) {
        const { error } = await supabase.from("order_items").insert(fresh.map(l => ({
          order_id: order.id, workspace_id: order.workspace_id, user_id: order.user_id,
          product_id: l.product_id, title: l.title.trim(), sku: l.sku.trim() || null,
          quantity: Math.round(Number(l.quantity)), price: Number(l.price),
        })));
        if (error) throw error;
      }

      // 2) Pedido: datos del cliente + resumen calculado de los artículos.
      const first = valid[0];
      const quantity = valid.reduce((n, l) => n + Math.round(Number(l.quantity)), 0);
      const total = valid.reduce((n, l) => n + Math.round(Number(l.quantity)) * Number(l.price), 0);
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
          product_id: first.product_id ?? order.product_id,
          product_title: valid.length === 1 ? first.title.trim() : valid.map(l => l.title.trim()).join(" + "),
          sku: first.sku.trim() || null,
          quantity,
          unit_price: valid.length === 1 ? Number(first.price) : null,
          price: valid.length === 1 ? Number(first.price) : total,
          total,
          payment_method: form.payment_method,
          payment_status: form.payment_status,
          observations: form.observations,
          // Datos corregidos (p. ej. el SKU): el error anterior ya no vale y se reintenta al instante.
          ...(!loadedToEcommerce ? { ecommerce_sync_error: null, ecommerce_sync_attempted_at: null } : {}),
        } as any)
        .eq("id", order.id);
      if (error) throw error;
      if (!loadedToEcommerce && ["nuevo", "confirmado"].includes(String(order.status))) {
        try {
          return await retryOrderLoadNow({ data: { orderId: order.id } });
        } catch {
          return null;
        }
      }
      return null;
    },
    onSuccess: (retry: any) => {
      toast.success(loadedToEcommerce
        ? "Pedido actualizado. Ya estaba cargado en el E-commerce: aplicá el mismo cambio allá."
        : retry?.loaded ? "Pedido actualizado y cargado en el E-commerce ✅"
        : retry?.failed ? "Pedido actualizado, pero el E-commerce lo rechazó: mirá el error en el pedido."
        : "Pedido actualizado");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order-edit-items", order.id] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const products = productsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar pedido {order.order_number}</DialogTitle>
          <DialogDescription>Podés cambiar todos los datos: cliente, dirección, artículos, cantidades, precios y pago. El total se calcula solo.</DialogDescription>
        </DialogHeader>

        {loadedToEcommerce && (
          <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p>Este pedido ya está cargado en el E-commerce{order.dcanp_order_number ? ` (${order.dcanp_order_number})` : ""}. Los cambios se guardan acá, pero allá hay que hacerlos a mano.</p>
          </div>
        )}

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
            <CityPicker value={form.city ?? ""} onChange={(city, dept) => { set("city", city); if (dept) set("departamento", dept); }} />
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

          <div className="space-y-2 rounded-lg border p-3 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Artículos del pedido</p>
              <Button type="button" size="sm" variant="outline"
                onClick={() => setLines(prev => [...prev, { key: newKey(), id: null, product_id: null, title: "", sku: "", quantity: 1, price: 0 }])}>
                <Plus className="mr-1 h-4 w-4" /> Agregar artículo
              </Button>
            </div>
            {itemsQuery.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando artículos…</p>
            ) : lines.map((l, i) => (
              <div key={l.key} className="space-y-2 rounded-md bg-muted/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Artículo {i + 1}</span>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={lines.length <= 1}
                    title="Quitar artículo" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {products.length > 0 && (
                  <Select value={l.product_id && products.some(p => p.id === l.product_id) ? l.product_id : undefined}
                    onValueChange={(v) => pickProduct(l.key, v)}>
                    <SelectTrigger><SelectValue placeholder="Elegir producto del catálogo (opcional)" /></SelectTrigger>
                    <SelectContent>
                      {products.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="grid gap-2 sm:grid-cols-[2fr_1.4fr_0.7fr_1fr]">
                  <div className="space-y-1">
                    <Label className="text-xs">Producto</Label>
                    <Input value={l.title} onChange={(e) => setLine(l.key, { title: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">SKU</Label>
                    <Input value={l.sku} onChange={(e) => setLine(l.key, { sku: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cantidad</Label>
                    <Input type="number" min={1} value={l.quantity}
                      onChange={(e) => setLine(l.key, { quantity: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Precio unitario (₲)</Label>
                    <Input type="number" min={0} value={l.price}
                      onChange={(e) => setLine(l.key, { price: Number(e.target.value) })} />
                  </div>
                </div>
                <p className="text-right text-xs text-muted-foreground">Subtotal: {gs((Number(l.quantity) || 0) * (Number(l.price) || 0))}</p>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-sm font-semibold">
              <span>Cantidad total: {totals.quantity}</span>
              <span>Total: {gs(totals.total)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Forma de pago</Label>
            <Select value={form.payment_method ?? undefined} onValueChange={(v) => set("payment_method", v)}>
              <SelectTrigger><SelectValue placeholder="Elegí la forma de pago" /></SelectTrigger>
              <SelectContent>
                {[...new Set([...PAYMENT_METHODS, ...(form.payment_method ? [form.payment_method] : [])])].map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Button onClick={() => save.mutate()} disabled={save.isPending || itemsQuery.isLoading}>
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
