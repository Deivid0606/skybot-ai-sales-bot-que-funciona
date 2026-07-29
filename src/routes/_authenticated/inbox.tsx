import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  BotOff,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Tag,
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
import { sendManualMessage } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/inbox")({
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

function InboxPage() {
  const { profile } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useQuery({
    queryKey: ["conversations", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "*, contacts(name, phone, city), products(name), conversation_labels(label_id, labels(name, color))",
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

  const active = conversations?.find((c) => c.id === activeId) ?? null;

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

  const filtered = (conversations ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.contacts?.name ?? "").toLowerCase().includes(q) ||
      (c.contacts?.phone ?? "").includes(q) ||
      (c.last_message ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full">
      <aside
        className={cn(
          "flex w-full flex-col border-r border-border sm:w-80",
          activeId && "hidden sm:flex",
        )}
      >
        <div className="relative p-3">
          <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar chat"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ScrollArea className="flex-1">
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Aún no hay conversaciones.</p>
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
                  {active.products?.name ? ` · ${active.products.name}` : ""}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
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

            <ScrollArea className="flex-1 bg-muted/30 p-4">
              <div className="mx-auto flex max-w-3xl flex-col gap-2">
                {messages?.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                      m.direction === "inbound"
                        ? "self-start rounded-bl-sm bg-card"
                        : "self-end rounded-br-sm bg-primary text-primary-foreground",
                    )}
                  >
                    {m.media_url && (
                      <p className="mb-1 text-xs opacity-80">[{m.media_type ?? "archivo"}]</p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className="mt-1 text-[10px] opacity-70">
                      {m.sender === "ai" ? "IA · " : m.sender === "agent" ? "Tú · " : ""}
                      {formatTime(m.created_at)}
                    </p>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <footer className="flex items-end gap-2 border-t border-border p-3">
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
          </>
        )}
      </section>
    </div>
  );
}
