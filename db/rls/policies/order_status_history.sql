-- Politicas RLS: public.order_status_history

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_status_history_ws_access" ON public.order_status_history;
CREATE POLICY "order_status_history_ws_access" ON public.order_status_history
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
