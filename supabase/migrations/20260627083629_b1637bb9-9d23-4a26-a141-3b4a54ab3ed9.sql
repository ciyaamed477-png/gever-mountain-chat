
-- 1) Fix convmembers privilege escalation: only self-join, OR conversation creator may add others
DROP POLICY IF EXISTS convmembers_insert_by_member ON public.conversation_members;
CREATE POLICY convmembers_insert_self_or_creator
  ON public.conversation_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
  );

-- 2) Allow members (not just creator) to delete a conversation when cleaning up
DROP POLICY IF EXISTS convs_delete_creator ON public.conversations;
CREATE POLICY convs_delete_creator_or_member
  ON public.conversations
  FOR DELETE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_member_of(id, auth.uid())
  );

-- 3) Allow members to delete messages in their conversations (needed for cleanup on leave)
CREATE POLICY messages_delete_member
  ON public.messages
  FOR DELETE
  TO authenticated
  USING (public.is_member_of(conversation_id, auth.uid()));

-- 4) chat-attachments storage: restrict UPDATE to original uploader who is still a chat member
CREATE POLICY "chat_att_update_owner"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND owner = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND owner = auth.uid()
  );

-- 5) Convert user-callable helpers to SECURITY INVOKER so they no longer trip the
--    "SECURITY DEFINER callable by authenticated" linter. Each function's writes
--    are already covered by the table's RLS policies.

