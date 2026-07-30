-- Politicas RLS: public.product_followups

ALTER TABLE public.product_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_followups_ws_access" ON public.product_followups;
CREATE POLICY "product_followups_ws_access" ON public.product_followups
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
