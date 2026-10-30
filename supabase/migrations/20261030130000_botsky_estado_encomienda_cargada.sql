-- Nuevo estado de pedido: «Encomienda cargada». Solo agrega un valor; no cambia pedidos existentes.
ALTER TYPE public.order_state ADD VALUE IF NOT EXISTS 'encomienda_cargada' AFTER 'cargado';
