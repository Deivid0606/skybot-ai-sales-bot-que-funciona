import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Copy,
  Download,
  Eye,
  FileText,
  History,
  MessageSquare,
  Pencil,
  ShoppingCart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedUrl } from "@/lib/storage";
import { formatDate, formatGs, formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContactInfoDialog } from "@/components/contact-info-dialog";
import { OrderEditDialog } from "@/components/order-edit-dialog";
import { ORDER_STATES, ORDER_TAGS, orderStateLabel, buildEcommerceUrl } from "@/lib/orders";
import type { Tables } from "@/integrations/supabase/types";

type Order = Tables<"orders">;

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm">{value === null || value === undefined || value === "" ? "—" : value}</p>
    </div>
  );
}

export function OrderCard({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  // Una compra con varias presentaciones no puede exportarse como un SKU único.
  const isMixedVariantOrder = String(order.observations ?? "").includes(
    "MULTIVARIANTE (MISMO PRODUCTO)",
  );

  const { data: preview } = useQuery({
    queryKey: ["order-chat-preview", order.conversation_id],
    enabled: chatOpen && Boolean(order.conversation_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, body, sender, direction, created_at")
        .eq("conversation_id", order.conversation_id!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data.reverse();
    },
  });

  const changeStatus = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await supabase
        .from("orders")
        .update({ status: value as Order["status"] })
        .eq("id", order.id);
      if (error) throw error;
      await supabase.from("order_status_history").insert({
        workspace_id: order.workspace_id,
        order_id: order.id,
        user_id: order.user_id,
        status: value as Order["status"],
      });
    },
    onSuccess: () => {
      toast.success("Estado actualizado");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTag = useMutation({
    mutationFn: async (tag: string) => {
      const tags = order.tags.includes(tag)
        ? order.tags.filter((t) => t !== tag)
        : [...order.tags, tag];
      const { error } = await supabase.from("orders").update({ tags }).eq("id", order.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  async function openReceipt(download = false) {
    if (!order.receipt_url) {
      toast.error("Este pedido no tiene comprobante");
      return;
    }
    try {
      let url: string;

      if (order.receipt_url.startsWith("http")) {
        url = order.receipt_url;
      } else {
        /*
         * Los comprobantes recibidos por WhatsApp quedan guardados en chat-media.
         * Mantenemos fallback a receipts para comprobantes antiguos/subidos manualmente.
         */
        try {
          const { data, error } = await supabase.storage
            .from("chat-media")
            .createSignedUrl(order.receipt_url, 60 * 60);

          if (error || !data?.signedUrl) {
            throw error ?? new Error("No se pudo generar la URL del comprobante");
          }

          url = data.signedUrl;
        } catch {
          url = await getSignedUrl("receipts", order.receipt_url);
        }
      }
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `comprobante-${order.order_number}`;
        a.target = "_blank";
        a.click();
      } else {
        setReceiptUrl(url);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function copyData() {
    const text = [
      `Pedido: ${order.order_number}`,
      `Cliente: ${order.customer_name}`,
      `Teléfono: ${order.phone}`,
      `Ciudad: ${order.city ?? "—"} / ${order.departamento ?? "—"}`,
      `Dirección: ${order.street ?? "—"}, ${order.district ?? "—"}`,
      `Referencia: ${order.reference ?? "—"}`,
      `Producto: ${order.product_title ?? "—"} (${order.sku ?? "s/ SKU"}) x${order.quantity}`,
      `Precio: ${formatGs(order.price)}`,
      `Total: ${formatGs(order.total)}`,
      `Pago: ${order.payment_method ?? "—"} (${order.payment_status})`,
      `Observaciones: ${order.observations ?? "—"}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Datos copiados");
  }

  function sendToEcommerce() {
    if (isMixedVariantOrder) {
      toast.error("Este pedido contiene varias presentaciones. Cargá cada variante por separado en E-commerce para evitar productos o cantidades incorrectos.");
      return;
    }
    const url = buildEcommerceUrl(order);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("Abriendo Ecommerce con los datos del pedido");
    if (!order.tags.includes("Ecommerce")) toggleTag.mutate("Ecommerce");
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-semibold">{order.order_number}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(order.created_at)} · {formatTime(order.created_at)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-display text-lg font-bold">{formatGs(order.total)}</p>
            <Badge variant={order.payment_status === "pagado" ? "default" : "outline"}>
              {order.payment_status}
            </Badge>
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field label="Cliente" value={order.customer_name} />
          <Field label="Teléfono" value={order.phone} />
          <Field label="Ciudad" value={order.city} />
          <Field label="Departamento" value={order.departamento} />
          <Field label="Calle" value={order.street} />
          <Field label="Barrio" value={order.district} />
          <Field label="Referencia" value={order.reference} />
          <Field label="Producto" value={order.product_title} />
          <Field label="SKU" value={order.sku} />
          <Field label="Cantidad" value={order.quantity} />
          <Field label="Precio" value={formatGs(order.price)} />
          <Field label="Forma de pago" value={order.payment_method} />
          <Field label="Anuncio" value={order.ad_id} />
          <Field label="Comprobante" value={order.receipt_url ? "Sí" : "No"} />
        </div>

        {order.observations && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-semibold text-foreground">Observaciones y detalle del pedido</p>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{order.observations}</p>
          </div>
        )}
        {isMixedVariantOrder && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Este pedido contiene más de una presentación: cargá cada variante manualmente en E-commerce.
          </p>
        )}

        <div className="flex flex-wrap gap-1">
          {ORDER_TAGS.map((t) => {
            const on = order.tags.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTag.mutate(t)}
                className={
                  on
                    ? "rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground"
                    : "rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                }
              >
                {t}
              </button>
            );
          })}
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <Select value={order.status} onValueChange={(v) => changeStatus.mutate(v)}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {orderStateLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" onClick={sendToEcommerce} disabled={isMixedVariantOrder} title={isMixedVariantOrder ? "Variantes mezcladas: cargar manualmente en E-commerce" : "Cargar a E-commerce"}>
            <ShoppingCart className="mr-1 h-4 w-4" /> Ecommerce
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              order.conversation_id
                ? navigate({ to: "/inbox", search: { c: order.conversation_id } })
                : toast.error("Este pedido no tiene chat asociado")
            }
          >
            <MessageSquare className="mr-1 h-4 w-4" /> Abrir chat
          </Button>
          <Button size="sm" variant="outline" onClick={() => setChatOpen(true)}>
            <Eye className="mr-1 h-4 w-4" /> Vista previa
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openReceipt(false)}
            className={
              order.receipt_url
                ? "border-emerald-600 bg-emerald-600 text-white hover:border-emerald-700 hover:bg-emerald-700 hover:text-white"
                : undefined
            }
          >
            <FileText className="mr-1 h-4 w-4" /> Comprobante
          </Button>
          <Button size="sm" variant="outline" onClick={() => openReceipt(true)}>
            <Download className="mr-1 h-4 w-4" /> Descargar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1 h-4 w-4" /> Editar
          </Button>
          <Button size="sm" variant="outline" onClick={copyData}>
            <Copy className="mr-1 h-4 w-4" /> Copiar datos
          </Button>
          <Button size="sm" variant="outline" onClick={() => setInfoOpen(true)}>
            <History className="mr-1 h-4 w-4" /> Historial
          </Button>
        </div>
      </CardContent>

      <OrderEditDialog order={order} open={editOpen} onOpenChange={setEditOpen} />
      <ContactInfoDialog contactId={order.contact_id} open={infoOpen} onOpenChange={setInfoOpen} />

      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Conversación de origen</DialogTitle>
            <DialogDescription>
              {order.customer_name} · {order.phone}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-96 pr-2">
            <div className="flex flex-col gap-2">
              {!preview?.length && (
                <p className="text-sm text-muted-foreground">Sin mensajes para mostrar.</p>
              )}
              {preview?.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.direction === "inbound"
                      ? "max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm"
                      : "max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className="mt-1 text-[10px] opacity-70">{formatTime(m.created_at)}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(receiptUrl)} onOpenChange={(o) => !o && setReceiptUrl(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Comprobante</DialogTitle>
            <DialogDescription>Pedido {order.order_number}</DialogDescription>
          </DialogHeader>
          {receiptUrl && (
            receiptUrl.toLowerCase().includes(".pdf") ? (
              <iframe
                src={receiptUrl}
                title={`Comprobante del pedido ${order.order_number}`}
                className="h-[70vh] w-full rounded-lg border"
              />
            ) : (
              <img
                src={receiptUrl}
                alt={`Comprobante del pedido ${order.order_number}`}
                className="max-h-[70vh] w-full rounded-lg object-contain"
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
