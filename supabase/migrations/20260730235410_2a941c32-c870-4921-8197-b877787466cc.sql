-- ai_settings: owner-only
DROP POLICY IF EXISTS ai_settings_ws_access ON public.ai_settings;
CREATE POLICY ai_settings_owner_access ON public.ai_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
REVOKE ALL ON TABLE public.ai_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;

-- whatsapp_connections: owner-only
DROP POLICY IF EXISTS whatsapp_connections_ws_access ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_owner_access ON public.whatsapp_connections
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
REVOKE ALL ON TABLE public.whatsapp_connections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_connections TO authenticated;
GRANT ALL ON public.whatsapp_connections TO service_role;

-- plans: only active plans visible to regular users
DROP POLICY IF EXISTS plans_read ON public.plans;
CREATE POLICY plans_read_active ON public.plans
  FOR SELECT TO authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'::public.app_role));