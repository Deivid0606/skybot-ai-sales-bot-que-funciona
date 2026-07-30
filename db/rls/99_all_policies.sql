-- BOT SKY — Todas las politicas RLS en un solo archivo.
-- Requiere 00_prerequisites.sql, 01_grants.sql y 02_enable_rls.sql.

-- Politicas RLS: public.ads

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ads_ws_access" ON public.ads;
CREATE POLICY "ads_ws_access" ON public.ads
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.ai_settings

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_settings_ws_access" ON public.ai_settings;
CREATE POLICY "ai_settings_ws_access" ON public.ai_settings
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.app_messages

ALTER TABLE public.app_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_messages_admin_write" ON public.app_messages;
CREATE POLICY "app_messages_admin_write" ON public.app_messages
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "app_messages_read" ON public.app_messages;
CREATE POLICY "app_messages_read" ON public.app_messages
  FOR SELECT
  USING (true);

-- Politicas RLS: public.audit_logs

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_ws_access" ON public.audit_logs;
CREATE POLICY "audit_logs_ws_access" ON public.audit_logs
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.complaints

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members manage complaints" ON public.complaints;
CREATE POLICY "Workspace members manage complaints" ON public.complaints
  FOR ALL
  TO authenticated
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- Politicas RLS: public.contacts

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_ws_access" ON public.contacts;
CREATE POLICY "contacts_ws_access" ON public.contacts
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.conversation_balances

ALTER TABLE public.conversation_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_balances_ws_access" ON public.conversation_balances;
CREATE POLICY "conversation_balances_ws_access" ON public.conversation_balances
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.conversation_labels

ALTER TABLE public.conversation_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_labels_ws_access" ON public.conversation_labels;
CREATE POLICY "conversation_labels_ws_access" ON public.conversation_labels
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.conversation_usage

ALTER TABLE public.conversation_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_usage_ws_access" ON public.conversation_usage;
CREATE POLICY "conversation_usage_ws_access" ON public.conversation_usage
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.conversations

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_ws_access" ON public.conversations;
CREATE POLICY "conversations_ws_access" ON public.conversations
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.followup_sends

ALTER TABLE public.followup_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members read followup sends" ON public.followup_sends;
CREATE POLICY "workspace members read followup sends" ON public.followup_sends
  FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id));

-- Politicas RLS: public.integration_logs

ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_logs_ws_access" ON public.integration_logs;
CREATE POLICY "integration_logs_ws_access" ON public.integration_logs
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.labels

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "labels_ws_access" ON public.labels;
CREATE POLICY "labels_ws_access" ON public.labels
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.messages

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_ws_access" ON public.messages;
CREATE POLICY "messages_ws_access" ON public.messages
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.notifications

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_admin" ON public.notifications;
CREATE POLICY "notifications_admin" ON public.notifications
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "notifications_read" ON public.notifications;
CREATE POLICY "notifications_read" ON public.notifications
  FOR SELECT
  TO authenticated
  USING ((((audience = 'seller'::text) AND is_workspace_member(workspace_id)) OR ((audience = 'admin'::text) AND has_role(auth.uid(), 'admin'::app_role)) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE
  TO authenticated
  USING ((((audience = 'seller'::text) AND is_workspace_member(workspace_id)) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((((audience = 'seller'::text) AND is_workspace_member(workspace_id)) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.order_items

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_ws_access" ON public.order_items;
CREATE POLICY "order_items_ws_access" ON public.order_items
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.order_status_history

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_status_history_ws_access" ON public.order_status_history;
CREATE POLICY "order_status_history_ws_access" ON public.order_status_history
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.orders

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_ws_access" ON public.orders;
CREATE POLICY "orders_ws_access" ON public.orders
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.payment_receipts

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_receipts_ws_access" ON public.payment_receipts;
CREATE POLICY "payment_receipts_ws_access" ON public.payment_receipts
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.plan_purchases

ALTER TABLE public.plan_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_purchases_ws_access" ON public.plan_purchases;
CREATE POLICY "plan_purchases_ws_access" ON public.plan_purchases
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.plans

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_admin" ON public.plans;
CREATE POLICY "plans_admin" ON public.plans
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "plans_read" ON public.plans;
CREATE POLICY "plans_read" ON public.plans
  FOR SELECT
  TO authenticated
  USING (true);

-- Politicas RLS: public.product_followups

ALTER TABLE public.product_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_followups_ws_access" ON public.product_followups;
CREATE POLICY "product_followups_ws_access" ON public.product_followups
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.product_keywords

ALTER TABLE public.product_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_keywords_ws_access" ON public.product_keywords;
CREATE POLICY "product_keywords_ws_access" ON public.product_keywords
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "public_catalog_keywords_read" ON public.product_keywords;
CREATE POLICY "public_catalog_keywords_read" ON public.product_keywords
  FOR SELECT
  TO anon
  USING ((EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_keywords.product_id) AND (p.is_active = true)))));

-- Politicas RLS: public.product_media

ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_media_ws_access" ON public.product_media;
CREATE POLICY "product_media_ws_access" ON public.product_media
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "public_catalog_media_read" ON public.product_media;
CREATE POLICY "public_catalog_media_read" ON public.product_media
  FOR SELECT
  TO anon
  USING ((EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_media.product_id) AND (p.is_active = true)))));

-- Politicas RLS: public.products

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_ws_access" ON public.products;
CREATE POLICY "products_ws_access" ON public.products
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "public_catalog_products_read" ON public.products;
CREATE POLICY "public_catalog_products_read" ON public.products
  FOR SELECT
  TO anon
  USING ((is_active = true));

-- Politicas RLS: public.profiles

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;
CREATE POLICY "profiles_self_read" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (((id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));

-- Politicas RLS: public.training_entries

ALTER TABLE public.training_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_entries_ws_access" ON public.training_entries;
CREATE POLICY "training_entries_ws_access" ON public.training_entries
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.user_roles

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_admin" ON public.user_roles;
CREATE POLICY "user_roles_admin" ON public.user_roles
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "user_roles_read" ON public.user_roles;
CREATE POLICY "user_roles_read" ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.user_settings

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_ws_access" ON public.user_settings;
CREATE POLICY "user_settings_ws_access" ON public.user_settings
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.webhook_events

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_events_admin" ON public.webhook_events;
CREATE POLICY "webhook_events_admin" ON public.webhook_events
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Politicas RLS: public.whatsapp_connections

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_connections_ws_access" ON public.whatsapp_connections;
CREATE POLICY "whatsapp_connections_ws_access" ON public.whatsapp_connections
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.workspace_members

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_members_admin" ON public.workspace_members;
CREATE POLICY "workspace_members_admin" ON public.workspace_members
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "workspace_members_read" ON public.workspace_members;
CREATE POLICY "workspace_members_read" ON public.workspace_members
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));

-- Politicas RLS: public.workspaces

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_catalog_workspaces_read" ON public.workspaces;
CREATE POLICY "public_catalog_workspaces_read" ON public.workspaces
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "workspaces_admin" ON public.workspaces;
CREATE POLICY "workspaces_admin" ON public.workspaces
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "workspaces_read" ON public.workspaces;
CREATE POLICY "workspaces_read" ON public.workspaces
  FOR SELECT
  TO authenticated
  USING ((is_workspace_member(id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (
);
