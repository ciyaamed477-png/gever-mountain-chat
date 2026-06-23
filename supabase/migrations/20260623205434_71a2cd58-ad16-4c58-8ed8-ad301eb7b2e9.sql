
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

-- Auto-confirm synthetic gever_*@gever.app emails (no real inbox exists)
CREATE OR REPLACE FUNCTION public.auto_confirm_gever_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email LIKE 'gever_%@gever.app' THEN
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_auto_confirm_gever ON auth.users;
CREATE TRIGGER trg_auto_confirm_gever BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_gever_email();
