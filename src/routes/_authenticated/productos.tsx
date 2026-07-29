import { useState } from "react";
import { formatGs } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { guessMediaType, MAX_FILE_BYTES, uploadWorkspaceFile } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/productos")({
  head: () => ({
    meta: [
      { title: "Productos — BOT SKY" },
      { name: "description", content: "Administra tu catálogo, copys, archivos y palabras clave." },
      { property: "og:title", content: "Productos — BOT SKY" },
      { property: "og:description", content: "Catálogo de productos conectado a tu IA de ventas." },
    ],
  }),
  component: ProductsPage,
});

type ProductForm = {
  id?: string;
  name: string;
  sku: string;
  description: string;
  sales_copy: string;
  price: string;
  promo_price: string;
  stock: string;
  is_active: boolean;
  delivery_info: string;
  ai_instructions: string;
  followup_message: string;
  followup_minutes: string;
  followup_enabled: boolean;
  no_repeat_template: boolean;
  keywords: string;
};

const emptyForm: ProductForm = {
  name: "",
  sku: "",
  description: "",
  sales_copy: "",
  price: "0",
  promo_price: "",
  stock: "0",
  is_active: true,
  delivery_info: "",
  ai_instructions: "",
  followup_message: "",
  followup_minutes: "60",
  followup_enabled: false,
  no_repeat_template: true,
  keywords: "",
};

