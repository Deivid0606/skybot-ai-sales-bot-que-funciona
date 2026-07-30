CREATE TABLE public.followup_sends (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  product_id uuid,
  step integer NOT NULL DEFAULT 1,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, product_id, step)
);
GRANT SELECT ON public.followup_sends TO authenticated;
GRANT ALL ON public.followup_sends TO service_role;
ALTER TABLE public.followup_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read followup sends"
ON public.followup_sends FOR SELECT TO authenticated
USING (public.is_workspace_member(workspace_id));
CREATE INDEX followup_sends_conv_idx ON public.followup_sends (conversation_id);