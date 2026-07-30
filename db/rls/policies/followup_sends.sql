-- Politicas RLS: public.followup_sends

ALTER TABLE public.followup_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members read followup sends" ON public.followup_sends;
CREATE POLICY "workspace members read followup sends" ON public.followup_sends
  FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id));
