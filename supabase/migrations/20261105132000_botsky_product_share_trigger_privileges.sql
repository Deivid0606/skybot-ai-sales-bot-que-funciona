-- A product insert is made by an authenticated seller under RLS.
-- The trigger must be allowed to generate a private share code even though
-- sellers have NO direct access to the private sharing table.
CREATE OR REPLACE FUNCTION public.bot_sky_assign_product_share_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.bot_sky_product_shares(product_id)
    VALUES(NEW.id) ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bot_sky_assign_product_share_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_sky_assign_product_share_code() TO service_role;
