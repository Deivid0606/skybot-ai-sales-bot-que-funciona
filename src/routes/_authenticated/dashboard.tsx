import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  MessageSquare,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceId } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — BOT SKY" },
      { name: "description", content: "Métricas de conversaciones, ventas y desempeño de tu IA." },
      { property: "og:title", content: "Dashboard — BOT SKY" },
      { property: "og:description", content: "Métricas en vivo de tu operación de ventas por WhatsApp." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const workspaceId = useWorkspaceId();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", workspaceId],
    enabled: Boolean(workspaceId),
    refetchInterval: 60000,
    queryFn: async () => {
      const [conversations, orders, balance, messages] = await Promise.all([
        supabase
          .from("conversations")
          .select("id, status, sale_closed, created_at")
          .eq("workspace_id", workspaceId!),
        supabase
          .from("orders")
          .select("id, total, status, created_at, product_title")
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
      if (conversations.error) throw conversations.error;
      if (orders.error) throw orders.error;
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
        <PageHeader title="Dashboard" description="Resumen de tu operación." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </PageShell>
    );
  }

  const totalConversations = data.conversations.length;
  const closed = data.conversations.filter((c) => c.sale_closed).length;
  const conversion = totalConversations ? Math.round((closed / totalConversations) * 100) : 0;
  const revenue = data.orders
    .filter((o) => o.status !== "cancelado")
    .reduce((acc, o) => acc + Number(o.total ?? 0), 0);
  const aiMessages = data.messages.filter((m) => m.sender === "ai").length;

  const topProducts = Object.entries(
    data.orders.reduce<Record<string, number>>((acc, o) => {
      const key = o.product_title || "Sin producto";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const stats = [
    { label: "Conversaciones", value: totalConversations, icon: MessageSquare },
    { label: "Ventas cerradas", value: closed, icon: CheckCircle2 },
    { label: "Conversión", value: `${conversion}%`, icon: TrendingUp },
    { label: "Ingresos", value: `$${revenue.toLocaleString("es-CO")}`, icon: ShoppingCart },
  ];

  return (
    <PageShell>
      <PageHeader title="Dashboard" description="Resumen en vivo de tu operación de ventas." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="font-display text-xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h2 className="font-display text-base font-semibold">Productos más vendidos</h2>
            <div className="mt-4 space-y-3">
              {topProducts.length === 0 && (
                <p className="text-sm text-muted-foreground">Aún no hay pedidos registrados.</p>
              )}
              {topProducts.map(([name, count]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(count / topProducts[0][1]) * 100}%` }}
                    />
                  </div>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="font-display text-base font-semibold">Consumo</h2>
            <div className="flex items-center gap-3">
              <Wallet className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Disponibles</span>
              <span className="ml-auto font-semibold">{data.balance?.available ?? 0}</span>
            </div>
            <div className="flex items-center gap-3">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Consumidas</span>
              <span className="ml-auto font-semibold">{data.balance?.consumed ?? 0}</span>
            </div>
            <div className="flex items-center gap-3">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Respuestas IA</span>
              <span className="ml-auto font-semibold">{aiMessages}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
