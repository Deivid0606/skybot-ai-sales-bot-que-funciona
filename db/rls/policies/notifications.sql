-- Politicas RLS: public.notifications

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_admin" ON public.notifications;
CREATE POLICY "notifications_admin" ON public.notifications
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "notifications_read" ON public.notifications;
CREATE POLICY "notifications_read" ON public.notifications
  FOR SELECT
  TO authenticated
  USING ((((audience = 'seller'::text) AND is_workspace_member(workspace_id)) OR ((audience = 'admin'::text) AND has_role(auth.uid(), 'admin'::app_role)) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE
  TO authenticated
  USING ((((audience = 'seller'::text) AND is_workspace_member(workspace_id)) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((((audience = 'seller'::text) AND is_workspace_member(workspace_id)) OR has_role(auth.uid(), 'admin'::app_role)));
