-- Politicas RLS: public.plans

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_admin" ON public.plans;
CREATE POLICY "plans_admin" ON public.plans
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "plans_read" ON public.plans;
DROP POLICY IF EXISTS "plans_read_active" ON public.plans;
CREATE POLICY "plans_read_active" ON public.plans
  FOR SELECT
  TO authenticated
  USING (is_active OR has_role(auth.uid(), 'admin'::app_role));
