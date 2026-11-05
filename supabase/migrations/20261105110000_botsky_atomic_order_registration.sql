-- Atomic order creation: avoid two checkouts caused by GPS + address arriving
-- concurrently. Existing order numbers, order statuses and receipt handling stay unchanged.
CREATE OR REPLACE FUNCTION public.bot_sky_register_order_once(p_order jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace uuid;
  v_conversation uuid;
  v_product uuid;
  v_total numeric;
  v_existing public.orders%ROWTYPE;
  v_created public.orders%ROWTYPE;
BEGIN
  v_workspace := (p_order->>'workspace_id')::uuid;
  v_conversation := (p_order->>'conversation_id')::uuid;
  v_product := (p_order->>'product_id')::uuid;
  v_total := (p_order->>'total')::numeric;
  IF v_workspace IS NULL OR v_conversation IS NULL OR v_product IS NULL
      OR v_total IS NULL OR v_total <= 0 OR NULLIF(p_order->>'order_number','') IS NULL THEN
    RAISE EXCEPTION 'Datos obligatorios del pedido no válidos';
  END IF;

  -- Transaction-scoped lock is shared by all requests for this conversation.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || v_conversation::text, 0));

  -- Retries of the exact same inbound WhatsApp message reuse the same order.
  SELECT o.* INTO v_existing FROM public.orders o
   WHERE o.workspace_id=v_workspace AND o.order_number=p_order->>'order_number'
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('already_registered',true,'order',to_jsonb(v_existing));
  END IF;

  -- Nearby GPS and street messages can finish the same checkout in parallel.
  -- Allow different products/totals; only coalesce identical near-simultaneous sales.
  SELECT o.* INTO v_existing FROM public.orders o
   WHERE o.workspace_id=v_workspace AND o.conversation_id=v_conversation
     AND o.product_id=v_product AND o.total=v_total
     AND o.status::text <> 'cancelado'
     AND o.created_at >= clock_timestamp() - interval '45 seconds'
   ORDER BY o.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('already_registered',true,'order',to_jsonb(v_existing));
  END IF;

  INSERT INTO public.orders (
    workspace_id,user_id,conversation_id,ad_id,contact_id,order_number,
    customer_name,phone,city,departamento,district,street,observations,
    payment_method,product_id,product_title,sku,quantity,price,total,status,payment_status
  ) VALUES (
    v_workspace,(p_order->>'user_id')::uuid,v_conversation,
    p_order->>'ad_id',(p_order->>'contact_id')::uuid,p_order->>'order_number',
    p_order->>'customer_name',p_order->>'phone',p_order->>'city',
    p_order->>'departamento',p_order->>'district',p_order->>'street',
    p_order->>'observations',p_order->>'payment_method',v_product,
    p_order->>'product_title',p_order->>'sku',(p_order->>'quantity')::integer,
    (p_order->>'price')::numeric,v_total,'nuevo','pendiente'
  ) RETURNING * INTO v_created;

  RETURN jsonb_build_object('already_registered',false,'order',to_jsonb(v_created));
END;
$$;
REVOKE ALL ON FUNCTION public.bot_sky_register_order_once(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_sky_register_order_once(jsonb) TO service_role;
