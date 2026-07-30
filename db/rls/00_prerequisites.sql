-- BOT SKY — Dependencias necesarias ANTES de aplicar las politicas RLS.
-- Ejecutar primero en la base de datos destino.

-- 1) Tipos ENUM usados por las politicas / columnas

DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('admin', 'seller'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.msg_direction AS ENUM ('inbound', 'outbound'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.msg_sender AS ENUM ('customer', 'ai', 'agent', 'system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.order_state AS ENUM ('nuevo', 'confirmado', 'cargado', 'preparacion', 'enviado', 'entregado', 'cancelado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.payment_state AS ENUM ('pendiente', 'anticipado', 'pagado', 'contraentrega', 'rechazado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.purchase_state AS ENUM ('pendiente', 'aprobado', 'rechazado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.user_status AS ENUM ('pending', 'approved', 'rejected', 'blocked', 'active', 'suspended'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Funciones SECURITY DEFINER usadas dentro de las politicas

CREATE OR REPLACE FUNCTION public.current_workspace_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$function$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = auth.uid()
  );
$function$;

-- Permisos de ejecucion
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO authenticated, anon, service_role;
