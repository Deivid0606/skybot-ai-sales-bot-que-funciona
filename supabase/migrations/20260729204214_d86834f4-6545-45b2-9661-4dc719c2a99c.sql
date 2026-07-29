
CREATE POLICY "workspace files access" ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id IN ('product-media','chat-media','receipts')
  AND (
    public.has_role(auth.uid(),'admin')
    OR public.is_workspace_member(NULLIF(split_part(name,'/',1),'')::uuid)
  )
)
WITH CHECK (
  bucket_id IN ('product-media','chat-media','receipts')
  AND (
    public.has_role(auth.uid(),'admin')
    OR public.is_workspace_member(NULLIF(split_part(name,'/',1),'')::uuid)
  )
);
