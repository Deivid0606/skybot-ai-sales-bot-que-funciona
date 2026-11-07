-- Emergency sales controls are workspace-scoped and default to automatic, non-disruptive behavior.
alter table public.ai_settings add column if not exists emergency_mode text not null default 'automatico';
alter table public.ai_settings add column if not exists emergency_recover_pending boolean not null default true;
alter table public.ai_settings add column if not exists emergency_active_until timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='ai_settings_emergency_mode_check') then
    alter table public.ai_settings add constraint ai_settings_emergency_mode_check
      check (emergency_mode in ('automatico','forzado','desactivado'));
  end if;
end $$;