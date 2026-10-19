import { useState, type ChangeEvent, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ImagePlus, Megaphone, MessageCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/novedades")({
  head: () => ({ meta: [
    { title: "Novedades — BOT SKY" },
    { name: "description", content: "Noticias, avisos e información oficial de BOT SKY." },
  ] }),
  component: NovedadesPage,
});

type NewsLink = { label: string; url: string };
type NewsItem = {
  id: string;
  title: string;
  body: string;
  images: string[];
  links: NewsLink[];
  whatsapp_number: string | null;
  whatsapp_message: string | null;
  is_published: boolean;
  is_pinned: boolean;
  created_at: string;
};
type NewsForm = {
  title: string;
  body: string;
  images: string[];
  links: NewsLink[];
  whatsapp_number: string;
  whatsapp_message: string;
  is_published: boolean;
  is_pinned: boolean;
};
const emptyForm = (): NewsForm => ({
  title: "", body: "", images: [], links: [], whatsapp_number: "",
  whatsapp_message: "", is_published: false, is_pinned: false,
});
const BUCKET = "news-images";
const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024;

function httpUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch { return null; }
}
function whatsappUrl(number: string | null, message: string | null): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}
function toForm(item: NewsItem): NewsForm {
  return {
    title: item.title, body: item.body, images: [...item.images],
    links: item.links.map(link => ({ ...link })),
    whatsapp_number: item.whatsapp_number ?? "",
    whatsapp_message: item.whatsapp_message ?? "",
    is_published: item.is_published, is_pinned: item.is_pinned,
  };
}
function normalizeItem(value: Record<string, unknown>): NewsItem {
  return {
    id: String(value.id), title: String(value.title ?? ""), body: String(value.body ?? ""),
    images: Array.isArray(value.images) ? value.images.filter((x): x is string => typeof x === "string") : [],
    links: Array.isArray(value.links) ? value.links.filter((x): x is NewsLink =>
      !!x && typeof x === "object" && typeof x.label === "string" && typeof x.url === "string") : [],
    whatsapp_number: typeof value.whatsapp_number === "string" ? value.whatsapp_number : null,
    whatsapp_message: typeof value.whatsapp_message === "string" ? value.whatsapp_message : null,
    is_published: value.is_published === true, is_pinned: value.is_pinned === true,
    created_at: String(value.created_at ?? ""),
  };
}

