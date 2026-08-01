import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  MapPin,
  MessageSquare,
  PackageCheck,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { formatGs } from "@/lib/format";
import { resolveDepartamento } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useWorkspaceId } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      {
        title: "Dashboard — BOT SKY",
      },
      {
        name: "description",
        content:
          "Métricas de conversaciones, ventas y desempeño de tu IA.",
      },
      {
        property: "og:title",
        content: "Dashboard — BOT SKY",
      },
      {
        property: "og:description",
        content:
          "Métricas en vivo de tu operación de ventas por WhatsApp.",
      },
    ],
  }),
  component: DashboardPage,
});

/**
 * Devuelve la fecha local actual en formato YYYY-MM-DD.
 * Evita problemas de cambio de día por zona horaria.
 */
function getTodayDate() {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Comprueba si una fecha de Supabase corresponde
 * a la fecha seleccionada según la hora local.
 */
function isSameLocalDate(
  createdAt: string | null,
  selectedDate: string,
) {
  if (!createdAt || !selectedDate) return false;

  const orderDate = new Date(createdAt);
  const [year, month, day] = selectedDate.split("-").map(Number);

  return (
    orderDate.getFullYear() === year &&
    orderDate.getMonth() + 1 === month &&
    orderDate.getDate() === day
  );
}

/**
 * Normaliza textos para comparar sin importar
 * mayúsculas, espacios ni acentos.
 */
function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Comprueba si el pedido tiene una etiqueta específica.
 *
 * Funciona si tags es:
 * - string[]
 * - string separado por comas
 * - null
 */
function hasOrderTag(tags: unknown, expectedTag: string) {
  const normalizedExpectedTag = normalizeText(expectedTag);

  if (Array.isArray(tags)) {
    return tags.some(
      (tag) => normalizeText(tag) === normalizedExpectedTag,
    );
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .some(
        (tag) => normalizeText(tag) === normalizedExpectedTag,
      );
  }

  return false;
}

/**
 * Unifica nombres de ciudades con diferencias de
 * mayúsculas, espacios o acentos.
 */
function getNormalizedCityName(city?: string | null) {
  const value = city?.trim();

  if (!value) return "Sin ciudad";

  return value
    .toLowerCase()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function DashboardPage() {
  const workspaceId = useWorkspaceId();

  const [selectedDate, setSelectedDate] = useState(getTodayDate);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", workspaceId],
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,

    queryFn: async () => {
      const [conversations, orders, balance, messages] =
        await Promise.all([
          supabase
            .from("conversations")
            .select("id, status, sale_closed, created_at")
            .eq("workspace_id", workspaceId!),

          supabase
            .from("orders")
            .select(`
              id,
              total,
              status,
              created_at,
              product_title,
              city,
              departamento,
              payment_status,
              payment_method,
              tags
            `)
            .eq("workspace_id", workspaceId!),

          supabase
            .from("conversation_balances")
            .select("available, consumed, purchased")
            .eq("workspace_id", workspaceId!)
            .maybeSingle(),

          supabase
            .from("messages")
            .select("id, sender")
            .eq("workspace_id", workspaceId!)
            .limit(5000),
        ]);

      if (conversations.error) {
        throw conversations.error;
      }

      if (orders.error) {
        throw orders.error;
      }

      if (balance.error) {
        throw balance.error;
      }

      if (messages.error) {
        throw messages.error;
      }

      return {
        conversations: conversations.data ?? [],
        orders: orders.data ?? [],
        balance: balance.data,
        messages: messages.data ?? [],
      };
    },
  });

  if (isLoading || !data) {
    return (
      <PageShell>
        <PageHeader
          title="Dashboard"
          description="Resumen de tu operación."
        />

        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton
                key={index}
                className="h-28 w-full"
              />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <PageHeader
          title="Dashboard"
          description="Resumen de tu operación."
        />

        <Card>
          <CardContent className="p-5">
            <p className="font-medium text-destructive">
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

  /*
   * =========================================================
   * MÉTRICAS GENERALES
   * =========================================================
   */

  const totalConversations = data.conversations.length;

  const closedSales = data.conversations.filter(
    (conversation) => conversation.sale_closed,
  ).length;

  const conversion = totalConversations
    ? Math.round((closedSales / totalConversations) * 100)
    : 0;

  const validOrders = data.orders.filter(
    (order) => order.status !== "cancelado",
  );

  const totalRevenue = validOrders.reduce(
    (total, order) => total + Number(order.total ?? 0),
    0,
  );

  const aiMessages = data.messages.filter(
    (message) => message.sender === "ai",
  ).length;

  /*
   * =========================================================
   * PEDIDOS DE LA FECHA SELECCIONADA
   * =========================================================
   */

  const dateOrders = validOrders.filter((order) =>
    isSameLocalDate(order.created_at, selectedDate),
  );

  const loadedOrders = dateOrders.filter(
    (order) => order.status === "cargado",
  ).length;

  const centralOrders = dateOrders.filter((order) => {
    const departamento = resolveDepartamento(
      order.departamento,
      order.city,
    );

    return departamento === "Central";
  }).length;

  const prepaidOrders = dateOrders.filter((order) => {
    const paymentStatus = normalizeText(order.payment_status);
    const paymentMethod = normalizeText(order.payment_method);

    return (
      paymentStatus === "anticipado" ||
      paymentMethod.includes("anticipado") ||
      hasOrderTag(order.tags, "Pago anticipado")
    );
  }).length;

  const pendingPaymentOrders = dateOrders.filter((order) => {
    const paymentStatus = normalizeText(order.payment_status);

    return (
      paymentStatus === "pendiente" ||
      hasOrderTag(order.tags, "Pendiente de pago")
    );
  }).length;

  const dateRevenue = dateOrders.reduce(
    (total, order) => total + Number(order.total ?? 0),
    0,
  );

  /*
   * =========================================================
   * PRODUCTOS MÁS VENDIDOS
   * =========================================================
   */

  const topProducts = Object.entries(
    validOrders.reduce<Record<string, number>>(
      (accumulator, order) => {
        const productName =
          order.product_title?.trim() || "Sin producto";

        accumulator[productName] =
          (accumulator[productName] ?? 0) + 1;

        return accumulator;
      },
      {},
    ),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  /*
   * =========================================================
   * CIUDADES MÁS VENDIDAS DE LA FECHA
   * =========================================================
   */

  const topCities = Object.entries(
    dateOrders.reduce<Record<string, number>>(
      (accumulator, order) => {
        const city = getNormalizedCityName(order.city);

        accumulator[city] =
          (accumulator[city] ?? 0) + 1;

        return accumulator;
      },
      {},
    ),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  /*
   * =========================================================
   * DEPARTAMENTOS MÁS VENDIDOS DE LA FECHA
   * =========================================================
   */

  const topDepartments = Object.entries(
    dateOrders.reduce<Record<string, number>>(
      (accumulator, order) => {
        const department =
          resolveDepartamento(
            order.departamento,
            order.city,
          ) || "Sin departamento";

        accumulator[department] =
          (accumulator[department] ?? 0) + 1;

        return accumulator;
      },
      {},
    ),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const generalStats = [
    {
      label: "Conversaciones",
      value: totalConversations,
      icon: MessageSquare,
    },
    {
      label: "Ventas cerradas",
      value: closedSales,
      icon: CheckCircle2,
    },
    {
      label: "Conversión",
      value: `${conversion}%`,
      icon: TrendingUp,
    },
    {
      label: "Ingresos totales",
      value: formatGs(totalRevenue),
      icon: ShoppingCart,
    },
  ];

  const dateStats = [
    {
      label: "Pedidos de la fecha",
      value: dateOrders.length,
      icon: CalendarDays,
    },
    {
      label: "Pedidos cargados",
      value: loadedOrders,
      icon: PackageCheck,
    },
    {
      label: "Pedidos de Central",
      value: centralOrders,
      icon: Building2,
    },
    {
      label: "Pagos anticipados",
      value: prepaidOrders,
      icon: CreditCard,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Dashboard"
        description="Resumen en vivo de tu operación de ventas."
      />

      <div className="space-y-4">
        {/* Selector de fecha */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />

                <h2 className="font-display text-base font-semibold">
                  Resumen diario
                </h2>
              </div>

              <p className="mt-1 text-sm text-muted-foreground">
                Al abrir el dashboard se muestran automáticamente
                los pedidos de hoy.
              </p>
            </div>

            <div className="w-full sm:w-56">
              <label
                htmlFor="dashboard-date"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Seleccionar fecha
              </label>

              <Input
                id="dashboard-date"
                type="date"
                value={selectedDate}
                onChange={(event) =>
                  setSelectedDate(event.target.value)
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Métricas generales */}
        <div>
          <h2 className="mb-3 font-display text-base font-semibold">
            Resumen general
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {generalStats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="flex items-center gap-4 p-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <stat.icon className="h-5 w-5" />
                  </span>

                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {stat.label}
                    </p>

                    <p className="truncate font-display text-xl font-bold">
                      {stat.value}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Métricas por fecha */}
        <div>
          <h2 className="mb-3 font-display text-base font-semibold">
            Pedidos de la fecha seleccionada
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {dateStats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="flex items-center gap-4 p-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <stat.icon className="h-5 w-5" />
                  </span>

                  <div>
                    <p className="text-xs text-muted-foreground">
                      {stat.label}
                    </p>

                    <p className="font-display text-xl font-bold">
                      {stat.value}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Ingresos y pagos de la fecha */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Wallet className="h-5 w-5" />
              </span>

              <div>
                <p className="text-xs text-muted-foreground">
                  Ingresos de la fecha
                </p>

                <p className="font-display text-xl font-bold">
                  {formatGs(dateRevenue)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CreditCard className="h-5 w-5" />
              </span>

              <div>
                <p className="text-xs text-muted-foreground">
                  Pendientes de pago
                </p>

                <p className="font-display text-xl font-bold">
                  {pendingPaymentOrders}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Productos y ciudades */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <h2 className="font-display text-base font-semibold">
                Productos más vendidos
              </h2>

              <p className="mt-1 text-xs text-muted-foreground">
                Todos los pedidos, excepto los cancelados.
              </p>

              <div className="mt-4 space-y-3">
                {topProducts.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Aún no hay pedidos registrados.
                  </p>
                )}

                {topProducts.map(([name, count]) => {
                  const highestCount =
                    topProducts[0]?.[1] ?? 1;

                  const percentage =
                    (count / highestCount) * 100;

                  return (
                    <div
                      key={name}
                      className="flex items-center gap-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {name}
                      </span>

                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted sm:w-32">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${percentage}%`,
                          }}
                        />
                      </div>

                      <Badge variant="secondary">
                        {count}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />

                <h2 className="font-display text-base font-semibold">
                  Ciudades más vendidas
                </h2>
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                Pedidos de la fecha seleccionada.
              </p>

              <div className="mt-4 space-y-3">
                {topCities.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No hay pedidos registrados para esta fecha.
                  </p>
                )}

                {topCities.map(([city, count], index) => (
                  <div
                    key={city}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {index + 1}
                    </span>

                    <span className="min-w-0 flex-1 truncate text-sm">
                      {city}
                    </span>

                    <Badge variant="secondary">
                      {count}{" "}
                      {count === 1 ? "pedido" : "pedidos"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Departamentos y consumo */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />

                <h2 className="font-display text-base font-semibold">
                  Departamentos más vendidos
                </h2>
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                Calculados según departamento o ciudad.
              </p>

              <div className="mt-4 space-y-3">
                {topDepartments.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No hay pedidos registrados para esta fecha.
                  </p>
                )}

                {topDepartments.map(
                  ([department, count], index) => (
                    <div
                      key={department}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {index + 1}
                      </span>

                      <span className="min-w-0 flex-1 truncate text-sm">
                        {department}
                      </span>

                      <Badge variant="secondary">
                        {count}{" "}
                        {count === 1 ? "pedido" : "pedidos"}
                      </Badge>
                    </div>
                  ),
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="font-display text-base font-semibold">
                Consumo
              </h2>

              <div className="flex items-center gap-3">
                <Wallet className="h-4 w-4 text-primary" />

                <span className="text-sm text-muted-foreground">
                  Disponibles
                </span>

                <span className="ml-auto font-semibold">
                  {data.balance?.available ?? 0}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <MessageSquare className="h-4 w-4 text-primary" />

                <span className="text-sm text-muted-foreground">
                  Consumidas
                </span>

                <span className="ml-auto font-semibold">
                  {data.balance?.consumed ?? 0}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Bot className="h-4 w-4 text-primary" />

                <span className="text-sm text-muted-foreground">
                  Respuestas IA
                </span>

                <span className="ml-auto font-semibold">
                  {aiMessages}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <ShoppingCart className="h-4 w-4 text-primary" />

                <span className="text-sm text-muted-foreground">
                  Pedidos totales
                </span>

                <span className="ml-auto font-semibold">
                  {validOrders.length}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
