-- Έλεγχος του πίνακα quotes (Φάση 3): ο χρήστης Α ΔΕΝ διαβάζει, δεν αλλάζει, δεν σβήνει και δεν «κλέβει» γραμμές του Β·
-- κανείς δεν σβήνει γραμμές από την εφαρμογή (μόνο deleted_at)· νεότερο updated_at κερδίζει· καθάρισμα μετά από 30 μέρες.
-- Όλα σε μία συναλλαγή που ακυρώνεται (rollback). Επιτυχία = «QUOTES RLS OK». Αποτυχία = σφάλμα «FAIL: …».
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'quotes-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'quotes-b@example.invalid', 'authenticated', 'authenticated');

-- ── Ως Β: δύο προσφορές του ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
insert into public.quotes (id, user_id, data, updated_at) values
  ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', '{"no":1,"client":"Πελάτης Β"}', '2026-11-20T10:00:00Z'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000b', '{"no":2,"client":"Άλλος Β"}', '2026-11-20T10:00:00Z');
reset role;

-- ── Ως Α ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
do $$ declare n int; r record; begin
  -- δεν διαβάζει
  select count(*) into n from public.quotes;
  if n <> 0 then raise exception 'FAIL: ο Α βλέπει % γραμμές του Β', n; end if;
  -- δεν αλλάζει
  update public.quotes set data = '{"no":1,"client":"hack"}', updated_at = now() where user_id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: ο Α άλλαξε γραμμή του Β'; end if;
  -- δεν σβήνει (ούτε του Β, ούτε τις δικές του: καμία διαγραφή από την εφαρμογή)
  begin
    delete from public.quotes where id = 'bbbbbbbb-0000-4000-8000-000000000001';
    raise exception 'FAIL: ο Α μπορεί να εκτελέσει DELETE';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.quotes;
    raise exception 'FAIL: ο Α άδειασε τον πίνακα (TRUNCATE)';
  exception when insufficient_privilege then null;
  end;
  -- δεν γράφει γραμμή στο όνομα του Β
  begin
    insert into public.quotes (id, user_id, data, updated_at)
      values ('aaaaaaaa-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-00000000000b', '{"no":9}', now());
    raise exception 'FAIL: ο Α έγραψε γραμμή με user_id του Β';
  exception when insufficient_privilege then null;
  end;
  -- δεν «κλέβει» γραμμή του Β με το id της (upsert)
  begin
    insert into public.quotes (id, user_id, data, updated_at)
      values ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', '{"no":1,"client":"hack"}', now())
      on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
    raise exception 'FAIL: ο Α πήρε γραμμή του Β με upsert';
  exception when insufficient_privilege or unique_violation then null;
  end;

  -- οι δικές του: γράφει, αλλάζει με νεότερη ώρα, η παλιότερη αγνοείται, δεν αλλάζει ιδιοκτήτη
  insert into public.quotes (id, user_id, data, updated_at)
    values ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', '{"no":1,"status":"sent"}', '2026-11-21T10:00:00Z');
  update public.quotes set data = '{"no":1,"status":"won"}', updated_at = '2026-11-22T10:00:00Z' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  update public.quotes set data = '{"no":1,"status":"lost"}', updated_at = '2026-11-21T12:00:00Z' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  select data ->> 'status' s, updated_at into r from public.quotes where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if r.s <> 'won' then raise exception 'FAIL: η παλιότερη αλλαγή νίκησε τη νεότερη (%)', r.s; end if;
  begin
    update public.quotes set user_id = '00000000-0000-4000-8000-00000000000b', updated_at = '2026-11-23T10:00:00Z'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: ο Α έδωσε γραμμή του στον Β';
  exception when insufficient_privilege then null;
  end;
  -- ώρα κινητού στο μέλλον: δεν μένει «για πάντα νεότερη»
  update public.quotes set data = '{"no":1,"status":"won"}', updated_at = now() + interval '1 year' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  select updated_at into r from public.quotes where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if r.updated_at > now() + interval '1 day' then raise exception 'FAIL: updated_at στο μέλλον έγινε δεκτό'; end if;
  -- σβήσιμο = deleted_at, χωρίς το περιεχόμενο
  begin
    update public.quotes set deleted_at = now(), updated_at = now() + interval '1 hour' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: σβησμένη γραμμή κράτησε το περιεχόμενο (στοιχεία πελάτη)';
  exception when check_violation then null;
  end;
  update public.quotes set deleted_at = now(), data = null, updated_at = now() + interval '1 hour' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  select count(*) into n from public.quotes where deleted_at is not null;
  if n <> 1 then raise exception 'FAIL: το σβήσιμο με deleted_at δεν δούλεψε'; end if;
  -- καθάρισμα: μόνο ο server, όχι η εφαρμογή
  begin
    perform public.purge_deleted_quotes();
    raise exception 'FAIL: η εφαρμογή εκτελεί το καθάρισμα';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── Ανώνυμος: τίποτα ──
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ declare n int; begin
  begin
    select count(*) into n from public.quotes;
    raise exception 'FAIL: ο ανώνυμος διαβάζει quotes';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.quotes (id, user_id, data, updated_at) values (gen_random_uuid(), '00000000-0000-4000-8000-00000000000b', '{}', now());
    raise exception 'FAIL: ο ανώνυμος γράφει quotes';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── Ο Β έμεινε ανέπαφος· καθάρισμα μετά από 30 μέρες· διαγραφή λογαριασμού ──
do $$ declare n int; c text; begin
  select data ->> 'client' into c from public.quotes where id = 'bbbbbbbb-0000-4000-8000-000000000001';
  if c is distinct from 'Πελάτης Β' then raise exception 'FAIL: η γραμμή του Β άλλαξε (%)', c; end if;
  update public.quotes set deleted_at = now() - interval '31 days', data = null, updated_at = now()
   where id = 'bbbbbbbb-0000-4000-8000-000000000002';
  update public.quotes set deleted_at = now() - interval '29 days', updated_at = now() + interval '2 hours'
   where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if public.purge_deleted_quotes() <> 1 then raise exception 'FAIL: το καθάρισμα δεν έσβησε ακριβώς τη σβησμένη πάνω από 30 μέρες'; end if;
  select count(*) into n from public.quotes where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL: το καθάρισμα έσβησε σβησμένη μόλις 29 ημερών'; end if;
end $$;

-- service_role (delete-account): σβήνει τις γραμμές ενός χρήστη· και η διαγραφή χρήστη τις παίρνει μαζί (cascade)
set local role service_role;
do $$ declare n int; begin
  delete from public.quotes where user_id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: το service_role δεν έσβησε τις γραμμές του Α (%)', n; end if;
end $$;
reset role;
do $$ declare n int; begin
  delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
  select count(*) into n from public.quotes where user_id = '00000000-0000-4000-8000-00000000000b';
  if n <> 0 then raise exception 'FAIL: η διαγραφή χρήστη δεν πήρε μαζί τις προσφορές του'; end if;
end $$;

select 'QUOTES RLS OK' as result;
rollback;
