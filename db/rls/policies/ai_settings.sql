-- Politicas RLS: public.ai_settings
-- gemini_api_key es un secreto: solo el dueño de la configuración accede.

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;

DROP POLICY IF EXISTS "ai_settings_ws_access" ON public.ai_settings;
DROP POLICY IF EXISTS "ai_settings_owner_access" ON public.ai_settings;
CREATE POLICY "ai_settings_owner_access" ON public.ai_settings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
