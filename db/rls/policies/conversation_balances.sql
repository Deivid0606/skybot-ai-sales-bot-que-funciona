-- Politicas RLS: public.conversation_balances

ALTER TABLE public.conversation_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_balances_ws_access" ON public.conversation_balances;
CREATE POLICY "conversation_balances_ws_access" ON public.conversation_balances
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
