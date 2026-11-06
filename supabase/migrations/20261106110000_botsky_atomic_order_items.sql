-- Register a checkout and its immutable line snapshots in ONE transaction.
-- The original single-argument RPC stays available for older clients.
CREATE OR REPLACE FUNCTION public.bot_sky_register_order_with_items(p_order jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
 v_workspace uuid := (p_order->>'workspace_id')::uuid;
 v_conversation uuid := (p_order->>'conversation_id')::uuid;
 v_total numeric := (p_order->>'total')::numeric;
 v_existing public.orders%ROWTYPE;
 v_created public.orders%ROWTYPE;
 v_item jsonb;
 v_count integer := 0;
 v_sum numeric := 0;
 v_item_id uuid;
BEGIN
 IF v_workspace IS NULL OR v_conversation IS NULL OR v_total IS NULL OR v_total<=0
   OR NULLIF(p_order->>'order_number','') IS NULL OR jsonb_typeof(p_items)<>'array'
   OR jsonb_array_length(p_items)<1 OR jsonb_array_length(p_items)>20 THEN
   RAISE EXCEPTION 'Pedido sin productos válidos';
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   IF jsonb_typeof(v_item)<>'object'
     OR NULLIF(v_item->>'title','') IS NULL
     OR (v_item->>'quantity')::integer NOT BETWEEN 1 AND 100
     OR (v_item->>'price')::numeric <= 0
     OR (v_item->>'price')::numeric IS NULL THEN
      RAISE EXCEPTION 'Artículo con cantidad o importe inválido';
   END IF;
   v_item_id := (v_item->>'product_id')::uuid;
   IF v_item_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.products
      WHERE id=v_item_id AND workspace_id=v_workspace) THEN
     RAISE EXCEPTION 'Artículo no pertenece a la tienda';
   END IF;
   v_sum:=v_sum+(v_item->>'quantity')::integer*(v_item->>'price')::numeric;
   v_count:=v_count+1;
 END LOOP;
 IF round(v_sum,2)<>round(v_total,2) OR v_count<>jsonb_array_length(p_items) THEN
   RAISE EXCEPTION 'El subtotal de artículos no coincide con el total';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_workspace::text||':'||v_conversation::text,0));
 SELECT * INTO v_existing FROM public.orders
  WHERE workspace_id=v_workspace AND order_number=p_order->>'order_number' LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('already_registered',true,'order',to_jsonb(v_existing)); END IF;
 SELECT * INTO v_existing FROM public.orders
  WHERE workspace_id=v_workspace AND conversation_id=v_conversation
    AND product_id=(p_order->>'product_id')::uuid AND total=v_total
    AND status::text<>'cancelado' AND created_at>=clock_timestamp()-interval '45 seconds'
  ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('already_registered',true,'order',to_jsonb(v_existing)); END IF;

 INSERT INTO public.orders(workspace_id,user_id,conversation_id,ad_id,contact_id,order_number,
  customer_name,phone,city,departamento,district,street,observations,payment_method,
  product_id,product_title,sku,quantity,price,total,status,payment_status)
 VALUES(v_workspace,(p_order->>'user_id')::uuid,v_conversation,p_order->>'ad_id',
  (p_order->>'contact_id')::uuid,p_order->>'order_number',p_order->>'customer_name',
  p_order->>'phone',p_order->>'city',p_order->>'departamento',p_order->>'district',
  p_order->>'street',p_order->>'observations',p_order->>'payment_method',
  (p_order->>'product_id')::uuid,p_order->>'product_title',p_order->>'sku',
  (p_order->>'quantity')::integer,(p_order->>'price')::numeric,v_total,'nuevo','pendiente')
 RETURNING * INTO v_created;
 INSERT INTO public.order_items(workspace_id,user_id,order_id,product_id,title,sku,quantity,price)
 SELECT v_workspace,(p_order->>'user_id')::uuid,v_created.id,
    (value->>'product_id')::uuid,value->>'title',NULLIF(value->>'sku',''),
    (value->>'quantity')::integer,(value->>'price')::numeric
 FROM jsonb_array_elements(p_items);
 RETURN jsonb_build_object('already_registered',false,'order',to_jsonb(v_created));
END $$;
REVOKE ALL ON FUNCTION public.bot_sky_register_order_with_items(jsonb,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_sky_register_order_with_items(jsonb,jsonb) TO service_role;
