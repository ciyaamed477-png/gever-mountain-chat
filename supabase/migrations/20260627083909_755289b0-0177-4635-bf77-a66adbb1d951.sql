
DROP POLICY IF EXISTS convmembers_insert_self_or_creator ON public.conversation_members;
CREATE POLICY convmembers_insert_by_creator
  ON public.conversation_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
  );