CREATE OR REPLACE FUNCTION public.remove_contact(_other_user_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  DELETE FROM public.contacts WHERE user_id = auth.uid() AND contact_id = _other_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_contacts()
 RETURNS TABLE(contact_id uuid, display_name text, gever_number text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.display_name, p.gever_number, p.avatar_url
  FROM public.contacts c JOIN public.profiles p ON p.id = c.contact_id
  WHERE c.user_id = auth.uid() ORDER BY p.display_name;
$function$;

CREATE OR REPLACE FUNCTION public.block_user(_other_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _other_user_id = auth.uid() THEN RAISE EXCEPTION 'Kendini engelleyemezsin'; END IF;
  INSERT INTO public.blocks (user_id, blocked_id) VALUES (auth.uid(), _other_user_id)
    ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unblock_user(_other_user_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  DELETE FROM public.blocks WHERE user_id = auth.uid() AND blocked_id = _other_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_blocked()
 RETURNS TABLE(blocked_id uuid, display_name text, gever_number text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.display_name, p.gever_number, p.avatar_url
  FROM public.blocks b JOIN public.profiles p ON p.id = b.blocked_id
  WHERE b.user_id = auth.uid() ORDER BY p.display_name;
$function$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE uid UUID := auth.uid();
BEGIN
  IF NOT public.is_member_of(_conversation_id, uid) THEN RETURN; END IF;
  UPDATE public.conversation_members SET last_read_at = now()
    WHERE conversation_id = _conversation_id AND user_id = uid;
  UPDATE public.messages SET read_by = read_by || ARRAY[uid]
    WHERE conversation_id = _conversation_id AND NOT (uid = ANY(read_by));
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_contact_by_number(_gever_number text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE target UUID;
BEGIN
  IF _gever_number !~ '^[0-9]{8}$' THEN RAISE EXCEPTION 'Geçersiz numara'; END IF;
  SELECT id INTO target FROM public.profiles WHERE gever_number = _gever_number;
  IF target IS NULL THEN RAISE EXCEPTION 'Kullanıcı bulunamadı'; END IF;
  IF target = auth.uid() THEN RAISE EXCEPTION 'Kendini ekleyemezsin'; END IF;
  INSERT INTO public.contacts (user_id, contact_id) VALUES (auth.uid(), target)
    ON CONFLICT DO NOTHING;
  RETURN target;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_group_conversation(_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE conv UUID; uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Yetkisiz'; END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN RAISE EXCEPTION 'Grup adı gerekli'; END IF;
  INSERT INTO public.conversations (is_group, group_name, created_by) VALUES (true, trim(_name), uid) RETURNING id INTO conv;
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (conv, uid);
  RETURN conv;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(_other_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  conv UUID;
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Yetkisiz'; END IF;
  IF _other_user_id = uid THEN RAISE EXCEPTION 'Kendinle sohbet açamazsın'; END IF;
  IF public.has_block_between(uid, _other_user_id) THEN
    RAISE EXCEPTION 'Bu kullanıcıyla sohbet başlatılamaz (engel mevcut).';
  END IF;
  SELECT c.id INTO conv FROM public.conversations c
  WHERE c.is_group = false
    AND EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = c.id AND user_id = uid)
    AND EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = c.id AND user_id = _other_user_id)
    AND (SELECT COUNT(*) FROM public.conversation_members WHERE conversation_id = c.id) = 2
  LIMIT 1;
  IF conv IS NOT NULL THEN RETURN conv; END IF;
  INSERT INTO public.conversations (is_group, created_by) VALUES (false, uid) RETURNING id INTO conv;
  -- INVOKER + new convmembers policy allows: self-join (uid) and creator-adds-other
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (conv, uid), (conv, _other_user_id);
  RETURN conv;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_group_member_by_number(_conversation_id uuid, _gever_number text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE target UUID; is_grp BOOLEAN; creator UUID;
BEGIN
  SELECT is_group, created_by INTO is_grp, creator FROM public.conversations WHERE id = _conversation_id;
  IF is_grp IS NULL THEN RAISE EXCEPTION 'Sohbet bulunamadı'; END IF;
  IF NOT is_grp THEN RAISE EXCEPTION 'Bu bir grup değil'; END IF;
  IF creator <> auth.uid() THEN RAISE EXCEPTION 'Sadece grup kurucusu üye ekleyebilir'; END IF;
  SELECT id INTO target FROM public.profiles WHERE gever_number = _gever_number;
  IF target IS NULL THEN RAISE EXCEPTION 'Kullanıcı bulunamadı'; END IF;
  IF public.has_block_between(target, auth.uid()) THEN RAISE EXCEPTION 'Bu kullanıcı eklenemez'; END IF;
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (_conversation_id, target) ON CONFLICT DO NOTHING;
  RETURN target;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_conversation_for_user(_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid UUID := auth.uid();
  total INT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Yetkisiz'; END IF;
  IF NOT public.is_member_of(_conversation_id, uid) THEN
    RAISE EXCEPTION 'Bu sohbetin üyesi değilsin';
  END IF;
  SELECT COUNT(*) INTO total FROM public.conversation_members
    WHERE conversation_id = _conversation_id;
  IF total <= 1 THEN
    -- Last member: clean up messages and the conversation while still a member
    DELETE FROM public.messages WHERE conversation_id = _conversation_id;
    DELETE FROM public.conversation_members
      WHERE conversation_id = _conversation_id AND user_id = uid;
    DELETE FROM public.conversations WHERE id = _conversation_id;
  ELSE
    DELETE FROM public.conversation_members
      WHERE conversation_id = _conversation_id AND user_id = uid;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_conversations()
 RETURNS TABLE(conversation_id uuid, is_group boolean, group_name text, group_avatar_url text, other_user_id uuid, other_display_name text, other_gever_number text, other_avatar_url text, last_message text, last_message_at timestamp with time zone, unread_count bigint)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH my AS (
    SELECT cm.conversation_id, cm.last_read_at FROM public.conversation_members cm WHERE cm.user_id = auth.uid()
  )
  SELECT c.id, c.is_group, c.group_name, c.group_avatar_url,
    other_p.id, other_p.display_name, other_p.gever_number, other_p.avatar_url,
    last_m.content, c.last_message_at,
    COALESCE((SELECT COUNT(*) FROM public.messages m
      WHERE m.conversation_id = c.id AND m.sender_id <> auth.uid() AND m.created_at > my.last_read_at), 0)
  FROM my
  JOIN public.conversations c ON c.id = my.conversation_id
  LEFT JOIN LATERAL (
    SELECT user_id FROM public.conversation_members
    WHERE conversation_id = c.id AND user_id <> auth.uid() LIMIT 1
  ) om ON NOT c.is_group
  LEFT JOIN public.profiles other_p ON other_p.id = om.user_id
  LEFT JOIN LATERAL (
    SELECT content FROM public.messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
  ) last_m ON true
  ORDER BY c.last_message_at DESC;
$function$;
