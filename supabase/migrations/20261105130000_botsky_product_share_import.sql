-- Product exchange is opt-in. Codes do not expose product details to unauthenticated visitors.
CREATE TABLE IF NOT EXISTS public.bot_sky_product_shares (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  share_code text NOT NULL UNIQUE DEFAULT ('SKY-' || upper(encode(gen_random_bytes(8), 'hex'))),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.bot_sky_product_imports (
  source_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  target_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  imported_product_id uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_product_id,target_workspace_id)
);
ALTER TABLE public.bot_sky_product_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_sky_product_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bot_sky_product_shares, public.bot_sky_product_imports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.bot_sky_product_shares, public.bot_sky_product_imports TO service_role;

CREATE OR REPLACE FUNCTION public.bot_sky_assign_product_share_code()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.bot_sky_product_shares(product_id) VALUES(NEW.id) ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS botsky_product_share_code_on_insert ON public.products;
CREATE TRIGGER botsky_product_share_code_on_insert AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.bot_sky_assign_product_share_code();
INSERT INTO public.bot_sky_product_shares(product_id)
 SELECT p.id FROM public.products p
 ON CONFLICT(product_id) DO NOTHING;

-- Run only from trusted server/service-role. Owner workspace is checked in the
-- server action and again here. Transaction lock prevents double imports.
CREATE OR REPLACE FUNCTION public.bot_sky_clone_shared_product(
 p_code text, p_workspace uuid, p_user uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
 v_source public.products%ROWTYPE;
 v_target uuid;
 v_existing uuid;
 v_sharing boolean;
 v_created uuid;
BEGIN
 SELECT pr.workspace_id INTO v_target FROM public.profiles pr
 WHERE pr.id=p_user AND pr.workspace_id=p_workspace AND pr.status::text IN ('approved','active');
 IF v_target IS NULL THEN RAISE EXCEPTION 'No tenés permiso para importar en esta tienda'; END IF;
 SELECT p.*,s.enabled INTO v_source,v_sharing FROM public.products p
 JOIN public.bot_sky_product_shares s ON s.product_id=p.id
 WHERE s.share_code=upper(trim(p_code)) AND s.enabled=true AND p.is_active=true;
 IF NOT FOUND OR NOT v_sharing THEN RAISE EXCEPTION 'Código no encontrado o no compartido'; END IF;
 IF v_source.workspace_id = p_workspace THEN RAISE EXCEPTION 'El producto ya pertenece a tu tienda'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_source.id::text || ':' || p_workspace::text,0));
 SELECT imported_product_id INTO v_existing FROM public.bot_sky_product_imports
 WHERE source_product_id=v_source.id AND target_workspace_id=p_workspace;
 IF FOUND THEN
   RETURN jsonb_build_object('product_id',v_existing,'source_product_id',v_source.id,'existing',true);
 END IF;
 INSERT INTO public.products(workspace_id,user_id,created_by,name,sku,description,
  sales_copy,price,promo_price,stock,is_active,variants,delivery_info,ai_instructions,
  followup_enabled,no_repeat_template)
 VALUES(p_workspace,p_user,p_user,v_source.name,v_source.sku,v_source.description,
  v_source.sales_copy,v_source.price,v_source.promo_price,0,true,v_source.variants,
  null,null,false,true)
 RETURNING id INTO v_created;
 INSERT INTO public.product_prices(workspace_id,user_id,product_id,label,quantity,price,sort_order)
 SELECT p_workspace,p_user,v_created,label,quantity,price,sort_order
 FROM public.product_prices WHERE product_id=v_source.id;
 INSERT INTO public.product_keywords(workspace_id,user_id,product_id,keyword)
 SELECT p_workspace,p_user,v_created,keyword FROM public.product_keywords WHERE product_id=v_source.id;
 INSERT INTO public.bot_sky_product_imports(source_product_id,target_workspace_id,imported_product_id)
 VALUES(v_source.id,p_workspace,v_created);
 RETURN jsonb_build_object('product_id',v_created,'source_product_id',v_source.id,'existing',false);
END; $$;
REVOKE ALL ON FUNCTION public.bot_sky_clone_shared_product(text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_sky_clone_shared_product(text,uuid,uuid) TO service_role;
