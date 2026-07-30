-- Politicas RLS: public.conversation_usage

ALTER TABLE public.conversation_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_usage_ws_access" ON public.conversation_usage;
CREATE POLICY "conversation_usage_ws_access" ON public.conversation_usage
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
