-- Carga automática de pedidos a DCANP (ya aplicada en la base).
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS dcanp_email text;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS dcanp_auto_import boolean NOT NULL DEFAULT false;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS dcanp_auto_since timestamptz;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS dcanp_auto_status text;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS dcanp_auto_checked_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ecommerce_sync_attempted_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_dcanp_auto_import(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace uuid;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.profiles WHERE id = auth.uid();
  IF v_workspace IS NULL OR NOT (public.is_workspace_member(v_workspace)
      OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace AND w.owner_id = auth.uid())) THEN
    RAISE EXCEPTION 'Sin permiso para cambiar la carga automática';
  END IF;
  UPDATE public.workspaces
     SET dcanp_auto_import = p_enabled,
         dcanp_auto_since = CASE WHEN p_enabled THEN now() ELSE dcanp_auto_since END,
         dcanp_auto_status = CASE WHEN p_enabled THEN 'Activada. Se revisa cada 2 minutos.' ELSE 'Desactivada.' END
   WHERE id = v_workspace;
  RETURN p_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.set_dcanp_auto_import(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_dcanp_auto_import(boolean) TO authenticated;
