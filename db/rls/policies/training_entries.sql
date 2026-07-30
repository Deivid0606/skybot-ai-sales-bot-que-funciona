-- Politicas RLS: public.training_entries

ALTER TABLE public.training_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_entries_ws_access" ON public.training_entries;
CREATE POLICY "training_entries_ws_access" ON public.training_entries
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
