import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MessageSquare, Phone, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";
import { COMPLAINT_REASON_LABELS } from "@/lib/complaints";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceId } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reclamos")({
  head: () => ({
    meta: [
      { title: "Reclamos — BOT SKY" },
      {
        name: "description",
        content:
          "Reclamos detectados automáticamente en los chats de WhatsApp con número, motivo, fecha y hora.",
      },
      { property: "og:title", content: "Reclamos — BOT SKY" },
      {
        property: "og:description",
        content: "Detección automática de quejas y reclamos de tus clientes.",
      },
    ],
  }),
  component: ComplaintsPage,
});

const STATUS_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  revision: "En revisión",
  resuelto: "Resuelto",
};

function ComplaintsPage() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("todos");

  const { data: items } = useQuery({
    queryKey: ["complaints", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("complaints")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("complaints-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => {
        queryClient.invalidateQueries({ queryKey: ["complaints"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("complaints").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["complaints"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("complaints").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reclamo eliminado");
      queryClient.invalidateQueries({ queryKey: ["complaints"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (items ?? []).filter((c) => filter === "todos" || c.status === filter);
  const pending = (items ?? []).filter((c) => c.status !== "resuelto").length;

  return (
    <PageShell>
      <PageHeader
        title="Reclamos"
        description="Detección automática de quejas y reclamos en los chats que llegan al Inbox."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={pending ? "destructive" : "secondary"}>{pending} pendientes</Badge>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="nuevo">Nuevos</SelectItem>
                <SelectItem value="revision">En revisión</SelectItem>
                <SelectItem value="resuelto">Resueltos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {!list.length ? (
        <EmptyState
          title="Sin reclamos detectados"
          description="Cuando un cliente escriba una queja o reclamo por WhatsApp, aparecerá aquí con su número, motivo, fecha y hora."
        />
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <Card key={c.id} className={c.status === "resuelto" ? "opacity-70" : ""}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle
                    className={
                      c.severity === "alta"
                        ? "h-4 w-4 text-destructive"
                        : "h-4 w-4 text-muted-foreground"
                    }
                  />
                  <span className="flex items-center gap-1 font-medium">
                    <Phone className="h-3.5 w-3.5" />
                    {c.phone}
                  </span>
                  {c.contact_name && (
                    <span className="text-sm text-muted-foreground">{c.contact_name}</span>
                  )}
                  <Badge variant={c.severity === "alta" ? "destructive" : "secondary"}>
                    {COMPLAINT_REASON_LABELS[c.reason] ?? c.reason}
                  </Badge>
                  <Badge variant="outline">{STATUS_LABELS[c.status] ?? c.status}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDateTime(c.created_at)}
                  </span>
                </div>

                <p className="rounded-md bg-muted/50 p-3 text-sm break-words">{c.body}</p>

                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/inbox">
                      <MessageSquare className="mr-1 h-4 w-4" /> Ver chat
                    </Link>
                  </Button>
                  {c.status !== "revision" && c.status !== "resuelto" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStatus.mutate({ id: c.id, status: "revision" })}
                    >
                      En revisión
                    </Button>
                  )}
                  {c.status !== "resuelto" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStatus.mutate({ id: c.id, status: "resuelto" })}
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Resuelto
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(c.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
