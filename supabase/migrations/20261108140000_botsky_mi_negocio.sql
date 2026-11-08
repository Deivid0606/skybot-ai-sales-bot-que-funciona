-- Pestaña «Mi negocio»: nombre de la tienda, asistente, estilo y horarios de entrega.
-- Cada vendedor edita lo suyo; el admin solo puede leer.
CREATE TABLE IF NOT EXISTS public.workspace_business_profile (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  store_name text,
  assistant_name text,
  tone text NOT NULL DEFAULT 'amable' CHECK (tone IN ('amable','formal','emojis')),
  greeting text,
  delivery_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  cutoff_time text,
  no_holiday_delivery boolean NOT NULL DEFAULT true,
  bot_always_on boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_business_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_business_profile_member_all ON public.workspace_business_profile;
CREATE POLICY workspace_business_profile_member_all ON public.workspace_business_profile
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS workspace_business_profile_admin_read ON public.workspace_business_profile;
CREATE POLICY workspace_business_profile_admin_read ON public.workspace_business_profile
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_business_profile TO authenticated;
GRANT ALL ON public.workspace_business_profile TO service_role;
