-- BOT SKY — Esquema completo de la base de datos (PostgreSQL)
-- Generado el 2026-07-30
-- Incluye: tipos ENUM, tablas, claves, índices, funciones, triggers, GRANTs y políticas RLS.
-- Nota: el trigger on_auth_user_created vive en el esquema auth (ver el final del archivo).

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'seller'
);


--
-- Name: msg_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.msg_direction AS ENUM (
    'inbound',
    'outbound'
);


--
-- Name: msg_sender; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.msg_sender AS ENUM (
    'customer',
    'ai',
    'agent',
    'system'
);


--
-- Name: order_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_state AS ENUM (
    'nuevo',
    'confirmado',
    'cargado',
    'preparacion',
    'enviado',
    'entregado',
    'cancelado'
);


--
-- Name: payment_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_state AS ENUM (
    'pendiente',
    'anticipado',
    'pagado',
    'contraentrega',
    'rechazado'
);


--
-- Name: purchase_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.purchase_state AS ENUM (
    'pendiente',
    'aprobado',
    'rechazado'
);


--
-- Name: user_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'blocked',
    'active',
    'suspended'
);


--
-- Name: current_workspace_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_workspace_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid();
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;


--
-- Name: is_workspace_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_workspace_member(_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = auth.uid()
  );
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    ad_id text NOT NULL,
    name text,
    product_id uuid,
    media_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    gemini_api_key text,
    model text DEFAULT 'google/gemini-3.6-flash'::text NOT NULL,
    autodetect_model boolean DEFAULT true NOT NULL,
    system_instruction text DEFAULT 'Eres un asistente de ventas para una tienda online. Responde en español de forma amable, clara y profesional. Ayuda a cerrar ventas sin perder el contexto. Sigue estrictamente el entrenamiento y el catálogo del vendedor. No inventes precios, stock, cobertura, promociones ni datos bancarios.'::text NOT NULL,
    reply_delay_seconds integer DEFAULT 3 NOT NULL,
    ai_enabled boolean DEFAULT true NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_messages (
    key text NOT NULL,
    title text,
    body text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    action text NOT NULL,
    entity text,
    entity_id uuid,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid,
    contact_id uuid,
    message_id uuid,
    phone text NOT NULL,
    contact_name text,
    body text NOT NULL,
    reason text DEFAULT 'general'::text NOT NULL,
    severity text DEFAULT 'media'::text NOT NULL,
    status text DEFAULT 'nuevo'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    phone text NOT NULL,
    name text,
    city text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_balances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    purchased integer DEFAULT 0 NOT NULL,
    consumed integer DEFAULT 0 NOT NULL,
    available integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_labels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    label_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid,
    wamid text,
    amount integer DEFAULT 1 NOT NULL,
    reason text DEFAULT 'inbound_message'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    product_id uuid,
    ad_id text,
    ad_media_url text,
    last_message text,
    last_message_at timestamp with time zone,
    unread_count integer DEFAULT 0 NOT NULL,
    ai_paused boolean DEFAULT false NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    sale_closed boolean DEFAULT false NOT NULL,
    followups_paused boolean DEFAULT false NOT NULL,
    status text DEFAULT 'abierta'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.conversations REPLICA IDENTITY FULL;


--
-- Name: followup_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.followup_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    product_id uuid,
    step integer DEFAULT 1 NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    integration text NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    message text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    wamid text,
    direction public.msg_direction NOT NULL,
    sender public.msg_sender DEFAULT 'customer'::public.msg_sender NOT NULL,
    body text,
    media_type text,
    media_url text,
    status text DEFAULT 'sent'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    transcript text,
    catalog_product_id uuid
);

