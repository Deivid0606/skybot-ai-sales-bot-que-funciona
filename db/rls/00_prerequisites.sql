-- BOT SKY — Dependencias necesarias ANTES de aplicar las politicas RLS.
-- Ejecutar primero en la base de datos destino.

-- 1) Tipos ENUM usados por las politicas / columnas

DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('admin', 'seller'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.msg_direction AS ENUM ('inbound', 'outbound'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.msg_sender AS ENUM ('customer', 'ai', 'agent', 'system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.order_state AS ENUM ('nuevo', 'confirmado', 'cargado', 'preparacion', 'enviado', 'entregado', 'cancelado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.payment_state AS ENUM ('pendiente', 'anticipado', 'pagado', 'contraentrega', 'rechazado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.purchase_state AS ENUM ('pendiente', 'aprobado', 'rechazado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.user_status AS ENUM ('pending', 'approved', 'rejected', 'blocked', 'active', 'suspended'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Funciones SECURITY DEFINER usadas dentro de las politicas

CREATE OR REPLACE FUNCTION public.current_workspace_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid();
$function$;

-- Self-scoped: an authenticated caller can only evaluate its OWN roles.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN
    IF current_user <> 'service_role' THEN
      RETURN false;
    END IF;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
END;
$function$;

-- Self-scoped: always evaluated against auth.uid(), never another user.
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND current_user <> 'service_role' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = auth.uid()
  );
END;
$function$;

-- Permisos de ejecucion (minimo necesario)
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO service_role;


CREATE OR REPLACE FUNCTION public.is_public_catalog_product(_product_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.products p WHERE p.id = _product_id AND p.is_active = true);
$$;
REVOKE ALL ON FUNCTION public.is_public_catalog_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_catalog_product(uuid) TO anon, authenticated, service_role;