function NovedadesPage() {
  const { isAdmin, user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openEditor, setOpenEditor] = useState(false);
  const [form, setForm] = useState<NewsForm>(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorText, setErrorText] = useState("");

  // La consulta se ejecuta DESPUÉS de conocer el rol para evitar exponer borradores.
  const { data: items = [], isPending, error } = useQuery({
    queryKey: ["bot-sky-news", isAdmin],
    enabled: !loading && !!user,
    queryFn: async () => {
      // El cliente Supabase existente puede tener tipos generados previos a la migración.
      const query = (supabase as any).from("news_posts").select("*");
      if (!isAdmin) query.eq("is_published", true);
      const { data, error: queryError } = await query
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeItem);
    },
  });

  const save = useMutation({
    mutationFn: async (payload: { id: string | null; value: NewsForm }) => {
      if (!isAdmin || !user) throw new Error("No tenés permiso para publicar.");
      const title = payload.value.title.trim();
      const body = payload.value.body.trim();
      if (!title || !body) throw new Error("Completá el título y el texto.");
      if (title.length > 180 || body.length > 15000) throw new Error("El título o el texto es demasiado largo.");
      const number = payload.value.whatsapp_number.replace(/\D/g, "");
      if (number && !whatsappUrl(number, null)) throw new Error("Número de WhatsApp inválido. Usá código de país, por ejemplo 595...");
      const links = payload.value.links.filter(link => link.label.trim() || link.url.trim()).map(link => {
        const url = httpUrl(link.url);
        if (!link.label.trim() || !url) throw new Error("Cada enlace necesita título y URL http(s) válida.");
        return { label: link.label.trim().slice(0, 100), url };
      });
      if (links.length > 10) throw new Error("Podés agregar hasta 10 enlaces.");
      const row = {
        title, body, links, images: payload.value.images,
        whatsapp_number: number || null,
        whatsapp_message: payload.value.whatsapp_message.trim() || null,
        is_published: payload.value.is_published,
        is_pinned: payload.value.is_pinned,
      };
      const table = (supabase as any).from("news_posts");
      const result = payload.id
        ? await table.update(row).eq("id", payload.id)
        : await table.insert({ ...row, created_by: user.id });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      setErrorText(""); setNotice("Publicación guardada correctamente.");
      setOpenEditor(false); setEditingId(null); setForm(emptyForm());
      await queryClient.invalidateQueries({ queryKey: ["bot-sky-news"] });
    },
    onError: (e: Error) => setErrorText(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!isAdmin) throw new Error("No tenés permiso.");
      const { error: deleteError } = await (supabase as any).from("news_posts").delete().eq("id", id);
      if (deleteError) throw deleteError;
    },
    onSuccess: async () => {
      setNotice("Publicación eliminada."); setErrorText("");
      await queryClient.invalidateQueries({ queryKey: ["bot-sky-news"] });
    },
    onError: (e: Error) => setErrorText(e.message),
  });

  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!isAdmin || !user || !files.length) return;
    if (form.images.length + files.length > MAX_IMAGES) {
      setErrorText(`Máximo ${MAX_IMAGES} imágenes por publicación.`); return;
    }
    setUploading(true); setErrorText("");
    try {
      const urls: string[] = [];
      for (const file of files) {
        if (!(["image/jpeg", "image/png", "image/webp"].includes(file.type)) || file.size > MAX_BYTES) {
          throw new Error("Se admiten JPG, PNG o WEBP de hasta 5 MB por imagen.");
        }
        const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
          upsert: false, contentType: file.type,
        });
        if (uploadError) throw uploadError;
        urls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
      }
      setForm(previous => ({ ...previous, images: [...previous.images, ...urls] }));
    } catch (e) { setErrorText(e instanceof Error ? e.message : "No se pudieron subir las imágenes."); }
    finally { setUploading(false); }
  };

  const startCreate = () => { setEditingId(null); setForm(emptyForm()); setErrorText(""); setNotice(""); setOpenEditor(true); };
  const startEdit = (item: NewsItem) => { setEditingId(item.id); setForm(toForm(item)); setErrorText(""); setNotice(""); setOpenEditor(true); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!uploading) save.mutate({ id: editingId, value: form }); };

  return (
    <PageShell>
      <PageHeader title="Novedades" description="Noticias y avisos oficiales de BOT SKY."
        actions={isAdmin ? <Button onClick={startCreate}><Plus className="mr-2 h-4 w-4" />Nueva publicación</Button> : undefined} />
      {notice && <p role="status" className="mb-4 rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
      {errorText && <p role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errorText}</p>}

      {isAdmin && openEditor && (
        <Card className="mb-6"><CardContent className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingId ? "Editar novedad" : "Nueva novedad"}</h2>
              <Button type="button" size="icon" variant="ghost" onClick={() => setOpenEditor(false)}><X className="h-4 w-4" /></Button>
            </div>
            <label className="block space-y-1 text-sm font-medium">Título
              <input required maxLength={180} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-md border bg-background p-2" placeholder="Título de la noticia" />
            </label>
            <label className="block space-y-1 text-sm font-medium">Texto de la publicación
              <textarea required rows={7} maxLength={15000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} className="mt-1 w-full rounded-md border bg-background p-2" placeholder="Escribí el anuncio..." />
            </label>
            <div className="space-y-2">
              <span className="text-sm font-medium">Imágenes ({form.images.length}/{MAX_IMAGES})</span>
              <div className="flex flex-wrap gap-3">{form.images.map((src, index) => (
                <div key={src} className="relative">
                  <img src={src} alt={`Imagen ${index + 1}`} className="h-24 w-32 rounded-md border object-cover" />
                  <button type="button" aria-label="Quitar imagen" className="absolute right-1 top-1 rounded-full bg-background p-1 shadow" onClick={() => setForm(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }))}><X className="h-3 w-3" /></button>
                </div>
              ))}</div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                <ImagePlus className="h-4 w-4" />{uploading ? "Subiendo..." : "Agregar imágenes"}
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={uploadImages} className="sr-only" />
              </label>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><span className="text-sm font-medium">Enlaces web</span>
                <Button type="button" variant="outline" size="sm" disabled={form.links.length >= 10} onClick={() => setForm(prev => ({ ...prev, links: [...prev.links, { label: "", url: "" }] }))}><Plus className="mr-1 h-4 w-4" />Enlace</Button>
              </div>
              {form.links.map((link, index) => <div className="flex flex-wrap gap-2" key={index}>
                <input aria-label="Nombre del enlace" className="min-w-40 flex-1 rounded-md border bg-background p-2 text-sm" placeholder="Texto del botón" value={link.label} onChange={e => setForm(prev => ({ ...prev, links: prev.links.map((l, i) => i === index ? { ...l, label: e.target.value } : l) }))} />
                <input aria-label="URL del enlace" className="min-w-52 flex-[2] rounded-md border bg-background p-2 text-sm" placeholder="https://pagina.com" value={link.url} onChange={e => setForm(prev => ({ ...prev, links: prev.links.map((l, i) => i === index ? { ...l, url: e.target.value } : l) }))} />
                <Button type="button" variant="outline" size="icon" aria-label="Eliminar enlace" onClick={() => setForm(prev => ({ ...prev, links: prev.links.filter((_, i) => i !== index) }))}><X className="h-4 w-4" /></Button>
              </div>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">WhatsApp (con código país)
                <input className="mt-1 w-full rounded-md border bg-background p-2" placeholder="5959..." value={form.whatsapp_number} onChange={e => setForm({ ...form, whatsapp_number: e.target.value })} />
              </label>
              <label className="text-sm font-medium">Mensaje automático opcional
                <input className="mt-1 w-full rounded-md border bg-background p-2" placeholder="Hola, quiero información" value={form.whatsapp_message} onChange={e => setForm({ ...form, whatsapp_message: e.target.value })} />
              </label>
            </div>
            <div className="flex flex-wrap gap-5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_published} onChange={e => setForm({ ...form, is_published: e.target.checked })} />Publicar (visible para todos)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_pinned} onChange={e => setForm({ ...form, is_pinned: e.target.checked })} />Destacar arriba</label>
            </div>
            <div className="flex gap-2"><Button type="submit" disabled={save.isPending || uploading}>{save.isPending ? "Guardando..." : "Guardar publicación"}</Button>
              <Button type="button" variant="outline" onClick={() => setOpenEditor(false)}>Cancelar</Button></div>
          </form>
        </CardContent></Card>
      )}

      {isPending || loading ? <p className="text-sm text-muted-foreground">Cargando novedades...</p>
        : error ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar las novedades: {error instanceof Error ? error.message : "Error desconocido"}</p>
        : !items.length ? <EmptyState title="Sin novedades" description="Aquí aparecerán las noticias publicadas por el administrador." />
        : <div className="grid gap-5 lg:grid-cols-2">{items.map(item => <Card key={item.id} className="overflow-hidden">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2">
                <Megaphone className="h-4 w-4 text-primary" />
                {item.is_pinned && <Badge variant="secondary">Destacada</Badge>}
                {isAdmin && !item.is_published && <Badge variant="outline">Borrador</Badge>}
              </div><h2 className="text-lg font-semibold break-words">{item.title}</h2>
                <p className="text-xs text-muted-foreground">{item.created_at ? new Date(item.created_at).toLocaleDateString("es-PY") : ""}</p>
              </div>
              {isAdmin && <div className="flex gap-1">
                <Button size="icon" variant="outline" aria-label="Editar noticia" onClick={() => startEdit(item)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" aria-label="Eliminar noticia" disabled={remove.isPending} onClick={() => { if (window.confirm(`¿Eliminar «${item.title}»?`)) remove.mutate(item.id); }}><Trash2 className="h-4 w-4" /></Button>
              </div>}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.body}</p>
            {item.images.length > 0 && <div className="grid grid-cols-2 gap-2">
              {item.images.map((src, i) => <a key={`${src}-${i}`} href={src} target="_blank" rel="noopener noreferrer" title="Abrir imagen">
                <img src={src} alt={`${item.title}, imagen ${i + 1}`} loading="lazy" className="h-40 w-full rounded-lg border object-cover transition-opacity hover:opacity-80" />
              </a>)}
            </div>}
            {(item.links.length > 0 || whatsappUrl(item.whatsapp_number, item.whatsapp_message)) && <div className="flex flex-wrap gap-2 border-t pt-3">
              {whatsappUrl(item.whatsapp_number, item.whatsapp_message) && <a href={whatsappUrl(item.whatsapp_number, item.whatsapp_message)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
              {item.links.map((link, index) => { const url = httpUrl(link.url); return url ? <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"><ExternalLink className="h-4 w-4" />{link.label}</a> : null; })}
            </div>}
          </CardContent>
        </Card>)}</div>}
    </PageShell>
  );
}
