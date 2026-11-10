-- Fichas de la pestaña «Entrenamiento»: reglas de la tienda con interruptores
-- (factura, tarjeta, QR, cédula en encomienda, catálogo, retiro, garantía…).
-- Cada vendedor edita lo suyo; el admin solo puede leer.
CREATE TABLE IF NOT EXISTS public.workspace_sales_rules (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_sales_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_sales_rules_member_all ON public.workspace_sales_rules;
CREATE POLICY workspace_sales_rules_member_all ON public.workspace_sales_rules
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS workspace_sales_rules_admin_read ON public.workspace_sales_rules;
CREATE POLICY workspace_sales_rules_admin_read ON public.workspace_sales_rules
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_sales_rules TO authenticated;
GRANT ALL ON public.workspace_sales_rules TO service_role;