function ProductsPage() {
  const { profile, user } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, product_keywords(id, keyword), product_media(id, media_type, storage_path)")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (values: ProductForm) => {
      if (!workspaceId || !user) throw new Error("Sesión no válida");
      const payload = {
        workspace_id: workspaceId,
        user_id: user.id,
        created_by: user.id,
        name: values.name.trim(),
        sku: values.sku.trim() || null,
        description: values.description.trim() || null,
        sales_copy: values.sales_copy.trim() || null,
        price: Number(values.price) || 0,
        promo_price: values.promo_price ? Number(values.promo_price) : null,
        stock: Number(values.stock) || 0,
        is_active: values.is_active,
        delivery_info: values.delivery_info.trim() || null,
        ai_instructions: values.ai_instructions.trim() || null,
        followup_message: values.followup_message.trim() || null,
        followup_minutes: Number(values.followup_minutes) || 60,
        followup_enabled: values.followup_enabled,
        no_repeat_template: values.no_repeat_template,
      };
      let productId = values.id;
      if (productId) {
        const { error } = await supabase.from("products").update(payload).eq("id", productId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("products").insert(payload).select("id").single();
        if (error) throw error;
        productId = data.id;
      }

      const keywords = values.keywords
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      await supabase.from("product_keywords").delete().eq("product_id", productId!);
      if (keywords.length) {
        const { error } = await supabase.from("product_keywords").insert(
          keywords.map((keyword) => ({
            workspace_id: workspaceId,
            user_id: user.id,
            product_id: productId!,
            keyword,
          })),
        );
        if (error) throw error;
      }
      return productId;
    },
    onSuccess: () => {
      toast.success("Producto guardado");
      setOpen(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Producto eliminado");
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleUpload(productId: string, files: FileList | null) {
    if (!files?.length || !workspaceId || !user) return;
    setUploadingFor(productId);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`${file.name} supera 25MB`);
          continue;
        }
        const path = await uploadWorkspaceFile("product-media", workspaceId, file, productId);
        const { error } = await supabase.from("product_media").insert({
          workspace_id: workspaceId,
          user_id: user.id,
          product_id: productId,
          media_type: guessMediaType(file),
          url: path,
          storage_path: path,
        });
        if (error) throw error;
      }
      toast.success("Archivos subidos");
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al subir");
    } finally {
      setUploadingFor(null);
    }
  }

  function editProduct(p: {
    id: string;
    name: string;
    sku: string | null;
    description: string | null;
    sales_copy: string | null;
    price: number;
    promo_price: number | null;
    stock: number;
    is_active: boolean;
    delivery_info: string | null;
    ai_instructions: string | null;
    followup_message: string | null;
    followup_minutes: number;
    followup_enabled: boolean;
    no_repeat_template: boolean;
    product_keywords: { keyword: string }[];
  }) {
    setForm({
      id: p.id,
      name: p.name,
      sku: p.sku ?? "",
      description: p.description ?? "",
      sales_copy: p.sales_copy ?? "",
      price: String(p.price ?? 0),
      promo_price: p.promo_price ? String(p.promo_price) : "",
      stock: String(p.stock ?? 0),
      is_active: p.is_active,
      delivery_info: p.delivery_info ?? "",
      ai_instructions: p.ai_instructions ?? "",
      followup_message: p.followup_message ?? "",
      followup_minutes: String(p.followup_minutes ?? 60),
      followup_enabled: p.followup_enabled,
      no_repeat_template: p.no_repeat_template,
      keywords: p.product_keywords.map((k) => k.keyword).join(", "),
    });
    setOpen(true);
  }

  return (
    <PageShell>
      <PageHeader
        title="Productos"
        description="Tu catálogo alimenta directamente las respuestas de la IA."
        actions={
          <Button
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Nuevo producto
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      ) : !products?.length ? (
        <EmptyState
          title="Todavía no tienes productos"
          description="Crea tu primer producto con su copy de venta y palabras clave para que la IA pueda detectarlo."
          action={
            <Button
              onClick={() => {
                setForm(emptyForm);
                setOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Crear producto
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{p.name}</h3>
                    <p className="text-xs text-muted-foreground">{p.sku || "Sin SKU"}</p>
                  </div>
                  <Badge variant={p.is_active ? "default" : "secondary"}>
                    {p.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold">
                    {formatGs(p.promo_price ?? p.price)}
                  </span>
                  {p.promo_price && (
                    <span className="text-xs text-muted-foreground line-through">
                      {formatGs(p.price)}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">Stock {p.stock}</span>
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {p.sales_copy || p.description || "Sin copy de venta"}
                </p>
                <div className="flex flex-wrap gap-1">
                  {p.product_keywords.slice(0, 6).map((k) => (
                    <Badge key={k.id} variant="outline" className="text-[10px]">
                      {k.keyword}
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => editProduct(p)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                  </Button>
                  <label className="inline-flex">
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => handleUpload(p.id, e.target.files)}
                    />
                    <span className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
                      {uploadingFor === p.id ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="mr-1 h-3.5 w-3.5" />
                      )}
                      Archivos ({p.product_media.length})
                    </span>
                  </label>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setDeleteId(p.id)}
                    aria-label="Eliminar"
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar producto" : "Nuevo producto"}</DialogTitle>
            <DialogDescription>
              La IA usará este contenido para responder y cerrar ventas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                maxLength={140}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>SKU</Label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Stock</Label>
              <Input
                type="number"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Precio (₲)</Label>
              <Input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Precio promocional (₲)</Label>
              <Input
                type="number"
                value={form.promo_price}
                onChange={(e) => setForm({ ...form, promo_price: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Descripción</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Copy de venta</Label>
              <Textarea
                rows={4}
                value={form.sales_copy}
                onChange={(e) => setForm({ ...form, sales_copy: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Palabras clave (separadas por coma)</Label>
              <Input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="reloj, reloj inteligente, smartwatch"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Información de entrega</Label>
              <Textarea
                rows={2}
                value={form.delivery_info}
                onChange={(e) => setForm({ ...form, delivery_info: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Instrucciones específicas para la IA</Label>
              <Textarea
                rows={3}
                value={form.ai_instructions}
                onChange={(e) => setForm({ ...form, ai_instructions: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Mensaje de seguimiento</Label>
              <Textarea
                rows={2}
                value={form.followup_message}
                onChange={(e) => setForm({ ...form, followup_message: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Minutos para el seguimiento</Label>
              <Input
                type="number"
                value={form.followup_minutes}
                onChange={(e) => setForm({ ...form, followup_minutes: e.target.value })}
              />
            </div>
            <div className="space-y-3 pt-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.followup_enabled}
                  onCheckedChange={(v) => setForm({ ...form, followup_enabled: v })}
                />
                <Label className="text-sm">Seguimiento activo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.no_repeat_template}
                  onCheckedChange={(v) => setForm({ ...form, no_repeat_template: v })}
                />
                <Label className="text-sm">No repetir plantilla</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label className="text-sm">Producto activo</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              <X className="mr-1 h-4 w-4" /> Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!form.name.trim()) {
                  toast.error("El nombre es obligatorio");
                  return;
                }
                save.mutate(form);
              }}
              disabled={save.isPending}
            >
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán también sus archivos, palabras clave y seguimientos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) remove.mutate(deleteId);
                setDeleteId(null);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
