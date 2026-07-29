import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Save } from "lucide-react";
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
      });
    }
  }, [data]);

  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/public/whatsapp/webhook` : "";

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
          app_secret: wa.app_secret.trim() || null,
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
                <Label>URL del webhook (pégala en Meta)</Label>
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
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Phone Number ID</Label>
                  <Input
                    value={wa.phone_number_id}
                    onChange={(e) => setWa({ ...wa, phone_number_id: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>WABA ID</Label>
                  <Input value={wa.waba_id} onChange={(e) => setWa({ ...wa, waba_id: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Access Token permanente</Label>
                  <Input
                    type="password"
                    value={wa.access_token}
                    onChange={(e) => setWa({ ...wa, access_token: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>App ID</Label>
                  <Input value={wa.app_id} onChange={(e) => setWa({ ...wa, app_id: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>App Secret</Label>
                  <Input
                    type="password"
                    value={wa.app_secret}
                    onChange={(e) => setWa({ ...wa, app_secret: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Verify Token</Label>
                  <Input
                    value={wa.verify_token}
                    onChange={(e) => setWa({ ...wa, verify_token: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Número visible</Label>
                  <Input
                    value={wa.display_phone}
                    onChange={(e) => setWa({ ...wa, display_phone: e.target.value })}
                  />
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
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <Switch
                  checked={ai.ai_enabled}
                  onCheckedChange={(v) => setAi({ ...ai, ai_enabled: v })}
                />
                <Label>IA activa (responde automáticamente)</Label>
              </div>
              <div className="space-y-1.5">
                <Label>Personalidad e instrucciones del vendedor</Label>
                <Textarea
                  rows={8}
                  value={ai.system_instruction}
                  onChange={(e) => setAi({ ...ai, system_instruction: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Retraso de respuesta (segundos)</Label>
                  <Input
                    type="number"
                    value={ai.reply_delay_seconds}
                    onChange={(e) =>
                      setAi({ ...ai, reply_delay_seconds: Number(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    checked={ai.autodetect_model}
                    onCheckedChange={(v) => setAi({ ...ai, autodetect_model: v })}
                  />
                  <Label>Detectar producto automáticamente</Label>
                </div>
              </div>
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
