import { useMemo, useState, useEffect, useRef } from "react";
import { formatDateTime, formatGs } from "@/lib/format";
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
  Copy,
  BarChart3,
  Trash2,
  ShoppingCart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PageHeader,
  EmptyState,
} from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StoreScopeToggle, useStoreDirectory, useStoreScope } from "@/lib/admin-scope";
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
  | "advance-payment"
  | "duplicates";

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
  // Administrador con «Todas las tiendas»: pedidos de todos los vendedores (solo consulta).
  const { allStores } = useStoreScope();
  const { data: storeDirectory } = useStoreDirectory(allStores);
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState("");
  const importRef = useRef<{ popup: Window; batchId: string; ids: string[] } | null>(null);
  const ecommerceOrigin = "https://www.el-ecommercedcanpgroup.com";

  const [search, setSearch] = useState("");

  // Al entrar muestra pedidos nuevos.
  const [status, setStatus] = useState("nuevo");

  // KPI especial seleccionado.
  const [quickFilter, setQuickFilter] =
    useState<QuickFilter>("none");
  // Carga automática a DCANP: estado del vendedor (correo vinculado por el administrador).
  const { data: dcanpAuto, refetch: refetchDcanpAuto } = useQuery({
    queryKey: ["dcanp-auto", workspaceId],
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces")
        .select("dcanp_email, dcanp_auto_import, dcanp_auto_status, dcanp_auto_checked_at" as never)
        .eq("id", workspaceId!).maybeSingle();
      if (error) throw error;
      return data as unknown as { dcanp_email: string | null; dcanp_auto_import: boolean; dcanp_auto_status: string | null; dcanp_auto_checked_at: string | null } | null;
    },
  });
  const [dcanpEmailDraft, setDcanpEmailDraft] = useState<string | null>(null);
  const saveDcanpEmail = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.rpc("set_dcanp_email" as never, { p_email: email } as never);
      if (error) throw error;
    },
    onSuccess: () => { setDcanpEmailDraft(null); void refetchDcanpAuto(); },
    onError: (e: Error) => window.alert(e.message),
  });
  const toggleDcanpAuto = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.rpc("set_dcanp_auto_import" as never, { p_enabled: enabled } as never);
      if (error) throw error;
    },
    onSuccess: () => { void refetchDcanpAuto(); },
    onError: (e: Error) => window.alert(e.message),
  });

  // Filtro por producto elegido desde «Ventas por producto».
  const [productFilter, setProductFilter] = useState<string | null>(null);

  // Siempre comienza en HOY.
  const [dateFrom, setDateFrom] = useState(getTodayDate);
  const [dateTo, setDateTo] = useState(getTodayDate);

  const {
    data: orders,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["orders", workspaceId, allStores ? `todas:${dateFrom}:${dateTo}` : "propia"],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (allStores) {
        // Todas las tiendas: solo el período elegido (pueden ser miles de pedidos).
        const start = new Date(`${dateFrom}T00:00:00`).toISOString();
        const end = new Date(`${dateTo}T23:59:59.999`).toISOString();
        const all: NonNullable<Awaited<ReturnType<typeof loadPage>>> = [];
        async function loadPage(page: number) {
          const { data, error } = await supabase.from("orders").select("*")
            .gte("created_at", start).lte("created_at", end)
            .order("created_at", { ascending: false })
            .range(page * 1000, page * 1000 + 999);
          if (error) throw error;
          return data ?? [];
        }
        for (let page = 0; page < 50; page++) {
          const rows = await loadPage(page);
          all.push(...rows);
          if (rows.length < 1000) break;
        }
        return all;
      }
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
    // Respaldo si el canal en tiempo real no está disponible.
    refetchInterval: 30_000,
  });

  // Los pedidos que registra el bot aparecen sin recargar la página.
  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase.channel(`pedidos-orders-${workspaceId}`)
      .on("postgres_changes", {event:"*",schema:"public",table:"orders",filter:`workspace_id=eq.${workspaceId}`}, () => {
        queryClient.invalidateQueries({queryKey:["orders",workspaceId]});
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workspaceId, queryClient]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const active = importRef.current;
      if (!active || event.origin !== ecommerceOrigin || event.source !== active.popup) return;
      const msg = event.data;
      if (!msg || msg.channel !== "botsky-import-v1") return;
      if (msg.type !== "READY" && msg.batchId !== active.batchId) return;
      if (msg.type === "READY") {
        const selected = (orders ?? []).filter(o => active.ids.includes(o.id));
        if(selected.some(o=>String(o.observations??"").includes("MULTIVARIANTE (MISMO PRODUCTO)"))){
          setImportReport("El lote contiene un pedido con varias presentaciones. Cargalo manualmente como artículos separados en E-commerce para evitar un SKU incorrecto.");
          setImporting(false);importRef.current=null;return;
        }
        if (selected.length !== active.ids.length) {
          setImportReport("La lista cambió. Actualizá y volvé a seleccionar los pedidos.");
          setImporting(false); importRef.current = null; return;
        }
        active.popup.postMessage({ channel: "botsky-import-v1", type: "ORDERS", batchId: active.batchId,
          orders: selected.map(o => ({ source_order_id: o.id, order_number: o.order_number,
            customer_name: o.customer_name, phone: o.phone, city: o.city,
            departamento: o.departamento, street: o.street, district: o.district,
            email: o.email, obs: "", sku: o.sku, product_title: o.product_title,
            quantity: o.quantity, total: o.total, payment_method: o.payment_method,
            payment_status: o.payment_status, receipt_url: o.receipt_url }))
        }, ecommerceOrigin);
      }
      if (msg.type === "RESULT" && Array.isArray(msg.results)) {
        if (msg.results.length !== active.ids.length || new Set(msg.results.map((r: any) => r.source_order_id)).size !== active.ids.length || msg.results.some((r: any) => !active.ids.includes(r.source_order_id))) {
          setImportReport("La respuesta de E-commerce no coincide con el lote. No se modificaron estados.");
          setImporting(false); importRef.current = null; return;
        }
        const successful = msg.results.filter((r: any) => (r.status === "created" || r.status === "already_exists") && active.ids.includes(r.source_order_id));
        let updated = 0;
        for (const result of successful) {
          const { error } = await supabase.from("orders").update({ status: "cargado" })
            .eq("workspace_id", workspaceId!).eq("id", result.source_order_id);
          if (!error) updated++;
        }
        const failed = msg.results.filter((r: any) => r.status === "error");
        setImportReport(`E-commerce: ${msg.results.filter((r:any) => r.status === "created").length} creados, ${msg.results.filter((r:any) => r.status === "already_exists").length} existentes, ${failed.length} errores. BOT SKY: ${updated} estados actualizados. ${failed.map((r:any) => `${r.source_order_id}: ${r.message}`).join(" | ")}`);
        setSelectedIds([]); setImporting(false); importRef.current = null;
        await queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [orders, workspaceId, queryClient]);

  function startBulkImport() {
    if (importing || !selectedIds.length) return;
    const ids = selectedIds.filter(id => (orders ?? []).some(o => o.id === id && ["nuevo", "confirmado"].includes(o.status)));
    if((orders??[]).some(o=>ids.includes(o.id)&&String(o.observations??"").includes("MULTIVARIANTE (MISMO PRODUCTO)"))){
      window.alert("Pedido con varias presentaciones: cargalo manualmente como artículos separados en E-commerce.");return;
    }
    if (!ids.length) { window.alert("Seleccioná pedidos nuevos o confirmados."); return; }
    if (ids.length > 100) { window.alert("Podés cargar hasta 100 pedidos por lote."); return; }
    const popup = window.open(`${ecommerceOrigin}/?view=import-botsky`, "_blank");
    if (!popup) { window.alert("Permití las ventanas emergentes para E-commerce."); return; }
    const batchId = crypto.randomUUID();
    importRef.current = { popup, batchId, ids };
    setImportReport("Esperando que inicies sesión en E-commerce y se complete la importación…");
    setImporting(true);
  }



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
   * VENTAS POR PRODUCTO (período, sin cancelados)
   * ============================================================
   */
  const productKey = (order: { product_title?: string | null; product_id?: string | null }) =>
    (order.product_title?.trim() || "Sin producto").replace(/\s+/g, " ");
  const productStats = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; units: number; total: number }>();
    for (const order of ordersInDateRange) {
      if (order.status === "cancelado") continue;
      const name = productKey(order);
      const row = map.get(name) ?? { name, orders: 0, units: 0, total: 0 };
      row.orders += 1;
      row.units += Number(order.quantity) > 0 ? Number(order.quantity) : 1;
      row.total += Number(order.total) || 0;
      map.set(name, row);
    }
    return [...map.values()].sort((a, b) => b.orders - a.orders || b.total - a.total);
  }, [ordersInDateRange]);
  const productOrdersTotal = productStats.reduce((sum, row) => sum + row.orders, 0);

  /**
   * ============================================================
   * POSIBLES PEDIDOS REPETIDOS (período, sin cancelados)
   * ============================================================
   * Mismo teléfono + mismo producto más de una vez en el período.
   */
  const duplicateOrders = useMemo(() => {
    const groups = new Map<string, typeof ordersInDateRange>();
    for (const order of ordersInDateRange) {
      if (order.status === "cancelado") continue;
      const phone = String(order.phone ?? "").replace(/\D/g, "").slice(-9);
      if (!phone) continue;
      const key = `${phone}|${productKey(order).toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), order]);
    }
    return [...groups.values()]
      .filter(group => group.length > 1)
      .flatMap(group => [...group].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
  }, [ordersInDateRange]);
  const duplicateGroupsCount = useMemo(() =>
    new Set(duplicateOrders.map(o => `${String(o.phone ?? "").replace(/\D/g, "").slice(-9)}|${productKey(o).toLowerCase()}`)).size,
  [duplicateOrders]);

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

    if (quickFilter === "duplicates") {
      return duplicateOrders;
    }

    return ordersInDateRange;
  }, [
    quickFilter,
    pendingLoadOrders,
    advancePaymentOrders,
    duplicateOrders,
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

      const matchProduct = !productFilter || productKey(order) === productFilter;

      return matchStatus && matchSearch && matchProduct;
    });
  }, [
    baseOrders,
    quickFilter,
    status,
    search,
    productFilter,
  ]);

  const eligibleVisible = filtered.filter(o => ["nuevo", "confirmado"].includes(o.status));
  const allVisibleSelected = eligibleVisible.length > 0 && eligibleVisible.every(o => selectedIds.includes(o.id));
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
        "Observaciones",
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
        order.observations ?? "",
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
          <div className="flex flex-wrap items-center gap-2">
          <StoreScopeToggle />
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={!filtered.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
          </div>
        }
      />

      {/* CARGA AUTOMÁTICA A DCANP */}
      {allStores && (
        <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Viendo los pedidos de TODAS las tiendas del período elegido. En esta vista no se cargan pedidos a DCANP: cada vendedor carga los suyos.
        </p>
      )}
      {!allStores && <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <ShoppingCart className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Carga automática a DCANP</p>
            <p className="text-xs text-muted-foreground">
              {!dcanpAuto?.dcanp_email
                ? "Escribí el correo con el que entrás a DCANP para poder activarla."
                : dcanpAuto.dcanp_auto_import
                  ? `${dcanpAuto.dcanp_auto_status ?? "Activada."}${dcanpAuto.dcanp_auto_checked_at ? ` · Revisado ${formatDateTime(dcanpAuto.dcanp_auto_checked_at)}` : ""}`
                  : `Cuenta DCANP: ${dcanpAuto.dcanp_email}. Al activarla, los pedidos nuevos que califiquen se cargan solos cada 2 minutos, siempre que hayas abierto DCANP ese día.`}
            </p>
          </div>
          <form
            className="flex w-full items-center gap-2 sm:w-auto"
            onSubmit={(event) => { event.preventDefault(); saveDcanpEmail.mutate(dcanpEmailDraft ?? dcanpAuto?.dcanp_email ?? ""); }}
          >
            <Input
              type="email"
              className="h-9 w-full sm:w-60"
              placeholder="Correo de DCANP"
              value={dcanpEmailDraft ?? dcanpAuto?.dcanp_email ?? ""}
              onChange={(event) => setDcanpEmailDraft(event.target.value)}
              aria-label="Correo con el que entrás a DCANP"
            />
            <Button
              type="submit"
              size="sm"
              variant={dcanpEmailDraft !== null && dcanpEmailDraft.trim().toLowerCase() !== (dcanpAuto?.dcanp_email ?? "") ? "default" : "outline"}
              disabled={saveDcanpEmail.isPending || dcanpEmailDraft === null || dcanpEmailDraft.trim().toLowerCase() === (dcanpAuto?.dcanp_email ?? "")}
            >
              Guardar
            </Button>
          </form>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch
              checked={Boolean(dcanpAuto?.dcanp_auto_import)}
              disabled={!dcanpAuto?.dcanp_email || toggleDcanpAuto.isPending}
              onCheckedChange={(value) => toggleDcanpAuto.mutate(value)}
              aria-label="Activar carga automática a DCANP"
            />
            {dcanpAuto?.dcanp_auto_import ? "Activada" : "Desactivada"}
          </label>
        </CardContent>
      </Card>}

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

          {/* POSIBLES REPETIDOS - PERÍODO */}
          {duplicateOrders.length > 0 && (
            <button
              type="button"
              onClick={() => setQuickFilter(quickFilter === "duplicates" ? "none" : "duplicates")}
              className={`min-h-[86px] rounded-xl border p-4 text-left transition-all hover:border-rose-500/70 hover:bg-rose-500/10 ${
                quickFilter === "duplicates" ? "border-rose-500 bg-rose-500/10 ring-1 ring-rose-500/30" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-2">
                <Copy className="h-4 w-4 text-rose-500" />
                <p className="text-xs font-medium text-muted-foreground">Posibles repetidos</p>
              </div>
              <p className="mt-1 text-2xl font-bold">{duplicateOrders.length}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {duplicateGroupsCount} {duplicateGroupsCount === 1 ? "cliente" : "clientes"} · mismo teléfono y producto
              </p>
            </button>
          )}
        </div>
      )}

      {/* VENTAS POR PRODUCTO - PERÍODO */}
      {!isLoading && !error && productStats.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Ventas por producto</p>
                <span className="text-xs text-muted-foreground">período seleccionado · sin cancelados</span>
              </div>
              {productFilter && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setProductFilter(null)}>
                  Ver todos los productos
                </Button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Producto</th>
                    <th className="py-2 pr-3 text-right font-medium">Pedidos</th>
                    <th className="py-2 pr-3 text-right font-medium">Unidades</th>
                    <th className="py-2 pr-3 text-right font-medium">Total</th>
                    <th className="py-2 text-right font-medium">% pedidos</th>
                  </tr>
                </thead>
                <tbody>
                  {productStats.map((row) => {
                    const share = productOrdersTotal ? Math.round((row.orders / productOrdersTotal) * 100) : 0;
                    const selected = productFilter === row.name;
                    return (
                      <tr
                        key={row.name}
                        onClick={() => setProductFilter(selected ? null : row.name)}
                        className={`cursor-pointer border-b last:border-0 hover:bg-accent/40 ${selected ? "bg-primary/10" : ""}`}
                      >
                        <td className="py-2 pr-3">
                          <div className="font-medium">{row.name}</div>
                          <div className="mt-1 h-1.5 w-full max-w-[220px] rounded-full bg-muted">
                            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${share}%` }} />
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{row.orders}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.units}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatGs(row.total)}</td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{share}%</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-xs font-semibold">
                    <td className="pt-2 pr-3">Total</td>
                    <td className="pt-2 pr-3 text-right tabular-nums">{productOrdersTotal}</td>
                    <td className="pt-2 pr-3 text-right tabular-nums">{productStats.reduce((sum, row) => sum + row.units, 0)}</td>
                    <td className="pt-2 pr-3 text-right tabular-nums">{formatGs(productStats.reduce((sum, row) => sum + row.total, 0))}</td>
                    <td className="pt-2 text-right" />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Tocá un producto para ver solo sus pedidos en la lista.</p>
          </CardContent>
        </Card>
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
                  : quickFilter === "duplicates"
                    ? "Mostrando posibles pedidos repetidos del período (mismo teléfono y mismo producto)."
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

      {!allStores && <Card><CardContent className="flex flex-wrap items-center gap-3 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allVisibleSelected} disabled={!eligibleVisible.length || importing}
            onChange={e => setSelectedIds(prev => e.target.checked
              ? [...new Set([...prev, ...eligibleVisible.map(o => o.id)])]
              : prev.filter(id => !eligibleVisible.some(o => o.id === id)))} />
          Seleccionar todos los pendientes visibles
        </label>
        <Button type="button" onClick={startBulkImport} disabled={importing || selectedIds.length === 0}>
          <ShoppingCart className="mr-2 h-4 w-4" />
          {importing ? "Esperando E-commerce…" : `Cargar seleccionados a E-commerce (${selectedIds.length})`}
        </Button>
        {importReport && <p role="status" className="w-full text-sm break-words">{importReport}</p>}
      </CardContent></Card>}

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
                <div className={allStores ? "hidden" : "absolute right-3 top-3 z-10"}>
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

                {allStores && (
                  <p className="mb-1 truncate text-xs font-semibold text-primary" title={storeDirectory?.get(order.workspace_id)?.name}>
                    {storeDirectory?.get(order.workspace_id)?.email ?? "Tienda"} · {storeDirectory?.get(order.workspace_id)?.name ?? ""}
                  </p>
                )}
                {!allStores && (["nuevo", "confirmado"].includes(order.status)) && (
                  <label className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded bg-background/95 px-2 py-1 text-xs shadow">
                    <input type="checkbox" checked={selectedIds.includes(order.id)} disabled={importing}
                      onChange={e => setSelectedIds(prev => e.target.checked
                        ? [...new Set([...prev, order.id])] : prev.filter(id => id !== order.id))} /> Seleccionar
                  </label>
                )}
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
