-- Politicas RLS: public.workspaces

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_catalog_workspaces_read" ON public.workspaces;
CREATE POLICY "public_catalog_workspaces_read" ON public.workspaces
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "workspaces_admin" ON public.workspaces;
CREATE POLICY "workspaces_admin" ON public.workspaces
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "workspaces_read" ON public.workspaces;
CREATE POLICY "workspaces_read" ON public.workspaces
  FOR SELECT
  TO authenticated
  USING ((is_workspace_member(id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (
);
