
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gever_number TEXT NOT NULL UNIQUE CHECK (gever_number ~ '^[0-9]{8}$'),
  display_name TEXT NOT NULL DEFAULT 'Kullanıcı',
  status_message TEXT,
  about TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_gever_number ON public.profiles(gever_number);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_any ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_insert_self ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.contacts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, contact_id),
  CHECK (user_id <> contact_id)
);
GRANT SELECT, INSERT, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_select_own ON public.contacts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY contacts_insert_own ON public.contacts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY contacts_delete_own ON public.contacts FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.blocks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id),
  CHECK (user_id <> blocked_id)
);
GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;
GRANT ALL ON public.blocks TO service_role;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY blocks_select_own ON public.blocks FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY blocks_insert_own ON public.blocks FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY blocks_delete_own ON public.blocks FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_block_between(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (user_id = _a AND blocked_id = _b)
       OR (user_id = _b AND blocked_id = _a)
  )
$$;

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN NOT NULL DEFAULT false,
  group_name TEXT,
  group_avatar_url TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_last_msg ON public.conversations(last_message_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.conversation_members (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_convmembers_user ON public.conversation_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_members TO authenticated;
GRANT ALL ON public.conversation_members TO service_role;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_member_of(_conv UUID, _user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conv AND user_id = _user
  )
$$;

CREATE POLICY convs_select_member ON public.conversations FOR SELECT TO authenticated
  USING (public.is_member_of(id, auth.uid()));

CREATE POLICY convmembers_select_in_my_convs ON public.conversation_members FOR SELECT TO authenticated
  USING (public.is_member_of(conversation_id, auth.uid()));
CREATE POLICY convmembers_update_self ON public.conversation_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY convmembers_delete_self ON public.conversation_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  read_by UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conv_created ON public.messages(conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select_member ON public.messages FOR SELECT TO authenticated
  USING (public.is_member_of(conversation_id, auth.uid()));
CREATE POLICY messages_insert_member ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_member_of(conversation_id, auth.uid()));
CREATE POLICY messages_update_read_by ON public.messages FOR UPDATE TO authenticated
  USING (public.is_member_of(conversation_id, auth.uid()))
  WITH CHECK (public.is_member_of(conversation_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_conversation_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  NEW.read_by := ARRAY[NEW.sender_id];
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_touch_conv BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_on_message();

CREATE OR REPLACE FUNCTION public.enforce_no_block_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_grp BOOLEAN;
  other UUID;
BEGIN
  SELECT is_group INTO is_grp FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT is_grp THEN
    SELECT user_id INTO other FROM public.conversation_members
      WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id LIMIT 1;
    IF other IS NOT NULL AND public.has_block_between(NEW.sender_id, other) THEN
      RAISE EXCEPTION 'Bu kullanıcıyla mesajlaşamazsın (engel mevcut).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_block_check BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_no_block_on_message();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  gnum TEXT;
  dname TEXT;
  attempts INT := 0;
BEGIN
  dname := COALESCE(NEW.raw_user_meta_data->>'display_name', 'Kullanıcı');
  gnum := NEW.raw_user_meta_data->>'gever_number';
  IF gnum IS NULL OR gnum !~ '^[0-9]{8}$' OR EXISTS (SELECT 1 FROM public.profiles WHERE gever_number = gnum) THEN
    LOOP
      attempts := attempts + 1;
      gnum := lpad((floor(random() * 90000000) + 10000000)::TEXT, 8, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE gever_number = gnum) OR attempts > 30;
    END LOOP;
  END IF;
  INSERT INTO public.profiles (id, gever_number, display_name) VALUES (NEW.id, gnum, dname);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.add_contact_by_number(_gever_number TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE ALL ON FUNCTION public.add_contact_by_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_contact_by_number(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_contact(_other_user_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.contacts WHERE user_id = auth.uid() AND contact_id = _other_user_id;
$$;
REVOKE ALL ON FUNCTION public.remove_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_contact(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_contacts()
RETURNS TABLE (contact_id UUID, display_name TEXT, gever_number TEXT, avatar_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.gever_number, p.avatar_url
  FROM public.contacts c JOIN public.profiles p ON p.id = c.contact_id
  WHERE c.user_id = auth.uid() ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.get_my_contacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_contacts() TO authenticated;

CREATE OR REPLACE FUNCTION public.block_user(_other_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _other_user_id = auth.uid() THEN RAISE EXCEPTION 'Kendini engelleyemezsin'; END IF;
  INSERT INTO public.blocks (user_id, blocked_id) VALUES (auth.uid(), _other_user_id)
    ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.block_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.unblock_user(_other_user_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.blocks WHERE user_id = auth.uid() AND blocked_id = _other_user_id;
$$;
REVOKE ALL ON FUNCTION public.unblock_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unblock_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_blocked()
RETURNS TABLE (blocked_id UUID, display_name TEXT, gever_number TEXT, avatar_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.gever_number, p.avatar_url
  FROM public.blocks b JOIN public.profiles p ON p.id = b.blocked_id
  WHERE b.user_id = auth.uid() ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.get_my_blocked() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_blocked() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(_other_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (conv, uid), (conv, _other_user_id);
  RETURN conv;
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_group_conversation(_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE conv UUID; uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Yetkisiz'; END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN RAISE EXCEPTION 'Grup adı gerekli'; END IF;
  INSERT INTO public.conversations (is_group, group_name, created_by) VALUES (true, trim(_name), uid) RETURNING id INTO conv;
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (conv, uid);
  RETURN conv;
END;
$$;
REVOKE ALL ON FUNCTION public.create_group_conversation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_group_conversation(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_group_member_by_number(_conversation_id UUID, _gever_number TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target UUID; is_grp BOOLEAN;
BEGIN
  IF NOT public.is_member_of(_conversation_id, auth.uid()) THEN RAISE EXCEPTION 'Bu grubun üyesi değilsin'; END IF;
  SELECT is_group INTO is_grp FROM public.conversations WHERE id = _conversation_id;
  IF NOT is_grp THEN RAISE EXCEPTION 'Bu bir grup değil'; END IF;
  SELECT id INTO target FROM public.profiles WHERE gever_number = _gever_number;
  IF target IS NULL THEN RAISE EXCEPTION 'Kullanıcı bulunamadı'; END IF;
  IF public.has_block_between(target, auth.uid()) THEN RAISE EXCEPTION 'Bu kullanıcı eklenemez'; END IF;
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (_conversation_id, target) ON CONFLICT DO NOTHING;
  RETURN target;
END;
$$;
REVOKE ALL ON FUNCTION public.add_group_member_by_number(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_group_member_by_number(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF NOT public.is_member_of(_conversation_id, uid) THEN RETURN; END IF;
  UPDATE public.conversation_members SET last_read_at = now()
    WHERE conversation_id = _conversation_id AND user_id = uid;
  UPDATE public.messages SET read_by = read_by || ARRAY[uid]
    WHERE conversation_id = _conversation_id AND NOT (uid = ANY(read_by));
END;
$$;
REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_conversations()
RETURNS TABLE (
  conversation_id UUID, is_group BOOLEAN, group_name TEXT, group_avatar_url TEXT,
  other_user_id UUID, other_display_name TEXT, other_gever_number TEXT, other_avatar_url TEXT,
  last_message TEXT, last_message_at TIMESTAMPTZ, unread_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE ALL ON FUNCTION public.get_my_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_conversations() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
