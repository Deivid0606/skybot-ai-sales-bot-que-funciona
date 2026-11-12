-- Ventas por WhatsApp a Meta (API de Conversiones).
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ctwa_clid text;

CREATE TABLE IF NOT EXISTS public.workspace_meta_capi (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  dataset_id text,
  access_token text,
  enabled boolean NOT NULL DEFAULT true,
  test_event_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_meta_capi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_meta_capi_member_all ON public.workspace_meta_capi;
CREATE POLICY workspace_meta_capi_member_all ON public.workspace_meta_capi
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_meta_capi TO authenticated;
GRANT ALL ON public.workspace_meta_capi TO service_role;

CREATE TABLE IF NOT EXISTS public.meta_capi_events (
  order_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid,
  status text NOT NULL,
  http_status integer,
  detail text,
  value numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_capi_events_member_read ON public.meta_capi_events;
CREATE POLICY meta_capi_events_member_read ON public.meta_capi_events
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS meta_capi_events_admin_read ON public.meta_capi_events;
CREATE POLICY meta_capi_events_admin_read ON public.meta_capi_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT ON public.meta_capi_events TO authenticated;
GRANT ALL ON public.meta_capi_events TO service_role;
CREATE INDEX IF NOT EXISTS meta_capi_events_ws_idx ON public.meta_capi_events (workspace_id, created_at DESC);
