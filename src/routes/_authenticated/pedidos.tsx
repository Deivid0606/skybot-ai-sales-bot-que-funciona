import { useState } from "react";
import { formatDate, formatDateTime, formatGs } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspaceId } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/pedidos")({
  head: () => ({
    meta: [
      { title: "Pedidos — BOT SKY" },
      { name: "description", content: "Gestiona los pedidos generados automáticamente por tu IA." },
      { property: "og:title", content: "Pedidos — BOT SKY" },
      { property: "og:description", content: "Pedidos, estados de pago y exportación a CSV." },
    ],
  }),
  component: OrdersPage,
});

const statuses = ["nuevo", "confirmado", "enviado", "entregado", "cancelado"] as const;
const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  nuevo: "secondary",
  confirmado: "default",
  enviado: "default",
  entregado: "default",
  cancelado: "destructive",
};

function OrdersPage() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");

  const { data: orders } = useQuery({
    queryKey: ["orders", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const { error } = await supabase
        .from("orders")
        .update({ status: value as (typeof statuses)[number] })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Estado actualizado");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (orders ?? []).filter((o) => {
    const matchStatus = status === "todos" || o.status === status;
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      o.customer_name.toLowerCase().includes(q) ||
      o.phone.includes(q) ||
      o.order_number.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  function exportCsv() {
    const rows = [
      [
        "Pedido",
        "Fecha",
        "Cliente",
        "Teléfono",
        "Producto",
        "Cantidad",
        "Total",
        "Ciudad",
        "Dirección",
        "Pago",
        "Estado",
      ],
      ...filtered.map((o) => [
        o.order_number,
        formatDateTime(o.created_at),
        o.customer_name,
        o.phone,
        o.product_title ?? "",
        o.quantity,
        o.total,
        o.city ?? "",
        o.street ?? "",
        o.payment_method ?? "",
        o.status,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PageShell>
      <PageHeader
        title="Pedidos"
        description="Cada venta cerrada por la IA se registra automáticamente aquí."
        actions={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-1 h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por cliente, teléfono o número"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!filtered.length ? (
        <EmptyState
          title="Sin pedidos"
          description="Cuando la IA cierre una venta con datos completos, el pedido aparecerá aquí."
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="font-medium">{o.order_number}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(o.created_at)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{o.customer_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.phone} · {o.city ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {o.product_title ?? "—"} × {o.quantity}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium">
                      {formatGs(o.total)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={o.payment_status === "pagado" ? "default" : "outline"}>
                        {o.payment_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={o.status}
                        onValueChange={(value) => updateStatus.mutate({ id: o.id, value })}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statuses.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Badge variant={statusVariant[o.status]} className="sr-only">
                        {o.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
