
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size BIGINT,
  ADD COLUMN IF NOT EXISTS attachment_duration INT;

ALTER TABLE public.messages ALTER COLUMN content DROP NOT NULL;

-- Storage RLS for chat-attachments bucket.
-- Path convention: {conversation_id}/{user_id}/{filename}
CREATE POLICY "chat_att_select_members"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND public.is_member_of((storage.foldername(name))[1]::uuid, auth.uid())
);

CREATE POLICY "chat_att_insert_members"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND owner = auth.uid()
  AND public.is_member_of((storage.foldername(name))[1]::uuid, auth.uid())
  AND (storage.foldername(name))[2]::uuid = auth.uid()
);

CREATE POLICY "chat_att_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND owner = auth.uid()
);
