-- Politicas RLS: public.app_messages

ALTER TABLE public.app_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_messages_admin_write" ON public.app_messages;
CREATE POLICY "app_messages_admin_write" ON public.app_messages
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "app_messages_read" ON public.app_messages;
CREATE POLICY "app_messages_read" ON public.app_messages
  FOR SELECT
  USING (true);
