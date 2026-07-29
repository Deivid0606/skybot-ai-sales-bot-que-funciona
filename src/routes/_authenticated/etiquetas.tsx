import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/etiquetas")({
  head: () => ({
    meta: [
      { title: "Etiquetas — BOT SKY" },
      { name: "description", content: "Organiza tus conversaciones con etiquetas de colores." },
      { property: "og:title", content: "Etiquetas — BOT SKY" },
      { property: "og:description", content: "Clasifica conversaciones y filtra tu inbox." },
    ],
  }),
  component: LabelsPage,
});

function LabelsPage() {
  const { profile, user } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#38bdf8");

  const { data: labels } = useQuery({
    queryKey: ["labels", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labels")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !user) throw new Error("Sesión no válida");
      const { error } = await supabase
        .from("labels")
        .insert({ workspace_id: workspaceId, user_id: user.id, name: name.trim(), color });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      toast.success("Etiqueta creada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("labels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["labels"] }),
  });

  return (
    <PageShell>
      <PageHeader title="Etiquetas" description="Clasifica tus conversaciones por estado o interés." />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label>Nombre</Label>
            <Input
              value={name}
              maxLength={40}
              placeholder="Interesado"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <Input
              type="color"
              value={color}
              className="h-9 w-16 p-1"
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <Button onClick={() => name.trim() && create.mutate()} disabled={create.isPending}>
            <Plus className="mr-1 h-4 w-4" /> Agregar
          </Button>
        </CardContent>
      </Card>

      {!labels?.length ? (
        <EmptyState title="Sin etiquetas" description="Crea etiquetas para segmentar tus chats." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {labels.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <span
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Eliminar etiqueta"
                  onClick={() => remove.mutate(l.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
