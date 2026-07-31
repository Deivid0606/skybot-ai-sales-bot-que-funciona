-- Politicas RLS: public.product_keywords

ALTER TABLE public.product_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_keywords_ws_access" ON public.product_keywords;
CREATE POLICY "product_keywords_ws_access" ON public.product_keywords
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "public_catalog_keywords_read" ON public.product_keywords;
CREATE POLICY "public_catalog_keywords_read" ON public.product_keywords
  FOR SELECT
  TO anon
  USING (public.is_public_catalog_product(product_id));
