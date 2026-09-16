import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  BotOff,
  CheckCircle2,
  CalendarDays,
  Loader2,
  MessageSquare,
  MapPin,
  ExternalLink,
  Search,
  Save,
  Send,
  Sparkles,
  Paperclip,
  ShoppingBag,
  Tag,
  Trash2,
  Wand2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  aiReplyNow,
  deleteMessages,
  sendManualMessage,
  sendMediaMessage,
  sendProductCatalog,
  transcribeMessage,
} from "@/lib/chat.functions";
import { ChatMedia } from "@/components/chat-media";
import { MAX_FILE_BYTES, guessMediaType, uploadWorkspaceFile } from "@/lib/storage";
import { AdOriginCard } from "@/components/ad-origin-card";
import { ContactInfoDialog } from "@/components/contact-info-dialog";

function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isWithinLocalDateRange(
  value: string | null | undefined,
  dateFrom: string,
  dateTo: string,
) {
  if (!value || !dateFrom || !dateTo) return false;

  const date = new Date(value);
  const [fromYear, fromMonth, fromDay] = dateFrom.split("-").map(Number);
  const [toYear, toMonth, toDay] = dateTo.split("-").map(Number);

  const start = new Date(fromYear, fromMonth - 1, fromDay, 0, 0, 0, 0);
  const end = new Date(toYear, toMonth - 1, toDay, 23, 59, 59, 999);

  return date >= start && date <= end;
}

export const Route = createFileRoute("/_authenticated/inbox")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search.c === "string" ? search.c : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Inbox — BOT SKY" },
      { name: "description", content: "Conversaciones de WhatsApp en tiempo real con control humano." },
      { property: "og:title", content: "Inbox — BOT SKY" },
      { property: "og:description", content: "Atiende, pausa la IA y cierra ventas desde un solo lugar." },
    ],
  }),
  component: InboxPage,
});

