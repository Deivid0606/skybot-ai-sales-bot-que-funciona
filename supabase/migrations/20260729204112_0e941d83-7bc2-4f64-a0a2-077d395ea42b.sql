
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin','seller');
CREATE TYPE public.user_status AS ENUM ('pending','approved','rejected','blocked','active','suspended');
CREATE TYPE public.msg_direction AS ENUM ('inbound','outbound');
CREATE TYPE public.msg_sender AS ENUM ('customer','ai','agent','system');
CREATE TYPE public.order_state AS ENUM ('nuevo','confirmado','cargado','preparacion','enviado','entregado','cancelado');
CREATE TYPE public.payment_state AS ENUM ('pendiente','anticipado','pagado','contraentrega','rechazado');
CREATE TYPE public.purchase_state AS ENUM ('pendiente','aprobado','rechazado');

-- UPDATED_AT helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- CORE TABLES
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  full_name text,
  email text,
  phone text,
  company text,
  avatar_url text,
  status public.user_status NOT NULL DEFAULT 'pending',
  status_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

-- SECURITY DEFINER HELPERS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid();
$$;

-- SETTINGS
CREATE TABLE public.user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  user_id uuid NOT NULL,
  business_name text,
  timezone text NOT NULL DEFAULT 'America/Bogota',
  currency text NOT NULL DEFAULT 'COP',
  google_sheets_url text,
  apps_script_url text,
  last_sheet_sync timestamptz,
  notify_numbers text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  user_id uuid NOT NULL,
  phone_number_id text,
  waba_id text,
  app_id text,
  access_token text,
  verify_token text,
  display_phone text,
  app_secret text,
  connected boolean NOT NULL DEFAULT false,
  last_error text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  user_id uuid NOT NULL,
  gemini_api_key text,
  model text NOT NULL DEFAULT 'google/gemini-3.6-flash',
  autodetect_model boolean NOT NULL DEFAULT true,
  system_instruction text NOT NULL DEFAULT 'Eres un asistente de ventas para una tienda online. Responde en español de forma amable, clara y profesional. Ayuda a cerrar ventas sin perder el contexto. Sigue estrictamente el entrenamiento y el catálogo del vendedor. No inventes precios, stock, cobertura, promociones ni datos bancarios.',
  reply_delay_seconds integer NOT NULL DEFAULT 3,
  ai_enabled boolean NOT NULL DEFAULT true,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- TRAINING
CREATE TABLE public.training_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'reglas_generales',
  content text NOT NULL,
  priority integer NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  scope text NOT NULL DEFAULT 'general',
  product_id uuid,
  schedule_from time,
  schedule_to time,
  keywords text[] NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PRODUCTS
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  sku text,
  description text,
  sales_copy text,
  price numeric(12,2) NOT NULL DEFAULT 0,
  promo_price numeric(12,2),
  stock integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_info text,
  ai_instructions text,
  followup_message text,
  followup_minutes integer NOT NULL DEFAULT 60,
  followup_enabled boolean NOT NULL DEFAULT false,
  no_repeat_template boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  media_type text NOT NULL,
  url text NOT NULL,
  storage_path text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  keyword text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step integer NOT NULL DEFAULT 1,
  delay_minutes integer NOT NULL DEFAULT 60,
  message text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  skip_if_purchased boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  ad_id text NOT NULL,
  name text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  media_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- LABELS
CREATE TABLE public.labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- CONTACTS / CONVERSATIONS / MESSAGES
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  phone text NOT NULL,
  name text,
  city text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, phone)
);

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ad_id text,
  ad_media_url text,
  last_message text,
  last_message_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0,
  ai_paused boolean NOT NULL DEFAULT false,
  is_closed boolean NOT NULL DEFAULT false,
  sale_closed boolean NOT NULL DEFAULT false,
  followups_paused boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'abierta',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  wamid text,
  direction public.msg_direction NOT NULL,
  sender public.msg_sender NOT NULL DEFAULT 'customer',
  body text,
  media_type text,
  media_url text,
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messages_wamid_unique ON public.messages (workspace_id, wamid) WHERE wamid IS NOT NULL;
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at);

CREATE TABLE public.conversation_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES public.labels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, label_id)
);

