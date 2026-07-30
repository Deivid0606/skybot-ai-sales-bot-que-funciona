import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquareWarning, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  APP_MESSAGE_LABELS,
  DEFAULT_APP_MESSAGES,
  fetchAppMessages,
  type AppMessageKey,
} from "@/lib/app-messages";

export const Route = createFileRoute("/_authenticated/admin/mensajes")({
  head: () => ({
    meta: [
      { title: "Mensajes del sistema — BOT SKY Admin" },
      {
        name: "description",
        content:
          "Editá los avisos que ven los usuarios recién registrados, bloqueados o sin conversaciones disponibles.",
      },
      { property: "og:title", content: "Mensajes del sistema — BOT SKY Admin" },
      {
        property: "og:description",
        content: "Personalizá los avisos automáticos de BOT SKY.",
      },
    ],
  }),
  component: AdminMessagesPage,
});

const KEYS = Object.keys(APP_MESSAGE_LABELS) as AppMessageKey[];

function AdminMessagesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, { title: string; body: string }>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["app-messages"],
    queryFn: fetchAppMessages,
  });

  useEffect(() => {
    if (!data) return;
    setForm(
      Object.fromEntries(
        KEYS.map((k) => [
          k,
          {
            title: data[k]?.title ?? DEFAULT_APP_MESSAGES[k].title,
            body: data[k]?.body ?? DEFAULT_APP_MESSAGES[k].body,
          },
        ]),
      ),
    );
  }, [data]);

  const save = useMutation({
    mutationFn: async (key: AppMessageKey) => {
      const value = form[key];
      const { error } = await supabase
        .from("app_messages")
        .upsert(
          { key, title: value.title.trim(), body: value.body.trim() },
          { onConflict: "key" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mensaje actualizado");
      queryClient.invalidateQueries({ queryKey: ["app-messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell>
      <PageHeader
        title="Mensajes del sistema"
        description="Personalizá los avisos automáticos que ven los vendedores en cada situación."
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {KEYS.map((key) => (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquareWarning className="h-4 w-4 text-primary" />
                  {APP_MESSAGE_LABELS[key].label}
                </CardTitle>
                <CardDescription>{APP_MESSAGE_LABELS[key].help}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`title-${key}`}>Título</Label>
                  <Input
                    id={`title-${key}`}
                    value={form[key]?.title ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [key]: { ...f[key], title: e.target.value } }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`body-${key}`}>Mensaje</Label>
                  <Textarea
                    id={`body-${key}`}
                    rows={4}
                    value={form[key]?.body ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [key]: { ...f[key], body: e.target.value } }))
                    }
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => save.mutate(key)}
                  disabled={save.isPending}
                >
                  {save.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Guardar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
