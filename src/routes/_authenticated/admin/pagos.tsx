import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatDateTime, formatGs } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  X,
  FileText,
  Mail,
  TrendingUp,
  Wallet,
  Users,
  MessageSquare,
  Crown,
  History,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getSignedUrl } from "@/lib/storage";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reviewPlanPurchase } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/pagos")({
  head: () => ({
    meta: [
      { title: "Planes y pagos — BOT SKY Admin" },
      { name: "description", content: "Aprueba recargas, mide ingresos por planes y revisa el historial de compradores." },
      { property: "og:title", content: "Planes y pagos — BOT SKY Admin" },
      { property: "og:description", content: "Dashboard de ingresos, top de planes y compradores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPaymentsPage,
});

type Purchase = {
  id: string;
  user_id: string;
  plan_name: string | null;
  amount: number;
  conversations: number;
  status: string;
  created_at: string;
  expires_at: string | null;
  receipt_url: string | null;
  profile: { id: string; email: string | null; full_name: string | null } | null;
};

function AdminPaymentsPage() {
  const queryClient = useQueryClient();
  const [buyer, setBuyer] = useState<string | null>(null);

  const { data: purchases } = useQuery({
    queryKey: ["admin-purchases"],
    queryFn: async (): Promise<Purchase[]> => {
      const { data, error } = await supabase
        .from("plan_purchases")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = Array.from(new Set((data ?? []).map((p) => p.user_id).filter(Boolean)));
      let profiles: { id: string; email: string | null; full_name: string | null }[] = [];
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", ids);
        profiles = profs ?? [];
      }
      return (data ?? []).map((p) => ({
        ...p,
        profile: profiles.find((pr) => pr.id === p.user_id) ?? null,
      })) as Purchase[];
    },
  });

  const { data: balances } = useQuery({
    queryKey: ["admin-balances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_balances")
        .select("user_id, available, purchased, consumed, expires_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const clients = useMemo(() => {
    const all = purchases ?? [];
    const approved = all.filter((p) => p.status === "aprobado");
    const now = Date.now();
    const map = new Map<
      string,
      {
        userId: string;
        email: string;
        name: string;
        plan: string;
        planDate: string | null;
        expiresAt: string | null;
        available: number;
        purchased: number;
        consumed: number;
      }
    >();

    for (const b of balances ?? []) {
      map.set(b.user_id, {
        userId: b.user_id,
        email: "Sin correo",
        name: "",
        plan: "Sin plan",
        planDate: null,
        expiresAt: b.expires_at ?? null,
        available: Number(b.available || 0),
        purchased: Number(b.purchased || 0),
        consumed: Number(b.consumed || 0),
      });
    }

    for (const p of approved) {
      const cur = map.get(p.user_id) ?? {
        userId: p.user_id,
        email: "Sin correo",
        name: "",
        plan: "Sin plan",
        planDate: null,
        expiresAt: null,
        available: 0,
        purchased: 0,
        consumed: 0,
      };
      cur.email = p.profile?.email ?? cur.email;
      cur.name = p.profile?.full_name ?? cur.name;
      if (!cur.planDate || new Date(p.created_at) > new Date(cur.planDate)) {
        cur.plan = p.plan_name ?? "Sin nombre";
        cur.planDate = p.created_at;
        if (p.expires_at) cur.expiresAt = p.expires_at;
      }
      map.set(p.user_id, cur);
    }

    return [...map.values()]
      .map((c) => {
        const expMs = c.expiresAt ? new Date(c.expiresAt).getTime() : null;
        const daysLeft = expMs ? Math.ceil((expMs - now) / 86400000) : null;
        const usedPct = c.purchased ? Math.min(100, (c.consumed / c.purchased) * 100) : 0;
        return {
          ...c,
          daysLeft,
          expired: daysLeft !== null && daysLeft <= 0,
          usedPct,
        };
      })
      .sort((a, b) => b.available - a.available);
  }, [purchases, balances]);

  const stats = useMemo(() => {
    const all = purchases ?? [];
    const approved = all.filter((p) => p.status === "aprobado");
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const revenue = approved.reduce((s, p) => s + Number(p.amount || 0), 0);
    const revenueMonth = approved
      .filter((p) => {
        const d = new Date(p.created_at);
        return `${d.getFullYear()}-${d.getMonth()}` === monthKey;
      })
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const convs = approved.reduce((s, p) => s + Number(p.conversations || 0), 0);

    const planMap = new Map<string, { name: string; count: number; revenue: number }>();
    for (const p of approved) {
      const name = p.plan_name ?? "Sin nombre";
      const cur = planMap.get(name) ?? { name, count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += Number(p.amount || 0);
      planMap.set(name, cur);
    }
    const topPlans = [...planMap.values()].sort((a, b) => b.count - a.count);
    const maxCount = topPlans[0]?.count ?? 1;

    const buyerMap = new Map<
      string,
      {
        userId: string;
        email: string;
        name: string;
        count: number;
        revenue: number;
        conversations: number;
        last: string;
      }
    >();
    for (const p of approved) {
      const cur = buyerMap.get(p.user_id) ?? {
        userId: p.user_id,
        email: p.profile?.email ?? "Sin correo",
        name: p.profile?.full_name ?? "",
        count: 0,
        revenue: 0,
        conversations: 0,
        last: p.created_at,
      };
      cur.count += 1;
      cur.revenue += Number(p.amount || 0);
      cur.conversations += Number(p.conversations || 0);
      if (new Date(p.created_at) > new Date(cur.last)) cur.last = p.created_at;
      buyerMap.set(p.user_id, cur);
    }
    const buyers = [...buyerMap.values()].sort((a, b) => b.revenue - a.revenue);

    return {
      revenue,
      revenueMonth,
      convs,
      approvedCount: approved.length,
      pending: all.filter((p) => p.status === "pendiente").length,
      ticket: approved.length ? Math.round(revenue / approved.length) : 0,
      topPlans,
      maxCount,
      buyers,
    };
  }, [purchases]);

  const buyerHistory = useMemo(
    () => (purchases ?? []).filter((p) => p.user_id === buyer),
    [purchases, buyer],
  );

  const openReceipt = async (path: string) => {
    try {
      const url = path.startsWith("http") ? path : await getSignedUrl("receipts", path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const review = useMutation({
    mutationFn: async ({ purchaseId, approve }: { purchaseId: string; approve: boolean }) =>
      reviewPlanPurchase({ data: { purchaseId, approve } }),
    onSuccess: () => {
      toast.success("Solicitud procesada");
      queryClient.invalidateQueries({ queryKey: ["admin-purchases"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell>
      <PageHeader
        title="Planes y pagos"
        description="Ingresos por venta de planes, top de planes y compradores."
      />

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="solicitudes">
            Solicitudes{stats.pending ? ` (${stats.pending})` : ""}
          </TabsTrigger>
          <TabsTrigger value="compradores">Compradores</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Wallet} label="Ingresos totales" value={formatGs(stats.revenue)} />
            <StatCard icon={TrendingUp} label="Ingresos del mes" value={formatGs(stats.revenueMonth)} />
            <StatCard
              icon={MessageSquare}
              label="Conversaciones vendidas"
              value={stats.convs.toLocaleString("es-PY")}
            />
            <StatCard
              icon={Users}
              label="Compradores únicos"
              value={String(stats.buyers.length)}
              hint={`Ticket promedio ${formatGs(stats.ticket)}`}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Crown className="h-4 w-4 text-primary" /> Planes más comprados
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!stats.topPlans.length ? (
                <p className="text-sm text-muted-foreground">Aún no hay recargas aprobadas.</p>
              ) : (
                stats.topPlans.map((p) => (
                  <div key={p.name} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {p.count} ventas · {formatGs(p.revenue)}
                      </span>
                    </div>
                    <Progress value={(p.count / stats.maxCount) * 100} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="solicitudes">
          {!purchases?.length ? (
            <EmptyState title="Sin solicitudes" />
          ) : (
            <div className="space-y-2">
              {purchases.map((p) => (
                <Card key={p.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.plan_name}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="break-all">
                          {p.profile?.email ?? "Sin correo"}
                          {p.profile?.full_name ? ` · ${p.profile.full_name}` : ""}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatGs(p.amount)} · {p.conversations} conversaciones ·{" "}
                        {formatDateTime(p.created_at)}
                      </p>
                      {p.receipt_url ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => openReceipt(p.receipt_url!)}
                        >
                          <FileText className="mr-1 h-4 w-4" /> Ver comprobante
                        </Button>
                      ) : (
                        <p className="mt-2 text-xs text-destructive">Sin comprobante adjunto</p>
                      )}
                    </div>
                    <Badge
                      variant={
                        p.status === "aprobado"
                          ? "default"
                          : p.status === "rechazado"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {p.status}
                    </Badge>

                    {p.status === "pendiente" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => review.mutate({ purchaseId: p.id, approve: true })}
                          disabled={review.isPending}
                        >
                          <Check className="mr-1 h-4 w-4" /> Aprobar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => review.mutate({ purchaseId: p.id, approve: false })}
                          disabled={review.isPending}
                        >
                          <X className="mr-1 h-4 w-4" /> Rechazar
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="compradores">
          {!stats.buyers.length ? (
            <EmptyState title="Sin compradores todavía" />
          ) : (
            <div className="space-y-2">
              {stats.buyers.map((b) => (
                <Card key={b.userId}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-medium">{b.email}</p>
                      {b.name && <p className="text-xs text-muted-foreground">{b.name}</p>}
                      <p className="text-xs text-muted-foreground">
                        {b.count} compras · {b.conversations} conversaciones · última{" "}
                        {formatDateTime(b.last)}
                      </p>
                    </div>
                    <p className="font-semibold text-primary">{formatGs(b.revenue)}</p>
                    <Button size="sm" variant="outline" onClick={() => setBuyer(b.userId)}>
                      <History className="mr-1 h-4 w-4" /> Historial
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!buyer} onOpenChange={(o) => !o && setBuyer(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Historial de {buyerHistory[0]?.profile?.email ?? "comprador"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {buyerHistory.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{p.plan_name}</p>
                  <Badge
                    variant={
                      p.status === "aprobado"
                        ? "default"
                        : p.status === "rechazado"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {p.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatGs(p.amount)} · {p.conversations} conversaciones ·{" "}
                  {formatDateTime(p.created_at)}
                </p>
                {p.receipt_url && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 h-7 px-2"
                    onClick={() => openReceipt(p.receipt_url!)}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" /> Comprobante
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-4 w-4 text-primary" /> {label}
        </div>
        <p className="mt-1 text-xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
