import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/registros")({
  head: () => ({
    meta: [
      { title: "Registros — BOT SKY Admin" },
      { name: "description", content: "Bitácora de integraciones, errores y eventos del sistema." },
      { property: "og:title", content: "Registros — BOT SKY Admin" },
      { property: "og:description", content: "Auditoría técnica de la plataforma BOT SKY." },
    ],
  }),
  component: AdminLogsPage,
});

function AdminLogsPage() {
  const { data: logs } = useQuery({
    queryKey: ["admin-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <PageShell>
      <PageHeader title="Registros" description="Eventos de WhatsApp, IA e integraciones externas." />
      {!logs?.length ? (
        <EmptyState title="Sin registros" />
      ) : (
        <div className="space-y-2">
          {logs.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <Badge variant={l.level === "error" ? "destructive" : "secondary"}>{l.level}</Badge>
                <Badge variant="outline">{l.integration}</Badge>
                <span className="min-w-0 flex-1 break-words">{l.message}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(l.created_at).toLocaleString("es-CO")}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
