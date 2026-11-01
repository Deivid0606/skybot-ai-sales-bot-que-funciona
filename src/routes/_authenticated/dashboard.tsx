import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  MapPin,
  Megaphone,
  MessageSquare,
  PackageCheck,
  Truck,
  RefreshCcw,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { formatGs } from "@/lib/format";
import { resolveDepartamento } from "@/lib/orders";
import { StoreScopeToggle, useStoreDirectory, useStoreScope } from "@/lib/admin-scope";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useWorkspaceId } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — BOT SKY" },
      {
        name: "description",
        content: "Métricas de conversaciones, ventas y desempeño de tu IA.",
      },
      { property: "og:title", content: "Dashboard — BOT SKY" },
      {
        property: "og:description",
        content: "Métricas en vivo de tu operación de ventas por WhatsApp.",
      },
    ],
  }),
  component: DashboardPage,
});

function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string, endOfDay = false) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
}

function formatDisplayDate(value: string) {
  if (!value) return "";

  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parseLocalDate(value));
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasOrderTag(tags: unknown, expectedTag: string) {
  const expected = normalizeText(expectedTag);

  if (Array.isArray(tags)) {
    return tags.some((tag) => normalizeText(tag) === expected);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .some((tag) => normalizeText(tag) === expected);
  }

  return false;
}

