
-- Move SECURITY DEFINER helper functions out of the public API schema
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_member_of(_conv uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = _conv AND user_id = _user)
$$;

CREATE OR REPLACE FUNCTION private.has_block_between(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (user_id = _a AND blocked_id = _b) OR (user_id = _b AND blocked_id = _a)
  )
$$;

REVOKE ALL ON FUNCTION private.is_member_of(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_block_between(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_member_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_block_between(uuid, uuid) TO authenticated;

-- Recreate policies to reference private schema functions
DROP POLICY IF EXISTS convs_select_member ON public.conversations;
CREATE POLICY convs_select_member ON public.conversations FOR SELECT TO authenticated
  USING (private.is_member_of(id, auth.uid()));

DROP POLICY IF EXISTS convs_delete_creator_or_member ON public.conversations;
CREATE POLICY convs_delete_creator_or_member ON public.conversations FOR DELETE TO authenticated
  USING ((created_by = auth.uid()) OR private.is_member_of(id, auth.uid()));

DROP POLICY IF EXISTS convmembers_select_in_my_convs ON public.conversation_members;
CREATE POLICY convmembers_select_in_my_convs ON public.conversation_members FOR SELECT TO authenticated
  USING (private.is_member_of(conversation_id, auth.uid()));

DROP POLICY IF EXISTS messages_select_member ON public.messages;
CREATE POLICY messages_select_member ON public.messages FOR SELECT TO authenticated
  USING (private.is_member_of(conversation_id, auth.uid()));

DROP POLICY IF EXISTS messages_insert_member ON public.messages;
CREATE POLICY messages_insert_member ON public.messages FOR INSERT TO authenticated
  WITH CHECK ((sender_id = auth.uid()) AND private.is_member_of(conversation_id, auth.uid()));

DROP POLICY IF EXISTS messages_delete_member ON public.messages;
CREATE POLICY messages_delete_member ON public.messages FOR DELETE TO authenticated
  USING (private.is_member_of(conversation_id, auth.uid()));

DROP POLICY IF EXISTS messages_update_read_by ON public.messages;
CREATE POLICY messages_update_read_by ON public.messages FOR UPDATE TO authenticated
  USING (private.is_member_of(conversation_id, auth.uid()))
  WITH CHECK (
    private.is_member_of(conversation_id, auth.uid())
    AND (sender_id = (SELECT m.sender_id FROM public.messages m WHERE m.id = messages.id))
    AND (NOT (content IS DISTINCT FROM (SELECT m.content FROM public.messages m WHERE m.id = messages.id)))
    AND (NOT (attachment_url IS DISTINCT FROM (SELECT m.attachment_url FROM public.messages m WHERE m.id = messages.id)))
  );

DROP POLICY IF EXISTS chat_att_select_members ON storage.objects;
CREATE POLICY chat_att_select_members ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-attachments' AND private.is_member_of(((storage.foldername(name))[1])::uuid, auth.uid()));

DROP POLICY IF EXISTS chat_att_insert_members ON storage.objects;
CREATE POLICY chat_att_insert_members ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND owner = auth.uid()
    AND private.is_member_of(((storage.foldername(name))[1])::uuid, auth.uid())
    AND ((storage.foldername(name))[2])::uuid = auth.uid()
  );

-- Update functions that referenced public.is_member_of / has_block_between
CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF NOT private.is_member_of(_conversation_id, uid) THEN RETURN; END IF;
  UPDATE public.conversation_members SET last_read_at = now()
    WHERE conversation_id = _conversation_id AND user_id = uid;
  UPDATE public.messages SET read_by = read_by || ARRAY[uid]
    WHERE conversation_id = _conversation_id AND NOT (uid = ANY(read_by));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_conversation_for_user(_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); total INT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Yetkisiz'; END IF;
  IF NOT private.is_member_of(_conversation_id, uid) THEN
    RAISE EXCEPTION 'Bu sohbetin üyesi değilsin';
  END IF;
  SELECT COUNT(*) INTO total FROM public.conversation_members WHERE conversation_id = _conversation_id;
  IF total <= 1 THEN
    DELETE FROM public.messages WHERE conversation_id = _conversation_id;
    DELETE FROM public.conversation_members WHERE conversation_id = _conversation_id AND user_id = uid;
    DELETE FROM public.conversations WHERE id = _conversation_id;
  ELSE
    DELETE FROM public.conversation_members WHERE conversation_id = _conversation_id AND user_id = uid;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_no_block_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_grp BOOLEAN; other UUID;
BEGIN
  SELECT is_group INTO is_grp FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT is_grp THEN
    SELECT user_id INTO other FROM public.conversation_members
      WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id LIMIT 1;
    IF other IS NOT NULL AND private.has_block_between(NEW.sender_id, other) THEN
      RAISE EXCEPTION 'Bu kullanıcıyla mesajlaşamazsın (engel mevcut).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_group_member_by_number(_conversation_id uuid, _gever_number text)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE target UUID; is_grp BOOLEAN; creator UUID;
BEGIN
  SELECT is_group, created_by INTO is_grp, creator FROM public.conversations WHERE id = _conversation_id;
  IF is_grp IS NULL THEN RAISE EXCEPTION 'Sohbet bulunamadı'; END IF;
  IF NOT is_grp THEN RAISE EXCEPTION 'Bu bir grup değil'; END IF;
  IF creator <> auth.uid() THEN RAISE EXCEPTION 'Sadece grup kurucusu üye ekleyebilir'; END IF;
  SELECT id INTO target FROM public.profiles WHERE gever_number = _gever_number;
  IF target IS NULL THEN RAISE EXCEPTION 'Kullanıcı bulunamadı'; END IF;
  IF private.has_block_between(target, auth.uid()) THEN RAISE EXCEPTION 'Bu kullanıcı eklenemez'; END IF;
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (_conversation_id, target) ON CONFLICT DO NOTHING;
  RETURN target;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(_other_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE conv UUID; uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Yetkisiz'; END IF;
  IF _other_user_id = uid THEN RAISE EXCEPTION 'Kendinle sohbet açamazsın'; END IF;
  IF private.has_block_between(uid, _other_user_id) THEN
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
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (conv, uid), (conv, _other_user_id);
  RETURN conv;
END;
$$;

-- Drop the now-unused public SECURITY DEFINER helpers
DROP FUNCTION IF EXISTS public.is_member_of(uuid, uuid);
DROP FUNCTION IF EXISTS public.has_block_between(uuid, uuid);
