-- El administrador puede ver las opciones de precio de todos los vendedores (vista «Todas las tiendas»).
DROP POLICY IF EXISTS product_prices_admin_read ON public.product_prices;
CREATE POLICY product_prices_admin_read ON public.product_prices FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));
