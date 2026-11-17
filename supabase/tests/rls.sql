-- Έλεγχος Row Level Security: ο χρήστης Α ΔΕΝ διαβάζει, δεν αλλάζει, δεν σβήνει το profile ή το λογότυπο του Β.
-- Τρέχει στο SQL editor του Supabase ΜΕΤΑ τη migration. Όλα γίνονται μέσα σε μία συναλλαγή που ακυρώνεται στο τέλος
-- (rollback): δεν μένει κανένας δοκιμαστικός χρήστης. Επιτυχία = τελευταία γραμμή «RLS OK». Αποτυχία = σφάλμα «FAIL: …».
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@example.invalid', 'authenticated', 'authenticated');

-- Ο trigger έφτιαξε άδεια γραμμή και για τους δύο
do $$ declare n int; begin
  select count(*) into n from public.profiles
   where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
  if n <> 2 then raise exception 'FAIL: ο trigger δεν έφτιαξε profile για κάθε νέο χρήστη (%)', n; end if;
end $$;

update public.profiles set business_name = 'Επιχείρηση Β', phone = '2100000000'
 where id = '00000000-0000-4000-8000-00000000000b';
insert into storage.objects (bucket_id, name) values ('logos', '00000000-0000-4000-8000-00000000000b/logo.jpg');

-- ── Ως χρήστης Α ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

do $$ declare n int; begin
  -- profiles
  select count(*) into n from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
  if n <> 0 then raise exception 'FAIL: ο Α διαβάζει το profile του Β'; end if;
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: ο Α βλέπει % γραμμές αντί για 1 (τη δική του)', n; end if;

  update public.profiles set business_name = 'hack' where id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: ο Α άλλαξε το profile του Β'; end if;

  begin
    delete from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
    get diagnostics n = row_count;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL: ο Α έσβησε το profile του Β'; end if;

  begin
    truncate public.profiles;
    raise exception 'FAIL: ο Α άδειασε τον πίνακα profiles (TRUNCATE)';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.profiles (id) values ('00000000-0000-4000-8000-00000000000c');
    raise exception 'FAIL: ο Α έφτιαξε profile με ξένο id';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;

  update public.profiles set business_name = 'Επιχείρηση Α' where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: ο Α δεν μπορεί να αλλάξει το δικό του profile'; end if;

  -- λογότυπο (storage)
  select count(*) into n from storage.objects
   where bucket_id = 'logos' and name like '00000000-0000-4000-8000-00000000000b/%';
  if n <> 0 then raise exception 'FAIL: ο Α βλέπει το λογότυπο του Β'; end if;

  update storage.objects set name = '00000000-0000-4000-8000-00000000000b/hack.jpg'
   where bucket_id = 'logos' and name = '00000000-0000-4000-8000-00000000000b/logo.jpg';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: ο Α άλλαξε το λογότυπο του Β'; end if;

  -- Το Supabase απαγορεύει κάθε απευθείας DELETE στο storage.objects (μόνο μέσω Storage API): άρνηση = σωστό.
  begin
    delete from storage.objects where bucket_id = 'logos' and name = '00000000-0000-4000-8000-00000000000b/logo.jpg';
    get diagnostics n = row_count;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL: ο Α έσβησε το λογότυπο του Β'; end if;

  begin
    insert into storage.objects (bucket_id, name) values ('logos', '00000000-0000-4000-8000-00000000000b/hack.jpg');
    raise exception 'FAIL: ο Α ανέβασε αρχείο στον φάκελο του Β';
  exception when insufficient_privilege then null;
  end;

  insert into storage.objects (bucket_id, name) values ('logos', '00000000-0000-4000-8000-00000000000a/logo.jpg');
  select count(*) into n from storage.objects where bucket_id = 'logos' and name like '00000000-0000-4000-8000-00000000000a/%';
  if n <> 1 then raise exception 'FAIL: ο Α δεν βλέπει το δικό του λογότυπο'; end if;
end $$;

-- ── Ανώνυμος (χωρίς σύνδεση) ──
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ declare n int; begin
  begin
    select count(*) into n from public.profiles;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL: ο ανώνυμος βλέπει profiles'; end if;
  select count(*) into n from storage.objects where bucket_id = 'logos';
  if n <> 0 then raise exception 'FAIL: ο ανώνυμος βλέπει λογότυπα'; end if;
end $$;

-- ── Ο Β έμεινε ανέπαφος ──
reset role;
do $$ declare b record; n int; begin
  select business_name, phone into b from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
  if b.business_name is distinct from 'Επιχείρηση Β' then raise exception 'FAIL: το profile του Β άλλαξε'; end if;
  select count(*) into n from storage.objects where bucket_id = 'logos' and name = '00000000-0000-4000-8000-00000000000b/logo.jpg';
  if n <> 1 then raise exception 'FAIL: το λογότυπο του Β χάθηκε'; end if;
  -- Διαγραφή χρήστη → φεύγει και το profile του (cascade)
  delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
  select count(*) into n from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
  if n <> 0 then raise exception 'FAIL: η διαγραφή χρήστη δεν έσβησε το profile του'; end if;
end $$;

select 'RLS OK' as result;
rollback;
