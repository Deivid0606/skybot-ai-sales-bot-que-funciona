-- Seguimientos: la función recorría TODOS los chats históricos (31 s) y la llamada se cortaba
-- (límite 8 s): desde el 08/11 no salía ningún seguimiento. Ahora solo chats con actividad
-- en las últimas 24 h (1,5 s). Índice nuevo por fecha de último mensaje.
create index if not exists conversations_last_message_at_idx on public.conversations (last_message_at desc);
-- La función bot_claim_followups se reemplazó con el filtro
--   c.last_message_at > NOW() - INTERVAL '24 hours'
-- (aplicado en la base con la migración botsky_followups_recent_only).

-- Venta consultiva: problema que resuelve el producto y pregunta para conocer al cliente.
alter table public.products add column if not exists pain_point text;
alter table public.products add column if not exists discovery_question text;
