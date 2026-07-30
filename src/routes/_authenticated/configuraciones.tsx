import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Loader2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/configuraciones")({
  head: () => ({
    meta: [
      { title: "Configuraciones — BOT SKY" },
      { name: "description", content: "Conecta WhatsApp, configura tu IA e integra Google Sheets." },
      { property: "og:title", content: "Configuraciones — BOT SKY" },
      { property: "og:description", content: "Conexión de WhatsApp Cloud API, IA y negocio." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { profile, user } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const [wa, setWa] = useState({
    phone_number_id: "",
    waba_id: "",
    access_token: "",
    app_id: "",
    app_secret: "",
    verify_token: "",
    display_phone: "",
  });
  const [ai, setAi] = useState({
    ai_enabled: true,
    model: "google/gemini-3.6-flash",
    system_instruction: "",
    reply_delay_seconds: 3,
    autodetect_model: true,
    gemini_api_key: "",
  });
  const [biz, setBiz] = useState({
    business_name: "",
    currency: "PYG",
    timezone: "America/Asuncion",
    google_sheets_url: "",
    apps_script_url: "",
    notify_numbers: "",
    catalog_enabled: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const [conn, aiRow, settings] = await Promise.all([
        supabase.from("whatsapp_connections").select("*").eq("workspace_id", workspaceId!).maybeSingle(),
        supabase.from("ai_settings").select("*").eq("workspace_id", workspaceId!).maybeSingle(),
        supabase.from("user_settings").select("*").eq("workspace_id", workspaceId!).maybeSingle(),
      ]);
      return { conn: conn.data, ai: aiRow.data, settings: settings.data };
    },
  });

  useEffect(() => {
    if (!data) return;
    if (data.conn) {
      setWa({
        phone_number_id: data.conn.phone_number_id ?? "",
        waba_id: data.conn.waba_id ?? "",
        access_token: data.conn.access_token ?? "",
        app_id: data.conn.app_id ?? "",
        app_secret: data.conn.app_secret ?? "",
        verify_token: data.conn.verify_token ?? "",
        display_phone: data.conn.display_phone ?? "",
      });
    }
    if (data.ai) {
      setAi({
        ai_enabled: data.ai.ai_enabled,
        model: data.ai.model,
        system_instruction: data.ai.system_instruction,
        reply_delay_seconds: data.ai.reply_delay_seconds,
        autodetect_model: data.ai.autodetect_model,
        gemini_api_key: data.ai.gemini_api_key ?? "",
      });
    }
    if (data.settings) {
      setBiz({
        business_name: data.settings.business_name ?? "",
        currency: data.settings.currency,
        timezone: data.settings.timezone,
        google_sheets_url: data.settings.google_sheets_url ?? "",
        apps_script_url: data.settings.apps_script_url ?? "",
        notify_numbers: (data.settings.notify_numbers ?? []).join(", "),
        catalog_enabled: data.settings.catalog_enabled !== false,
      });
    }
  }, [data]);

  // Meta solo acepta una URL pública y estable. La vista previa del editor
  // (id-preview--<id>.lovable.app) no sirve, por eso la convertimos al dominio estable.
  function buildWebhookBase() {
    if (typeof window === "undefined") return "";
    const host = window.location.hostname;
    const preview = host.match(/^id-preview--([0-9a-f-]+)\.lovable\.app$/i);
    if (preview) return `https://project--${preview[1]}-dev.lovable.app`;
    if (host === "localhost" || host === "127.0.0.1") return window.location.origin;
    return window.location.origin;
  }

  const webhookUrl = `${buildWebhookBase()}/api/public/whatsapp/webhook`;
  const [testing, setTesting] = useState(false);

  async function testWebhook() {
    const token = wa.verify_token.trim();
    if (!token) {
      toast.error("Primero generá y guardá el token de verificación");
      return;
    }
    setTesting(true);
    try {
      const challenge = `botsky${Date.now()}`;
      const url = `${webhookUrl}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
        token,
      )}&hub.challenge=${challenge}`;
      const res = await fetch(url);
      const body = (await res.text()).trim();
      if (res.ok && body === challenge) {
        toast.success("Webhook verificado. Ya podés pegar estos datos en Meta.");
      } else if (res.status === 403) {
        toast.error("El token no coincide con el guardado. Guardá la conexión y probá de nuevo.");
      } else {
        toast.error(`La URL respondió ${res.status}. Publicá la app e intentá otra vez.`);
      }
    } catch {
      toast.error("No se pudo alcanzar la URL del webhook desde este navegador.");
    } finally {
      setTesting(false);
    }
  }

  function generateVerifyToken() {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `botsky_${rand}_${new Date().getFullYear()}`;
  }


  useEffect(() => {
    if (!data) return;
    if (!data.conn?.verify_token) {
      setWa((prev) => (prev.verify_token ? prev : { ...prev, verify_token: generateVerifyToken() }));
    }
  }, [data]);

  async function upsert(table: "whatsapp_connections" | "ai_settings" | "user_settings", values: Record<string, unknown>) {
    if (!workspaceId || !user) throw new Error("Sesión no válida");
    const { data: existing } = await supabase
      .from(table)
      .select("id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.from(table).update(values as any).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from(table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({ ...values, workspace_id: workspaceId, user_id: user.id } as any);
      if (error) throw error;
    }
  }

  async function handleSave(section: "wa" | "ai" | "biz") {
    setSaving(true);
    try {
      if (section === "wa") {
        await upsert("whatsapp_connections", {
          phone_number_id: wa.phone_number_id.trim() || null,
          waba_id: wa.waba_id.trim() || null,
          access_token: wa.access_token.trim() || null,
          app_id: wa.app_id.trim() || null,
          app_secret: null,
          verify_token: wa.verify_token.trim() || null,
          display_phone: wa.display_phone.trim() || null,
          connected: Boolean(wa.phone_number_id.trim() && wa.access_token.trim()),
        });
      } else if (section === "ai") {
        await upsert("ai_settings", {
          ai_enabled: ai.ai_enabled,
          model: ai.model,
          system_instruction: ai.system_instruction,
          reply_delay_seconds: Number(ai.reply_delay_seconds) || 0,
          autodetect_model: ai.autodetect_model,
          gemini_api_key: ai.gemini_api_key.trim() || null,
        });
      } else {
        await upsert("user_settings", {
          business_name: biz.business_name.trim() || null,
          currency: biz.currency,
          timezone: biz.timezone,
          google_sheets_url: biz.google_sheets_url.trim() || null,
          apps_script_url: biz.apps_script_url.trim() || null,
          notify_numbers: biz.notify_numbers
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
          catalog_enabled: biz.catalog_enabled,
        });
      }
      toast.success("Configuración guardada");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <PageShell>
        <PageHeader title="Configuraciones" />
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader title="Configuraciones" description="Conexión, inteligencia artificial y negocio." />

      <Tabs defaultValue="whatsapp">
        <TabsList>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="ia">Inteligencia artificial</TabsTrigger>
          <TabsTrigger value="negocio">Negocio</TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="mt-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <Badge variant={data?.conn?.connected ? "default" : "secondary"}>
                  {data?.conn?.connected ? "Conectado" : "Sin conectar"}
                </Badge>
                {data?.conn?.last_error && (
                  <span className="text-xs text-destructive">{data.conn.last_error}</span>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Configuración de Webhook</p>
                <Label>URL Webhook</Label>
                <div className="flex gap-2">
                  <Input readOnly value={webhookUrl} />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copiar"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      toast.success("Copiado");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Pegá esta URL exacta (sin espacios ni barra final) en “URL de devolución de
                  llamada”. Guardá primero la conexión: Meta valida el token contra lo guardado.
                </p>
                <Button variant="secondary" size="sm" onClick={testWebhook} disabled={testing}>
                  {testing ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                  )}
                  Probar verificación
                </Button>
              </div>




              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Id. Número de teléfono</Label>
                  <Input
                    value={wa.phone_number_id}
                    onChange={(e) => setWa({ ...wa, phone_number_id: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Valor único asignado a cada número de teléfono registrado en la plataforma de
                    WhatsApp Business API Cloud.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Id. cuenta de WhatsApp Business (Opcional)</Label>
                  <Input value={wa.waba_id} onChange={(e) => setWa({ ...wa, waba_id: e.target.value })} />
                  <p className="text-xs text-muted-foreground">
                    Identificador de la cuenta de WhatsApp Business.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Id. de la aplicación de Meta (Opcional)</Label>
                  <Input value={wa.app_id} onChange={(e) => setWa({ ...wa, app_id: e.target.value })} />
                  <p className="text-xs text-muted-foreground">Identificador de la aplicación de Meta.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Número visible</Label>
                  <Input
                    value={wa.display_phone}
                    onChange={(e) => setWa({ ...wa, display_phone: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Token permanente</Label>
                  <Input
                    type="password"
                    value={wa.access_token}
                    onChange={(e) => setWa({ ...wa, access_token: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Cadena de caracteres para acceder a servicios de Meta.
                  </p>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Token de verificación (se genera automáticamente)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={wa.verify_token}
                      onChange={(e) => setWa({ ...wa, verify_token: e.target.value })}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Copiar token"
                      onClick={() => {
                        navigator.clipboard.writeText(wa.verify_token);
                        toast.success("Token copiado");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Generar token"
                      onClick={() => setWa({ ...wa, verify_token: generateVerifyToken() })}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Pegá este mismo token en Meta al configurar el webhook. Es único para tu cuenta.
                  </p>
                </div>
              </div>

              <Button onClick={() => handleSave("wa")} disabled={saving}>
                <Save className="mr-1 h-4 w-4" /> Guardar conexión
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ia" className="mt-4">
          <Card>
            <CardContent className="space-y-5 p-5">
              <div className="space-y-1.5">
                <Label>Tiempo de respuesta del bot</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    className="max-w-32"
                    value={ai.reply_delay_seconds}
                    onChange={(e) =>
                      setAi({ ...ai, reply_delay_seconds: Number(e.target.value) || 0 })
                    }
                  />
                  <span className="text-sm text-muted-foreground">seg</span>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-semibold">IA (Gemini)</p>
                <div className="space-y-1.5">
                  <Label>API Key de Gemini</Label>
                  <Input
                    type="password"
                    placeholder="AIza..."
                    value={ai.gemini_api_key}
                    onChange={(e) => setAi({ ...ai, gemini_api_key: e.target.value })}
                  />
                  {ai.gemini_api_key.trim() ? (
                    <p className="flex items-center gap-1 text-xs text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" /> API Key configurada
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Aún no cargaste tu API Key.</p>
                  )}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline text-muted-foreground hover:text-foreground"
                  >
                    Obtené tu API Key en Google AI Studio
                  </a>
                </div>

                <div className="space-y-1.5">
                  <Label>Modelo preferido</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={ai.autodetect_model ? "auto" : ai.model}
                    onChange={(e) =>
                      e.target.value === "auto"
                        ? setAi({ ...ai, autodetect_model: true })
                        : setAi({ ...ai, autodetect_model: false, model: e.target.value })
                    }
                  >
                    <option value="auto">Auto-detectar</option>
                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                    <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                    <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                    <option value="google/gemini-3.6-flash">google/gemini-3.6-flash</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Seleccioná "Auto-detectar" para que el sistema encuentre el modelo disponible
                    automáticamente.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Instrucción del sistema</Label>
                <Textarea
                  rows={8}
                  placeholder="Eres un asistente de ventas para una tienda online. Responde en español, de forma amable y profesional. Ayuda a cerrar ventas sin perder el contexto."
                  value={ai.system_instruction}
                  onChange={(e) => setAi({ ...ai, system_instruction: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-3 rounded-lg border p-4">
                <Switch
                  checked={ai.ai_enabled}
                  onCheckedChange={(v) => setAi({ ...ai, ai_enabled: v })}
                />
                <div>
                  <p className="text-sm font-medium">Activar IA</p>
                  <p className="text-xs text-muted-foreground">
                    Responde automáticamente a los mensajes
                  </p>
                </div>
              </div>

              {ai.ai_enabled && ai.gemini_api_key.trim() && (
                <p className="flex items-center gap-1 text-sm text-primary">
                  <CheckCircle2 className="h-4 w-4" /> IA activa y configurada correctamente
                </p>
              )}

              <Button onClick={() => handleSave("ai")} disabled={saving}>
                <Save className="mr-1 h-4 w-4" /> Guardar IA
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="negocio" className="mt-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nombre del negocio</Label>
                  <Input
                    value={biz.business_name}
                    onChange={(e) => setBiz({ ...biz, business_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Moneda</Label>
                  <Input
                    value={biz.currency}
                    onChange={(e) => setBiz({ ...biz, currency: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Zona horaria</Label>
                  <Input
                    value={biz.timezone}
                    onChange={(e) => setBiz({ ...biz, timezone: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Números para notificar (coma)</Label>
                  <Input
                    value={biz.notify_numbers}
                    onChange={(e) => setBiz({ ...biz, notify_numbers: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>URL de Google Sheets</Label>
                  <Input
                    value={biz.google_sheets_url}
                    onChange={(e) => setBiz({ ...biz, google_sheets_url: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>URL del Apps Script (webhook de pedidos)</Label>
                  <Input
                    value={biz.apps_script_url}
                    onChange={(e) => setBiz({ ...biz, apps_script_url: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <Label>Catálogo público</Label>
                  <p className="text-xs text-muted-foreground">
                    Publica tus productos activos en un link para compartir.
                  </p>
                </div>
                <Switch
                  checked={biz.catalog_enabled}
                  onCheckedChange={(v) => setBiz({ ...biz, catalog_enabled: v })}
                />
              </div>
              <Button onClick={() => handleSave("biz")} disabled={saving}>
                <Save className="mr-1 h-4 w-4" /> Guardar negocio
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
