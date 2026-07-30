-- Politicas RLS: public.whatsapp_connections

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_connections_ws_access" ON public.whatsapp_connections;
CREATE POLICY "whatsapp_connections_ws_access" ON public.whatsapp_connections
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
