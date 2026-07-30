-- Politicas RLS: public.workspace_members

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_members_admin" ON public.workspace_members;
CREATE POLICY "workspace_members_admin" ON public.workspace_members
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "workspace_members_read" ON public.workspace_members;
CREATE POLICY "workspace_members_read" ON public.workspace_members
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