-- ORDERS
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  order_number text NOT NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  phone text NOT NULL,
  city text,
  departamento text,
  street text,
  district text,
  reference text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_title text,
  sku text,
  quantity integer NOT NULL DEFAULT 1,
  price numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text,
  payment_status public.payment_state NOT NULL DEFAULT 'pendiente',
  status public.order_state NOT NULL DEFAULT 'nuevo',
  tags text[] NOT NULL DEFAULT '{}',
  observations text,
  receipt_url text,
  ad_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, order_number)
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  sku text,
  quantity integer NOT NULL DEFAULT 1,
  price numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid,
  status public.order_state NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  url text NOT NULL,
  amount numeric(12,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- NOTIFICATIONS
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid,
  audience text NOT NULL DEFAULT 'seller',
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- PLANS
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  conversations integer NOT NULL DEFAULT 0,
  duration_days integer NOT NULL DEFAULT 30,
  benefits text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.plan_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  plan_name text,
  conversations integer NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  receipt_url text,
  status public.purchase_state NOT NULL DEFAULT 'pendiente',
  admin_note text,
  approved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  user_id uuid NOT NULL,
  purchased integer NOT NULL DEFAULT 0,
  consumed integer NOT NULL DEFAULT 0,
  available integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  wamid text,
  amount integer NOT NULL DEFAULT 1,
  reason text NOT NULL DEFAULT 'inbound_message',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- LOGS
CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_id text NOT NULL UNIQUE,
  payload jsonb,
  processed boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.integration_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid,
  integration text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  entity text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SIGNUP TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws_id uuid;
BEGIN
  INSERT INTO public.workspaces (name, owner_id)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'company', NEW.email, 'Workspace'), NEW.id)
  RETURNING id INTO ws_id;

  INSERT INTO public.profiles (id, workspace_id, full_name, email, phone, company)
  VALUES (NEW.id, ws_id, NEW.raw_user_meta_data->>'full_name', NEW.email,
          NEW.raw_user_meta_data->>'phone', NEW.raw_user_meta_data->>'company');

  INSERT INTO public.workspace_members (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'seller');
  INSERT INTO public.user_settings (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.ai_settings (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.whatsapp_connections (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.conversation_balances (workspace_id, user_id) VALUES (ws_id, NEW.id);
  INSERT INTO public.notifications (audience, type, title, body)
  VALUES ('admin','user_pending','Nuevo registro pendiente', COALESCE(NEW.email,'') || ' solicita acceso');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- GRANTS + RLS + POLICIES
DO $$
DECLARE t text;
  ws_tables text[] := ARRAY['user_settings','whatsapp_connections','ai_settings','training_entries','products',
    'product_media','product_keywords','product_followups','ads','labels','contacts','conversations','messages',
    'conversation_labels','orders','order_items','order_status_history','payment_receipts','plan_purchases',
    'conversation_balances','conversation_usage','integration_logs','audit_logs'];
  all_tables text[] := ARRAY['workspaces','profiles','user_roles','workspace_members','user_settings',
    'whatsapp_connections','ai_settings','training_entries','products','product_media','product_keywords',
    'product_followups','ads','labels','contacts','conversations','messages','conversation_labels','orders',
    'order_items','order_status_history','payment_receipts','notifications','plans','plan_purchases',
    'conversation_balances','conversation_usage','webhook_events','integration_logs','audit_logs'];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  FOREACH t IN ARRAY ws_tables LOOP
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(),'admin'))
      WITH CHECK (public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(),'admin'))$f$,
      t || '_ws_access', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;

CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY workspaces_read ON public.workspaces FOR SELECT TO authenticated
  USING (public.is_workspace_member(id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY workspaces_admin ON public.workspaces FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_admin_all ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY user_roles_read ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY user_roles_admin ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY workspace_members_read ON public.workspace_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY workspace_members_admin ON public.workspace_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY notifications_read ON public.notifications FOR SELECT TO authenticated
  USING ((audience = 'seller' AND public.is_workspace_member(workspace_id)) OR (audience='admin' AND public.has_role(auth.uid(),'admin')) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING ((audience = 'seller' AND public.is_workspace_member(workspace_id)) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK ((audience = 'seller' AND public.is_workspace_member(workspace_id)) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY notifications_admin ON public.notifications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING (true);
CREATE POLICY plans_admin ON public.plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY webhook_events_admin ON public.webhook_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- REALTIME
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- DEMO PLANS
INSERT INTO public.plans (name, price, conversations, duration_days, benefits) VALUES
 ('Starter', 90000, 500, 30, ARRAY['500 conversaciones','IA ilimitada','1 número de WhatsApp']),
 ('Pro', 180000, 1500, 30, ARRAY['1500 conversaciones','Seguimientos automáticos','Soporte prioritario']),
 ('Business', 350000, 4000, 30, ARRAY['4000 conversaciones','Métricas por anuncio','Integraciones externas']);
