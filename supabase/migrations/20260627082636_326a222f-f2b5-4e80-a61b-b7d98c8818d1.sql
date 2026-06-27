
-- 1) Avatars: restrict read to authenticated only
DROP POLICY IF EXISTS avatars_public_read ON storage.objects;
CREATE POLICY avatars_authenticated_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

-- 2) Revoke EXECUTE on internal helpers from authenticated
REVOKE EXECUTE ON FUNCTION public.has_block_between(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_member_of(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 3) conversations: explicit INSERT/DELETE policies
CREATE POLICY convs_insert_creator ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY convs_delete_creator ON public.conversations
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- 4) conversation_members: explicit INSERT policy
-- Allow a member to add others to a group they belong to (creator bootstrap also handled
-- via SECURITY DEFINER create_group_conversation). Block-checks are enforced by trigger
-- on messages and by add_group_member_by_number wrapper. Self-join is not allowed unless
-- caller is already a member (so the conversation creator can add themselves first via the
-- SECURITY DEFINER function).
CREATE POLICY convmembers_insert_by_member ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = conversation_members.conversation_id
        AND cm.user_id = auth.uid()
    )
  );

-- 5) messages: tighten update policy. Column-level GRANT (read_by only) already in place;
-- recreate the policy to make intent explicit.
DROP POLICY IF EXISTS messages_update_read_by ON public.messages;
CREATE POLICY messages_update_read_by ON public.messages
  FOR UPDATE TO authenticated
  USING (public.is_member_of(conversation_id, auth.uid()))
  WITH CHECK (
    public.is_member_of(conversation_id, auth.uid())
    AND sender_id = (SELECT m.sender_id FROM public.messages m WHERE m.id = messages.id)
    AND content IS NOT DISTINCT FROM (SELECT m.content FROM public.messages m WHERE m.id = messages.id)
    AND attachment_url IS NOT DISTINCT FROM (SELECT m.attachment_url FROM public.messages m WHERE m.id = messages.id)
  );
