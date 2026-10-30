-- Índices para que Inbox y Dashboard carguen rápido: buscan por vendedor + fecha.
-- Son seguros de aplicar varias veces (IF NOT EXISTS) y no cambian datos.
CREATE INDEX IF NOT EXISTS messages_workspace_created_idx
  ON public.messages (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS conversations_workspace_last_message_idx
  ON public.conversations (workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_workspace_created_idx
  ON public.conversations (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS orders_workspace_created_idx
  ON public.orders (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS orders_workspace_conversation_idx
  ON public.orders (workspace_id, conversation_id);
