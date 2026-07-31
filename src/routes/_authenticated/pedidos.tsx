import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Download, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PageHeader,
  PageShell,
  EmptyState,
} from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceId } from "@/lib/auth";
import { OrderCard } from "@/components/order-card";
import {
  ORDER_STATES,
  orderStateLabel,
} from "@/lib/orders";

export const Route = createFileRoute("/_authenticated/pedidos")({
  head: () => ({
    meta: [
      { title: "Pedidos — BOT SKY" },
      {
        name: "description",
        content:
          "Gestiona los pedidos generados automáticamente por tu IA.",
      },
      {
        property: "og:title",
        content: "Pedidos — BOT SKY",
      },
      {
        property: "og:description",
        content:
          "Pedidos, estados de pago y exportación a CSV.",
      },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");

  // Al entrar, muestra solamente los pedidos nuevos.
  const [status, setStatus] = useState("nuevo");

  const {
    data: orders,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["orders", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      if (!workspaceId) {
        throw new Error("No se encontró el espacio de trabajo.");
      }

      const { error } = await supabase
        .from("orders")
        .delete()
        .eq("id", orderId)
        .eq("workspace_id", workspaceId);

      if (error) {
        throw error;
      }

      return orderId;
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["orders", workspaceId],
      });
    },

    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo eliminar el pedido.";

      window.alert(`Error al eliminar el pedido: ${message}`);
    },
  });

  const filtered = (orders ?? []).filter((order) => {
    const matchStatus =
      status === "todos" || order.status === status;

    const query = search.trim().toLowerCase();

    const customerName = String(
      order.customer_name ?? "",
    ).toLowerCase();

    const phone = String(order.phone ?? "").toLowerCase();

    const orderNumber = String(
      order.order_number ?? "",
    ).toLowerCase();

    const matchSearch =
      !query ||
      customerName.includes(query) ||
      phone.includes(query) ||
      orderNumber.includes(query);

    return matchStatus && matchSearch;
  });

  async function handleDeleteOrder(
    orderId: string,
    orderNumber?: string | null,
  ) {
    const confirmed = window.confirm(
      `¿Seguro que querés eliminar el pedido ${
        orderNumber ? `#${orderNumber}` : ""
      }?\n\nEsta acción no se puede deshacer.`,
    );

    if (!confirmed) {
      return;
    }

    await deleteOrderMutation.mutateAsync(orderId);
  }

  function exportCsv() {
    if (!filtered.length) {
      window.alert("No hay pedidos para exportar.");
      return;
    }

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
      ...filtered.map((order) => [
        order.order_number ?? "",
        formatDateTime(order.created_at),
        order.customer_name ?? "",
        order.phone ?? "",
        order.product_title ?? "",
        order.quantity ?? 0,
        order.total ?? 0,
        order.city ?? "",
        order.street ?? "",
        order.payment_method ?? "",
        orderStateLabel(order.status),
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map(
            (column) =>
              `"${String(column).replace(/"/g, '""')}"`,
          )
          .join(","),
      )
      .join("\n");

    // BOM para que Excel reconozca correctamente acentos y ñ.
    const csvWithBom = `\uFEFF${csv}`;

    const url = URL.createObjectURL(
      new Blob([csvWithBom], {
        type: "text/csv;charset=utf-8",
      }),
    );

    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `pedidos-${status}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
  }

  return (
    <PageShell>
      <PageHeader
        title="Pedidos"
        description="Cada venta cerrada por la IA se registra automáticamente aquí."
        actions={
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={!filtered.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
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
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </div>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Seleccionar estado" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="todos">
                Todos los estados
              </SelectItem>

              {ORDER_STATES.map((orderStatus) => (
                <SelectItem
                  key={orderStatus}
                  value={orderStatus}
                >
                  {orderStateLabel(orderStatus)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isLoading ? (
        <EmptyState
          title="Cargando pedidos"
          description="Estamos obteniendo los pedidos registrados."
        />
      ) : error ? (
        <EmptyState
          title="No se pudieron cargar los pedidos"
          description="Revisá la conexión con Supabase y las políticas de seguridad."
        />
      ) : !filtered.length ? (
        <EmptyState
          title={
            status === "nuevo"
              ? "No hay pedidos nuevos"
              : "No se encontraron pedidos"
          }
          description={
            status === "nuevo"
              ? "Cuando la IA cierre una nueva venta, aparecerá automáticamente aquí."
              : "No existen pedidos que coincidan con el estado o la búsqueda seleccionada."
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((order) => {
            const isDeleting =
              deleteOrderMutation.isPending &&
              deleteOrderMutation.variables === order.id;

            return (
              <div
                key={order.id}
                className="relative"
              >
                <div className="absolute right-3 top-3 z-10">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={isDeleting}
                    onClick={() =>
                      handleDeleteOrder(
                        order.id,
                        order.order_number,
                      )
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />

                    {isDeleting
                      ? "Eliminando..."
                      : "Eliminar"}
                  </Button>
                </div>

                <OrderCard order={order} />
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
