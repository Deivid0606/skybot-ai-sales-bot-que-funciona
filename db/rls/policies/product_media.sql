-- Politicas RLS: public.product_media

ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_media_ws_access" ON public.product_media;
CREATE POLICY "product_media_ws_access" ON public.product_media
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "public_catalog_media_read" ON public.product_media;
CREATE POLICY "public_catalog_media_read" ON public.product_media
  FOR SELECT
  TO anon
  USING ((EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_media.product_id) AND (p.is_active = true)))));
