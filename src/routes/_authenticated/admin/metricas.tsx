import { createFileRoute } from "@tanstack/react-router";
import { formatGs } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/metricas")({
  head: () => ({
    meta: [
      { title: "Métricas globales — BOT SKY Admin" },
      { name: "description", content: "Actividad global de la plataforma: cuentas, chats y ventas." },
      { property: "og:title", content: "Métricas globales — BOT SKY Admin" },
      { property: "og:description", content: "Vista consolidada de toda la plataforma BOT SKY." },
    ],
  }),
  component: AdminMetricsPage,
});

function AdminMetricsPage() {
  const { data } = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: async () => {
      const [users, conversations, orders, purchases] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("conversations").select("id", { count: "exact", head: true }),
        supabase.from("orders").select("total"),
        supabase.from("plan_purchases").select("amount, status"),
      ]);
      return {
        users: users.count ?? 0,
        conversations: conversations.count ?? 0,
        orders: orders.data?.length ?? 0,
        revenue: (orders.data ?? []).reduce((a, o) => a + Number(o.total ?? 0), 0),
        income: (purchases.data ?? [])
          .filter((p) => p.status === "aprobado")
          .reduce((a, p) => a + Number(p.amount ?? 0), 0),
      };
    },
  });

  const stats = [
    { label: "Cuentas", value: data?.users ?? 0 },
    { label: "Conversaciones", value: data?.conversations ?? 0 },
    { label: "Pedidos", value: data?.orders ?? 0 },
    { label: "Ventas (₲)", value: `${formatGs(data?.revenue ?? 0)}` },
    { label: "Ingresos por planes (₲)", value: `${formatGs(data?.income ?? 0)}` },
  ];

  return (
    <PageShell>
      <PageHeader title="Métricas globales" description="Resumen consolidado de toda la plataforma." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="font-display text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
