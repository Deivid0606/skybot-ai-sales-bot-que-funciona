-- Politicas RLS: public.integration_logs

ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_logs_ws_access" ON public.integration_logs;
CREATE POLICY "integration_logs_ws_access" ON public.integration_logs
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
