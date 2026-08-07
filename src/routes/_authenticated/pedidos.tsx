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
  CreditCard,
  Download,
  PackageCheck,
  Search,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PageHeader,
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

type QuickFilter =
  | "none"
  | "pending-load"
  | "advance-payment";

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

  // Al entrar muestra pedidos nuevos.
  const [status, setStatus] = useState("nuevo");

  // KPI especial seleccionado.
  const [quickFilter, setQuickFilter] =
    useState<QuickFilter>("none");

  // Siempre comienza en HOY.
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
   * ============================================================
   * PEDIDOS DEL RANGO DE FECHAS
   * ============================================================
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
   * ============================================================
   * KPI DE ESTADOS DEL PERÍODO
   * ============================================================
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
   * Solo mostramos KPI de estados que tengan datos.
   */
  const visibleStatusMetrics = useMemo(() => {
    return ORDER_STATES.filter(
      (orderStatus) =>
        (statusCounts[orderStatus] ?? 0) > 0,
    );
  }, [statusCounts]);

  /**
   * ============================================================
   * KPI GLOBAL: PENDIENTES DE CARGAR
   * ============================================================
   *
   * IMPORTANTE:
   * Este KPI NO depende del filtro de fecha.
   *
   * Incluye pedidos:
   * - nuevo
   * - confirmado
   *
   * De esta forma podés ver pedidos atrasados de días anteriores.
   */
  const pendingLoadOrders = useMemo(() => {
    return (orders ?? []).filter(
      (order) =>
        order.status === "nuevo" ||
        order.status === "confirmado",
    );
  }, [orders]);

  const pendingLoadCount =
    pendingLoadOrders.length;

  /**
   * ============================================================
   * KPI GLOBAL: PAGOS ANTICIPADOS PENDIENTES
   * ============================================================
   *
   * Tampoco depende de la fecha.
   *
   * Cuenta pagos que ya tienen estado anticipado,
   * pero cuyo pedido todavía no fue cargado.
   */
  const advancePaymentOrders = useMemo(() => {
    return (orders ?? []).filter(
      (order) =>
        order.payment_status === "anticipado" &&
        (
          order.status === "nuevo" ||
          order.status === "confirmado"
        ),
    );
  }, [orders]);

  const advancePaymentCount =
    advancePaymentOrders.length;

  /**
   * ============================================================
   * PEDIDOS QUE SE MUESTRAN
   * ============================================================
   *
   * Si se toca un KPI global:
   * - ignora las fechas
   *
   * Si no:
   * - respeta el rango seleccionado
   */
  const baseOrders = useMemo(() => {
    if (quickFilter === "pending-load") {
      return pendingLoadOrders;
    }

    if (quickFilter === "advance-payment") {
      return advancePaymentOrders;
    }

    return ordersInDateRange;
  }, [
    quickFilter,
    pendingLoadOrders,
    advancePaymentOrders,
    ordersInDateRange,
  ]);

  /**
   * ============================================================
   * FILTRO FINAL
   * ============================================================
   */
  const filtered = useMemo(() => {
    return baseOrders.filter((order) => {
      /**
       * Los KPI globales ya tienen su propia condición,
       * entonces no aplicamos nuevamente el selector de estado.
       */
      const matchStatus =
        quickFilter !== "none" ||
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
    baseOrders,
    quickFilter,
    status,
    search,
  ]);

  const totalInDateRange =
    ordersInDateRange.length;

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

  /**
   * Vuelve a HOY y sale de cualquier KPI global.
   */
  function resetDateFilters() {
    const today = getTodayDate();

    setDateFrom(today);
    setDateTo(today);
    setQuickFilter("none");
  }

  /**
   * Selecciona un estado normal del período.
   */
  function selectStatusMetric(
    orderStatus: string,
  ) {
    setQuickFilter("none");
    setStatus(orderStatus);
  }

  /**
   * Selecciona KPI pendientes global.
   */
  function selectPendingLoad() {
    if (quickFilter === "pending-load") {
      setQuickFilter("none");
      setStatus("nuevo");
      return;
    }

    setQuickFilter("pending-load");
  }

  /**
   * Selecciona KPI anticipados global.
   */
  function selectAdvancePayments() {
    if (
      quickFilter === "advance-payment"
    ) {
      setQuickFilter("none");
      setStatus("nuevo");
      return;
    }

    setQuickFilter("advance-payment");
  }

  /**
   * Cuando cambia manualmente el selector de estado,
   * abandonamos cualquier KPI especial.
   */
  function handleStatusChange(
    value: string,
  ) {
    setQuickFilter("none");
    setStatus(value);
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
        "Estado pago",
        "Estado pedido",
        "Comprobante",
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
        order.payment_status ?? "",
        orderStateLabel(order.status),
        order.receipt_url ? "Sí" : "No",
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

    const csvWithBom = `\uFEFF${csv}`;

    const url = URL.createObjectURL(
      new Blob([csvWithBom], {
        type: "text/csv;charset=utf-8",
      }),
    );

    const anchor =
      document.createElement("a");

    anchor.href = url;

    let fileSuffix = "";

    if (
      quickFilter === "pending-load"
    ) {
      fileSuffix =
        "pendientes-de-cargar";
    } else if (
      quickFilter === "advance-payment"
    ) {
      fileSuffix =
        "pagos-anticipados";
    } else if (dateFrom === dateTo) {
      fileSuffix =
        `${status}-${dateFrom}`;
    } else {
      fileSuffix =
        `${status}-${dateFrom}-a-${dateTo}`;
    }

    anchor.download =
      `pedidos-${fileSuffix}.csv`;

    document.body.appendChild(anchor);

    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
  }

  return (
    /**
     * NO usamos PageShell aquí.
     *
     * Así Pedidos puede aprovechar todo el ancho disponible
     * del área principal y no queda ese espacio grande
     * vacío a izquierda y derecha.
     */
    <div className="w-full max-w-none space-y-4 px-4 py-5 sm:px-5 lg:px-6 xl:px-8">

      {/* CABECERA */}
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

      {/* ===================================================== */}
      {/* DASHBOARD / KPIs                                     */}
      {/* ===================================================== */}

      {!isLoading && !error && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">

          {/* ESTADOS DEL PERÍODO */}
          {visibleStatusMetrics.map(
            (orderStatus) => {
              const count =
                statusCounts[
                  orderStatus
                ] ?? 0;

              const selected =
                quickFilter === "none" &&
                status === orderStatus;

              return (
                <button
                  key={orderStatus}
                  type="button"
                  onClick={() =>
                    selectStatusMetric(
                      orderStatus,
                    )
                  }
                  className={`
                    min-h-[86px]
                    rounded-xl
                    border
                    p-4
                    text-left
                    transition-all
                    hover:border-primary/60
                    hover:bg-accent/40
                    ${
                      selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
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

                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Período seleccionado
                  </p>
                </button>
              );
            },
          )}

          {/* PENDIENTES DE CARGAR - GLOBAL */}
          {pendingLoadCount > 0 && (
            <button
              type="button"
              onClick={
                selectPendingLoad
              }
              className={`
                min-h-[86px]
                rounded-xl
                border
                p-4
                text-left
                transition-all
                hover:border-amber-500/70
                hover:bg-amber-500/10
                ${
                  quickFilter ===
                  "pending-load"
                    ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30"
                    : "border-border bg-card"
                }
              `}
            >
              <div className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-amber-500" />

                <p className="text-xs font-medium text-muted-foreground">
                  Pendientes de cargar
                </p>
              </div>

              <p className="mt-1 text-2xl font-bold">
                {pendingLoadCount}
              </p>

              <p className="mt-1 text-[10px] text-muted-foreground">
                Todas las fechas
              </p>
            </button>
          )}

          {/* PAGOS ANTICIPADOS - GLOBAL */}
          {advancePaymentCount > 0 && (
            <button
              type="button"
              onClick={
                selectAdvancePayments
              }
              className={`
                min-h-[86px]
                rounded-xl
                border
                p-4
                text-left
                transition-all
                hover:border-emerald-500/70
                hover:bg-emerald-500/10
                ${
                  quickFilter ===
                  "advance-payment"
                    ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                    : "border-border bg-card"
                }
              `}
            >
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-emerald-500" />

                <p className="text-xs font-medium text-muted-foreground">
                  Pagos anticipados
                </p>
              </div>

              <p className="mt-1 text-2xl font-bold">
                {advancePaymentCount}
              </p>

              <p className="mt-1 text-[10px] text-muted-foreground">
                Pendientes · todas las fechas
              </p>
            </button>
          )}
        </div>
      )}

      {/* ===================================================== */}
      {/* FILTROS                                               */}
      {/* ===================================================== */}

      <Card>
        <CardContent className="space-y-4 p-4">

          {/* FECHAS */}
          <div className="grid gap-3 md:grid-cols-[200px_200px_auto_1fr]">

            <label className="space-y-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                Desde
              </span>

              <Input
                type="date"
                value={dateFrom}
                max={dateTo}
                disabled={
                  quickFilter !== "none"
                }
                onChange={(event) => {
                  const value =
                    event.target.value;

                  setQuickFilter("none");
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
                disabled={
                  quickFilter !== "none"
                }
                onChange={(event) => {
                  const value =
                    event.target.value;

                  setQuickFilter("none");
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
                onClick={
                  resetDateFilters
                }
              >
                Hoy
              </Button>
            </div>

            <div className="flex items-end justify-start md:justify-end">
              <p className="pb-2 text-xs text-muted-foreground">
                {quickFilter ===
                "pending-load"
                  ? `${pendingLoadCount} pendientes de cargar en total`
                  : quickFilter ===
                      "advance-payment"
                    ? `${advancePaymentCount} pagos anticipados pendientes`
                    : `${totalInDateRange} ${
                        totalInDateRange ===
                        1
                          ? "pedido"
                          : "pedidos"
                      } en el período`}
              </p>
            </div>
          </div>

          {/* BUSCADOR + ESTADO */}
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
              value={
                quickFilter !== "none"
                  ? "todos"
                  : status
              }
              onValueChange={
                handleStatusChange
              }
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

          {/* AVISO DE FILTRO GLOBAL */}
          {quickFilter !== "none" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">

              <p className="text-xs text-muted-foreground">
                {quickFilter ===
                "pending-load"
                  ? "Mostrando pedidos pendientes de cargar de todas las fechas."
                  : "Mostrando pagos anticipados pendientes de todas las fechas."}
              </p>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={
                  resetDateFilters
                }
              >
                Volver a hoy
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===================================================== */}
      {/* LISTA DE PEDIDOS                                      */}
      {/* ===================================================== */}

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
            quickFilter ===
            "pending-load"
              ? "No hay pedidos pendientes de cargar"
              : quickFilter ===
                  "advance-payment"
                ? "No hay pagos anticipados pendientes"
                : status === "nuevo"
                  ? "No hay pedidos nuevos"
                  : "No se encontraron pedidos"
          }
          description={
            quickFilter ===
            "pending-load"
              ? "No existen pedidos nuevos o confirmados pendientes de cargar."
              : quickFilter ===
                  "advance-payment"
                ? "No existen pagos anticipados pendientes de cargar."
                : totalInDateRange === 0
                  ? "No existen pedidos registrados dentro del rango de fechas seleccionado."
                  : "No existen pedidos que coincidan con los filtros seleccionados."
          }
        />
      ) : (
        /**
         * 3 PEDIDOS POR FILA EN MONITORES GRANDES.
         *
         * xl = 2
         * 2xl = 3
         */
        <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">

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
    </div>
  );
}
