import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, FileSpreadsheet, FileText, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  { value: "correccion", label: "Corrección / Regla de la IA" },
  { value: "general", label: "General" },
  { value: "objeciones", label: "Objeciones" },
  { value: "envios", label: "Envíos" },
  { value: "pagos", label: "Pagos" },
  { value: "cierre", label: "Cierre de venta" },
  { value: "producto", label: "Producto" },
];

const quickRules: { label: string; title: string; content: string }[] = [
  {
    label: "Cantidades exactas",
    title: "Regla de cantidades",
    content:
      'Cuando el cliente escriba un número suelto (ej: "2" o "2 unidades"), la cantidad es EXACTAMENTE ese número. Nunca dupliques ni concatenes dígitos. Si repite la cantidad, no la sumes. Total = precio vigente × cantidad.',
  },
  {
    label: "No inventar precios",
    title: "Regla de precios",
    content:
      "Usa solo los precios del catálogo. Si no encontrás el precio, decí que lo consultás y no inventes montos ni descuentos.",
  },
  {
    label: "Pedir ciudad primero",
    title: "Regla de flujo de venta",
    content:
      "Antes de hablar de envío o pago, preguntá siempre la ciudad del cliente para verificar cobertura y costo.",
  },
  {
    label: "Mensajes cortos",
    title: "Regla de estilo",
    content:
      "Respondé en máximo 2 frases cortas, tono cercano paraguayo, sin listas largas ni textos formales.",
  },
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

type TransferEntry = {
  title: string;
  content: string;
  category: string;
  scope: string;
  product_name: string | null;
  keywords: string[];
  priority: number;
  is_active: boolean;
};

type TrainingTransfer = {
  format: "BOT_SKY_TRAINING";
  version: 1;
  exported_at: string;
  entries: TransferEntry[];
};

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob(["\uFEFF", content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: unknown): string {
  // Escapa fórmulas para que Google Sheets/Excel no ejecuten contenido importado.
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text) && !/^-?\d+(?:[.,]\d+)?$/.test(text.trim())) {
    text = "'" + text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function TrainingPage() {
  const { profile, user } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [transferring, setTransferring] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };
  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };
  const deleteSelected = async () => {
    if (!workspaceId || deletingBulk || selectedIds.length === 0) return;
    setDeletingBulk(true);
    try {
      const ids = [...selectedIds];
      let deleted = 0;
      // Los lotes pequeños evitan consultas demasiado largas y mantienen el alcance del workspace.
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const { data, error } = await supabase
          .from("training_entries")
          .delete()
          .eq("workspace_id", workspaceId)
          .in("id", batch)
          .select("id");
        if (error) throw new Error(`${deleted} eliminados antes del error: ${error.message}`);
        const removedIds = new Set((data ?? []).map((item) => item.id));
        deleted += removedIds.size;
        setSelectedIds((current) => current.filter((id) => !removedIds.has(id)));
      }
      await queryClient.invalidateQueries({ queryKey: ["training", workspaceId] });
      toast.success(`${deleted} conocimientos eliminados`);
      exitSelection();
      setConfirmBulkDelete(false);
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: ["training", workspaceId] });
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar", { duration: 9000 });
      setConfirmBulkDelete(false);
    } finally {
      setDeletingBulk(false);
    }
  };

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

  // Se pagina para exportar/importar sin perder entradas cuando hay más de 1000.
  const fetchAllTraining = async () => {
    if (!workspaceId) throw new Error("No se encontró el espacio de trabajo");
    const all: Array<NonNullable<typeof entries>[number]> = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("training_entries")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      all.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
    return all;
  };

  const makeTransfer = async (): Promise<TrainingTransfer> => {
    const all = await fetchAllTraining();
    const productNames = new Map<string, string>((products ?? []).map((p) => [p.id, p.name]));
    return {
      format: "BOT_SKY_TRAINING",
      version: 1,
      exported_at: new Date().toISOString(),
      entries: all.map((e) => ({
        title: e.title,
        content: e.content,
        category: e.category,
        scope: e.scope,
        product_name: e.product_id ? productNames.get(e.product_id) ?? null : null,
        keywords: Array.isArray(e.keywords) ? e.keywords.filter((k): k is string => typeof k === "string") : [],
        priority: Number(e.priority) || 0,
        is_active: Boolean(e.is_active),
      })),
    };
  };

  const exportTraining = async (format: "txt" | "csv") => {
    if (transferring) return;
    setTransferring(true);
    try {
      const transfer = await makeTransfer();
      const date = new Date().toISOString().slice(0, 10);
      if (format === "txt") {
        // JSON válido guardado como .txt: importación exacta y sin perder saltos de línea.
        downloadText(`BOT-SKY-entrenamiento-${date}.txt`, JSON.stringify(transfer, null, 2), "text/plain");
      } else {
        const headers = ["Título", "Contenido", "Categoría", "Alcance", "Producto", "Palabras clave", "Prioridad", "Activo"];
        const rows = transfer.entries.map((e) => [
          e.title, e.content, e.category, e.scope, e.product_name ?? "",
          e.keywords.join("; "), e.priority, e.is_active ? "Sí" : "No",
        ]);
        const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
        downloadText(`BOT-SKY-entrenamiento-${date}.csv`, csv, "text/csv");
      }
      toast.success(`${transfer.entries.length} conocimientos exportados`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo exportar");
    } finally {
      setTransferring(false);
    }
  };

  const importTraining = async (file: File) => {
    if (transferring) return;
    setTransferring(true);
    try {
      if (!file.name.toLowerCase().endsWith(".txt")) throw new Error("Seleccioná un archivo TXT exportado desde BOT SKY");
      if (file.size > 10 * 1024 * 1024) throw new Error("El archivo supera los 10 MB");
      if (!workspaceId || !user) throw new Error("Sesión no válida");
      const raw = (await file.text()).replace(/^\uFEFF/, "");
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new Error("TXT inválido: exportalo desde BOT SKY antes de importarlo"); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Formato de entrenamiento inválido");
      const transfer = parsed as Partial<TrainingTransfer>;
      if (transfer.format !== "BOT_SKY_TRAINING" || transfer.version !== 1 || !Array.isArray(transfer.entries)) {
        throw new Error("Este TXT no es compatible con el importador BOT SKY");
      }
      if (transfer.entries.length > 10000) throw new Error("El archivo contiene demasiadas entradas");
      const current = await fetchAllTraining();
      const known = new Set(current.map((e) => [normalized(e.title), normalized(e.category), e.scope, e.product_id ?? ""].join("|")));
      const productByName = new Map<string, string>((products ?? []).map((p) => [normalized(p.name), p.id]));
      const toInsert: Array<{
        workspace_id: string; user_id: string; created_by: string; title: string; content: string;
        category: string; scope: string; product_id: string | null; keywords: string[];
        priority: number; is_active: boolean;
      }> = [];
      let skipped = 0;
      let unmatched = 0;
      let invalid = 0;
      for (const item of transfer.entries) {
        if (!item || typeof item !== "object" || typeof item.title !== "string" || typeof item.content !== "string" ||
            typeof item.category !== "string" || typeof item.scope !== "string" ||
            !item.title.trim() || !item.content.trim() || item.title.length > 140 ||
            !["global", "producto"].includes(item.scope)) {
          invalid++;
          continue;
        }
        let productId: string | null = null;
        if (item.scope === "producto") {
          productId = typeof item.product_name === "string" ? productByName.get(normalized(item.product_name)) ?? null : null;
          if (!productId) { unmatched++; continue; }
        }
        const key = [normalized(item.title), normalized(item.category), item.scope, productId ?? ""].join("|");
        if (known.has(key)) { skipped++; continue; }
        known.add(key);
        toInsert.push({
          workspace_id: workspaceId,
          user_id: user.id,
          created_by: user.id,
          title: item.title.trim(),
          content: item.content.trim(),
          category: item.category.trim(),
          scope: item.scope,
          product_id: productId,
          keywords: Array.isArray(item.keywords) ? item.keywords.filter((k): k is string => typeof k === "string").slice(0, 100) : [],
          priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
          is_active: item.is_active === true,
        });
      }
      let imported = 0;
      for (let i = 0; i < toInsert.length; i += 100) {
        const batch = toInsert.slice(i, i + 100);
        const { error } = await supabase.from("training_entries").insert(batch);
        if (error) {
          throw new Error(`Se importaron ${imported} entradas antes del error: ${error.message}`);
        }
        imported += batch.length;
      }
      await queryClient.invalidateQueries({ queryKey: ["training", workspaceId] });
      toast.success(`Importadas: ${imported}. Repetidas: ${skipped}. Sin producto equivalente: ${unmatched}. Inválidas: ${invalid}.`, { duration: 9000 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al importar", { duration: 9000 });
    } finally {
      setTransferring(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
        keywords: values.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              aria-label="Seleccionar entrenamiento TXT"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importTraining(file);
              }}
            />
            <Button variant="outline" disabled={transferring} onClick={() => void exportTraining("txt")}>
              <FileText className="mr-1 h-4 w-4" /> Exportar TXT
            </Button>
            <Button variant="outline" disabled={transferring} onClick={() => void exportTraining("csv")}>
              <FileSpreadsheet className="mr-1 h-4 w-4" /> Exportar Sheet
            </Button>
            <Button variant="outline" disabled={transferring} onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" /> Cargar entrenamiento
            </Button>
            <Button variant={selectionMode ? "secondary" : "outline"} disabled={deletingBulk} onClick={() => selectionMode ? exitSelection() : setSelectionMode(true)}>
              {selectionMode ? <X className="mr-1 h-4 w-4" /> : <CheckSquare className="mr-1 h-4 w-4" />}
              {selectionMode ? "Cancelar selección" : "Seleccionar varios"}
            </Button>
            <Button onClick={() => { setForm(empty); setOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Nuevo conocimiento
            </Button>
          </div>
        }
      />

      {selectionMode && !!entries?.length && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={entries.every((entry) => selectedIds.includes(entry.id))}
              onCheckedChange={(checked) => setSelectedIds(checked === true ? entries.map((entry) => entry.id) : [])}
              disabled={deletingBulk}
            />
            Seleccionar todos ({entries.length})
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.length} seleccionados</span>
            <Button
              variant="destructive"
              disabled={selectedIds.length === 0 || deletingBulk}
              onClick={() => setConfirmBulkDelete(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Eliminar seleccionados
            </Button>
          </div>
        </div>
      )}

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
                  {selectionMode && (
                    <Checkbox
                      checked={selectedIds.includes(e.id)}
                      onCheckedChange={() => toggleSelected(e.id)}
                      disabled={deletingBulk}
                      aria-label={`Seleccionar ${e.title}`}
                    />
                  )}
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
                    disabled={selectionMode || deletingBulk}
                    onClick={() => {
                      setForm({
                        id: e.id,
                        title: e.title,
                        content: e.content,
                        category: e.category,
                        scope: e.scope,
                        product_id: e.product_id ?? "",
                        keywords: Array.isArray(e.keywords) ? e.keywords.join(", ") : "",
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
                    disabled={selectionMode || deletingBulk}
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

      <Dialog open={confirmBulkDelete} onOpenChange={(value) => { if (!deletingBulk) setConfirmBulkDelete(value); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Eliminar {selectedIds.length} conocimientos?</DialogTitle>
            <DialogDescription>
              Esta acción elimina definitivamente los entrenamientos seleccionados de este espacio de trabajo.
              No se puede deshacer. Te recomendamos exportar el TXT antes de continuar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deletingBulk} onClick={() => setConfirmBulkDelete(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={deletingBulk || selectedIds.length === 0} onClick={() => void deleteSelected()}>
              {deletingBulk && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sí, eliminar {selectedIds.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Correcciones rápidas
              </Label>
              <div className="flex flex-wrap gap-2">
                {quickRules.map((r) => (
                  <Button
                    key={r.label}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        title: r.title,
                        content: r.content,
                        category: "correccion",
                        priority: "10",
                      }))
                    }
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Las entradas con categoría "Corrección / Regla de la IA" se envían como reglas
                obligatorias, por encima del resto del entrenamiento.
              </p>
            </div>

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
