-- Conectar con DCANP una sola vez: el vendedor verifica su cuenta con correo y
-- contraseña (no se guarda la contraseña) y la carga automática queda activa.
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS dcanp_verified_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_dcanp_auto_import(p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_workspace uuid;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.profiles WHERE id = auth.uid();
  IF v_workspace IS NULL OR NOT (public.is_workspace_member(v_workspace)
      OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace AND w.owner_id = auth.uid())) THEN
    RAISE EXCEPTION 'Sin permiso para cambiar la carga automática';
  END IF;
  IF p_enabled AND NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace AND w.dcanp_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Primero conectá tu cuenta de DCANP';
  END IF;
  UPDATE public.workspaces
     SET dcanp_auto_import = p_enabled,
         dcanp_auto_since = CASE WHEN p_enabled THEN now() ELSE dcanp_auto_since END,
         dcanp_auto_status = CASE WHEN p_enabled THEN 'Activada. Se revisa cada 2 minutos.' ELSE 'Desactivada.' END
   WHERE id = v_workspace;
  RETURN p_enabled;
END;
$function$;

CREATE OR REPLACE FUNCTION public.disconnect_dcanp()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_workspace uuid;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.profiles WHERE id = auth.uid();
  IF v_workspace IS NULL OR NOT (public.is_workspace_member(v_workspace)
      OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace AND w.owner_id = auth.uid())) THEN
    RAISE EXCEPTION 'Sin permiso';
  END IF;
  UPDATE public.workspaces
     SET dcanp_email = NULL, dcanp_verified_at = NULL, dcanp_auto_import = false,
         dcanp_auto_status = 'Cuenta de DCANP desconectada.'
   WHERE id = v_workspace;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.disconnect_dcanp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disconnect_dcanp() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_dcanp_email(text) FROM authenticated;
