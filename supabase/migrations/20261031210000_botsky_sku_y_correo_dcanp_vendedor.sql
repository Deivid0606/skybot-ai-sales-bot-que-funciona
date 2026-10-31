-- Al cambiar el SKU de un producto, los pedidos todavía no cargados en DCANP toman el SKU nuevo
-- y se reintentan en la próxima carga automática. (Ya aplicada en la base.)
CREATE OR REPLACE FUNCTION public.botsky_propagate_product_sku()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sku IS DISTINCT FROM OLD.sku THEN
    UPDATE public.orders
       SET sku = NEW.sku,
           ecommerce_sync_error = NULL,
           ecommerce_sync_attempted_at = NULL
     WHERE workspace_id = NEW.workspace_id
       AND product_id = NEW.id
       AND status IN ('nuevo', 'confirmado')
       AND ecommerce_synced_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS botsky_product_sku_to_orders ON public.products;
CREATE TRIGGER botsky_product_sku_to_orders
  AFTER UPDATE OF sku ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.botsky_propagate_product_sku();

-- El vendedor guarda su propio correo de DCANP (solo en su propio negocio).
CREATE OR REPLACE FUNCTION public.set_dcanp_email(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace uuid;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.profiles WHERE id = auth.uid();
  IF v_workspace IS NULL OR NOT (public.is_workspace_member(v_workspace)
      OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace AND w.owner_id = auth.uid())) THEN
    RAISE EXCEPTION 'Sin permiso para cambiar el correo de DCANP';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'Correo inválido';
  END IF;
  UPDATE public.workspaces
     SET dcanp_email = v_email,
         dcanp_auto_import = CASE WHEN v_email IS NULL THEN false ELSE dcanp_auto_import END,
         dcanp_auto_status = CASE WHEN v_email IS NULL THEN 'Sin cuenta de DCANP.' ELSE 'Cuenta de DCANP guardada.' END
   WHERE id = v_workspace;
  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.set_dcanp_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_dcanp_email(text) TO authenticated;