ALTER TABLE ONLY public.messages REPLICA IDENTITY FULL;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    audience text DEFAULT 'seller'::text NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notifications REPLICA IDENTITY FULL;


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    user_id uuid NOT NULL,
    title text NOT NULL,
    sku text,
    quantity integer DEFAULT 1 NOT NULL,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    order_id uuid NOT NULL,
    user_id uuid,
    status public.order_state NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    order_number text NOT NULL,
    conversation_id uuid,
    contact_id uuid,
    customer_name text NOT NULL,
    phone text NOT NULL,
    city text,
    departamento text,
    street text,
    district text,
    reference text,
    product_id uuid,
    product_title text,
    sku text,
    quantity integer DEFAULT 1 NOT NULL,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) DEFAULT 0 NOT NULL,
    payment_method text,
    payment_status public.payment_state DEFAULT 'pendiente'::public.payment_state NOT NULL,
    status public.order_state DEFAULT 'nuevo'::public.order_state NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    observations text,
    receipt_url text,
    ad_id text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    order_id uuid,
    user_id uuid NOT NULL,
    url text NOT NULL,
    amount numeric(12,2),
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: plan_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    plan_id uuid,
    plan_name text,
    conversations integer DEFAULT 0 NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    receipt_url text,
    status public.purchase_state DEFAULT 'pendiente'::public.purchase_state NOT NULL,
    admin_note text,
    approved_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    conversations integer DEFAULT 0 NOT NULL,
    duration_days integer DEFAULT 30 NOT NULL,
    benefits text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_followups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    product_id uuid NOT NULL,
    user_id uuid NOT NULL,
    step integer DEFAULT 1 NOT NULL,
    delay_minutes integer DEFAULT 60 NOT NULL,
    message text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    skip_if_purchased boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_keywords (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    product_id uuid NOT NULL,
    user_id uuid NOT NULL,
    keyword text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    product_id uuid NOT NULL,
    user_id uuid NOT NULL,
    media_type text NOT NULL,
    url text NOT NULL,
    storage_path text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    sku text,
    description text,
    sales_copy text,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    promo_price numeric(12,2),
    stock integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    variants jsonb DEFAULT '[]'::jsonb NOT NULL,
    delivery_info text,
    ai_instructions text,
    followup_message text,
    followup_minutes integer DEFAULT 60 NOT NULL,
    followup_enabled boolean DEFAULT false NOT NULL,
    no_repeat_template boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    workspace_id uuid,
    full_name text,
    email text,
    phone text,
    company text,
    avatar_url text,
    status public.user_status DEFAULT 'pending'::public.user_status NOT NULL,
    status_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    category text DEFAULT 'reglas_generales'::text NOT NULL,
    content text NOT NULL,
    priority integer DEFAULT 5 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    scope text DEFAULT 'general'::text NOT NULL,
    product_id uuid,
    schedule_from time without time zone,
    schedule_to time without time zone,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    business_name text,
    timezone text DEFAULT 'America/Asuncion'::text NOT NULL,
    currency text DEFAULT 'PYG'::text NOT NULL,
    google_sheets_url text,
    apps_script_url text,
    last_sheet_sync timestamp with time zone,
    notify_numbers text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    catalog_enabled boolean DEFAULT true NOT NULL
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    event_id text NOT NULL,
    payload jsonb,
    processed boolean DEFAULT false NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whatsapp_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    phone_number_id text,
    waba_id text,
    app_id text,
    access_token text,
    verify_token text,
    display_phone text,
    app_secret text,
    connected boolean DEFAULT false NOT NULL,
    last_error text,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ads ads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_pkey PRIMARY KEY (id);


--
-- Name: ai_settings ai_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_pkey PRIMARY KEY (id);


--
-- Name: ai_settings ai_settings_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_workspace_id_key UNIQUE (workspace_id);


--
-- Name: app_messages app_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_messages
    ADD CONSTRAINT app_messages_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_workspace_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_workspace_id_phone_key UNIQUE (workspace_id, phone);


--
-- Name: conversation_balances conversation_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_balances
    ADD CONSTRAINT conversation_balances_pkey PRIMARY KEY (id);


--
-- Name: conversation_balances conversation_balances_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_balances
    ADD CONSTRAINT conversation_balances_workspace_id_key UNIQUE (workspace_id);


--
-- Name: conversation_labels conversation_labels_conversation_id_label_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_conversation_id_label_id_key UNIQUE (conversation_id, label_id);


--
-- Name: conversation_labels conversation_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_pkey PRIMARY KEY (id);


--
-- Name: conversation_usage conversation_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_usage
    ADD CONSTRAINT conversation_usage_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: followup_sends followup_sends_conversation_id_product_id_step_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_sends
    ADD CONSTRAINT followup_sends_conversation_id_product_id_step_key UNIQUE (conversation_id, product_id, step);


--
-- Name: followup_sends followup_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_sends
    ADD CONSTRAINT followup_sends_pkey PRIMARY KEY (id);


--
-- Name: integration_logs integration_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_logs
    ADD CONSTRAINT integration_logs_pkey PRIMARY KEY (id);


--
-- Name: labels labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: orders orders_workspace_id_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_workspace_id_order_number_key UNIQUE (workspace_id, order_number);


--
-- Name: payment_receipts payment_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_pkey PRIMARY KEY (id);


--
-- Name: plan_purchases plan_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_purchases
    ADD CONSTRAINT plan_purchases_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: product_followups product_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_followups
    ADD CONSTRAINT product_followups_pkey PRIMARY KEY (id);


--
-- Name: product_keywords product_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_keywords
    ADD CONSTRAINT product_keywords_pkey PRIMARY KEY (id);


--
-- Name: product_media product_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_media
    ADD CONSTRAINT product_media_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: training_entries training_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_entries
    ADD CONSTRAINT training_entries_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_workspace_id_key UNIQUE (workspace_id);


--
-- Name: webhook_events webhook_events_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_event_id_key UNIQUE (event_id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_connections whatsapp_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_connections
    ADD CONSTRAINT whatsapp_connections_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_connections whatsapp_connections_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_connections
    ADD CONSTRAINT whatsapp_connections_workspace_id_key UNIQUE (workspace_id);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: complaints_workspace_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX complaints_workspace_created_idx ON public.complaints USING btree (workspace_id, created_at DESC);


--
-- Name: followup_sends_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX followup_sends_conv_idx ON public.followup_sends USING btree (conversation_id);


--
-- Name: messages_catalog_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_catalog_product_idx ON public.messages USING btree (conversation_id, catalog_product_id);


--
-- Name: messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conversation_idx ON public.messages USING btree (conversation_id, created_at);


--
-- Name: messages_wamid_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_wamid_unique ON public.messages USING btree (workspace_id, wamid) WHERE (wamid IS NOT NULL);


--
-- Name: ads ads_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ads_set_updated_at BEFORE UPDATE ON public.ads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ai_settings ai_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_settings_set_updated_at BEFORE UPDATE ON public.ai_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: app_messages app_messages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_messages_updated_at BEFORE UPDATE ON public.app_messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_logs audit_logs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_set_updated_at BEFORE UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: complaints complaints_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER complaints_set_updated_at BEFORE UPDATE ON public.complaints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: contacts contacts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: conversation_balances conversation_balances_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversation_balances_set_updated_at BEFORE UPDATE ON public.conversation_balances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: conversation_labels conversation_labels_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversation_labels_set_updated_at BEFORE UPDATE ON public.conversation_labels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: conversation_usage conversation_usage_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversation_usage_set_updated_at BEFORE UPDATE ON public.conversation_usage FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: conversations conversations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: integration_logs integration_logs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER integration_logs_set_updated_at BEFORE UPDATE ON public.integration_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: labels labels_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER labels_set_updated_at BEFORE UPDATE ON public.labels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: messages messages_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_set_updated_at BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: order_items order_items_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_set_updated_at BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: order_status_history order_status_history_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_status_history_set_updated_at BEFORE UPDATE ON public.order_status_history FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: orders orders_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payment_receipts payment_receipts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payment_receipts_set_updated_at BEFORE UPDATE ON public.payment_receipts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: plan_purchases plan_purchases_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER plan_purchases_set_updated_at BEFORE UPDATE ON public.plan_purchases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: plans plans_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_followups product_followups_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_followups_set_updated_at BEFORE UPDATE ON public.product_followups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_keywords product_keywords_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_keywords_set_updated_at BEFORE UPDATE ON public.product_keywords FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_media product_media_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_media_set_updated_at BEFORE UPDATE ON public.product_media FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products products_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: training_entries training_entries_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER training_entries_set_updated_at BEFORE UPDATE ON public.training_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_settings user_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_settings_set_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: whatsapp_connections whatsapp_connections_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER whatsapp_connections_set_updated_at BEFORE UPDATE ON public.whatsapp_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspaces workspaces_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ads ads_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: ads ads_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_settings ai_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: complaints complaints_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: complaints complaints_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: complaints complaints_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: conversation_balances conversation_balances_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_balances
    ADD CONSTRAINT conversation_balances_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: conversation_labels conversation_labels_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_labels conversation_labels_label_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.labels(id) ON DELETE CASCADE;


--
-- Name: conversation_labels conversation_labels_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: conversation_usage conversation_usage_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_usage
    ADD CONSTRAINT conversation_usage_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: conversation_usage conversation_usage_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_usage
    ADD CONSTRAINT conversation_usage_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: integration_logs integration_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_logs
    ADD CONSTRAINT integration_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: labels labels_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: messages messages_catalog_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_catalog_product_id_fkey FOREIGN KEY (catalog_product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: order_status_history order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_status_history order_status_history_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: orders orders_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: orders orders_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: orders orders_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: orders orders_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: payment_receipts payment_receipts_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: payment_receipts payment_receipts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: plan_purchases plan_purchases_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_purchases
    ADD CONSTRAINT plan_purchases_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;


--
-- Name: plan_purchases plan_purchases_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_purchases
    ADD CONSTRAINT plan_purchases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: product_followups product_followups_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_followups
    ADD CONSTRAINT product_followups_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_followups product_followups_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_followups
    ADD CONSTRAINT product_followups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: product_keywords product_keywords_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_keywords
    ADD CONSTRAINT product_keywords_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_keywords product_keywords_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_keywords
    ADD CONSTRAINT product_keywords_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: product_media product_media_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_media
    ADD CONSTRAINT product_media_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_media product_media_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_media
    ADD CONSTRAINT product_media_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: products products_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: training_entries training_entries_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_entries
    ADD CONSTRAINT training_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: webhook_events webhook_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: whatsapp_connections whatsapp_connections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_connections
    ADD CONSTRAINT whatsapp_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: complaints Workspace members manage complaints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members manage complaints" ON public.complaints TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));


--
-- Name: ads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

--
-- Name: ads ads_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ads_ws_access ON public.ads TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: ai_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_settings ai_settings_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_settings_ws_access ON public.ai_settings TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: app_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: app_messages app_messages_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_messages_admin_write ON public.app_messages TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: app_messages app_messages_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_messages_read ON public.app_messages FOR SELECT USING (true);


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_logs_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_ws_access ON public.audit_logs TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: complaints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts contacts_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_ws_access ON public.contacts TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: conversation_balances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_balances ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_balances conversation_balances_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_balances_ws_access ON public.conversation_balances TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: conversation_labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_labels ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_labels conversation_labels_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_labels_ws_access ON public.conversation_labels TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: conversation_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_usage conversation_usage_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_usage_ws_access ON public.conversation_usage TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_ws_access ON public.conversations TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: followup_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.followup_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_logs integration_logs_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY integration_logs_ws_access ON public.integration_logs TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

--
-- Name: labels labels_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY labels_ws_access ON public.labels TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_ws_access ON public.messages TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_admin ON public.notifications TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: notifications notifications_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_read ON public.notifications FOR SELECT TO authenticated USING ((((audience = 'seller'::text) AND public.is_workspace_member(workspace_id)) OR ((audience = 'admin'::text) AND public.has_role(auth.uid(), 'admin'::public.app_role)) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: notifications notifications_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated USING ((((audience = 'seller'::text) AND public.is_workspace_member(workspace_id)) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((((audience = 'seller'::text) AND public.is_workspace_member(workspace_id)) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items order_items_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_ws_access ON public.order_items TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: order_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

--
-- Name: order_status_history order_status_history_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_status_history_ws_access ON public.order_status_history TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders orders_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_ws_access ON public.orders TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: payment_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_receipts payment_receipts_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_receipts_ws_access ON public.payment_receipts TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: plan_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plan_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_purchases plan_purchases_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_purchases_ws_access ON public.plan_purchases TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

--
-- Name: plans plans_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plans_admin ON public.plans TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: plans plans_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING (true);


--
-- Name: product_followups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_followups ENABLE ROW LEVEL SECURITY;

--
-- Name: product_followups product_followups_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_followups_ws_access ON public.product_followups TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: product_keywords; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_keywords ENABLE ROW LEVEL SECURITY;

--
-- Name: product_keywords product_keywords_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_keywords_ws_access ON public.product_keywords TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: product_media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

--
-- Name: product_media product_media_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_media_ws_access ON public.product_media TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_ws_access ON public.products TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_admin_all ON public.profiles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles profiles_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: profiles profiles_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: product_keywords public_catalog_keywords_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_catalog_keywords_read ON public.product_keywords FOR SELECT TO anon USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_keywords.product_id) AND (p.is_active = true)))));


--
-- Name: product_media public_catalog_media_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_catalog_media_read ON public.product_media FOR SELECT TO anon USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_media.product_id) AND (p.is_active = true)))));


