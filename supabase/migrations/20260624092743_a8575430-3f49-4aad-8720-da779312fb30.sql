
CREATE OR REPLACE FUNCTION public.delete_conversation_for_user(_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  remaining INT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Yetkisiz'; END IF;
  IF NOT public.is_member_of(_conversation_id, uid) THEN
    RAISE EXCEPTION 'Bu sohbetin üyesi değilsin';
  END IF;
  DELETE FROM public.conversation_members
    WHERE conversation_id = _conversation_id AND user_id = uid;
  SELECT COUNT(*) INTO remaining FROM public.conversation_members
    WHERE conversation_id = _conversation_id;
  IF remaining = 0 THEN
    DELETE FROM public.messages WHERE conversation_id = _conversation_id;
    DELETE FROM public.conversations WHERE id = _conversation_id;
  END IF;
END;
$$;
