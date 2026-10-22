import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, ImagePlus, Paperclip, Megaphone, MessageCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageShell, EmptyState } from "@/components/page-shell";
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

type NewsLink = { label: string; url: string; kind?: "file" };
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
const FILE_BUCKET = "news-files";
const MAX_ATTACHMENTS = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024;

function httpUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch { return null; }
}
// Convierte direcciones web escritas en el texto en enlaces clicables sin insertar HTML.
function linkifyBody(body: string) {
  const matcher = /https?:\/\/[^\s<>"']+/gi;
  const nodes: ReactNode[] = [];
  let previous = 0;
  for (const match of body.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (start > previous) nodes.push(body.slice(previous, start));
    const raw = match[0];
    const clean = raw.replace(/[.,;:!?)}\]]+$/, "");
    const url = httpUrl(clean);
    if (url) nodes.push(<a key={start} href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-600 underline underline-offset-2 break-all hover:text-violet-500 dark:text-violet-300">{clean}</a>);
    else nodes.push(clean);
    if (raw.length > clean.length) nodes.push(raw.slice(clean.length));
    previous = start + raw.length;
  }
  nodes.push(body.slice(previous));
  return nodes;
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
      !!x && typeof x === "object" && typeof x.label === "string" && typeof x.url === "string" && (x.kind === undefined || x.kind === "file")) : [],
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
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number; title: string } | null>(null);

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
        return { label: link.label.trim().slice(0, 100), url, ...(link.kind === "file" ? { kind: "file" as const } : {}) };
      });
      if (links.filter(link => link.kind !== "file").length > 10) throw new Error("Podés agregar hasta 10 enlaces web.");
      if (links.filter(link => link.kind === "file").length > MAX_ATTACHMENTS) throw new Error("Demasiados archivos adjuntos.");
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

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!isAdmin || !user || !files.length) return;
    const existing = form.links.filter(link => link.kind === "file").length;
    if (existing + files.length > MAX_ATTACHMENTS) {
      setErrorText(`Máximo ${MAX_ATTACHMENTS} archivos adjuntos.`); return;
    }
    setUploading(true); setErrorText("");
    try {
      const attachments: NewsLink[] = [];
      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        const valid = (ext === "pdf" && file.type === "application/pdf") ||
          (ext === "csv" && ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", ""].includes(file.type)) ||
          (ext === "txt" && ["text/plain", "application/octet-stream", ""].includes(file.type));
        if (!valid || file.size > MAX_FILE_BYTES || file.size === 0) {
          throw new Error("Solo se admiten archivos PDF, CSV o TXT de hasta 15 MB cada uno.");
        }
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(FILE_BUCKET).upload(path, file, {
          upsert: false,
          contentType: ext === "pdf" ? "application/pdf" : ext === "csv" ? "text/csv" : "text/plain",
          cacheControl: "3600",
        });
        if (uploadError) throw uploadError;
        const url = supabase.storage.from(FILE_BUCKET).getPublicUrl(path).data.publicUrl;
        attachments.push({ label: file.name.slice(0, 100), url, kind: "file" });
      }
      setForm(previous => ({ ...previous, links: [...previous.links, ...attachments] }));
    } catch (e) { setErrorText(e instanceof Error ? e.message : "No se pudieron subir los archivos."); }
    finally { setUploading(false); }
  };

  const startCreate = () => { setEditingId(null); setForm(emptyForm()); setErrorText(""); setNotice(""); setOpenEditor(true); };
  const startEdit = (item: NewsItem) => { setEditingId(item.id); setForm(toForm(item)); setErrorText(""); setNotice(""); setOpenEditor(true); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!uploading) save.mutate({ id: editingId, value: form }); };

  return (
    <PageShell>
      <div className="relative -mx-4 overflow-hidden rounded-3xl border border-violet-500/20 bg-gradient-to-br from-slate-950 via-[#171c35] to-[#30204d] px-5 py-8 text-white shadow-2xl sm:mx-0 sm:px-9 sm:py-10">
        <div className="pointer-events-none absolute -right-12 -top-20 h-72 w-72 rounded-full bg-violet-500/25 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/4 h-36 w-72 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/30 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wider text-violet-200">
              <Megaphone className="h-3.5 w-3.5" /> COMUNIDAD BOT SKY
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Novedades y noticias</h1>
            <p className="max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
              Descubrí anuncios, actualizaciones y oportunidades. Todo en un solo lugar.
            </p>
          </div>
          {isAdmin && <Button onClick={startCreate} className="bg-violet-600 text-white shadow-lg shadow-violet-500/25 hover:bg-violet-500">
            <Plus className="mr-2 h-4 w-4" /> Nueva publicación
          </Button>}
        </div>
      </div>

      <div className="mx-auto mt-7 w-full max-w-5xl space-y-6">
        {notice && <p role="status" className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
        {errorText && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{errorText}</p>}

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
              <span className="text-sm font-medium">Archivos adjuntos PDF / CSV / TXT ({form.links.filter(link => link.kind === "file").length}/{MAX_ATTACHMENTS})</span>
              {form.links.map((link, index) => link.kind === "file" && (
                <div key={`${link.url}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{link.label}</span></span>
                  <Button type="button" size="icon" variant="outline" aria-label="Quitar archivo adjunto" onClick={() => setForm(prev => ({ ...prev, links: prev.links.filter((_, i) => i !== index) }))}><X className="h-4 w-4" /></Button>
                </div>
              ))}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                <Paperclip className="h-4 w-4" />{uploading ? "Subiendo..." : "Adjuntar PDF, CSV o TXT"}
                <input type="file" multiple accept=".pdf,.csv,.txt,application/pdf,text/csv,text/plain" disabled={uploading} onChange={uploadFiles} className="sr-only" />
              </label>
              <p className="text-xs text-muted-foreground">Hasta 10 archivos de 15 MB. Los usuarios podrán descargarlos.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><span className="text-sm font-medium">Enlaces web</span>
                <Button type="button" variant="outline" size="sm" disabled={form.links.filter(link => link.kind !== "file").length >= 10} onClick={() => setForm(prev => ({ ...prev, links: [...prev.links, { label: "", url: "" }] }))}><Plus className="mr-1 h-4 w-4" />Enlace</Button>
              </div>
              {form.links.map((link, index) => link.kind !== "file" && <div className="flex flex-wrap gap-2" key={index}>
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


        {isPending || loading ? (
          <div className="rounded-2xl border bg-card p-10 text-center text-muted-foreground">Cargando novedades...</div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border p-5 text-sm text-destructive">No se pudieron cargar las novedades: {error instanceof Error ? error.message : "Error desconocido"}</div>
        ) : !items.length ? (
          <EmptyState title="Sin novedades" description="Aquí aparecerán las noticias publicadas por el administrador." />
        ) : (
          <div className="space-y-7">
            {items.map(item => {
              const wa = whatsappUrl(item.whatsapp_number, item.whatsapp_message);
              return (
                <article key={item.id} className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-lg shadow-black/5 ring-1 ring-black/[0.02] dark:shadow-black/25">
                  <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-7 sm:pt-7">
                    <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-md shadow-violet-500/25">
                        <Megaphone className="h-6 w-6" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold sm:text-base">BOT SKY · Oficial</span>
                          {item.is_pinned && <Badge className="bg-violet-600 text-white hover:bg-violet-600">Destacada</Badge>}
                          {isAdmin && !item.is_published && <Badge variant="outline">Borrador</Badge>}
                        </div>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {item.created_at ? new Date(item.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "long", year: "numeric" }) : "Novedad"}
                        </p>
                      </div>
                    </div>
                    {isAdmin && <div className="flex shrink-0 gap-1.5">
                      <Button size="icon" variant="outline" aria-label="Editar noticia" onClick={() => startEdit(item)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="outline" aria-label="Eliminar noticia" disabled={remove.isPending} onClick={() => { if (window.confirm(`¿Eliminar «${item.title}»?`)) remove.mutate(item.id); }}><Trash2 className="h-4 w-4" /></Button>
                    </div>}
                  </div>

                  <div className="space-y-3 px-5 pb-5 sm:px-7">
                    <h2 className="break-words text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">{item.title}</h2>
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground/85 sm:text-base">{linkifyBody(item.body)}</p>
                  </div>

                  {item.images.length > 0 && (
                    <div className="space-y-2 bg-slate-950/95 p-2 sm:p-3">
                      <button type="button" onClick={() => setLightbox({ images: item.images, index: 0, title: item.title })} className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl bg-[#0c1020] text-left" aria-label={`Ampliar imagen de ${item.title}`}>
                        <img src={item.images[0]} alt={`${item.title}, imagen principal`} loading="lazy" className="mx-auto max-h-[720px] min-h-[250px] w-full object-contain transition-transform duration-300 group-hover:scale-[1.015] sm:min-h-[380px]" />
                        <span className="absolute bottom-3 right-3 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">Ver en grande</span>
                      </button>
                      {item.images.length > 1 && (
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                          {item.images.slice(1).map((src, i) => <button type="button" key={`${src}-${i}`} onClick={() => setLightbox({ images: item.images, index: i + 1, title: item.title })} className="group overflow-hidden rounded-lg bg-[#0c1020]" aria-label={`Ampliar imagen ${i + 2}`}>
                            <img src={src} alt={`${item.title}, imagen ${i + 2}`} loading="lazy" className="h-20 w-full object-cover transition-transform duration-300 group-hover:scale-105 sm:h-28" />
                          </button>)}
                        </div>
                      )}
                    </div>
                  )}

                  {(wa || item.links.length > 0) && <div className="flex flex-wrap gap-3 px-5 py-5 sm:px-7">
                    {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#19b85a] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#139c4a]">
                      <MessageCircle className="h-5 w-5" /> Consultar por WhatsApp
                    </a>}
                    {item.links.filter(link => link.kind !== "file").map((link, index) => { const url = httpUrl(link.url); return url ? <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-5 py-2.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-500/20 dark:text-violet-200">
                      <ExternalLink className="h-4 w-4" /> {link.label}
                    </a> : null; })}
                  </div>}
                  {item.links.some(link => link.kind === "file") && (
                    <div className="space-y-3 border-t px-5 py-5 sm:px-7">
                      <h3 className="flex items-center gap-2 text-sm font-bold"><Paperclip className="h-4 w-4" />Archivos para descargar</h3>
                      <div className="flex flex-wrap gap-2">
                        {item.links.filter(link => link.kind === "file").map((file, index) => {
                          const url = httpUrl(file.url);
                          // Supabase Storage permite forzar la descarga con ?download=nombre.ext.
                          if (!url) return null;
                          const downloadUrl = new URL(url);
                          downloadUrl.searchParams.set("download", file.label);
                          return <a key={`${url}-${index}`} href={downloadUrl.toString()} download={file.label} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-accent">
                            <Download className="h-4 w-4" />Descargar {file.label}
                          </a>;
                        })}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {lightbox && <div role="dialog" aria-modal="true" aria-label={`Imágenes: ${lightbox.title}`} className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 p-3 sm:p-8" onClick={() => setLightbox(null)}>
        <button type="button" onClick={() => setLightbox(null)} className="absolute right-4 top-4 z-10 rounded-full bg-white/15 p-3 text-white hover:bg-white/25" aria-label="Cerrar imagen"><X className="h-6 w-6" /></button>
        <div className="mb-4 px-12 text-center text-sm font-medium text-white/80">{lightbox.title} · {lightbox.index + 1} de {lightbox.images.length}</div>
        <div className="relative flex w-full max-w-6xl flex-1 items-center justify-center overflow-hidden" onClick={e => e.stopPropagation()}>
          <img src={lightbox.images[lightbox.index]} alt={`${lightbox.title}, imagen ampliada ${lightbox.index + 1}`} className="max-h-[82vh] max-w-full object-contain" />
          {lightbox.images.length > 1 && <>
            <button type="button" onClick={() => setLightbox(prev => prev && ({ ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length }))} className="absolute left-1 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 sm:left-4" aria-label="Imagen anterior"><ChevronLeft className="h-7 w-7" /></button>
            <button type="button" onClick={() => setLightbox(prev => prev && ({ ...prev, index: (prev.index + 1) % prev.images.length }))} className="absolute right-1 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 sm:right-4" aria-label="Imagen siguiente"><ChevronRight className="h-7 w-7" /></button>
          </>}
        </div>
      </div>}
    </PageShell>
  );
}
