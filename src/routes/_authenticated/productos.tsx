import { useState } from "react";
import { formatGs } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link as LinkIcon, Loader2, Pencil, Phone, Plus, Trash2, Upload, X } from "lucide-react";
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
import {
  MEDIA_LIMITS,
  ProductMediaManager,
  type ExistingMedia,
} from "@/components/product-media-manager";
import { ProductPreview } from "@/components/product-preview";

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

type ProductPriceForm = {
  id?: string;
  label: string;
  quantity: string;
  price: string;
};

type ProductForm = {
  id?: string;
  name: string;
  sku: string;
  description: string;
  sales_copy: string;
  prices: ProductPriceForm[];
  stock: string;
  is_active: boolean;
  delivery_info: string;
  ai_instructions: string;
  followup_message: string;
  followup_second_message: string;
  followup_second_minutes: string;
  followup_minutes: string;
  followup_enabled: boolean;
  no_repeat_template: boolean;
  keywords: string;
};

function createEmptyForm(): ProductForm {
  return {
    name: "",
    sku: "",
    description: "",
    sales_copy: "",
    prices: [{ label: "1 unidad", quantity: "1", price: "" }],
    stock: "0",
    is_active: true,
    delivery_info: "",
    ai_instructions: "",
    followup_message: "¡Hola! 😊 ¿Te gustaría continuar con tu pedido? Estoy para ayudarte.",
    followup_second_message: "¡Hola de nuevo! 😊 ¿Todavía te interesa el producto que consultaste? Podemos ayudarte a finalizar el pedido.",
    followup_second_minutes: "1380",
    followup_minutes: "120",
    followup_enabled: false,
    no_repeat_template: true,
    keywords: "",
  };
}

