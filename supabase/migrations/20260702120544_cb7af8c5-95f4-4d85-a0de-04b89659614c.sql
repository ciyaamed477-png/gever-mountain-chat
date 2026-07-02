
CREATE OR REPLACE FUNCTION public.can_view_profile(_target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _target = auth.uid()
    OR EXISTS (SELECT 1 FROM public.contacts WHERE user_id = auth.uid() AND contact_id = _target)
    OR EXISTS (SELECT 1 FROM public.contacts WHERE user_id = _target AND contact_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.blocks  WHERE user_id = auth.uid() AND blocked_id = _target)
    OR EXISTS (
      SELECT 1
      FROM public.conversation_members me
      JOIN public.conversation_members other
        ON other.conversation_id = me.conversation_id
      WHERE me.user_id = auth.uid()
        AND other.user_id = _target
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_view_profile(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_view_profile(uuid) TO authenticated;

DROP POLICY IF EXISTS profiles_select_any ON public.profiles;

CREATE POLICY profiles_select_related
ON public.profiles
FOR SELECT
TO authenticated
USING (public.can_view_profile(id));
