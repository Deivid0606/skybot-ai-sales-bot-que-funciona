## BOT SKY — Plataforma SaaS de ventas por WhatsApp con IA

Aplicación multiusuario (React + TypeScript + Tailwind + TanStack Start) con backend en Lovable Cloud (Postgres, Auth, Storage, Realtime, RLS) e integraciones reales con WhatsApp Business Cloud API y Lovable AI (Gemini).

### Arquitectura

```text
Cliente WhatsApp
   │  (mensaje)
   ▼
Meta Cloud API ──► /api/public/whatsapp/webhook  (verifica firma HMAC, idempotencia por wamid)
   │                        │
   │                        ├─► inserta contact / conversation / message
   │                        ├─► descuenta saldo de conversaciones (una vez por conversación/ventana)
   │                        ├─► detecta producto por palabras clave + ad_id
   │                        ├─► arma contexto (vendedor + entrenamientos + producto + historial)
   │                        ├─► Lovable AI (Gemini) → respuesta / tool "crear_pedido"
   │                        └─► envía respuesta vía Cloud API + guarda mensaje
   ▼
Realtime → Inbox del vendedor (sin recargar)
```

- Frontend: rutas TanStack, sidebar SaaS, tema claro/oscuro, responsive.
- Backend: `createServerFn` para todo lo interno (productos, pedidos, IA de prueba, planes), rutas `src/routes/api/public/*` solo para webhook de Meta y cron de seguimientos.
- Secretos (token de Meta, verify token, API keys) guardados en el backend, nunca en el frontend.

### Esquema de base de datos (resumen)

`profiles` (rol, estado pending/approved/rejected/blocked), `user_roles` (tabla separada + `has_role()`), `workspaces`, `workspace_members`, `user_settings`, `whatsapp_connections`, `ai_settings`, `training_entries`, `products`, `product_media`, `product_keywords`, `product_followups`, `ads`, `contacts`, `conversations`, `messages`, `labels`, `conversation_labels`, `orders`, `order_items`, `order_status_history`, `payment_receipts`, `notifications`, `plans`, `plan_purchases`, `conversation_balances`, `conversation_usage`, `webhook_events`, `integration_logs`, `audit_logs`.

Cada tabla lleva `workspace_id`, `user_id`, `created_at`, `updated_at`, `created_by` según corresponda.

### RLS

- Aislamiento por `workspace_id` vía función `security definer` `is_workspace_member(workspace_id)`.
- Admin ve todo mediante `has_role(auth.uid(),'admin')` (nunca rol en `profiles`).
- `GRANT` explícito a `authenticated` / `service_role` en cada tabla; `anon` sin acceso.
- Webhook y tareas privilegiadas usan service role tras verificar firma.

### Mapa de pantallas

Vendedor: Dashboard, Inbox, Chat IA, Entrenamiento, Notificaciones, Pedidos, Productos, Etiquetas, Planes, Configuraciones.
Admin: Usuarios pendientes, Usuarios activos, Métricas en tiempo real, Planes, Pagos y recargas, Registros, Configuración global.
Públicas: Landing, Auth, Pendiente de aprobación.

### Flujo de cierre de venta

IA detecta intención → recopila nombre, teléfono, ciudad, departamento, calle, barrio, referencia, producto, cantidad, total, pago → muestra resumen → confirmación → crea `order` (anti-duplicado por conversación+producto en ventana) → marca conversación como venta cerrada → notificación → historial. Botón en cada pedido que abre `https://www.el-ecommercedcanpgroup.com/?...` con `URLSearchParams` (nombres de parámetros a validar contigo antes de fijarlos).

### Consumo de conversaciones

Cada mensaje entrante con `wamid` nuevo registra un movimiento en `conversation_usage` y descuenta de `conversation_balances`. Idempotencia por `wamid` en `webhook_events`. Saldo 0 → bloqueo de respuestas + aviso al vendedor y al admin.

### Fases de implementación

1. Diseño visual, base de datos completa, RLS, Auth, roles, registro pendiente, shell con sidebar.
2. Productos (media, keywords, seguimientos), Entrenamiento, Etiquetas, Configuraciones.
3. WhatsApp: conexión, webhook con firma, Inbox en tiempo real, envío de media, pausar/reactivar IA.
4. Motor de IA: contexto, detección de producto/anuncio, Chat IA de prueba, seguimientos automáticos.
5. Cierre de ventas, Pedidos, comprobantes, integración externa.
6. Planes, recargas con comprobante, control y bloqueo por saldo.
7. Dashboard y métricas por anuncio, auditoría, notificaciones, pruebas.

### Notas técnicas

- Lovable Cloud reemplaza la configuración manual de Supabase (misma base Postgres + Auth + Storage + Realtime).
- La IA usa Lovable AI Gateway con Gemini; el vendedor puede opcionalmente guardar su propia API Key de Gemini.
- Google Sheets vía Apps Script Web App configurable por vendedor.
- Buckets de Storage: `product-media`, `chat-media`, `receipts`.

Empiezo por la Fase 1 en cuanto apruebes; luego avanzo fase por fase en mensajes sucesivos.