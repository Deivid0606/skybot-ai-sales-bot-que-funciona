import { createFileRoute } from "@tanstack/react-router";
import { formatDateTime, formatGs } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, FileText, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getSignedUrl } from "@/lib/storage";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { reviewPlanPurchase } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/pagos")({
  head: () => ({
    meta: [
      { title: "Planes y pagos — BOT SKY Admin" },
      { name: "description", content: "Aprueba recargas y acredita conversaciones a los vendedores." },
      { property: "og:title", content: "Planes y pagos — BOT SKY Admin" },
      { property: "og:description", content: "Revisión de comprobantes y recargas de saldo." },
    ],
  }),
  component: AdminPaymentsPage,
});

function AdminPaymentsPage() {
  const queryClient = useQueryClient();

  const { data: purchases } = useQuery({
    queryKey: ["admin-purchases"],
    queryFn: async () => {
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
      }));
    },
  });

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
      <PageHeader title="Planes y pagos" description="Aprueba las recargas solicitadas por los vendedores." />
      {!purchases?.length ? (
        <EmptyState title="Sin solicitudes" />
      ) : (
        <div className="space-y-2">
          {purchases.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.plan_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatGs(p.amount)} · {p.conversations} conversaciones ·{" "}
                    {formatDateTime(p.created_at)}
                  </p>
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
    </PageShell>
  );
}
