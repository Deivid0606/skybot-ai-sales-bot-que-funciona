import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Bot, Loader2, Send, User } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { testAiReply } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/chat-ia")({
  head: () => ({
    meta: [
      { title: "Chat IA — BOT SKY" },
      { name: "description", content: "Prueba cómo responde tu vendedor virtual antes de publicarlo." },
      { property: "og:title", content: "Chat IA — BOT SKY" },
      { property: "og:description", content: "Simulador de conversación con tu IA entrenada." },
    ],
  }),
  component: ChatAiPage,
});

type TemplateMedia = { type: string; url: string };
type Template = { productId: string; name: string; copy: string; media: TemplateMedia[] };
type Turn = { role: "user" | "assistant"; content: string; meta?: string; template?: Template };

function TemplateBubble({ template }: { template: Template }) {
  const images = template.media.filter((m) => m.type === "image");
  const videos = template.media.filter((m) => m.type === "video");
  const audios = template.media.filter((m) => m.type === "audio");
  return (
    <div className="mr-auto flex max-w-[85%] flex-col gap-2 rounded-xl bg-muted p-2 text-sm">
      {images.length > 0 && (
        <div className={cn("grid gap-1", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {images.map((m, i) => (
            <img
              key={i}
              src={m.url}
              alt={template.name}
              loading="lazy"
              className="aspect-square w-full rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      {videos.map((m, i) => (
        <video key={i} src={m.url} controls preload="none" className="w-full rounded-lg" />
      ))}
      {audios.map((m, i) => (
        <audio key={i} src={m.url} controls preload="none" className="w-full" />
      ))}
      <p className="whitespace-pre-wrap px-1">{template.copy}</p>
      <Badge variant="secondary" className="w-fit text-[10px]">
        plantilla por palabra clave
      </Badge>
    </div>
  );
}

function ChatAiPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [sentTemplateIds, setSentTemplateIds] = useState<string[]>([]);

  const ask = useMutation({
    mutationFn: async (message: string) =>
      testAiReply({
        data: {
          message,
          history: turns.map((t) => ({ role: t.role, content: t.content })),
          activeProductId,
          sentTemplateIds,
        },
      }),
    onSuccess: (result) => {
      if (result.product_id) setActiveProductId(result.product_id);
      if (result.template) {
        const tpl = result.template;
        setSentTemplateIds((ids) => [...ids, tpl.productId]);
        setTurns((t) => [...t, { role: "assistant", content: tpl.copy, template: tpl }]);
      }
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: result.reply,
          meta: result.sale_closed ? "venta detectada" : undefined,
        },
      ]);
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("rate_limited")
          ? "Demasiadas solicitudes, intenta en unos segundos."
          : e.message.includes("credits")
            ? "Créditos de IA agotados."
            : e.message,
      ),
  });

  function submit() {
    const message = draft.trim();
    if (!message) return;
    setTurns((t) => [...t, { role: "user", content: message }]);
    setDraft("");
    ask.mutate(message);
  }



  return (
    <PageShell>
      <PageHeader
        title="Chat IA"
        description="Simula una conversación real para validar tu entrenamiento y catálogo."
      />

      <Card>
        <CardContent className="flex h-[60vh] flex-col gap-3 p-4">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {turns.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Escribe como si fueras un cliente: “hola, cuánto cuesta el reloj?”
              </p>
            )}
            {turns.map((t, i) => (
              <div
                key={i}
                className={cn(
                  "flex max-w-[85%] gap-2 rounded-xl px-3 py-2 text-sm",
                  t.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {t.role === "user" ? (
                  <User className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <Bot className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div>
                  <p className="whitespace-pre-wrap">{t.content}</p>
                  {t.meta && (
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      {t.meta}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
            {ask.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Escribiendo...
              </div>
            )}
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              rows={1}
              className="max-h-32 min-h-10 resize-none"
              value={draft}
              placeholder="Mensaje del cliente"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <Button onClick={submit} disabled={ask.isPending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
