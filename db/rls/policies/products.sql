-- Politicas RLS: public.products

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_ws_access" ON public.products;
CREATE POLICY "products_ws_access" ON public.products
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "public_catalog_products_read" ON public.products;
CREATE POLICY "public_catalog_products_read" ON public.products
  FOR SELECT
  TO anon
  USING ((is_active = true));
