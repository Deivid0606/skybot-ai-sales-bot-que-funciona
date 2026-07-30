-- Politicas RLS: public.plan_purchases

ALTER TABLE public.plan_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_purchases_ws_access" ON public.plan_purchases;
CREATE POLICY "plan_purchases_ws_access" ON public.plan_purchases
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
