ALTER TABLE public.user_settings ALTER COLUMN currency SET DEFAULT 'PYG';
ALTER TABLE public.user_settings ALTER COLUMN timezone SET DEFAULT 'America/Asuncion';
UPDATE public.user_settings SET currency = 'PYG' WHERE currency IN ('COP','USD');
UPDATE public.user_settings SET timezone = 'America/Asuncion' WHERE timezone IN ('America/Bogota','UTC');