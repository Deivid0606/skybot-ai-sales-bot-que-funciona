-- Politicas RLS: public.conversation_labels

ALTER TABLE public.conversation_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_labels_ws_access" ON public.conversation_labels;
CREATE POLICY "conversation_labels_ws_access" ON public.conversation_labels
  FOR ALL
  TO authenticated
  USING ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_workspace_member(workspace_id) OR has_role(auth.uid(), 'admin'::app_role)));
