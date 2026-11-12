-- Pestaña Pedidos: etiqueta «Enviado a Meta» (se trae junto con cada pedido).
DELETE FROM public.meta_capi_events e WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = e.order_id);
ALTER TABLE public.meta_capi_events DROP CONSTRAINT IF EXISTS meta_capi_events_order_id_fkey;
ALTER TABLE public.meta_capi_events ADD CONSTRAINT meta_capi_events_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