function ProductsPage() {
  const { profile, user } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(createEmptyForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingMedia, setEditingMedia] = useState<ExistingMedia[]>([]);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneValue, setPhoneValue] = useState("");

  const { data: waConn } = useQuery({
    queryKey: ["catalog-phone", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_connections")
        .select("id, display_phone")
        .eq("workspace_id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const catalogPhone = (waConn?.display_phone ?? "").replace(/[^0-9]/g, "");

  const savePhone = useMutation({
    mutationFn: async (raw: string) => {
      const digits = raw.replace(/[^0-9]/g, "");
      if (digits.length < 8) throw new Error("Ingresá el número con código de país (ej. 595981123456)");
      if (!workspaceId || !user) throw new Error("Sesión no válida");
      if (waConn?.id) {
        const { error } = await supabase
          .from("whatsapp_connections")
          .update({ display_phone: digits })
          .eq("id", waConn.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("whatsapp_connections")
          .insert({ workspace_id: workspaceId, user_id: user.id, display_phone: digits });
        if (error) throw error;
      }
      return digits;
    },
    onSuccess: () => {
      toast.success("Número de WhatsApp guardado");
      setPhoneOpen(false);
      queryClient.invalidateQueries({ queryKey: ["catalog-phone", workspaceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: products, isLoading } = useQuery({
    queryKey: ["products", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, product_keywords(id, keyword), product_media(id, media_type, storage_path), product_prices(id, label, quantity, price, sort_order)")
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
        // Las opciones se guardan exclusivamente en product_prices.
        // Se mantienen las columnas heredadas en cero/null solo por compatibilidad del esquema.
        price: 0,
        promo_price: null,
        stock: Number(values.stock) || 0,
        is_active: values.is_active,
        delivery_info: values.delivery_info.trim() || null,
        ai_instructions: values.ai_instructions.trim() || null,
        followup_message: values.followup_message.trim() || null,
        followup_second_message: values.followup_second_message.trim() || null,
        followup_second_minutes: Math.min(1400, Math.max(1, Number(values.followup_second_minutes) || 1380)),
        followup_minutes: Math.min(1360, Math.max(1, Number(values.followup_minutes) || 120)),
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

      const normalizedPrices = values.prices
        .map((item, index) => ({
          label: item.label.trim(),
          quantity: Math.max(1, Number(item.quantity) || 1),
          price: Number(item.price) || 0,
          sort_order: index,
        }))
        .filter((item) => item.label && item.price > 0);

      await supabase.from("product_prices").delete().eq("product_id", productId!);
      if (normalizedPrices.length) {
        const { error } = await supabase.from("product_prices").insert(
          normalizedPrices.map((item) => ({
            workspace_id: workspaceId,
            user_id: user.id,
            product_id: productId!,
            ...item,
          })),
        );
        if (error) throw error;
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
      if (pendingFiles.length) {
        for (const file of pendingFiles) {
          const path = await uploadWorkspaceFile("product-media", workspaceId, file, productId!);
          const { error } = await supabase.from("product_media").insert({
            workspace_id: workspaceId,
            user_id: user.id,
            product_id: productId!,
            media_type: guessMediaType(file),
            url: path,
            storage_path: path,
          });
          if (error) throw error;
        }
      }
      return productId;
    },
    onSuccess: () => {
      toast.success("Producto guardado");
      setOpen(false);
      setForm(createEmptyForm());
      setPendingFiles([]);
      setEditingMedia([]);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function removeMedia(media: ExistingMedia) {
    try {
      if (media.storage_path) {
        await supabase.storage.from("product-media").remove([media.storage_path]);
      }
      const { error } = await supabase.from("product_media").delete().eq("id", media.id);
      if (error) throw error;
      setEditingMedia((prev) => prev.filter((m) => m.id !== media.id));
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar el archivo");
    }
  }



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
    product_prices: {
      id: string;
      label: string;
      quantity: number;
      price: number;
      sort_order: number;
    }[];
    stock: number;
    is_active: boolean;
    delivery_info: string | null;
    ai_instructions: string | null;
    followup_message: string | null;
    followup_second_message: string | null;
    followup_second_minutes: number | null;
    followup_minutes: number;
    followup_enabled: boolean;
    no_repeat_template: boolean;
    product_keywords: { keyword: string }[];
    product_media: ExistingMedia[];
  }) {
    setForm({
      id: p.id,
      name: p.name,
      sku: p.sku ?? "",
      description: p.description ?? "",
      sales_copy: p.sales_copy ?? "",
      prices: [...(p.product_prices ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({
          id: item.id,
          label: item.label,
          quantity: String(item.quantity),
          price: String(item.price),
        }))
        .concat((p.product_prices ?? []).length ? [] : [{ label: "1 unidad", quantity: "1", price: "" }]),
      stock: String(p.stock ?? 0),
      is_active: p.is_active,
      delivery_info: p.delivery_info ?? "",
      ai_instructions: p.ai_instructions ?? "",
      followup_message: p.followup_message ?? "",
      followup_second_message: p.followup_second_message ?? "",
      followup_second_minutes: String(p.followup_second_minutes ?? 1380),
      followup_minutes: String(p.followup_minutes ?? 120),
      followup_enabled: p.followup_enabled,
      no_repeat_template: p.no_repeat_template,
      keywords: p.product_keywords.map((k) => k.keyword).join(", "),
    });
    setPendingFiles([]);
    setEditingMedia(p.product_media ?? []);
    setOpen(true);
  }


  return (
    <PageShell>
      <PageHeader
        title="Productos"
        description="Tu catálogo alimenta directamente las respuestas de la IA."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant={catalogPhone ? "outline" : "default"}
              disabled={!workspaceId}
              onClick={() => {
                setPhoneValue(catalogPhone);
                setPhoneOpen(true);
              }}
            >
              <Phone className="mr-1 h-4 w-4" />
              {catalogPhone ? `WhatsApp: ${catalogPhone}` : "Agregar número de WhatsApp"}
            </Button>
            <Button
              variant="outline"
              disabled={!workspaceId}
              onClick={() => {
                if (!workspaceId) return;
                navigator.clipboard.writeText(`${window.location.origin}/c/${workspaceId}`);
                toast.success("Link del catálogo copiado");
              }}
            >
              <LinkIcon className="mr-1 h-4 w-4" /> Copiar link del catálogo
            </Button>
            <Button
              variant="outline"
              disabled={!workspaceId}
              onClick={() => window.open(`/c/${workspaceId}`, "_blank", "noopener")}
            >
              <ExternalLink className="mr-1 h-4 w-4" /> Ver catálogo
            </Button>
            <Button
              onClick={() => {
                setForm(createEmptyForm());
                setPendingFiles([]);
                setEditingMedia([]);
                setOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Nuevo producto
            </Button>
          </div>
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
                setForm(createEmptyForm());
                setPendingFiles([]);
                setEditingMedia([]);
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
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Opciones de precio</span>
                    <span className="text-xs text-muted-foreground">Stock {p.stock}</span>
                  </div>
                  {p.product_prices?.length > 0 ? (
                    <div className="space-y-1.5">
                      {[...p.product_prices]
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .slice(0, 3)
                        .map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
                          >
                            <span className="truncate">{item.label}</span>
                            <span className="shrink-0 font-semibold">{formatGs(item.price)}</span>
                          </div>
                        ))}
                      {p.product_prices.length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          +{p.product_prices.length - 3} precios más
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-destructive">Sin precios cargados</p>
                  )}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar producto" : "Nuevo producto"}</DialogTitle>
            <DialogDescription>
              La IA usará este contenido para responder y cerrar ventas. Puedes adjuntar hasta{" "}
              {MEDIA_LIMITS.image} imágenes, {MEDIA_LIMITS.video} videos y {MEDIA_LIMITS.audio}{" "}
              audios.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ProductMediaManager
                existing={editingMedia}
                pending={pendingFiles}
                onPendingChange={setPendingFiles}
                onRemoveExisting={removeMedia}
              />
            </div>
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
            <div className="space-y-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Opciones de precio</Label>
                  <p className="text-xs text-muted-foreground">
                    Agrega una opción por cada cantidad o presentación disponible.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      prices: [
                        ...current.prices,
                        { label: "", quantity: "1", price: "" },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-1 h-4 w-4" /> Agregar precio
                </Button>
              </div>

              {form.prices.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Debes agregar al menos una opción de precio.
                </div>
              ) : (
                <div className="space-y-2">
                  {form.prices.map((item, index) => (
                    <div
                      key={item.id ?? `new-${index}`}
                      className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,180px)_40px]"
                    >
                      <div className="space-y-1">
                        <Label className="text-xs">Nombre</Label>
                        <Input
                          placeholder="Ej. 2 unidades"
                          value={item.label}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              prices: current.prices.map((priceItem, currentIndex) =>
                                currentIndex === index
                                  ? { ...priceItem, label: e.target.value }
                                  : priceItem,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Cantidad</Label>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              prices: current.prices.map((priceItem, currentIndex) =>
                                currentIndex === index
                                  ? { ...priceItem, quantity: e.target.value }
                                  : priceItem,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Precio total (₲)</Label>
                        <Input
                          type="number"
                          min="0"
                          placeholder="350000"
                          value={item.price}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              prices: current.prices.map((priceItem, currentIndex) =>
                                currentIndex === index
                                  ? { ...priceItem, price: e.target.value }
                                  : priceItem,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Eliminar precio ${index + 1}`}
                          disabled={form.prices.length === 1}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              prices: current.prices.filter(
                                (_, currentIndex) => currentIndex !== index,
                              ),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              <Label>1.º seguimiento — mensaje (por defecto: 2 horas)</Label>
              <Textarea rows={2} value={form.followup_message}
                onChange={(e) => setForm({ ...form, followup_message: e.target.value })} />
              <p className="text-xs text-muted-foreground">El enlace del catálogo se agregará automáticamente al final del mensaje.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Primer seguimiento (minutos)</Label>
              <Input type="number" min={1} max={1360} value={form.followup_minutes}
                onChange={(e) => setForm({ ...form, followup_minutes: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>2.º seguimiento — último mensaje (por defecto: 23 horas)</Label>
              <Textarea rows={2} value={form.followup_second_message}
                onChange={(e) => setForm({ ...form, followup_second_message: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Segundo seguimiento (minutos, máximo 1400)</Label>
              <Input type="number" min={1} max={1400} value={form.followup_second_minutes}
                onChange={(e) => setForm({ ...form, followup_second_minutes: e.target.value })} />
              <p className="text-xs text-muted-foreground">El envío se cancela si faltan menos de 20 minutos para que cierre la ventana de 24 horas.</p>
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
            <div className="lg:sticky lg:top-0 lg:self-start">
              <ProductPreview
                name={form.name}
                salesCopy={form.sales_copy}
                description={form.description}
                price={form.prices[0]?.price ?? "0"}
                promoPrice=""
                deliveryInfo={form.delivery_info}
                keywords={form.keywords}
                existing={editingMedia}
                pending={pendingFiles}
              />
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
                if (form.prices.length === 0) {
                  toast.error("Agrega al menos una opción de precio");
                  return;
                }
                const incompletePrice = form.prices.find(
                  (item) =>
                    !item.label.trim() ||
                    (Number(item.quantity) || 0) < 1 ||
                    (Number(item.price) || 0) <= 0,
                );
                if (incompletePrice) {
                  toast.error("Completa el nombre, la cantidad y el precio de cada opción");
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
      <Dialog open={phoneOpen} onOpenChange={setPhoneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Número de WhatsApp del catálogo</DialogTitle>
            <DialogDescription>
              A este número llegan los mensajes de compra desde el botón “Tocá aquí para comprar”.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="catalog-phone">Número con código de país</Label>
            <Input
              id="catalog-phone"
              inputMode="numeric"
              placeholder="595981123456"
              value={phoneValue}
              onChange={(e) => setPhoneValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Solo números, sin + ni espacios.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhoneOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => savePhone.mutate(phoneValue)} disabled={savePhone.isPending}>
              {savePhone.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
