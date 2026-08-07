import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CalendarDays,
  Download,
  Search,
  Trash2,
} from "lucide-react";
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

function getTodayDate() {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isWithinLocalDateRange(
  value: string | null | undefined,
  dateFrom: string,
  dateTo: string,
) {
  if (!value || !dateFrom || !dateTo) {
    return false;
  }

  const date = new Date(value);

  const [fromYear, fromMonth, fromDay] = dateFrom
    .split("-")
    .map(Number);

  const [toYear, toMonth, toDay] = dateTo
    .split("-")
    .map(Number);

  const start = new Date(
    fromYear,
    fromMonth - 1,
    fromDay,
    0,
    0,
    0,
    0,
  );

  const end = new Date(
    toYear,
    toMonth - 1,
    toDay,
    23,
    59,
    59,
    999,
  );

  return date >= start && date <= end;
}

function OrdersPage() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");

  // Conservamos el comportamiento anterior:
  // al entrar muestra pedidos NUEVOS.
  const [status, setStatus] = useState("nuevo");

  // Siempre inicia mostrando HOY.
  const [dateFrom, setDateFrom] = useState(getTodayDate);
  const [dateTo, setDateTo] = useState(getTodayDate);

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
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      if (!workspaceId) {
        throw new Error(
          "No se encontró el espacio de trabajo.",
        );
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

      window.alert(
        `Error al eliminar el pedido: ${message}`,
      );
    },
  });

  /**
   * PRIMER FILTRO:
   * solamente por fecha.
   *
   * Esto se utiliza para calcular el dashboard,
   * independientemente del buscador y del estado seleccionado.
   */
  const ordersInDateRange = useMemo(() => {
    return (orders ?? []).filter((order) =>
      isWithinLocalDateRange(
        order.created_at,
        dateFrom,
        dateTo,
      ),
    );
  }, [orders, dateFrom, dateTo]);

  /**
   * Conteo por estado para el dashboard.
   *
   * Solo toma pedidos del rango de fechas seleccionado.
   */
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const orderStatus of ORDER_STATES) {
      counts[orderStatus] = 0;
    }

    for (const order of ordersInDateRange) {
      counts[order.status] =
        (counts[order.status] ?? 0) + 1;
    }

    return counts;
  }, [ordersInDateRange]);

  /**
   * Estados que realmente tienen datos.
   *
   * Si un estado tiene 0 pedidos, no mostramos
   * una tarjeta vacía en el dashboard.
   */
  const visibleStatusMetrics = useMemo(() => {
    return ORDER_STATES.filter(
      (orderStatus) =>
        (statusCounts[orderStatus] ?? 0) > 0,
    );
  }, [statusCounts]);

  /**
   * Total de pedidos dentro de las fechas.
   */
  const totalInDateRange = ordersInDateRange.length;

  /**
   * FILTRO FINAL:
   * fecha + estado + búsqueda.
   */
  const filtered = useMemo(() => {
    return ordersInDateRange.filter((order) => {
      const matchStatus =
        status === "todos" ||
        order.status === status;

      const query = search
        .trim()
        .toLowerCase();

      const customerName = String(
        order.customer_name ?? "",
      ).toLowerCase();

      const phone = String(
        order.phone ?? "",
      ).toLowerCase();

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
  }, [
    ordersInDateRange,
    status,
    search,
  ]);

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

    await deleteOrderMutation.mutateAsync(
      orderId,
    );
  }

  function resetDateFilters() {
    const today = getTodayDate();

    setDateFrom(today);
    setDateTo(today);
  }

  function exportCsv() {
    if (!filtered.length) {
      window.alert(
        "No hay pedidos para exportar.",
      );
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
              `"${String(column).replace(
                /"/g,
                '""',
              )}"`,
          )
          .join(","),
      )
      .join("\n");

    // BOM para que Excel reconozca
    // correctamente acentos y ñ.
    const csvWithBom = `\uFEFF${csv}`;

    const url = URL.createObjectURL(
      new Blob([csvWithBom], {
        type: "text/csv;charset=utf-8",
      }),
    );

    const anchor =
      document.createElement("a");

    anchor.href = url;

    anchor.download =
      dateFrom === dateTo
        ? `pedidos-${status}-${dateFrom}.csv`
        : `pedidos-${status}-${dateFrom}-a-${dateTo}.csv`;

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

      {/* DASHBOARD DE ESTADOS */}
      {!isLoading &&
        !error &&
        totalInDateRange > 0 && (
          <div
            className="
              grid
              grid-cols-2
              gap-3
              sm:grid-cols-3
              lg:grid-cols-4
              xl:grid-cols-7
            "
          >
            {visibleStatusMetrics.map(
              (orderStatus) => {
                const count =
                  statusCounts[
                    orderStatus
                  ] ?? 0;

                const selected =
                  status === orderStatus;

                return (
                  <button
                    key={orderStatus}
                    type="button"
                    onClick={() =>
                      setStatus(orderStatus)
                    }
                    className={`
                      rounded-xl
                      border
                      p-4
                      text-left
                      transition-all
                      hover:border-primary/50
                      hover:bg-accent/40
                      ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card"
                      }
                    `}
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {orderStateLabel(
                        orderStatus,
                      )}
                    </p>

                    <p className="mt-1 text-2xl font-bold">
                      {count}
                    </p>
                  </button>
                );
              },
            )}
          </div>
        )}

      {/* FILTROS */}
      <Card>
        <CardContent className="space-y-4 p-4">
          {/* FILTRO DE FECHAS */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[220px_220px_auto_1fr]">
            <label className="space-y-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                Desde
              </span>

              <Input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => {
                  const value =
                    event.target.value;

                  setDateFrom(value);

                  if (value > dateTo) {
                    setDateTo(value);
                  }
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                Hasta
              </span>

              <Input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(event) => {
                  const value =
                    event.target.value;

                  setDateTo(value);

                  if (value < dateFrom) {
                    setDateFrom(value);
                  }
                }}
              />
            </label>

            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={resetDateFilters}
              >
                Hoy
              </Button>
            </div>

            <div className="flex items-end justify-start lg:justify-end">
              <p className="pb-2 text-xs text-muted-foreground">
                {totalInDateRange}{" "}
                {totalInDateRange === 1
                  ? "pedido"
                  : "pedidos"}{" "}
                en el período
              </p>
            </div>
          </div>

          {/* BÚSQUEDA + ESTADO */}
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                className="pl-9"
                placeholder="Buscar por cliente, teléfono o número"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
              />
            </div>

            <Select
              value={status}
              onValueChange={setStatus}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Seleccionar estado" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="todos">
                  Todos los estados
                </SelectItem>

                {ORDER_STATES.map(
                  (orderStatus) => (
                    <SelectItem
                      key={orderStatus}
                      value={orderStatus}
                    >
                      {orderStateLabel(
                        orderStatus,
                      )}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* PEDIDOS */}
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
            totalInDateRange === 0
              ? "No existen pedidos registrados dentro del rango de fechas seleccionado."
              : status === "nuevo"
                ? "No hay pedidos nuevos que coincidan con los filtros seleccionados."
                : "No existen pedidos que coincidan con el estado, la búsqueda o las fechas seleccionadas."
          }
        />
      ) : (
        <div
          className="
            grid
            grid-cols-1
            gap-4
            lg:grid-cols-2
            2xl:grid-cols-3
          "
        >
          {filtered.map((order) => {
            const isDeleting =
              deleteOrderMutation.isPending &&
              deleteOrderMutation.variables ===
                order.id;

            return (
              <div
                key={order.id}
                className="relative min-w-0"
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

                <OrderCard
                  order={order}
                />
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
