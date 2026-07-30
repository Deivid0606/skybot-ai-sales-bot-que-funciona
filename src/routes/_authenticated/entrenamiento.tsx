import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/entrenamiento")({
  head: () => ({
    meta: [
      { title: "Entrenamiento de IA — BOT SKY" },
      { name: "description", content: "Enseña a tu IA cómo responder, vender y manejar objeciones." },
      { property: "og:title", content: "Entrenamiento de IA — BOT SKY" },
      { property: "og:description", content: "Base de conocimiento que alimenta a tu vendedor virtual." },
    ],
  }),
  component: TrainingPage,
});

const categories = [
  { value: "general", label: "General" },
  { value: "objeciones", label: "Objeciones" },
  { value: "envios", label: "Envíos" },
  { value: "pagos", label: "Pagos" },
  { value: "cierre", label: "Cierre de venta" },
  { value: "producto", label: "Producto" },
];

type Form = {
  id?: string;
  title: string;
  content: string;
  category: string;
  scope: string;
  product_id: string;
  keywords: string;
  priority: string;
  is_active: boolean;
};

const empty: Form = {
  title: "",
  content: "",
  category: "general",
  scope: "global",
  product_id: "",
  keywords: "",
  priority: "0",
  is_active: true,
};

function TrainingPage() {
  const { profile, user } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const { data: entries } = useQuery({
    queryKey: ["training", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_entries")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products-mini", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name")
        .eq("workspace_id", workspaceId!)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (values: Form) => {
      if (!workspaceId || !user) throw new Error("Sesión no válida");
      const payload = {
        workspace_id: workspaceId,
        user_id: user.id,
        created_by: user.id,
        title: values.title.trim(),
        content: values.content.trim(),
        category: values.category,
        scope: values.scope,
        product_id: values.scope === "producto" && values.product_id ? values.product_id : null,
        keywords: [] as string[],
        priority: Number(values.priority) || 0,
        is_active: values.is_active,
      };
      if (values.id) {
        const { error } = await supabase.from("training_entries").update(payload).eq("id", values.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("training_entries").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Conocimiento guardado");
      setOpen(false);
      setForm(empty);
      queryClient.invalidateQueries({ queryKey: ["training"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("training_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training"] }),
  });

  return (
    <PageShell>
      <PageHeader
        title="Entrenamiento de IA"
        description="Todo lo que agregues aquí se convierte en el conocimiento de tu vendedor virtual."
        actions={
          <Button
            onClick={() => {
              setForm(empty);
              setOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Nuevo conocimiento
          </Button>
        }
      />

      {!entries?.length ? (
        <EmptyState
          title="Sin entrenamiento aún"
          description="Agrega instrucciones, respuestas a objeciones y políticas de envío."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {entries.map((e) => (
            <Card key={e.id}>
              <CardContent className="space-y-2 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{e.title}</h3>
                  <Badge variant={e.is_active ? "default" : "secondary"}>
                    {e.is_active ? "Activo" : "Pausado"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {e.category}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {e.scope}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    prioridad {e.priority}
                  </Badge>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {e.content}
                </p>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setForm({
                        id: e.id,
                        title: e.title,
                        content: e.content,
                        category: e.category,
                        scope: e.scope,
                        product_id: e.product_id ?? "",
                        keywords: "",
                        priority: String(e.priority),
                        is_active: e.is_active,
                      });
                      setOpen(true);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto"
                    aria-label="Eliminar"
                    onClick={() => remove.mutate(e.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar conocimiento" : "Nuevo conocimiento"}</DialogTitle>
            <DialogDescription>
              Escribe en lenguaje natural. La IA priorizará el contenido con mayor prioridad.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input
                value={form.title}
                maxLength={140}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contenido</Label>
              <Textarea
                rows={6}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Alcance</Label>
                <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="producto">Producto específico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.scope === "producto" && (
              <div className="space-y-1.5">
                <Label>Producto</Label>
                <Select
                  value={form.product_id}
                  onValueChange={(v) => setForm({ ...form, product_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                La IA usa todo este contenido para responder; no hacen falta palabras clave.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <Label className="text-sm">Activo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (!form.title.trim() || !form.content.trim()) {
                  toast.error("Título y contenido son obligatorios");
                  return;
                }
                save.mutate(form);
              }}
            >
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
