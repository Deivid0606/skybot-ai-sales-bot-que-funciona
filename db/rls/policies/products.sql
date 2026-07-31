-- Politicas RLS: public.products

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_ws_access" ON public.products;
CREATE POLICY "products_ws_access" ON public.products
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

-- El catalogo publico NO lee la tabla products directamente.
-- Se expone unicamente la vista public.public_catalog_products (columnas comerciales).
REVOKE ALL ON TABLE public.products FROM anon;

CREATE OR REPLACE VIEW public.public_catalog_products
WITH (security_invoker = off) AS
SELECT p.id, p.workspace_id, p.name, p.description, p.sales_copy,
       p.price, p.promo_price, p.delivery_info, p.created_at
FROM public.products p
WHERE p.is_active = true;

GRANT SELECT ON public.public_catalog_products TO anon, authenticated, service_role;
