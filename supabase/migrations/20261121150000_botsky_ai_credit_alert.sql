-- «Tu API se quedó sin saldo»: alerta en el panel y push al celular.
alter table public.ai_settings add column if not exists ai_credit_alert jsonb;
alter table public.botsky_push_outbox drop constraint if exists botsky_push_outbox_event_type_check;
alter table public.botsky_push_outbox add constraint botsky_push_outbox_event_type_check
  check (event_type = any (array['sale','news','balance_low','balance_empty','topup_request','topup_credited','signup_request','ai_credit']));
