-- BOT SKY — GRANTs del Data API (obligatorios: RLS por si sola no da acceso).
-- Ejecutar DESPUES de crear las tablas y ANTES/junto con las politicas.


-- ads
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads TO authenticated;
GRANT ALL ON public.ads TO service_role;

-- ai_settings
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;

-- app_messages
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_messages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_messages TO authenticated;
GRANT ALL ON public.app_messages TO service_role;

-- audit_logs
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

-- complaints
GRANT SELECT, INSERT, UPDATE, DELETE ON public.complaints TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.complaints TO authenticated;
GRANT ALL ON public.complaints TO service_role;

-- contacts
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;

-- conversation_balances
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_balances TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_balances TO authenticated;
GRANT ALL ON public.conversation_balances TO service_role;

-- conversation_labels
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_labels TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_labels TO authenticated;
GRANT ALL ON public.conversation_labels TO service_role;

-- conversation_usage
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_usage TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_usage TO authenticated;
GRANT ALL ON public.conversation_usage TO service_role;

-- conversations
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

-- followup_sends
GRANT SELECT, INSERT, UPDATE, DELETE ON public.followup_sends TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.followup_sends TO authenticated;
GRANT ALL ON public.followup_sends TO service_role;

-- integration_logs
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_logs TO authenticated;
GRANT ALL ON public.integration_logs TO service_role;

-- labels
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labels TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labels TO authenticated;
GRANT ALL ON public.labels TO service_role;

-- messages
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

-- notifications
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- order_items
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;

-- order_status_history
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_status_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_status_history TO authenticated;
GRANT ALL ON public.order_status_history TO service_role;

-- orders
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

-- payment_receipts
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_receipts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_receipts TO authenticated;
GRANT ALL ON public.payment_receipts TO service_role;

-- plan_purchases
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_purchases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_purchases TO authenticated;
GRANT ALL ON public.plan_purchases TO service_role;

-- plans
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;

-- product_followups
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_followups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_followups TO authenticated;
GRANT ALL ON public.product_followups TO service_role;

-- product_keywords
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_keywords TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_keywords TO authenticated;
GRANT ALL ON public.product_keywords TO service_role;

-- product_media
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_media TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_media TO authenticated;
GRANT ALL ON public.product_media TO service_role;

-- products
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

-- profiles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- training_entries
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_entries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_entries TO authenticated;
GRANT ALL ON public.training_entries TO service_role;

-- user_roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- user_settings
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;

-- webhook_events
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_events TO authenticated;
GRANT ALL ON public.webhook_events TO service_role;

-- whatsapp_connections
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_connections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_connections TO authenticated;
GRANT ALL ON public.whatsapp_connections TO service_role;

-- workspace_members
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;

-- workspaces
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