function getNormalizedCityName(city?: string | null) {
  const value = city?.trim();

  if (!value) return "Sin ciudad";

  return value
    .toLowerCase()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function DashboardPage() {
  const workspaceId = useWorkspaceId();
  // Administrador con «Todas las tiendas»: se suman los datos de todos los vendedores.
  const { allStores } = useStoreScope();
  const { data: storeDirectory } = useStoreDirectory(allStores);
  const today = getTodayDate();

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  const hasInvalidRange = dateFrom > dateTo;

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ["dashboard", allStores ? "todas" : workspaceId, dateFrom, dateTo],
    enabled:
      Boolean(workspaceId) &&
      Boolean(dateFrom) &&
      Boolean(dateTo) &&
      !hasInvalidRange,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,

    queryFn: async () => {
      if (!workspaceId) {
        throw new Error("Workspace no disponible.");
      }

      const startIso = parseLocalDate(dateFrom).toISOString();
      const endIso = parseLocalDate(dateTo, true).toISOString();

      type ConversationRow = {
        id: string;
        workspace_id: string;
        status: string | null;
        sale_closed: boolean | null;
        created_at: string | null;
        ad_id: string | null;
      };

      type OrderRow = {
        id: string;
        workspace_id: string;
        total: number | string | null;
        status: string | null;
        created_at: string | null;
        product_title: string | null;
        city: string | null;
        departamento: string | null;
        payment_status: string | null;
        payment_method: string | null;
        tags: unknown;
        conversation_id: string | null;
        ad_id: string | null;
      };

      async function fetchAllPages<T>(
        buildQuery: (from: number, to: number) => PromiseLike<{
          data: T[] | null;
          error: unknown;
        }>,
      ): Promise<T[]> {
        const rows: T[] = [];
        const pageSize = 1000;
        let page = 0;

        while (true) {
          const from = page * pageSize;
          const to = from + pageSize - 1;

          const result = await buildQuery(from, to);

          if (result.error) {
            throw result.error;
          }

          const pageRows = result.data ?? [];
          rows.push(...pageRows);

          if (pageRows.length < pageSize) {
            break;
          }

          page += 1;
        }

        return rows;
      }

      // Todas las tiendas: sin filtrar por tienda (la base ya limita al administrador).
      const allWorkspaceIds = allStores
        ? ((await supabase.from("workspaces").select("id")).data ?? []).map((w) => w.id)
        : [];
      const scopeIds = allStores ? allWorkspaceIds : [workspaceId];

      const [conversations, orders, balance, ads] = await Promise.all([
        fetchAllPages<ConversationRow>((from, to) =>
          supabase
            .from("conversations")
            .select("id, status, sale_closed, created_at, ad_id, workspace_id")
            .in("workspace_id", scopeIds)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
              data: ConversationRow[] | null;
              error: unknown;
            }>,
        ),

        fetchAllPages<OrderRow>((from, to) =>
          supabase
            .from("orders")
            .select(
              "id, total, status, created_at, product_title, city, departamento, payment_status, payment_method, tags, conversation_id, ad_id, workspace_id",
            )
            .in("workspace_id", scopeIds)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
              data: OrderRow[] | null;
              error: unknown;
            }>,
        ),

        supabase
          .from("conversation_balances")
          .select("available, consumed, purchased")
          .in("workspace_id", scopeIds),

        supabase
          .from("ads")
          .select("id, ad_id, name, media_url, products(name)")
          .in("workspace_id", scopeIds),
      ]);

      if (balance.error) throw balance.error;
      if (ads.error) throw ads.error;

      return {
        conversations,
        orders,
        // Saldo: suma de las tiendas incluidas.
        balance: (balance.data ?? []).reduce(
          (sum, row) => ({
            available: sum.available + Number(row.available ?? 0),
            consumed: sum.consumed + Number(row.consumed ?? 0),
            purchased: sum.purchased + Number(row.purchased ?? 0),
          }),
          { available: 0, consumed: 0, purchased: 0 },
        ),
        ads: ads.data ?? [],
      };
    },
  });

  if (isLoading || !data) {
    return (
      <PageShell>
        <PageHeader title="Dashboard" description="Resumen de tu operación." />

        <div className="space-y-5">
          <Skeleton className="h-44 w-full rounded-2xl" />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-2xl" />
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-96 w-full rounded-2xl" />
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
        </div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <PageHeader title="Dashboard" description="Resumen de tu operación." />

        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6">
            <p className="font-semibold text-destructive">
              No se pudo cargar el dashboard.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Ocurrió un error inesperado."}
            </p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const rangeOrders = hasInvalidRange
    ? []
    : data.orders.filter((order) => order.status !== "cancelado");

  /*
   * SIN CONSULTAR MESSAGES:
   * "Conversaciones recibidas" usa las conversaciones creadas en el período.
   * Esto permite que el dashboard sea mucho más liviano y rápido.
   */
  const totalConversations = hasInvalidRange ? 0 : data.conversations.length;

  // Fuente oficial de ventas: pedidos no cancelados creados en el período.
  const closedSales = rangeOrders.length;

  const conversion = totalConversations
    ? Math.round((closedSales / totalConversations) * 100)
    : 0;

  const rangeRevenue = rangeOrders.reduce(
    (total, order) => total + Number(order.total ?? 0),
    0,
  );

  const loadedOrders = rangeOrders.filter(
    (order) => order.status === "cargado",
  ).length;

  // Entregados: el estado llega solo desde el E-commerce (sincronización automática).
  const deliveredOrders = rangeOrders.filter(
    (order) => order.status === "entregado",
  ).length;
  const deliveredRate = rangeOrders.length
    ? Math.round((deliveredOrders / rangeOrders.length) * 100)
    : 0;

  const centralOrders = rangeOrders.filter((order) => {
    const departamento = resolveDepartamento(order.departamento, order.city);
    return departamento === "Central";
  }).length;

  const prepaidOrders = rangeOrders.filter((order) => {
    const paymentStatus = normalizeText(order.payment_status);
    const paymentMethod = normalizeText(order.payment_method);

    return (
      paymentStatus === "anticipado" ||
      paymentMethod.includes("anticipado") ||
      hasOrderTag(order.tags, "Pago anticipado")
    );
  }).length;

  const pendingPaymentOrders = rangeOrders.filter((order) => {
    const paymentStatus = normalizeText(order.payment_status);

    return (
      paymentStatus === "pendiente" ||
      hasOrderTag(order.tags, "Pendiente de pago")
    );
  }).length;

  // Todas las tiendas: resumen por vendedor (correo).
  const storeRows = allStores
    ? [...new Set([...data.conversations.map((c) => c.workspace_id), ...rangeOrders.map((o) => o.workspace_id)])]
        .map((id) => {
          const storeOrders = rangeOrders.filter((o) => o.workspace_id === id);
          const store = storeDirectory?.get(id);
          return {
            id,
            email: store?.email ?? "sin correo",
            name: store?.name ?? "Tienda",
            conversations: data.conversations.filter((c) => c.workspace_id === id).length,
            orders: storeOrders.length,
            delivered: storeOrders.filter((o) => o.status === "entregado").length,
            revenue: storeOrders.reduce((sum, o) => sum + Number(o.total ?? 0), 0),
          };
        })
        .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue)
    : [];

  const conversationById = new Map(
    data.conversations.map((conversation) => [conversation.id, conversation]),
  );

  const registeredAdByExternalId = new Map(
    data.ads
      .filter((ad) => Boolean(ad.ad_id))
      .map((ad) => [ad.ad_id as string, ad]),
  );

  /*
   * El pedido usa su ad_id guardado.
   * Si es un registro legacy sin ad_id, intenta usar el ad_id de la conversación
   * cuando esa conversación pertenece al período cargado.
   */
  const getOrderAdId = (order: (typeof rangeOrders)[number]) => {
    if (order.ad_id) return order.ad_id;

    if (order.conversation_id) {
      return conversationById.get(order.conversation_id)?.ad_id ?? null;
    }

    return null;
  };

  /*
   * Se construyen las métricas por anuncio en una sola pasada.
   * Evita hacer .filter() repetidamente por cada anuncio.
   */
  const conversationCountByAd = new Map<string, number>();
  let conversationsWithoutAd = 0;

  data.conversations.forEach((conversation) => {
    if (!conversation.ad_id) {
      conversationsWithoutAd += 1;
      return;
    }

    conversationCountByAd.set(
      conversation.ad_id,
      (conversationCountByAd.get(conversation.ad_id) ?? 0) + 1,
    );
  });

  const salesCountByAd = new Map<string, number>();
  let unattributedSales = 0;

  rangeOrders.forEach((order) => {
    const adId = getOrderAdId(order);

    if (!adId) {
      unattributedSales += 1;
      return;
    }

    salesCountByAd.set(adId, (salesCountByAd.get(adId) ?? 0) + 1);
  });

  const adIdsInPeriod = new Set<string>([
    ...conversationCountByAd.keys(),
    ...salesCountByAd.keys(),
  ]);

  const adMetrics = Array.from(adIdsInPeriod)
    .map((adId) => {
      const registeredAd = registeredAdByExternalId.get(adId);
      const conversations = conversationCountByAd.get(adId) ?? 0;
      const sales = salesCountByAd.get(adId) ?? 0;

      const conversion = conversations
        ? Math.round((sales / conversations) * 1000) / 10
        : 0;

      const relatedProducts = registeredAd?.products as
        | { name?: string | null }
        | Array<{ name?: string | null }>
        | null
        | undefined;

      const productName = Array.isArray(relatedProducts)
        ? relatedProducts[0]?.name
        : relatedProducts?.name;

      return {
        key: registeredAd?.id ?? adId,
        adId,
        name: registeredAd?.name?.trim() || "Anuncio sin registrar",
        productName: productName?.trim() || "Sin producto asignado",
        conversations,
        sales,
        conversion,
      };
    })
    .sort(
      (a, b) =>
        b.sales - a.sales ||
        b.conversations - a.conversations ||
        a.name.localeCompare(b.name),
    );

  const topProducts = Object.entries(
    rangeOrders.reduce<Record<string, number>>((accumulator, order) => {
      const productName = order.product_title?.trim() || "Sin producto";
      accumulator[productName] = (accumulator[productName] ?? 0) + 1;
      return accumulator;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topCities = Object.entries(
    rangeOrders.reduce<Record<string, number>>((accumulator, order) => {
      const city = getNormalizedCityName(order.city);
      accumulator[city] = (accumulator[city] ?? 0) + 1;
      return accumulator;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const topDepartments = Object.entries(
    rangeOrders.reduce<Record<string, number>>((accumulator, order) => {
      const department =
        resolveDepartamento(order.departamento, order.city) ||
        "Sin departamento";
      accumulator[department] = (accumulator[department] ?? 0) + 1;
      return accumulator;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const primaryStats = [
    {
      label: "Conversaciones recibidas",
      value: totalConversations,
      icon: MessageSquare,
      helper: "Conversaciones iniciadas en el periodo",
    },
    {
      label: "Ventas cerradas",
      value: closedSales,
      icon: CheckCircle2,
      helper: "Pedidos no cancelados del periodo",
    },
    {
      label: "Conversión",
      value: `${conversion}%`,
      icon: TrendingUp,
      helper: "Pedidos sobre conversaciones",
    },
    {
      label: "Ingresos",
      value: formatGs(rangeRevenue),
      icon: ShoppingCart,
      helper: "Total de pedidos no cancelados",
    },
  ];

  const orderStats = [
    {
      label: "Pedidos",
      value: rangeOrders.length,
      icon: CalendarDays,
      helper: "Pedidos del periodo",
    },
    {
      label: "Pedidos cargados",
      value: loadedOrders,
      icon: PackageCheck,
      helper: "Estado cargado",
    },
    {
      label: "Pedidos entregados",
      value: deliveredOrders,
      icon: Truck,
      helper: `${deliveredRate}% de los pedidos del periodo`,
    },
    {
      label: "Pedidos de Central",
      value: centralOrders,
      icon: Building2,
      helper: "Departamento Central",
    },
    {
      label: "Pagos anticipados",
      value: prepaidOrders,
      icon: CreditCard,
      helper: "Pagados por adelantado",
    },
  ];

  const resetToToday = () => {
    const currentToday = getTodayDate();
    setDateFrom(currentToday);
    setDateTo(currentToday);
  };

  return (
    <PageShell>
      <PageHeader
        title="Dashboard"
        description={allStores ? "Datos de TODAS las tiendas." : "Métricas de conversaciones, ventas y desempeño de tu IA."}
        actions={<StoreScopeToggle />}
      />

      <div className="space-y-5">
        <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-5 shadow-sm sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />

          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-xl">
              <Badge className="mb-3 gap-1.5 rounded-full px-3 py-1" variant="secondary">
                <Sparkles className="h-3.5 w-3.5" />
                BOT SKY en tiempo real
              </Badge>

              <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                Rendimiento de tu operación
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Seleccioná un periodo para analizar todas las métricas
                comerciales. Por defecto, el dashboard siempre abre con la
                fecha de hoy.
              </p>
            </div>

            <div className="w-full rounded-2xl border bg-background/90 p-4 shadow-sm backdrop-blur xl:max-w-2xl">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
                <div>
                  <label
                    htmlFor="dashboard-date-from"
                    className="mb-1.5 block text-xs font-semibold text-muted-foreground"
                  >
                    Desde
                  </label>
                  <Input
                    id="dashboard-date-from"
                    type="date"
                    value={dateFrom}
                    max={dateTo}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="h-11 rounded-xl"
                  />
                </div>

                <div className="hidden h-11 items-center justify-center text-muted-foreground sm:flex">
                  <ArrowRight className="h-4 w-4" />
                </div>

                <div>
                  <label
                    htmlFor="dashboard-date-to"
                    className="mb-1.5 block text-xs font-semibold text-muted-foreground"
                  >
                    Hasta
                  </label>
                  <Input
                    id="dashboard-date-to"
                    type="date"
                    value={dateTo}
                    min={dateFrom}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="h-11 rounded-xl"
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={resetToToday}
                  className="h-11 rounded-xl"
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Hoy
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                <span>
                  Periodo: {formatDisplayDate(dateFrom)} — {formatDisplayDate(dateTo)}
                </span>
                {isFetching && !isLoading && (
                  <Badge variant="outline" className="ml-auto">
                    Actualizando…
                  </Badge>
                )}
              </div>

              {hasInvalidRange && (
                <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                  La fecha “Desde” no puede ser posterior a la fecha “Hasta”.
                </p>
              )}
            </div>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {primaryStats.map((stat) => (
            <Card
              key={stat.label}
              className="group overflow-hidden rounded-2xl border-border/70 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-2 truncate font-display text-2xl font-bold tracking-tight">
                      {stat.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {stat.helper}
                    </p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                    <stat.icon className="h-5 w-5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {orderStats.map((stat) => (
            <Card
              key={stat.label}
              className="group overflow-hidden rounded-2xl border-border/70 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-2 font-display text-2xl font-bold tracking-tight">
                      {stat.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {stat.helper}
                    </p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                    <stat.icon className="h-5 w-5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="rounded-2xl border-border/70 shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <CreditCard className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Pendientes de pago
              </p>
              <p className="mt-1 font-display text-2xl font-bold">
                {pendingPaymentOrders}
              </p>
            </div>
          </CardContent>
        </Card>

        {allStores && storeRows.length > 0 && (
          <Card className="rounded-2xl border-border/70 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-3 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h2 className="font-display text-lg font-semibold">Ventas por tienda</h2>
                <span className="text-sm text-muted-foreground">periodo seleccionado · sin cancelados</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Vendedor</th>
                      <th className="py-2 pr-3 text-right font-medium">Conversaciones</th>
                      <th className="py-2 pr-3 text-right font-medium">Pedidos</th>
                      <th className="py-2 pr-3 text-right font-medium">Entregados</th>
                      <th className="py-2 pr-3 text-right font-medium">Conversión</th>
                      <th className="py-2 text-right font-medium">Ingresos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storeRows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{row.email}</div>
                          <div className="text-xs text-muted-foreground">{row.name}</div>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.conversations}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{row.orders}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.delivered}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.conversations ? Math.round((row.orders / row.conversations) * 100) : 0}%</td>
                        <td className="py-2 text-right tabular-nums">{formatGs(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-2xl border-border/70 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-lg font-semibold">
                    Rendimiento por anuncio
                  </h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Conversaciones y ventas cerradas por cada anuncio.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{adMetrics.length} anuncios</Badge>
                {conversationsWithoutAd > 0 && (
                  <Badge variant="outline">
                    {conversationsWithoutAd} chats sin anuncio
                  </Badge>
                )}
                {unattributedSales > 0 && (
                  <Badge variant="outline">
                    {unattributedSales} ventas sin atribuir
                  </Badge>
                )}
              </div>
            </div>

            <div className="mt-6 overflow-x-auto">
              {adMetrics.length === 0 ? (
                <EmptyState text="No hay conversaciones provenientes de anuncios en este periodo." />
              ) : (
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-3 pr-4 font-semibold">Anuncio</th>
                      <th className="pb-3 pr-4 font-semibold">Producto</th>
                      <th className="pb-3 px-3 text-center font-semibold">Conversaciones</th>
                      <th className="pb-3 px-3 text-center font-semibold">Ventas</th>
                      <th className="pb-3 pl-3 text-right font-semibold">Conversión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adMetrics.map((ad) => (
                      <tr key={ad.key} className="border-b last:border-0">
                        <td className="py-4 pr-4">
                          <p className="max-w-xs truncate font-semibold">{ad.name}</p>
                          <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                            ID: {ad.adId}
                          </p>
                        </td>
                        <td className="py-4 pr-4">
                          <span className="max-w-xs truncate">{ad.productName}</span>
                        </td>
                        <td className="px-3 py-4 text-center font-medium">
                          {ad.conversations}
                        </td>
                        <td className="px-3 py-4 text-center">
                          <Badge>{ad.sales}</Badge>
                        </td>
                        <td className="py-4 pl-3 text-right font-semibold">
                          {ad.conversion}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="rounded-2xl border-border/70 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold">
                    Productos más vendidos
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ranking de productos dentro del periodo seleccionado.
                  </p>
                </div>
                <Badge variant="secondary">Top 5</Badge>
              </div>

              <div className="mt-6 space-y-4">
                {topProducts.length === 0 && (
                  <EmptyState text="No hay pedidos registrados en este periodo." />
                )}

                {topProducts.map(([name, count], index) => {
                  const highestCount = topProducts[0]?.[1] ?? 1;

                  return (
                    <div key={name} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {name}
                        </span>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                      <div className="ml-10 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${(count / highestCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/70 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" />
                    <h2 className="font-display text-lg font-semibold">
                      Ciudades más vendidas
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ciudades con mayor cantidad de pedidos.
                  </p>
                </div>
                <Badge variant="secondary">Top 10</Badge>
              </div>

              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {topCities.length === 0 && (
                  <div className="sm:col-span-2">
                    <EmptyState text="No hay ciudades registradas en este periodo." />
                  </div>
                )}

                {topCities.map(([city, count], index) => (
                  <div
                    key={city}
                    className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-xs font-bold shadow-sm">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {city}
                    </span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="rounded-2xl border-border/70 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />
                    <h2 className="font-display text-lg font-semibold">
                      Departamentos más vendidos
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Distribución geográfica de los pedidos.
                  </p>
                </div>
                <Badge variant="secondary">Top 5</Badge>
              </div>

              <div className="mt-6 space-y-2">
                {topDepartments.length === 0 && (
                  <EmptyState text="No hay departamentos registrados en este periodo." />
                )}

                {topDepartments.map(([department, count], index) => (
                  <div
                    key={department}
                    className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-xs font-bold shadow-sm">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {department}
                    </span>
                    <Badge variant="secondary">
                      {count} {count === 1 ? "pedido" : "pedidos"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/70 bg-gradient-to-br from-card to-muted/30 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold">
                    Consumo general
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Estos valores no cambian con el filtro de fechas.
                  </p>
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Wallet className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <ConsumptionItem
                  label="Disponibles"
                  value={data.balance?.available ?? 0}
                  icon={Wallet}
                />
                <ConsumptionItem
                  label="Consumidas"
                  value={data.balance?.consumed ?? 0}
                  icon={MessageSquare}
                />
                <ConsumptionItem
                  label="Compradas"
                  value={data.balance?.purchased ?? 0}
                  icon={ShoppingCart}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ConsumptionItem({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Wallet;
}) {
  return (
    <div className="rounded-xl border bg-background/80 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
    </div>
  );
}
