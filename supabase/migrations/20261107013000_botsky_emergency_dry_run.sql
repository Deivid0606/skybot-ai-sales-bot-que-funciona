-- Optional manual-testing switch; never affects automatic live checkout.
alter table public.ai_settings add column if not exists emergency_dry_run boolean not null default false;
