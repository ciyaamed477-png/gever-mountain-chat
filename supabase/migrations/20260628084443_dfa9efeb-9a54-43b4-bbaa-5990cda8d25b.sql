-- Restore EXECUTE on RLS helper functions to authenticated.
-- These are referenced inside RLS policies on messages/conversations/conversation_members,
-- so the calling role must be able to execute them or every read/write fails with 42501.
GRANT EXECUTE ON FUNCTION public.is_member_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_block_between(uuid, uuid) TO authenticated;