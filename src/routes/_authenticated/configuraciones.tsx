import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, Loader2, RefreshCw, Save, XCircle, Sparkles, Zap, Globe, Cloud } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  runWebhookDiagnostics,
  type WebhookCheck,
} from "@/lib/webhook-diagnostics.functions";
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

// ============================================================
// TIPOS DE PROVEEDORES
// ============================================================

type AiProvider = "gemini" | "groq" | "openrouter" | "cloudflare";

const PROVIDER_INFO: Record<AiProvider, {
  label: string;
  icon: React.ReactNode;
  description: string;
  keyPlaceholder: string;
  keyLabel: string;
  docsUrl: string;
  keyFormat?: string;
}> = {
  gemini: {
    label: "Google Gemini",
    icon: <Sparkles className="h-4 w-4" />,
    description: "Contexto largo (1M tokens), 1,500 solicitudes/día gratis",
    keyPlaceholder: "AIza...",
    keyLabel: "API Key de Gemini",
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
  groq: {
    label: "Groq",
    icon: <Zap className="h-4 w-4" />,
    description: "⚡ Súper rápido (~200ms), 30 solicitudes/minuto gratis",
    keyPlaceholder: "gsk_...",
    keyLabel: "API Key de Groq",
    docsUrl: "https://console.groq.com/keys",
  },
  openrouter: {
    label: "OpenRouter",
    icon: <Globe className="h-4 w-4" />,
    description: "Acceso a 20+ modelos con una sola key",
    keyPlaceholder: "sk-or-...",
    keyLabel: "API Key de OpenRouter",
    docsUrl: "https://openrouter.ai/keys",
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    icon: <Cloud className="h-4 w-4" />,
    description: "100k neuronas/día gratis, integración con Cloudflare",
    keyPlaceholder: "account_id:api_token",
    keyLabel: "API Key de Cloudflare",
    docsUrl: "https://dash.cloudflare.com/?to=/:account/workers-and-pages",
    keyFormat: "account_id:api_token",
  },
};

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
    provider: "gemini" as AiProvider,
    gemini_api_key: "",
    groq_api_key: "",
    openrouter_api_key: "",
    cloudflare_api_key: "",
    model: "google/gemini-3.6-flash",
    system_instruction: "",
    reply_delay_seconds: 3,
    autodetect_model: true,
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

  // ============================================================
  // CARGA DE DATOS
  // ============================================================

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
        ai_enabled: data.ai.ai_enabled ?? true,
        provider: data.ai.provider ?? "gemini",
        gemini_api_key: data.ai.gemini_api_key ?? "",
        groq_api_key: data.ai.groq_api_key ?? "",
        openrouter_api_key: data.ai.openrouter_api_key ?? "",
        cloudflare_api_key: data.ai.cloudflare_api_key ?? "",
        model: data.ai.model ?? "google/gemini-3.6-flash",
        system_instruction: data.ai.system_instruction ?? "",
        reply_delay_seconds: data.ai.reply_delay_seconds ?? 3,
        autodetect_model: data.ai.autodetect_model ?? true,
      });
    }
    if (data.settings) {
      setBiz({
        business_name: data.settings.business_name ?? "",
        currency: data.settings.currency ?? "PYG",
        timezone: data.settings.timezone ?? "America/Asuncion",
        google_sheets_url: data.settings.google_sheets_url ?? "",
        apps_script_url: data.settings.apps_script_url ?? "",
        notify_numbers: (data.settings.notify_numbers ?? []).join(", "),
        catalog_enabled: data.settings.catalog_enabled !== false,
      });
    }
  }, [data]);

  // ============================================================
  // WEBHOOK
  // ============================================================

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
  const [checks, setChecks] = useState<WebhookCheck[] | null>(null);
  const runDiagnostics = useServerFn(runWebhookDiagnostics);

  async function testWebhook() {
    const token = wa.verify_token.trim();
    if (!token) {
      toast.error("Primero generá y guardá el token de verificación");
      return;
    }
    if (!workspaceId) {
      toast.error("Sesión no válida");
      return;
    }
    setTesting(true);
    setChecks(null);
    try {
      const res = await runDiagnostics({
        data: { url: webhookUrl, token, workspaceId },
      });
      setChecks(res.checks);
      if (res.verified) {
        toast.success("Webhook verificado. Ya podés pegar estos datos en Meta.");
      } else {
        toast.error("La verificación falló. Mirá el detalle debajo.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo ejecutar el diagnóstico");
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

  // ============================================================
  // GUARDADO
  // ============================================================

  async function upsert(table: "whatsapp_connections" | "ai_settings" | "user_settings", values: Record<string, unknown>) {
    if (!workspaceId || !user) throw new Error("Sesión no válida");
    const { data: existing } = await supabase
      .from(table)
      .select("id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase.from(table).update(values).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from(table)
        .insert({ ...values, workspace_id: workspaceId, user_id: user.id });
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
          provider: ai.provider,
          gemini_api_key: ai.gemini_api_key.trim() || null,
          groq_api_key: ai.groq_api_key.trim() || null,
          openrouter_api_key: ai.openrouter_api_key.trim() || null,
          cloudflare_api_key: ai.cloudflare_api_key.trim() || null,
          model: ai.model,
          system_instruction: ai.system_instruction,
          reply_delay_seconds: Number(ai.reply_delay_seconds) || 0,
          autodetect_model: ai.autodetect_model,
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

  // ============================================================
  // HELPERS
  // ============================================================

  function getCurrentApiKey(): string {
    switch (ai.provider) {
      case "gemini": return ai.gemini_api_key;
      case "groq": return ai.groq_api_key;
      case "openrouter": return ai.openrouter_api_key;
      case "cloudflare": return ai.cloudflare_api_key;
      default: return "";
    }
  }

  function setCurrentApiKey(value: string) {
    switch (ai.provider) {
      case "gemini": setAi({ ...ai, gemini_api_key: value }); break;
      case "groq": setAi({ ...ai, groq_api_key: value }); break;
      case "openrouter": setAi({ ...ai, openrouter_api_key: value }); break;
      case "cloudflare": setAi({ ...ai, cloudflare_api_key: value }); break;
    }
  }

  function getModelOptions(): { value: string; label: string }[] {
    switch (ai.provider) {
      case "gemini":
        return [
          { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
          { value: "google/gemini-3.6-flash", label: "Google Gemini 3.6 Flash" },
        ];
      case "groq":
        return [
          { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Recomendado)" },
          { value: "llama-3.1-70b-versatile", label: "Llama 3.1 70B" },
          { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
          { value: "gemma2-9b-it", label: "Gemma 2 9B" },
          { value: "llama-3.2-3b-preview", label: "Llama 3.2 3B (Rápido)" },
        ];
      case "openrouter":
        return [
          { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
          { value: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
          { value: "mistralai/mistral-7b-instruct", label: "Mistral 7B" },
        ];
      case "cloudflare":
        return [
          { value: "@cf/meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
          { value: "@cf/meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
          { value: "@cf/mistral/mistral-7b-instruct-v0.1", label: "Mistral 7B" },
          { value: "@cf/google/gemma-2-9b-it", label: "Gemma 2 9B" },
          { value: "@cf/microsoft/phi-3-mini-128k-instruct", label: "Phi-3 Mini" },
        ];
      default:
        return [];
    }
  }

  function getProviderStatus(): { hasKey: boolean; isConfigured: boolean } {
    const hasKey = Boolean(getCurrentApiKey().trim());
    return {
      hasKey,
      isConfigured: hasKey && ai.ai_enabled,
    };
  }

  // ============================================================
  // RENDER
  // ============================================================

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

        {/* ============================================================
            TAB: WHATSAPP
        ============================================================ */}
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
                  Pegá esta URL exacta (sin espacios ni barra final) en "URL de devolución de
                  llamada". Guardá primero la conexión: Meta valida el token contra lo guardado.
                </p>
                <Button variant="secondary" size="sm" onClick={testWebhook} disabled={testing}>
                  {testing ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                  )}
                  Probar verificación
                </Button>

                {checks && (
                  <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Diagnóstico de verificación (hub.mode · hub.verify_token · hub.challenge)
                    </p>
                    {checks.map((c) => (
                      <div key={c.id} className="flex gap-2 rounded-md bg-background/60 p-2">
                        {c.status === "ok" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        ) : c.status === "warn" ? (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        )}
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-xs font-medium">
                            {c.label}
                            {typeof c.httpStatus === "number" && c.httpStatus > 0 && (
                              <span className="ml-2 text-muted-foreground">HTTP {c.httpStatus}</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{c.detail}</p>
                          {(c.expected || c.received) && (
                            <p className="break-all font-mono text-[10px] text-muted-foreground">
                              {c.expected && <>esperado: {c.expected} · </>}
                              {c.received && <>recibido: {c.received}</>}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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

        {/* ============================================================
            TAB: INTELIGENCIA ARTIFICIAL (ACTUALIZADO)
        ============================================================ */}
        <TabsContent value="ia" className="mt-4">
          <Card>
            <CardContent className="space-y-5 p-5">
              {/* Tiempo de respuesta */}
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

              {/* Proveedor de IA */}
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Proveedor de IA</p>
                  {ai.ai_enabled && (
                    <Badge variant={getProviderStatus().isConfigured ? "default" : "destructive"}>
                      {getProviderStatus().isConfigured ? "✅ Activo" : "❌ Sin API Key"}
                    </Badge>
                  )}
                </div>

                {/* Selector de proveedor */}
                <div className="space-y-1.5">
                  <Label>Seleccioná tu proveedor de IA</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(Object.keys(PROVIDER_INFO) as AiProvider[]).map((provider) => {
                      const info = PROVIDER_INFO[provider];
                      const isSelected = ai.provider === provider;
                      const hasKey = provider === "gemini" ? ai.gemini_api_key.trim() :
                                     provider === "groq" ? ai.groq_api_key.trim() :
                                     provider === "openrouter" ? ai.openrouter_api_key.trim() :
                                     ai.cloudflare_api_key.trim();
                      
                      return (
                        <button
                          key={provider}
                          type="button"
                          onClick={() => setAi({ ...ai, provider })}
                          className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted/50"
                          } ${hasKey ? "opacity-100" : "opacity-60"}`}
                        >
                          <div className="flex items-center gap-1">
                            {info.icon}
                            <span className="text-xs font-medium">{info.label}</span>
                          </div>
                          {hasKey && (
                            <CheckCircle2 className="h-3 w-3 text-primary" />
                          )}
                          {!hasKey && (
                            <span className="text-[10px] text-muted-foreground">sin key</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Descripción del proveedor */}
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">
                    {PROVIDER_INFO[ai.provider].description}
                  </p>
                  <a
                    href={PROVIDER_INFO[ai.provider].docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline hover:text-primary/80"
                  >
                    📖 Cómo obtener tu API Key →
                  </a>
                  {PROVIDER_INFO[ai.provider].keyFormat && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Formato: <code className="rounded bg-muted px-1 py-0.5">{PROVIDER_INFO[ai.provider].keyFormat}</code>
                    </p>
                  )}
                </div>

                {/* API Key del proveedor seleccionado */}
                <div className="space-y-1.5">
                  <Label>{PROVIDER_INFO[ai.provider].keyLabel}</Label>
                  <Input
                    type="password"
                    placeholder={PROVIDER_INFO[ai.provider].keyPlaceholder}
                    value={getCurrentApiKey()}
                    onChange={(e) => setCurrentApiKey(e.target.value)}
                  />
                  {getCurrentApiKey().trim() ? (
                    <p className="flex items-center gap-1 text-xs text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" /> API Key configurada
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Aún no cargaste tu API Key para {PROVIDER_INFO[ai.provider].label}
                    </p>
                  )}
                </div>

                {/* Modelo */}
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
                    <option value="auto">Auto-detectar (recomendado)</option>
                    {getModelOptions().map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {ai.provider === "groq" 
                      ? "⚡ Groq es ideal por su velocidad y baja latencia"
                      : ai.provider === "gemini"
                      ? "🧠 Gemini destaca por su contexto largo (1M tokens)"
                      : ai.provider === "openrouter"
                      ? "🌐 OpenRouter permite probar múltiples modelos con una sola key"
                      : "☁️ Cloudflare Workers AI integración con el ecosistema Cloudflare"
                    }
                  </p>
                </div>
              </div>

              {/* Instrucción del sistema */}
              <div className="space-y-1.5">
                <Label>Instrucción del sistema</Label>
                <Textarea
                  rows={8}
                  placeholder="Eres un asistente de ventas para una tienda online. Responde en español, de forma amable y profesional. Ayuda a cerrar ventas sin perder el contexto."
                  value={ai.system_instruction}
                  onChange={(e) => setAi({ ...ai, system_instruction: e.target.value })}
                />
              </div>

              {/* Switch activar IA */}
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

              {/* Estado de configuración */}
              {ai.ai_enabled && (
                <div className="rounded-lg border p-3">
                  {getProviderStatus().isConfigured ? (
                    <p className="flex items-center gap-2 text-sm text-primary">
                      <CheckCircle2 className="h-4 w-4" />
                      IA activa y configurada correctamente con {PROVIDER_INFO[ai.provider].label}
                    </p>
                  ) : getProviderStatus().hasKey ? (
                    <p className="flex items-center gap-2 text-sm text-yellow-600">
                      <AlertTriangle className="h-4 w-4" />
                      Tienes API Key pero la IA está desactivada
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-destructive">
                      <XCircle className="h-4 w-4" />
                      Configura una API Key para activar la IA
                    </p>
                  )}
                </div>
              )}

              <Button onClick={() => handleSave("ai")} disabled={saving}>
                <Save className="mr-1 h-4 w-4" /> Guardar IA
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================
            TAB: NEGOCIO
        ============================================================ */}
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
