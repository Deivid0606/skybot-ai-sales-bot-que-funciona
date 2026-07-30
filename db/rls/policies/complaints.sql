-- Politicas RLS: public.complaints

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members manage complaints" ON public.complaints;
CREATE POLICY "Workspace members manage complaints" ON public.complaints
  FOR ALL
  TO authenticated
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));
