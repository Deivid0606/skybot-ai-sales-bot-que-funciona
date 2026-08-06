import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Bot, Loader2, Send, User } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, PageShell } from "@/components/page-shell";
import { ChatMedia } from "@/components/chat-media";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { testAiReply } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/chat-ia")({
  head: () => ({
    meta: [
      {
        title: "Chat IA — BOT SKY",
      },
      {
        name: "description",
        content:
          "Prueba cómo responde tu vendedor virtual antes de publicarlo.",
      },
      {
        property: "og:title",
        content: "Chat IA — BOT SKY",
      },
      {
        property: "og:description",
        content: "Simulador de conversación con tu IA entrenada.",
      },
    ],
  }),
  component: ChatAiPage,
});

type TemplateMedia = {
  type: string;
  url: string;
};

type Template = {
  productId: string;
  name: string;
  copy: string;
  media: TemplateMedia[];
};

type Turn = {
  role: "user" | "assistant";
  content: string;
  meta?: string;
  template?: Template;
};

function normalizeTemplateMedia(
  media: TemplateMedia[] | null | undefined,
): TemplateMedia[] {
  if (!Array.isArray(media)) {
    return [];
  }

  return media.filter((item): item is TemplateMedia => {
    return Boolean(
      item &&
        typeof item.type === "string" &&
        typeof item.url === "string" &&
        item.url.trim(),
    );
  });
}

function TemplateBubble({ template }: { template: Template }) {
  const media = normalizeTemplateMedia(template.media);

  const images = media.filter(
    (item) => item.type.trim().toLowerCase() === "image",
  );

  const otherMedia = media.filter(
    (item) => item.type.trim().toLowerCase() !== "image",
  );

  return (
    <div className="mr-auto flex max-w-[85%] flex-col gap-2 rounded-xl bg-muted p-2 text-sm md:max-w-[55%]">
      {images.length > 0 && (
        <div
          className={cn(
            "grid gap-2",
            images.length > 1 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {images.map((item, index) => (
            <ChatMedia
              key={`image-${item.url}-${index}`}
              bucket="product-media"
              path={item.url}
              type="image"
              alt={template.name || "Imagen del producto"}
            />
          ))}
        </div>
      )}

      {otherMedia.length > 0 && (
        <div className="flex flex-col gap-2">
          {otherMedia.map((item, index) => (
            <ChatMedia
              key={`${item.type}-${item.url}-${index}`}
              bucket="product-media"
              path={item.url}
              type={item.type}
              alt={template.name || "Archivo del producto"}
            />
          ))}
        </div>
      )}

      {template.copy?.trim() && (
        <p className="whitespace-pre-wrap px-1">{template.copy}</p>
      )}

      <Badge variant="secondary" className="w-fit text-[10px]">
        plantilla por palabra clave
      </Badge>
    </div>
  );
}

function ChatAiPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [activeProductId, setActiveProductId] = useState<string | null>(
    null,
  );
  const [sentTemplateIds, setSentTemplateIds] = useState<string[]>([]);

  // 🔥 CONFIGURACIÓN: Límite de historial para ahorrar tokens
  const HISTORY_LIMIT = 10; // Solo envía los últimos 10 mensajes

  const ask = useMutation({
    mutationFn: async (message: string) => {
      // 🔥 OPTIMIZACIÓN CRÍTICA: Solo envía los últimos HISTORY_LIMIT mensajes
      const limitedHistory = turns
        .slice(-HISTORY_LIMIT)
        .map((turn) => ({
          role: turn.role,
          content: turn.content,
        }));

      // Log para debugging (puedes eliminar esta línea en producción)
      console.log(
        `[Chat IA] Enviando ${limitedHistory.length} mensajes (de ${turns.length} totales) - Ahorro: ${((1 - limitedHistory.length / Math.max(turns.length, 1)) * 100).toFixed(0)}%`
      );

      return testAiReply({
        data: {
          message,
          history: limitedHistory, // ← AHORA SOLO ENVÍA 10 MENSAJES
          activeProductId,
          sentTemplateIds,
        },
      });
    },

    onSuccess: (result) => {
      console.log("[Chat IA] Respuesta completa:", result);
      console.log("[Chat IA] Plantilla:", result.template);
      console.log("[Chat IA] Multimedia:", result.template?.media);

      if (result.product_id) {
        setActiveProductId(result.product_id);
      }

      if (result.template?.productId) {
        setSentTemplateIds((currentIds) => {
          if (currentIds.includes(result.template.productId)) {
            return currentIds;
          }

          return [...currentIds, result.template.productId];
        });
      }

      setTurns((currentTurns) => {
        const newTurns: Turn[] = [];

        if (result.template) {
          const template: Template = {
            productId: result.template.productId,
            name: result.template.name ?? "Producto",
            copy: result.template.copy ?? "",
            media: normalizeTemplateMedia(result.template.media),
          };

          newTurns.push({
            role: "assistant",
            content: template.copy,
            template,
          });
        }

        if (result.reply?.trim()) {
          newTurns.push({
            role: "assistant",
            content: result.reply,
            meta: result.sale_closed ? "venta detectada" : undefined,
          });
        }

        return [...currentTurns, ...newTurns];
      });
    },

    onError: (error: Error) => {
      console.error("[Chat IA] Error solicitando respuesta:", error);

      toast.error(
        error.message.includes("rate_limited")
          ? "Demasiadas solicitudes, intenta en unos segundos."
          : error.message.includes("credits")
            ? "Créditos de IA agotados."
            : error.message || "No se pudo obtener una respuesta de la IA.",
      );
    },
  });

  function submit() {
    const message = draft.trim();

    if (!message || ask.isPending) {
      return;
    }

    setTurns((currentTurns) => [
      ...currentTurns,
      {
        role: "user",
        content: message,
      },
    ]);

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
                Escribe como si fueras un cliente: "hola, cuánto cuesta el
                reloj?"
              </p>
            )}

            {turns.map((turn, index) => {
              if (turn.template) {
                return (
                  <TemplateBubble
                    key={`template-${index}`}
                    template={turn.template}
                  />
                );
              }

              return (
                <div
                  key={`message-${index}`}
                  className={cn(
                    "flex max-w-[85%] gap-2 rounded-xl px-3 py-2 text-sm",
                    turn.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "mr-auto bg-muted text-foreground",
                  )}
                >
                  {turn.role === "user" ? (
                    <User className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <Bot className="mt-0.5 h-4 w-4 shrink-0" />
                  )}

                  <div className="min-w-0">
                    <p className="whitespace-pre-wrap break-words">
                      {turn.content}
                    </p>

                    {turn.meta && (
                      <Badge
                        variant="secondary"
                        className="mt-1 text-[10px]"
                      >
                        {turn.meta}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}

            {ask.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Escribiendo...
              </div>
            )}
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              rows={1}
              className="max-h-32 min-h-10 resize-none"
              value={draft}
              placeholder="Mensaje del cliente"
              disabled={ask.isPending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submit();
                }
              }}
            />

            <Button
              type="button"
              onClick={submit}
              disabled={ask.isPending || !draft.trim()}
              aria-label="Enviar mensaje"
            >
              {ask.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
