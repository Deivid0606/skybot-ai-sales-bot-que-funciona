CREATE OR REPLACE FUNCTION public.is_public_catalog_product(_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.products p WHERE p.id = _product_id AND p.is_active = true);
$$;

REVOKE ALL ON FUNCTION public.is_public_catalog_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_catalog_product(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "public_catalog_media_read" ON public.product_media;
CREATE POLICY "public_catalog_media_read" ON public.product_media
  FOR SELECT TO anon
  USING (public.is_public_catalog_product(product_id));

DROP POLICY IF EXISTS "public_catalog_keywords_read" ON public.product_keywords;
CREATE POLICY "public_catalog_keywords_read" ON public.product_keywords
  FOR SELECT TO anon
  USING (public.is_public_catalog_product(product_id));

DROP POLICY IF EXISTS "public_catalog_products_read" ON public.products;
REVOKE ALL ON TABLE public.products FROM anon;

CREATE OR REPLACE VIEW public.public_catalog_products
WITH (security_invoker = off) AS
SELECT p.id,
       p.workspace_id,
       p.name,
       p.description,
       p.sales_copy,
       p.price,
       p.promo_price,
       p.delivery_info,
       p.created_at
FROM public.products p
WHERE p.is_active = true;

GRANT SELECT ON public.public_catalog_products TO anon, authenticated, service_role;