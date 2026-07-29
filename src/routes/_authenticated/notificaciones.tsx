import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceId } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/notificaciones")({
  head: () => ({
    meta: [
      { title: "Notificaciones — BOT SKY" },
      { name: "description", content: "Alertas de ventas, pagos y estado de tu cuenta." },
      { property: "og:title", content: "Notificaciones — BOT SKY" },
      { property: "og:description", content: "Mantente al día con la actividad de tu bot." },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  const { data: items } = useQuery({
    queryKey: ["notifications", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("notifications-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const markAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Notificaciones"
        description="Ventas, pagos y avisos importantes de tu cuenta."
        actions={
          <Button variant="outline" onClick={() => markAll.mutate()}>
            <CheckCheck className="mr-1 h-4 w-4" /> Marcar todo como leído
          </Button>
        }
      />

      {!items?.length ? (
        <EmptyState title="Sin notificaciones" description="Aquí verás la actividad de tu cuenta." />
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n.id} className={n.read_at ? "opacity-70" : ""}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{n.title}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {n.type}
                    </Badge>
                  </div>
                  {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleString("es-CO")}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
