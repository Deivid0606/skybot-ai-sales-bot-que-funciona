-- El administrador puede crear, editar y borrar opciones de precio de cualquier vendedor. (Ya aplicada.)
DROP POLICY IF EXISTS product_prices_admin_all ON public.product_prices;
CREATE POLICY product_prices_admin_all ON public.product_prices FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