--
-- Name: products public_catalog_products_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_catalog_products_read ON public.products FOR SELECT TO anon USING ((is_active = true));


--
-- Name: workspaces public_catalog_workspaces_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_catalog_workspaces_read ON public.workspaces FOR SELECT TO anon USING (true);


--
-- Name: training_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: training_entries training_entries_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY training_entries_ws_access ON public.training_entries TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles user_roles_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_roles_admin ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles user_roles_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_roles_read ON public.user_roles FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: user_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings user_settings_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_settings_ws_access ON public.user_settings TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_events webhook_events_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_events_admin ON public.webhook_events TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: whatsapp_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_connections whatsapp_connections_ws_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_connections_ws_access ON public.whatsapp_connections TO authenticated USING ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK ((public.is_workspace_member(workspace_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: followup_sends workspace members read followup sends; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members read followup sends" ON public.followup_sends FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));


--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_members workspace_members_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_admin ON public.workspace_members TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: workspace_members workspace_members_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_read ON public.workspace_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces workspaces_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspaces_admin ON public.workspaces TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: workspaces workspaces_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspaces_read ON public.workspaces FOR SELECT TO authenticated USING ((public.is_workspace_member(id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO sandbox_exec;


--
-- Name: FUNCTION current_workspace_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_workspace_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_workspace_id() TO service_role;
GRANT ALL ON FUNCTION public.current_workspace_id() TO sandbox_exec;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;
GRANT ALL ON FUNCTION public.handle_new_user() TO sandbox_exec;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO sandbox_exec;


--
-- Name: FUNCTION is_workspace_member(_workspace_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_workspace_member(_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_workspace_member(_workspace_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_workspace_member(_workspace_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.is_workspace_member(_workspace_id uuid) TO sandbox_exec;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;
GRANT ALL ON FUNCTION public.set_updated_at() TO sandbox_exec;


--
-- Name: TABLE ads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ads TO anon;
GRANT ALL ON TABLE public.ads TO authenticated;
GRANT ALL ON TABLE public.ads TO service_role;
GRANT SELECT,INSERT ON TABLE public.ads TO sandbox_exec;


--
-- Name: TABLE ai_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_settings TO anon;
GRANT ALL ON TABLE public.ai_settings TO authenticated;
GRANT ALL ON TABLE public.ai_settings TO service_role;
GRANT SELECT,INSERT ON TABLE public.ai_settings TO sandbox_exec;


--
-- Name: TABLE app_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_messages TO anon;
GRANT ALL ON TABLE public.app_messages TO authenticated;
GRANT ALL ON TABLE public.app_messages TO service_role;
GRANT SELECT,INSERT ON TABLE public.app_messages TO sandbox_exec;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;
GRANT SELECT,INSERT ON TABLE public.audit_logs TO sandbox_exec;


--
-- Name: TABLE complaints; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.complaints TO anon;
GRANT ALL ON TABLE public.complaints TO authenticated;
GRANT ALL ON TABLE public.complaints TO service_role;
GRANT SELECT,INSERT ON TABLE public.complaints TO sandbox_exec;


--
-- Name: TABLE contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contacts TO anon;
GRANT ALL ON TABLE public.contacts TO authenticated;
GRANT ALL ON TABLE public.contacts TO service_role;
GRANT SELECT,INSERT ON TABLE public.contacts TO sandbox_exec;


--
-- Name: TABLE conversation_balances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_balances TO anon;
GRANT ALL ON TABLE public.conversation_balances TO authenticated;
GRANT ALL ON TABLE public.conversation_balances TO service_role;
GRANT SELECT,INSERT ON TABLE public.conversation_balances TO sandbox_exec;


--
-- Name: TABLE conversation_labels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_labels TO anon;
GRANT ALL ON TABLE public.conversation_labels TO authenticated;
GRANT ALL ON TABLE public.conversation_labels TO service_role;
GRANT SELECT,INSERT ON TABLE public.conversation_labels TO sandbox_exec;


--
-- Name: TABLE conversation_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_usage TO anon;
GRANT ALL ON TABLE public.conversation_usage TO authenticated;
GRANT ALL ON TABLE public.conversation_usage TO service_role;
GRANT SELECT,INSERT ON TABLE public.conversation_usage TO sandbox_exec;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;
GRANT SELECT,INSERT ON TABLE public.conversations TO sandbox_exec;


--
-- Name: TABLE followup_sends; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.followup_sends TO anon;
GRANT ALL ON TABLE public.followup_sends TO authenticated;
GRANT ALL ON TABLE public.followup_sends TO service_role;
GRANT SELECT,INSERT ON TABLE public.followup_sends TO sandbox_exec;


--
-- Name: TABLE integration_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.integration_logs TO anon;
GRANT ALL ON TABLE public.integration_logs TO authenticated;
GRANT ALL ON TABLE public.integration_logs TO service_role;
GRANT SELECT,INSERT ON TABLE public.integration_logs TO sandbox_exec;


--
-- Name: TABLE labels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.labels TO anon;
GRANT ALL ON TABLE public.labels TO authenticated;
GRANT ALL ON TABLE public.labels TO service_role;
GRANT SELECT,INSERT ON TABLE public.labels TO sandbox_exec;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;
GRANT SELECT,INSERT ON TABLE public.messages TO sandbox_exec;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;
GRANT SELECT,INSERT ON TABLE public.notifications TO sandbox_exec;


--
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_items TO anon;
GRANT ALL ON TABLE public.order_items TO authenticated;
GRANT ALL ON TABLE public.order_items TO service_role;
GRANT SELECT,INSERT ON TABLE public.order_items TO sandbox_exec;


--
-- Name: TABLE order_status_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_status_history TO anon;
GRANT ALL ON TABLE public.order_status_history TO authenticated;
GRANT ALL ON TABLE public.order_status_history TO service_role;
GRANT SELECT,INSERT ON TABLE public.order_status_history TO sandbox_exec;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;
GRANT SELECT,INSERT ON TABLE public.orders TO sandbox_exec;


--
-- Name: TABLE payment_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_receipts TO anon;
GRANT ALL ON TABLE public.payment_receipts TO authenticated;
GRANT ALL ON TABLE public.payment_receipts TO service_role;
GRANT SELECT,INSERT ON TABLE public.payment_receipts TO sandbox_exec;


--
-- Name: TABLE plan_purchases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plan_purchases TO anon;
GRANT ALL ON TABLE public.plan_purchases TO authenticated;
GRANT ALL ON TABLE public.plan_purchases TO service_role;
GRANT SELECT,INSERT ON TABLE public.plan_purchases TO sandbox_exec;


--
-- Name: TABLE plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plans TO anon;
GRANT ALL ON TABLE public.plans TO authenticated;
GRANT ALL ON TABLE public.plans TO service_role;
GRANT SELECT,INSERT ON TABLE public.plans TO sandbox_exec;


--
-- Name: TABLE product_followups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_followups TO anon;
GRANT ALL ON TABLE public.product_followups TO authenticated;
GRANT ALL ON TABLE public.product_followups TO service_role;
GRANT SELECT,INSERT ON TABLE public.product_followups TO sandbox_exec;


--
-- Name: TABLE product_keywords; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_keywords TO anon;
GRANT ALL ON TABLE public.product_keywords TO authenticated;
GRANT ALL ON TABLE public.product_keywords TO service_role;
GRANT SELECT,INSERT ON TABLE public.product_keywords TO sandbox_exec;


--
-- Name: TABLE product_media; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_media TO anon;
GRANT ALL ON TABLE public.product_media TO authenticated;
GRANT ALL ON TABLE public.product_media TO service_role;
GRANT SELECT,INSERT ON TABLE public.product_media TO sandbox_exec;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;
GRANT SELECT,INSERT ON TABLE public.products TO sandbox_exec;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT,INSERT ON TABLE public.profiles TO sandbox_exec;


--
-- Name: TABLE training_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_entries TO anon;
GRANT ALL ON TABLE public.training_entries TO authenticated;
GRANT ALL ON TABLE public.training_entries TO service_role;
GRANT SELECT,INSERT ON TABLE public.training_entries TO sandbox_exec;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;
GRANT SELECT,INSERT ON TABLE public.user_roles TO sandbox_exec;


--
-- Name: TABLE user_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_settings TO anon;
GRANT ALL ON TABLE public.user_settings TO authenticated;
GRANT ALL ON TABLE public.user_settings TO service_role;
GRANT SELECT,INSERT ON TABLE public.user_settings TO sandbox_exec;


--
-- Name: TABLE webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.webhook_events TO anon;
GRANT ALL ON TABLE public.webhook_events TO authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;
GRANT SELECT,INSERT ON TABLE public.webhook_events TO sandbox_exec;


--
-- Name: TABLE whatsapp_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_connections TO anon;
GRANT ALL ON TABLE public.whatsapp_connections TO authenticated;
GRANT ALL ON TABLE public.whatsapp_connections TO service_role;
GRANT SELECT,INSERT ON TABLE public.whatsapp_connections TO sandbox_exec;


--
-- Name: TABLE workspace_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_members TO anon;
GRANT ALL ON TABLE public.workspace_members TO authenticated;
GRANT ALL ON TABLE public.workspace_members TO service_role;
GRANT SELECT,INSERT ON TABLE public.workspace_members TO sandbox_exec;


--
-- Name: TABLE workspaces; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspaces TO anon;
GRANT ALL ON TABLE public.workspaces TO authenticated;
GRANT ALL ON TABLE public.workspaces TO service_role;
GRANT SELECT,INSERT ON TABLE public.workspaces TO sandbox_exec;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO sandbox_exec;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO sandbox_exec;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO sandbox_exec;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--



--
-- Trigger de registro de usuarios (esquema auth, crear manualmente en el nuevo proyecto)
--
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
