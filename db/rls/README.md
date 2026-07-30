# Politicas RLS — BOT SKY

Archivos para replicar la seguridad en otra base de datos Postgres/Supabase.

## Orden de ejecucion

1. `db/schema.sql` — tablas e indices
2. `00_prerequisites.sql` — tipos ENUM y funciones SECURITY DEFINER que usan las politicas
3. `01_grants.sql` — permisos del Data API para anon / authenticated / service_role
4. `02_enable_rls.sql` — activa RLS en todas las tablas
5. `policies/*.sql` — una politica por tabla (o `99_all_policies.sql` para aplicar todo junto)

## Politicas por tabla

- `policies/ads.sql` — 1 politica(s)
- `policies/ai_settings.sql` — 1 politica(s)
- `policies/app_messages.sql` — 2 politica(s)
- `policies/audit_logs.sql` — 1 politica(s)
- `policies/complaints.sql` — 1 politica(s)
- `policies/contacts.sql` — 1 politica(s)
- `policies/conversation_balances.sql` — 1 politica(s)
- `policies/conversation_labels.sql` — 1 politica(s)
- `policies/conversation_usage.sql` — 1 politica(s)
- `policies/conversations.sql` — 1 politica(s)
- `policies/followup_sends.sql` — 1 politica(s)
- `policies/integration_logs.sql` — 1 politica(s)
- `policies/labels.sql` — 1 politica(s)
- `policies/messages.sql` — 1 politica(s)
- `policies/notifications.sql` — 3 politica(s)
- `policies/order_items.sql` — 1 politica(s)
- `policies/order_status_history.sql` — 1 politica(s)
- `policies/orders.sql` — 1 politica(s)
- `policies/payment_receipts.sql` — 1 politica(s)
- `policies/plan_purchases.sql` — 1 politica(s)
- `policies/plans.sql` — 2 politica(s)
- `policies/product_followups.sql` — 1 politica(s)
- `policies/product_keywords.sql` — 2 politica(s)
- `policies/product_media.sql` — 2 politica(s)
- `policies/products.sql` — 2 politica(s)
- `policies/profiles.sql` — 3 politica(s)
- `policies/training_entries.sql` — 1 politica(s)
- `policies/user_roles.sql` — 2 politica(s)
- `policies/user_settings.sql` — 1 politica(s)
- `policies/webhook_events.sql` — 1 politica(s)
- `policies/whatsapp_connections.sql` — 1 politica(s)
- `policies/workspace_members.sql` — 2 politica(s)
- `policies/workspaces.sql` — 3 politica(s)

Total: 46 politicas en 33 tablas.
