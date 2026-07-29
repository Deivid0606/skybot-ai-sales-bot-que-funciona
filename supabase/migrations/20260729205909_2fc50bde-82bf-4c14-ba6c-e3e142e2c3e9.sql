CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ws_id uuid;
  is_first boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO is_first;

  INSERT INTO public.workspaces (name, owner_id)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'company', NEW.email, 'Workspace'), NEW.id)
  RETURNING id INTO ws_id;

  INSERT INTO public.profiles (id, workspace_id, full_name, email, phone, company, status)
  VALUES (NEW.id, ws_id, NEW.raw_user_meta_data->>'full_name', NEW.email,
          NEW.raw_user_meta_data->>'phone', NEW.raw_user_meta_data->>'company',
          CASE WHEN is_first THEN 'approved'::user_status ELSE 'pending'::user_status END);

  INSERT INTO public.workspace_members (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN is_first THEN 'admin'::app_role ELSE 'seller'::app_role END);
  INSERT INTO public.user_settings (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.ai_settings (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.whatsapp_connections (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.conversation_balances (workspace_id, user_id) VALUES (ws_id, NEW.id);

  IF NOT is_first THEN
    INSERT INTO public.notifications (audience, type, title, body)
    VALUES ('admin','user_pending','Nuevo registro pendiente', COALESCE(NEW.email,'') || ' solicita acceso');
  END IF;

  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Promote the earliest existing user to admin/approved if any exist
WITH first_user AS (
  SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1
)
UPDATE public.profiles p SET status = 'approved'
FROM first_user f WHERE p.id = f.id;

WITH first_user AS (
  SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1
)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM first_user
ON CONFLICT (user_id, role) DO NOTHING;