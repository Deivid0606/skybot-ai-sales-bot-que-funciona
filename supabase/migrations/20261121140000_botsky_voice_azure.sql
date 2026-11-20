-- Voces paraguayas de Microsoft Azure (Tania / Mario, plan gratuito F0).
alter table public.ai_settings
  add column if not exists azure_speech_key text,
  add column if not exists azure_speech_region text;
