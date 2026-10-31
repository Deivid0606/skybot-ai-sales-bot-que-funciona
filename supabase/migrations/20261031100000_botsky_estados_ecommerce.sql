-- Estados que llegan desde el E-commerce y el estado exacto del E-commerce en cada pedido.
ALTER TYPE public.order_state ADD VALUE IF NOT EXISTS 'reagendado' AFTER 'enviado';
ALTER TYPE public.order_state ADD VALUE IF NOT EXISTS 'devuelto_deposito' AFTER 'entregado';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ecommerce_status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ecommerce_status_at timestamptz;
