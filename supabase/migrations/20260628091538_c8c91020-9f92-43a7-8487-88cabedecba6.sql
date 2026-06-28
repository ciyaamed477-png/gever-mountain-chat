DROP POLICY IF EXISTS convs_select_member ON public.conversations;

CREATE POLICY convs_select_creator_or_member
ON public.conversations
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR private.is_member_of(id, auth.uid())
);