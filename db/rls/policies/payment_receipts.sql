-- Politicas RLS: public.payment_receipts

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_receipts_ws_access" ON public.payment_receipts;
CREATE POLICY "payment_receipts_ws_access" ON public.payment_receipts
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
