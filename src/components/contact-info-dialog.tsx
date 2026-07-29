import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { formatDate, formatGs } from "@/lib/format";

type Props = {
  contactId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ContactInfoDialog({ contactId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [notes, setNotes] = useState("");

  const { data: contact } = useQuery({
    queryKey: ["contact", contactId],
    enabled: Boolean(contactId) && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", contactId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: orders } = useQuery({
    queryKey: ["contact-orders", contactId],
    enabled: Boolean(contactId) && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, product_title, total, status, created_at")
        .eq("contact_id", contactId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setName(contact?.name ?? "");
    setCity(contact?.city ?? "");
    setNotes(contact?.notes ?? "");
  }, [contact?.id, contact?.name, contact?.city, contact?.notes]);

  const save = useMutation({
    mutationFn: async () => {
      if (!contactId) return;
      const { error } = await supabase
        .from("contacts")
        .update({ name: name.trim() || null, city: city.trim() || null, notes: notes.trim() || null })
        .eq("id", contactId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contacto actualizado");
      queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const purchases = orders?.filter((o) => o.status !== "cancelado") ?? [];
  const spent = purchases.reduce((acc, o) => acc + Number(o.total ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Información del contacto</DialogTitle>
          <DialogDescription>
            {contact?.phone ? `+${contact.phone.replace(/^\+/, "")}` : "Datos del cliente"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Teléfono</Label>
            <Input value={contact?.phone ?? ""} readOnly />
          </div>
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" />
          </div>
          <div className="space-y-1.5">
            <Label>Ciudad</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Asunción" />
          </div>
          <div className="space-y-1.5">
            <Label>Cliente desde</Label>
            <Input value={contact ? formatDate(contact.created_at) : ""} readOnly />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Otros datos / notas</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Dirección, referencias, preferencias..."
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border p-3 text-center">
          <div>
            <p className="text-lg font-semibold">{purchases.length}</p>
            <p className="text-xs text-muted-foreground">Compras</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{formatGs(spent)}</p>
            <p className="text-xs text-muted-foreground">Total gastado</p>
          </div>
          <div>
            <p className="text-lg font-semibold">
              {purchases[0] ? formatDate(purchases[0].created_at) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">Última compra</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Historial de pedidos</Label>
          {!orders?.length && (
            <p className="text-sm text-muted-foreground">Todavía no hizo compras.</p>
          )}
          {orders?.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{o.product_title ?? "Pedido"}</p>
                <p className="text-xs text-muted-foreground">
                  #{o.order_number} · {formatDate(o.created_at)}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {o.status}
              </Badge>
              <span className="font-medium">{formatGs(o.total)}</span>
            </div>
          ))}
        </div>

        <DialogFooter>
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
