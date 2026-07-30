-- 1) products: limitar columnas visibles para anon
REVOKE SELECT ON public.products FROM anon;
GRANT SELECT (id, workspace_id, name, description, sales_copy, price, promo_price, delivery_info, is_active, created_at) ON public.products TO anon;

-- 2) workspaces: solo nombre y solo si el catálogo está activo con productos publicados
REVOKE SELECT ON public.workspaces FROM anon;
GRANT SELECT (id, name) ON public.workspaces TO anon;

DROP POLICY IF EXISTS "public_catalog_workspaces_read" ON public.workspaces;
CREATE POLICY "public_catalog_workspaces_read" ON public.workspaces
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.user_settings us
      WHERE us.workspace_id = workspaces.id AND us.catalog_enabled = true
    )
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.workspace_id = workspaces.id AND p.is_active = true
    )
  );

-- 3) user_roles: sin escritura desde la app (solo service_role / admin backend)
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated, anon;
REVOKE ALL ON public.user_roles FROM anon;
DROP POLICY IF EXISTS "user_roles_admin" ON public.user_roles;
CREATE POLICY "user_roles_admin_read" ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 4) storage: exigir prefijo estricto workspace_id/
DROP POLICY IF EXISTS "workspace files access" ON storage.objects;
CREATE POLICY "workspace files access" ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = ANY (ARRAY['product-media','chat-media','receipts'])
    AND name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.+'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_workspace_member((split_part(name, '/', 1))::uuid)
    )
  )
  WITH CHECK (
    bucket_id = ANY (ARRAY['product-media','chat-media','receipts'])
    AND name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.+'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_workspace_member((split_part(name, '/', 1))::uuid)
    )
  );

-- 5) funciones SECURITY DEFINER: quitar permisos de ejecución innecesarios
REVOKE ALL ON FUNCTION public.current_workspace_id() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO service_role;
