-- Politicas RLS: public.whatsapp_connections
-- Credenciales sensibles (access_token, app_secret, verify_token): solo el dueño.

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_connections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_connections TO authenticated;
GRANT ALL ON public.whatsapp_connections TO service_role;

DROP POLICY IF EXISTS "whatsapp_connections_ws_access" ON public.whatsapp_connections;
DROP POLICY IF EXISTS "whatsapp_connections_owner_access" ON public.whatsapp_connections;
CREATE POLICY "whatsapp_connections_owner_access" ON public.whatsapp_connections
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
