import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  // Cuenta de DCANP de cada vendedor (solo el administrador la vincula).
  const { data: workspaces } = useQuery({
    queryKey: ["admin-workspaces-dcanp"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, dcanp_email, dcanp_auto_import, dcanp_auto_status" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; dcanp_email: string | null; dcanp_auto_import: boolean; dcanp_auto_status: string | null }>;
    },
  });
  const workspaceById = new Map((workspaces ?? []).map((w) => [w.id, w]));
  const saveDcanp = useMutation({
    mutationFn: async ({ workspaceId, email }: { workspaceId: string; email: string }) => {
      const value = email.trim().toLowerCase();
      if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Correo inválido");
      const { error } = await supabase.from("workspaces")
        .update({ dcanp_email: value || null } as never).eq("id", workspaceId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cuenta de DCANP guardada");
      queryClient.invalidateQueries({ queryKey: ["admin-workspaces-dcanp"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
                {u.workspace_id && (
                  <DcanpEmailField
                    key={`${u.workspace_id}-${workspaceById.get(u.workspace_id)?.dcanp_email ?? ""}`}
                    initial={workspaceById.get(u.workspace_id)?.dcanp_email ?? ""}
                    suggestion={u.email ?? ""}
                    autoOn={Boolean(workspaceById.get(u.workspace_id)?.dcanp_auto_import)}
                    saving={saveDcanp.isPending}
                    onSave={(email) => saveDcanp.mutate({ workspaceId: u.workspace_id!, email })}
                  />
                )}
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

function DcanpEmailField({ initial, suggestion, autoOn, saving, onSave }: {
  initial: string; suggestion: string; autoOn: boolean; saving: boolean; onSave: (email: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const changed = value.trim().toLowerCase() !== initial.trim().toLowerCase();
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <Input
        className="h-9 w-full sm:w-64"
        placeholder={suggestion ? `Correo DCANP (ej. ${suggestion})` : "Correo DCANP"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Correo de la cuenta DCANP del vendedor"
      />
      <Button size="sm" variant={changed ? "default" : "outline"} disabled={!changed || saving} onClick={() => onSave(value)}>
        Guardar
      </Button>
      {initial && <Badge variant={autoOn ? "default" : "secondary"} title="Carga automática a DCANP">{autoOn ? "Auto ON" : "Auto OFF"}</Badge>}
    </div>
  );
}
