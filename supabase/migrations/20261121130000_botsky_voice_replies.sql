-- Respuestas con nota de voz (OpenAI TTS), configurables por tienda en Configuraciones.
alter table public.ai_settings
  add column if not exists voice_reply_enabled boolean not null default false,
  add column if not exists voice_name text not null default 'coral',
  add column if not exists voice_instructions text;
