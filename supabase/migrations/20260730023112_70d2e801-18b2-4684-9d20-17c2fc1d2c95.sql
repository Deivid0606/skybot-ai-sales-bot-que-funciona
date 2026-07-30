ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS catalog_enabled boolean NOT NULL DEFAULT true;

GRANT SELECT ON public.products TO anon;
GRANT SELECT ON public.product_media TO anon;
GRANT SELECT ON public.product_keywords TO anon;
GRANT SELECT ON public.workspaces TO anon;

DROP POLICY IF EXISTS "public_catalog_products_read" ON public.products;
CREATE POLICY "public_catalog_products_read" ON public.products
  FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "public_catalog_media_read" ON public.product_media;
CREATE POLICY "public_catalog_media_read" ON public.product_media
  FOR SELECT TO anon USING (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_media.product_id AND p.is_active = true)
  );

DROP POLICY IF EXISTS "public_catalog_keywords_read" ON public.product_keywords;
CREATE POLICY "public_catalog_keywords_read" ON public.product_keywords
  FOR SELECT TO anon USING (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_keywords.product_id AND p.is_active = true)
  );

DROP POLICY IF EXISTS "public_catalog_workspaces_read" ON public.workspaces;
CREATE POLICY "public_catalog_workspaces_read" ON public.workspaces
  FOR SELECT TO anon USING (true);