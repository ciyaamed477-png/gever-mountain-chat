
-- 1. Drop overly broad UPDATE policy on messages; use column-level grant for read_by
DROP POLICY IF EXISTS messages_update_read_by ON public.messages;

REVOKE UPDATE ON public.messages FROM authenticated;
GRANT UPDATE (read_by) ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

CREATE POLICY messages_update_read_by ON public.messages
  FOR UPDATE TO authenticated
  USING (public.is_member_of(conversation_id, auth.uid()))
  WITH CHECK (public.is_member_of(conversation_id, auth.uid()));

-- 2. Lock down internal helper functions to authenticated only
REVOKE ALL ON FUNCTION public.has_block_between(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_block_between(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_member_of(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_member_of(uuid, uuid) TO authenticated, service_role;

-- Also tighten other SECURITY DEFINER helpers from public/anon (callable only by authenticated users)
REVOKE ALL ON FUNCTION public.get_my_contacts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_contacts() TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_blocked() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_blocked() TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_conversations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_conversations() TO authenticated;

REVOKE ALL ON FUNCTION public.block_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_contact(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.add_contact_by_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_contact_by_number(text) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_group_conversation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_conversation(text) TO authenticated;

REVOKE ALL ON FUNCTION public.add_group_member_by_number(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_group_member_by_number(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_conversation_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_conversation_for_user(uuid) TO authenticated;

-- 3. Fix mutable search_path on set_updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;