function getGoogleMapsUrl(
  latitude?: number | string | null,
  longitude?: number | string | null,
) {
  if (latitude == null || longitude == null) return null;

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function InboxPage() {
  const { c: initialConversationId } = Route.useSearch();
  const { profile } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(getTodayDate);
  const [dateTo, setDateTo] = useState(getTodayDate);
  const [selectedLabelId, setSelectedLabelId] = useState("all");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [adName, setAdName] = useState("");
  const [adProductId, setAdProductId] = useState("");
  const [statusNow, setStatusNow] = useState(() => Date.now());
  const [verifiedPendingIds, setVerifiedPendingIds] = useState<string[] | null>(null);
  const [isCheckingPending, setIsCheckingPending] = useState(false);


  const { data: conversations } = useQuery({
    queryKey: ["conversations", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "*, contacts(name, phone, city), products(name, sales_copy), conversation_labels(label_id, labels(name, color))",
        )
        .eq("workspace_id", workspaceId!)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: labels } = useQuery({
    queryKey: ["labels", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labels")
        .select("*")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: products } = useQuery({
    queryKey: ["catalog-products", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price, promo_price")
        .eq("workspace_id", workspaceId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", activeId],
    enabled: Boolean(activeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel("inbox-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["messages"] });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStatusNow(Date.now());
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const active = conversations?.find((c) => c.id === activeId) ?? null;

  const { data: ad } = useQuery({
    queryKey: ["ad", workspaceId, active?.ad_id],
    enabled: Boolean(workspaceId && active?.ad_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ads")
        .select("*, products(name, sales_copy)")
        .eq("workspace_id", workspaceId!)
        .eq("ad_id", active!.ad_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setAdName(ad?.name ?? active?.ad_name ?? "");
    setAdProductId(ad?.product_id ?? active?.product_id ?? "");
  }, [ad?.name, ad?.product_id, active?.ad_name, active?.product_id, active?.ad_id]);

  const saveAd = useMutation({
    mutationFn: async () => {
      const userId = profile?.id;

      if (!workspaceId || !userId || !activeId || !active?.ad_id) {
        throw new Error(
          "Faltan datos del usuario, workspace o anuncio para poder guardarlo.",
        );
      }

      const cleanName = adName.trim();

      if (!cleanName) {
        throw new Error("Escribí el nombre del anuncio.");
      }

      if (!adProductId) {
        throw new Error("Seleccioná un producto.");
      }

      const adPayload = {
        workspace_id: workspaceId,
        user_id: userId,
        ad_id: active.ad_id,
        name: cleanName,
        product_id: adProductId,
        source_url: active.ad_url ?? ad?.source_url ?? null,
        media_url: active.ad_media_url ?? ad?.media_url ?? null,
        media_type: active.ad_media_type ?? ad?.media_type ?? null,
        is_active: true,
      };

      const { error: adError } = await supabase
        .from("ads")
        .upsert(adPayload, {
          onConflict: "workspace_id,ad_id",
        });

      if (adError) {
        throw new Error(`No se pudo guardar el anuncio: ${adError.message}`);
      }

      const { error: conversationError } = await supabase
        .from("conversations")
        .update({
          ad_name: cleanName,
          product_id: adProductId,
        })
        .eq("id", activeId)
        .eq("workspace_id", workspaceId);

      if (conversationError) {
        throw new Error(
          `El anuncio se guardó, pero no se pudo actualizar la conversación: ${conversationError.message}`,
        );
      }
    },

    onSuccess: () => {
      toast.success(ad ? "Anuncio actualizado correctamente" : "Anuncio registrado correctamente");

      queryClient.invalidateQueries({
        queryKey: ["ad", workspaceId, active?.ad_id],
      });

      queryClient.invalidateQueries({
        queryKey: ["conversations", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["dashboard", workspaceId],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!activeId || !draft.trim()) return;
      await sendManualMessage({ data: { conversationId: activeId, body: draft.trim() } });
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAi = useMutation({
    mutationFn: async (paused: boolean) => {
      if (!activeId) return;
      const { error } = await supabase
        .from("conversations")
        .update({ ai_paused: paused })
        .eq("id", activeId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const toggleLabel = useMutation({
    mutationFn: async (labelId: string) => {
      if (!activeId || !workspaceId || !profile) return;
      const existing = active?.conversation_labels.find((l) => l.label_id === labelId);
      if (existing) {
        const { error } = await supabase
          .from("conversation_labels")
          .delete()
          .eq("conversation_id", activeId)
          .eq("label_id", labelId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("conversation_labels").insert({
          workspace_id: workspaceId,
          user_id: profile.id,
          conversation_id: activeId,
          label_id: labelId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const aiNow = useMutation({
    mutationFn: async () => {
      if (!activeId) return;
      await aiReplyNow({ data: { conversationId: activeId } });
    },
    onSuccess: () => {
      toast.success("Respuesta de IA enviada");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unreadCandidates = (conversations ?? []).filter(
    (conversation) =>
      Number(conversation.unread_count ?? 0) > 0 &&
      !conversation.ai_paused &&
      !conversation.sale_closed,
  );

  const unreadCandidatesSignature = unreadCandidates
    .map(
      (conversation) =>
        `${conversation.id}:${conversation.last_message_at ?? ""}`,
    )
    .join("|");

  useEffect(() => {
    let cancelled = false;

    if (!workspaceId || unreadCandidates.length === 0) {
      setVerifiedPendingIds([]);
      setIsCheckingPending(false);
      return () => {
        cancelled = true;
      };
    }

    setIsCheckingPending(true);

    const verifyPendingConversations = async () => {
      const confirmedPendingIds: string[] = [];
      const batchSize = 10;

      // Se verifica en tandas para obtener el último mensaje real sin bloquear
      // ni sobrecargar la carga normal del Inbox.
      for (let index = 0; index < unreadCandidates.length; index += batchSize) {
        if (cancelled) return;

        const batch = unreadCandidates.slice(index, index + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (conversation) => {
            const { data: lastMessage, error } = await supabase
              .from("messages")
              .select("direction")
              .eq("conversation_id", conversation.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (error) throw error;

            return lastMessage?.direction === "inbound"
              ? conversation.id
              : null;
          }),
        );

        results.forEach((result) => {
          if (result.status === "fulfilled" && result.value) {
            confirmedPendingIds.push(result.value);
          } else if (result.status === "rejected") {
            console.error(
              "No se pudo verificar una conversación pendiente:",
              result.reason,
            );
          }
        });
      }

      if (!cancelled) {
        setVerifiedPendingIds(confirmedPendingIds);
        setIsCheckingPending(false);
      }
    };

    void verifyPendingConversations();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, unreadCandidatesSignature]);

  const verifiedPendingIdSet = new Set(verifiedPendingIds ?? []);
  const pendingCandidates = unreadCandidates.filter((conversation) =>
    verifiedPendingIdSet.has(conversation.id),
  );

  const removeVerifiedPendingIds = (conversationIds: string[]) => {
    if (conversationIds.length === 0) return;

    const resolvedIds = new Set(conversationIds);

    setVerifiedPendingIds((current) =>
      current?.filter((conversationId) => !resolvedIds.has(conversationId)) ??
      current,
    );
  };

  const aiReplyAll = useMutation({
    mutationFn: async () => {
      if (!workspaceId) {
        throw new Error("No se encontró el workspace.");
      }

      if (pendingCandidates.length === 0) {
        return { total: 0, responded: 0, skipped: 0, failed: 0 };
      }

      let responded = 0;
      let skipped = 0;
      let failed = 0;
      const batchSize = 5;

      // La comprobación exacta se hace únicamente al presionar el botón.
      // Solo responde si el último mensaje real de ese chat es del cliente.
      for (let index = 0; index < pendingCandidates.length; index += batchSize) {
        const batch = pendingCandidates.slice(index, index + batchSize);

        const results = await Promise.allSettled(
          batch.map(async (conversation) => {
            const { data: lastMessage, error } = await supabase
              .from("messages")
              .select("direction")
              .eq("conversation_id", conversation.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (error) throw error;

            if (!lastMessage || lastMessage.direction !== "inbound") {
              return {
                status: "skipped" as const,
                conversationId: conversation.id,
              };
            }

            await aiReplyNow({
              data: { conversationId: conversation.id },
            });

            return {
              status: "responded" as const,
              conversationId: conversation.id,
            };
          }),
        );

        const resolvedInThisBatch: string[] = [];

        results.forEach((result) => {
          if (result.status === "rejected") {
            failed += 1;
            console.error("Error al responder una conversación pendiente:", result.reason);
          } else if (result.value.status === "responded") {
            responded += 1;
            resolvedInThisBatch.push(result.value.conversationId);
          } else {
            skipped += 1;
            resolvedInThisBatch.push(result.value.conversationId);
          }
        });

        // Actualiza el KPI después de cada tanda para que el número vaya bajando
        // inmediatamente, sin esperar a que termine todo el proceso.
        removeVerifiedPendingIds(resolvedInThisBatch);
      }

      return {
        total: pendingCandidates.length,
        responded,
        skipped,
        failed,
      };
    },
    onSuccess: (result) => {
      if (result.total === 0) {
        toast.info("No hay respuestas pendientes");
      } else if (result.failed > 0) {
        toast.warning(
          `Respondidas: ${result.responded} · Omitidas: ${result.skipped} · Fallaron: ${result.failed}`,
        );
      } else if (result.responded === 0) {
        toast.info("No se encontraron chats cuyo último mensaje sea del cliente");
      } else {
        toast.success(
          `IA reanudada en ${result.responded} conversación${result.responded === 1 ? "" : "es"}`,
        );
      }

      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error: Error) => {
      toast.error(`No se pudieron responder los chats pendientes: ${error.message}`);
    },
  });

  const removeMessages = useMutation({
    mutationFn: async (ids: string[]) => {
      await deleteMessages({ data: { ids } });
    },
    onSuccess: (_d, ids) => {
      setSelected([]);
      toast.success(ids.length > 1 ? `${ids.length} mensajes eliminados` : "Mensaje eliminado");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteConversation = useMutation({
    mutationFn: async () => {
      if (!activeId || !workspaceId) return;

      const conversationId = activeId;

      const { error: labelsError } = await supabase
        .from("conversation_labels")
        .delete()
        .eq("conversation_id", conversationId);

      if (labelsError) throw labelsError;

      const { error: messagesError } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversationId);

      if (messagesError) throw messagesError;

      const { error: conversationError } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversationId)
        .eq("workspace_id", workspaceId);

      if (conversationError) throw conversationError;
    },
    onSuccess: () => {
      setActiveId(null);
      setSelected([]);
      setDraft("");
      toast.success("Chat eliminado");

      queryClient.removeQueries({ queryKey: ["messages", activeId] });
      queryClient.invalidateQueries({ queryKey: ["conversations", workspaceId] });
    },
    onError: (e: Error) => {
      toast.error(`No se pudo eliminar el chat: ${e.message}`);
    },
  });

  const sendFile = useMutation({
    mutationFn: async (file: File) => {
      if (!activeId || !workspaceId) return;
      if (file.size > MAX_FILE_BYTES) throw new Error("El archivo supera los 25 MB");
      const mediaType = guessMediaType(file) as "image" | "video" | "audio" | "document";
      const path = await uploadWorkspaceFile("chat-media", workspaceId, file, "outbound");
      await sendMediaMessage({
        data: { conversationId: activeId, storagePath: path, mediaType },
      });
    },
    onSuccess: () => {
      toast.success("Archivo enviado");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendCatalog = useMutation({
    mutationFn: async (productId: string) => {
      if (!activeId) return;
      await sendProductCatalog({ data: { conversationId: activeId, productId } });
    },
    onSuccess: () => {
      toast.success("Catálogo enviado");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transcribe = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await transcribeMessage({ data: { messageId } });
      return res.transcript;
    },
    onSuccess: () => {
      toast.success("Transcripción lista");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    setSelected([]);
  }, [activeId]);


  const possibleAiFailures = pendingCandidates.filter((conversation) => {
    if (!conversation.last_message_at) return false;

    const lastMessageAt = new Date(conversation.last_message_at).getTime();
    if (!Number.isFinite(lastMessageAt)) return false;

    return statusNow - lastMessageAt >= 3 * 60 * 1000;
  });

  const hasPossibleAiFailure = possibleAiFailures.length > 0;
  const aiAlertShownRef = useRef(false);

  useEffect(() => {
    if (hasPossibleAiFailure && !aiAlertShownRef.current) {
      toast.warning(
        `Posible fallo de IA: ${possibleAiFailures.length} conversación${
          possibleAiFailures.length === 1 ? "" : "es"
        } lleva${possibleAiFailures.length === 1 ? "" : "n"} más de 3 minutos pendiente${
          possibleAiFailures.length === 1 ? "" : "s"
        }`,
      );
      aiAlertShownRef.current = true;
    }

    if (!hasPossibleAiFailure) {
      aiAlertShownRef.current = false;
    }
  }, [hasPossibleAiFailure, possibleAiFailures.length]);

  const filtered = (conversations ?? []).filter((c) => {
    const q = search.trim().toLowerCase();

    const matchesSearch =
      !q ||
      (c.contacts?.name ?? "").toLowerCase().includes(q) ||
      (c.contacts?.phone ?? "").includes(q) ||
      (c.last_message ?? "").toLowerCase().includes(q);

    const matchesDate = isWithinLocalDateRange(
      c.created_at,
      dateFrom,
      dateTo,
    );

    const matchesLabel =
      selectedLabelId === "all" ||
      c.conversation_labels.some(
        (conversationLabel) =>
          conversationLabel.label_id === selectedLabelId,
      );

    return matchesSearch && matchesDate && matchesLabel;
  });

  const resetFilters = () => {
    const today = getTodayDate();
    setSearch("");
    setDateFrom(today);
    setDateTo(today);
    setSelectedLabelId("all");
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full">
      <aside
        className={cn(
          "flex w-full flex-col border-r border-border sm:w-80",
          activeId && "hidden sm:flex",
        )}
      >
        <div className="space-y-3 border-b border-border bg-card/60 p-3 backdrop-blur">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Respuestas pendientes
              </p>
              <p className="mt-1 text-2xl font-bold">
                {isCheckingPending ? "…" : pendingCandidates.length}
              </p>
            </div>

            <div
              className={cn(
                "rounded-lg border p-3",
                isCheckingPending
                  ? "border-border bg-muted/40"
                  : hasPossibleAiFailure
                  ? "border-destructive/50 bg-destructive/10"
                  : "border-emerald-500/30 bg-emerald-500/10",
              )}
            >
              <p className="text-[11px] font-medium text-muted-foreground">Estado IA</p>
              <p
                className={cn(
                  "mt-1 text-sm font-bold",
                  isCheckingPending
                    ? "text-muted-foreground"
                    : hasPossibleAiFailure
                      ? "text-destructive"
                      : "text-emerald-600",
                )}
              >
                {isCheckingPending
                  ? "Verificando..."
                  : hasPossibleAiFailure
                    ? "Posible fallo"
                    : "Sin alertas"}
              </p>
            </div>
          </div>

          {hasPossibleAiFailure && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
              <div className="flex items-start gap-2">
                <BotOff className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Posible fallo de la IA</p>
                  <p className="mt-1">
                    {possibleAiFailures.length} conversación{
                      possibleAiFailures.length === 1 ? "" : "es"
                    } lleva{possibleAiFailures.length === 1 ? "" : "n"} más de 3 minutos sin respuesta.
                  </p>
                </div>
              </div>
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            disabled={
              isCheckingPending ||
              aiReplyAll.isPending ||
              pendingCandidates.length === 0
            }
            onClick={() => {
              if (pendingCandidates.length === 0) {
                toast.info("No hay respuestas pendientes");
                return;
              }

              const confirmed = window.confirm(
                `Se comprobarán ${pendingCandidates.length} conversación${
                  pendingCandidates.length === 1 ? "" : "es"
                }. La IA solo responderá cuando el último mensaje sea del cliente. ¿Continuar?`,
              );

              if (confirmed) {
                aiReplyAll.mutate();
              }
            }}
          >
            {isCheckingPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verificando pendientes...
              </>
            ) : aiReplyAll.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Comprobando y respondiendo...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Responder pendientes ({pendingCandidates.length})
              </>
            )}
          </Button>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nombre, teléfono o mensaje"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Desde
              </span>
              <Input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => {
                  const value = event.target.value;
                  setDateFrom(value);
                  if (value > dateTo) setDateTo(value);
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Hasta
              </span>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(event) => {
                  const value = event.target.value;
                  setDateTo(value);
                  if (value < dateFrom) setDateFrom(value);
                }}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <label className="min-w-0 flex-1 space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Tag className="h-3.5 w-3.5" /> Etiqueta
              </span>
              <select
                value={selectedLabelId}
                onChange={(event) => setSelectedLabelId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="all">Todas las etiquetas</option>
                {labels?.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </select>
            </label>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mt-5 shrink-0"
              onClick={resetFilters}
              title="Restablecer filtros"
              aria-label="Restablecer filtros"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Mostrando {filtered.length} conversación{filtered.length === 1 ? "" : "es"}</span>
            <span>{dateFrom === dateTo ? dateFrom : `${dateFrom} — ${dateTo}`}</span>
          </div>
        </div>
        <ScrollArea className="flex-1">
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No hay conversaciones que coincidan con los filtros.</p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={cn(
                "flex w-full flex-col gap-1 border-b border-border px-3 py-3 text-left transition-colors hover:bg-accent",
                activeId === c.id && "bg-accent",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {c.contacts?.name || c.contacts?.phone}
                </span>
                {c.unread_count > 0 && (
                  <Badge className="h-5 min-w-5 justify-center px-1 text-[10px]">
                    {c.unread_count}
                  </Badge>
                )}
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {c.last_message || "Sin mensajes"}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {c.sale_closed && (
                  <Badge variant="default" className="text-[10px]">
                    venta
                  </Badge>
                )}
                {c.ad_id && (
                  <Badge variant="secondary" className="text-[10px]">
                    anuncio
                  </Badge>
                )}
                {c.ai_paused && (
                  <Badge variant="outline" className="text-[10px]">
                    IA pausada
                  </Badge>
                )}
                {c.conversation_labels.map((l) => (
                  <span
                    key={l.label_id}
                    className="rounded-full px-1.5 py-0.5 text-[10px] text-background"
                    style={{ backgroundColor: l.labels?.color ?? "#64748b" }}
                  >
                    {l.labels?.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </ScrollArea>
      </aside>

      <section className={cn("flex min-w-0 flex-1 flex-col", !activeId && "hidden sm:flex")}>
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageSquare className="h-8 w-8" />
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <Button
                variant="ghost"
                size="sm"
                className="sm:hidden"
                onClick={() => setActiveId(null)}
              >
                Volver
              </Button>
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {active.contacts?.name || active.contacts?.phone}
                </p>
                <p className="text-xs text-muted-foreground">
                  {active.contacts?.phone}
                  {active.contacts?.city ? ` · ${active.contacts.city}` : ""}
                  {active.products?.name ? ` · ${active.products.name}` : ""}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setInfoOpen(true)}>
                  <User className="mr-1 h-4 w-4" /> Info
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteConversation.isPending}
                  onClick={() => {
                    const confirmed = window.confirm(
                      "¿Seguro que quieres borrar este chat? Se eliminarán todos sus mensajes.",
                    );

                    if (confirmed) {
                      deleteConversation.mutate();
                    }
                  }}
                >
                  {deleteConversation.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-4 w-4" />
                  )}
                  Borrar chat
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" disabled={sendCatalog.isPending}>
                      {sendCatalog.isPending ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <ShoppingBag className="mr-1 h-4 w-4" />
                      )}
                      Catálogo
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 space-y-1">
                    {!products?.length && (
                      <p className="text-sm text-muted-foreground">Crea productos primero.</p>
                    )}
                    {products?.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => sendCatalog.mutate(p.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <Popover>

                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Tag className="mr-1 h-4 w-4" /> Etiquetas
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 space-y-1">
                    {!labels?.length && (
                      <p className="text-sm text-muted-foreground">Crea etiquetas primero.</p>
                    )}
                    {labels?.map((l) => {
                      const on = active.conversation_labels.some((cl) => cl.label_id === l.id);
                      return (
                        <button
                          key={l.id}
                          onClick={() => toggleLabel.mutate(l.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                            on && "bg-accent",
                          )}
                        >
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: l.color }}
                          />
                          {l.name}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => aiNow.mutate()}
                  disabled={aiNow.isPending}
                >
                  {aiNow.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-4 w-4" />
                  )}
                  Responder IA
                </Button>
                <Button
                  variant={active.ai_paused ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleAi.mutate(!active.ai_paused)}
                >
                  {active.ai_paused ? (
                    <>
                      <Bot className="mr-1 h-4 w-4" /> Reactivar IA
                    </>
                  ) : (
                    <>
                      <BotOff className="mr-1 h-4 w-4" /> Pausar IA
                    </>
                  )}
                </Button>
                {active.sale_closed && (
                  <Badge>
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Venta
                  </Badge>
                )}
              </div>
            </header>

            {selected.length > 0 && (
              <div className="flex items-center gap-2 border-b border-border bg-accent/50 px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                  <X className="mr-1 h-4 w-4" /> Cancelar
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selected.length} seleccionado{selected.length > 1 ? "s" : ""}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="ml-auto"
                  disabled={removeMessages.isPending}
                  onClick={() => removeMessages.mutate(selected)}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Eliminar
                </Button>
              </div>
            )}

            <ScrollArea className="flex-1 bg-muted/30 p-4">
              <div className="mx-auto flex max-w-3xl flex-col gap-2">
                {active.ad_id && (
                  <div className="mb-2 rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">Registrar anuncio</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ID detectado: <span className="font-mono">{active.ad_id}</span>
                        </p>
                      </div>
                      <Badge variant={ad ? "default" : "secondary"}>
                        {ad ? "Registrado" : "Sin registrar"}
                      </Badge>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <Input
                        value={adName}
                        onChange={(event) => setAdName(event.target.value)}
                        placeholder="Nombre del anuncio"
                      />

                      <select
                        value={adProductId}
                        onChange={(event) => setAdProductId(event.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <option value="">Seleccionar producto</option>
                        {products?.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>

                      <Button
                        type="button"
                        onClick={() => saveAd.mutate()}
                        disabled={saveAd.isPending || !adName.trim() || !adProductId}
                      >
                        {saveAd.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        {ad ? "Actualizar" : "Guardar"}
                      </Button>
                    </div>
                  </div>
                )}

                {active.ad_id && (
                  <AdOriginCard
                    adId={active.ad_id}
                    mediaUrl={active.ad_media_url ?? ad?.media_url}
                    mediaType={active.ad_media_type ?? ad?.media_type}
                    sourceUrl={active.ad_url ?? ad?.source_url}
                    title={
                      ad?.name ??
                      active.ad_name ??
                      ad?.products?.name ??
                      active.products?.name
                    }
                    copy={ad?.products?.sales_copy ?? active.products?.sales_copy}
                    date={active.created_at}
                  />
                )}

                {messages?.map((m) => {
                  const isSelected = selected.includes(m.id);
                  const googleMapsUrl = getGoogleMapsUrl(m.latitude, m.longitude);
                  const isLocation = Boolean(googleMapsUrl);
                  const toggleSelect = () =>
                    setSelected((prev) =>
                      prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                    );
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "group flex items-center gap-2",
                        m.direction === "inbound" ? "self-start" : "flex-row-reverse self-end",
                        "max-w-[90%]",
                      )}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => selected.length > 0 && toggleSelect()}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          toggleSelect();
                        }}
                        className={cn(
                          "cursor-pointer rounded-2xl px-3 py-2 text-sm shadow-sm",
                          m.direction === "inbound"
                            ? "rounded-bl-sm bg-card"
                            : "rounded-br-sm bg-primary text-primary-foreground",
                          isSelected && "ring-2 ring-destructive",
                        )}
                      >
                        {m.media_url ? (
                          <div
                            className="mb-1"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ChatMedia path={m.media_url} type={m.media_type} />
                          </div>
                        ) : m.media_type ? (
                          <p className="mb-1 rounded-md bg-background/20 px-2 py-1 text-xs opacity-75">
                            No se encontró el archivo de este mensaje.
                          </p>
                        ) : null}

                        {isLocation && googleMapsUrl ? (
                          <div className="min-w-[230px] space-y-2">
                            <div className="flex items-start gap-2">
                              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-semibold">Ubicación del cliente</p>

                                {m.location_name && (
                                  <p className="mt-1 text-xs">{m.location_name}</p>
                                )}

                                {m.location_address && (
                                  <p className="text-xs opacity-80">{m.location_address}</p>
                                )}

                                <p className="mt-1 break-all text-[10px] opacity-60">
                                  {m.latitude}, {m.longitude}
                                </p>
                              </div>
                            </div>

                            <a
                              href={googleMapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="flex w-full items-center justify-center gap-2 rounded-lg bg-background/20 px-3 py-2 text-xs font-semibold transition-colors hover:bg-background/30"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              Abrir en Google Maps
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        ) : (
                          m.body &&
                          !(
                            m.media_type === "audio" &&
                            (m.body === "[audio]" || m.body === "[voice]")
                          ) && (
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          )
                        )}

                        {m.transcript && (
                          <div className="mt-1 rounded-md bg-background/20 p-2 text-xs">
                            <p className="mb-0.5 font-medium opacity-80">
                              {m.media_type === "audio" ? "Transcripción" : "Interpretación"}
                            </p>
                            <p className="whitespace-pre-wrap italic opacity-90">{m.transcript}</p>
                          </div>
                        )}

                        {m.media_url &&
                          (m.media_type === "audio" || m.media_type === "image") &&
                          !m.transcript && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                transcribe.mutate(m.id);
                              }}
                              disabled={transcribe.isPending}
                              className="mt-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] underline opacity-80 hover:bg-background/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {transcribe.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Wand2 className="h-3 w-3" />
                              )}
                              {m.media_type === "audio"
                                ? "Transcribir con IA"
                                : "Interpretar con IA"}
                            </button>
                          )}
                        <p className="mt-1 text-[10px] opacity-70">
                          {m.sender === "ai" ? "IA · " : m.sender === "agent" ? "Tú · " : ""}
                          {formatTime(m.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          aria-label="Seleccionar mensaje"
                          onClick={toggleSelect}
                          className={cn(
                            "h-4 w-4 rounded-full border border-muted-foreground",
                            isSelected && "border-destructive bg-destructive",
                          )}
                        />
                        <button
                          aria-label="Eliminar mensaje"
                          onClick={() => removeMessages.mutate([m.id])}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>


            <footer className="flex items-end gap-2 border-t border-border p-3">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="image/*,video/*,audio/*,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) sendFile.mutate(file);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="icon"
                disabled={sendFile.isPending}
                onClick={() => fileRef.current?.click()}
                aria-label="Adjuntar archivo"
              >
                {sendFile.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </Button>
              <Textarea
                rows={1}
                value={draft}
                placeholder="Escribe un mensaje..."
                className="max-h-32 min-h-10 resize-none"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send.mutate();
                  }
                }}
              />
              <Button onClick={() => send.mutate()} disabled={send.isPending || !draft.trim()}>
                {send.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </footer>

            <ContactInfoDialog
              contactId={active.contact_id}
              open={infoOpen}
              onOpenChange={setInfoOpen}
            />
          </>

        )}
      </section>
    </div>
  );
}
