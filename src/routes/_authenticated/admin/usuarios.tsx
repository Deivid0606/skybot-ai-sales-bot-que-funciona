import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateUserStatus } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuarios — BOT SKY Admin" },
      { name: "description", content: "Aprueba, bloquea o suspende cuentas de vendedores." },
      { property: "og:title", content: "Usuarios — BOT SKY Admin" },
      { property: "og:description", content: "Control de acceso de vendedores en BOT SKY." },
    ],
  }),
  component: AdminUsersPage,
});

const states = ["pending", "approved", "rejected", "blocked", "active", "suspended"] as const;

function AdminUsersPage() {
  const queryClient = useQueryClient();

  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async ({ profileId, status }: { profileId: string; status: (typeof states)[number] }) =>
      updateUserStatus({ data: { profileId, status } }),
    onSuccess: () => {
      toast.success("Estado actualizado");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell>
      <PageHeader title="Usuarios" description="Gestiona el acceso de los vendedores a la plataforma." />
      {!users?.length ? (
        <EmptyState title="Sin usuarios" />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.full_name || u.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.email} {u.company ? `· ${u.company}` : ""} {u.phone ? `· ${u.phone}` : ""}
                  </p>
                </div>
                <Badge variant={u.status === "approved" || u.status === "active" ? "default" : "secondary"}>
                  {u.status}
                </Badge>
                <Select
                  value={u.status}
                  onValueChange={(value) =>
                    update.mutate({ profileId: u.id, status: value as (typeof states)[number] })
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
