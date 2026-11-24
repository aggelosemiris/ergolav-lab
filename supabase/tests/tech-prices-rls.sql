-- Έλεγχος των «τιμών από τεχνικούς» (migration 20261125000000_tech_prices.sql): κανείς δεν διαβάζει τις μεμονωμένες τιμές·
-- φαίνονται μόνο διάμεσοι με ≥ 5 διαφορετικούς τεχνικούς και μόνο σε συνδεδεμένους· ακραίες εκτός· ανάκληση και διαγραφή
-- σβήνουν τα πάντα. Όλα σε μία συναλλαγή που ακυρώνεται (rollback). Επιτυχία = «TECH PRICES RLS OK». Αποτυχία = «FAIL: …».
begin;

-- Μυστικό ΜΟΝΟ για το τεστ (στο Supabase μπαίνει στο Vault από τον διαχειριστή· ποτέ στο repo).
insert into vault.secrets (name, secret) values ('tech_price_pepper', repeat('t', 64));
insert into auth.users (id, email, aud, role)
  select ('00000000-0000-4000-8000-00000000c00' || i)::uuid, 'tp' || i || '@example.invalid', 'authenticated', 'authenticated'
    from generate_series(1, 8) i;

create or replace function pg_temp.as_user(i int) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000c00' || i, 'role', 'authenticated')::text, true);
end $$;

-- ── Παραλλαγές: τις φορτώνει το service_role ──
set local role service_role;
insert into public.tech_price_keys (key, unit) values ('hollow|40×40', 'μ.'), ('k4|', 'τεμ.'), ('old|', 'τεμ.');
update public.tech_price_keys set active = false where key = 'old|';
reset role;

-- ── Χωρίς λογαριασμό: τίποτα ──
set local role anon;
do $$ begin
  begin perform 1 from public.tech_price_stats; raise exception 'FAIL: ο anon διαβάζει τις τιμές τεχνικών';
  exception when insufficient_privilege then null; end;
  begin perform public.submit_tech_price('hollow|40×40', 'μ.', 900); raise exception 'FAIL: ο anon έστειλε τιμή';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── Χωρίς συγκατάθεση: δεν μπαίνει τίποτα· άγνωστη περιφέρεια: λάθος ──
select pg_temp.as_user(1);
set local role authenticated;
do $$ begin
  if public.submit_tech_price('hollow|40×40', 'μ.', 900) <> 'no-consent' then raise exception 'FAIL: τιμή χωρίς συγκατάθεση'; end if;
  begin perform public.set_tech_prices_consent(true, 1, 'Αττική'); raise exception 'FAIL: δέχτηκε άγνωστη περιφέρεια';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ── 8 τεχνικοί δίνουν συγκατάθεση· 1–5 στην Αττική (GR-I), 6–7 χωρίς περιφέρεια, 8 Κρήτη ──
do $$ declare i int; begin
  for i in 1..8 loop
    perform pg_temp.as_user(i);
    set local role authenticated;
    perform public.set_tech_prices_consent(true, 1, case when i <= 5 then 'GR-I' when i = 8 then 'GR-M' end);
    reset role;
  end loop;
end $$;

-- ── Τιμές: 6 κανονικές + 1 ακραία (λάθος πληκτρολόγησης)· ο 1 αλλάζει την τιμή του (μετρά μία φορά) ──
do $$ declare i int; p int[] := array[900, 950, 1000, 1050, 1100, 1000, 90000]; r text; begin
  for i in 1..7 loop
    perform pg_temp.as_user(i);
    set local role authenticated;
    r := public.submit_tech_price('hollow|40×40', 'μ.', p[i]);
    if r <> 'ok' then raise exception 'FAIL: αποστολή % → %', i, r; end if;
    if i <= 4 then perform public.submit_tech_price('k4|', 'τεμ.', 500 + i); end if;
    reset role;
  end loop;
  perform pg_temp.as_user(1);
  set local role authenticated;
  if public.submit_tech_price('hollow|40×40', 'μ.', 920) <> 'ok' then raise exception 'FAIL: αλλαγή τιμής'; end if;
  if public.submit_tech_price('hollow|40×40', 'τεμ.', 900) <> 'unit-mismatch' then raise exception 'FAIL: άλλη μονάδα δεκτή'; end if;
  if public.submit_tech_price('nope|', 'τεμ.', 900) <> 'unknown-variant' then raise exception 'FAIL: άγνωστη παραλλαγή δεκτή'; end if;
  if public.submit_tech_price('old|', 'τεμ.', 900) <> 'unknown-variant' then raise exception 'FAIL: ανενεργή παραλλαγή δεκτή'; end if;
  if public.submit_tech_price('hollow|40×40', 'μ.', 0) <> 'bad-price' then raise exception 'FAIL: τιμή 0 δεκτή'; end if;
  reset role;
end $$;

-- ── Συνδεδεμένος χρήστης: ΚΑΜΙΑ πρόσβαση στις μεμονωμένες τιμές ──
select pg_temp.as_user(1);
set local role authenticated;
do $$ declare n int; begin
  begin perform 1 from public.tech_price_submissions; raise exception 'FAIL: ο χρήστης διάβασε μεμονωμένες τιμές';
  exception when insufficient_privilege then null; end;
  begin insert into public.tech_price_submissions (variant_key, price_cents, month, contributor)
          values ('hollow|40×40', 1, date_trunc('month', now()), decode(repeat('00', 32), 'hex'));
        raise exception 'FAIL: ο χρήστης έγραψε απευθείας τιμή';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.tech_price_rate; raise exception 'FAIL: ο χρήστης διάβασε τα όρια';
  exception when insufficient_privilege then null; end;
  begin insert into public.tech_price_stats (variant_key, region, median_cents, band, period_from, period_to)
          values ('hollow|40×40', 'GR', 1, '5-9', now(), now()); raise exception 'FAIL: ο χρήστης έγραψε αποτέλεσμα';
  exception when insufficient_privilege then null; end;
  begin perform public.refresh_tech_price_stats(); raise exception 'FAIL: ο χρήστης έτρεξε τον υπολογισμό';
  exception when insufficient_privilege then null; end;
  begin perform public.forget_tech_prices('00000000-0000-4000-8000-00000000c002'); raise exception 'FAIL: ο χρήστης έσβησε τιμές άλλου';
  exception when insufficient_privilege then null; end;
  begin perform public.tech_price_digest('00000000-0000-4000-8000-00000000c002', 'k4|'); raise exception 'FAIL: ο χρήστης υπολόγισε ψευδώνυμο';
  exception when insufficient_privilege then null; end;
  begin insert into public.tech_price_keys (key, unit) values ('x|', 'τεμ.'); raise exception 'FAIL: ο χρήστης πρόσθεσε παραλλαγή';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.tech_price_consent;
  if n <> 1 then raise exception 'FAIL: ο χρήστης βλέπει % συγκαταθέσεις (μόνο τη δική του)', n; end if;
end $$;
reset role;

-- ── Τι αποθηκεύτηκε (ως διαχειριστής): μία τιμή ανά τεχνικό, χωρίς user id, ψευδώνυμο 32 bytes ──
do $$ declare n int; begin
  select count(*) into n from public.tech_price_submissions where variant_key = 'hollow|40×40';
  if n <> 7 then raise exception 'FAIL: % τιμές αντί για 7 (μία ανά τεχνικό)', n; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tech_price_submissions'
               and column_name in ('user_id', 'client', 'quote_id', 'name', 'email')) then
    raise exception 'FAIL: προσωπικό πεδίο στις τιμές τεχνικών'; end if;
  if exists (select 1 from public.tech_price_submissions where position(convert_to('00000000-0000-4000-8000-00000000c00', 'UTF8') in contributor) > 0)
    then raise exception 'FAIL: το ψευδώνυμο περιέχει το user id'; end if;
  select count(distinct contributor) into n from public.tech_price_submissions where variant_key in ('hollow|40×40', 'k4|')
    and contributor in (select contributor from public.tech_price_submissions where variant_key = 'k4|');
  if n <> 4 then raise exception 'FAIL: ίδιο ψευδώνυμο σε διαφορετικές παραλλαγές'; end if;
end $$;

-- ── Υπολογισμός (service_role) ──
set local role service_role;
select public.refresh_tech_price_stats();
reset role;
do $$ declare s record; n int; begin
  select * into s from public.tech_price_stats where variant_key = 'hollow|40×40' and region = 'GR';
  if not found then raise exception 'FAIL: λείπει ο πανελλαδικός διάμεσος (6 τεχνικοί)'; end if;
  if s.median_cents <> 1000 or s.band <> '5-9' then raise exception 'FAIL: διάμεσος % / % (αναμενόταν 1000 / 5-9: η 900,00 € εκτός)', s.median_cents, s.band; end if;
  if not exists (select 1 from public.tech_price_stats where variant_key = 'hollow|40×40' and region = 'GR-I') then
    raise exception 'FAIL: λείπει ο διάμεσος Αττικής (5 τεχνικοί)'; end if;
  if exists (select 1 from public.tech_price_stats where region = 'GR-M') then raise exception 'FAIL: διάμεσος Κρήτης με 0 τεχνικούς'; end if;
  if exists (select 1 from public.tech_price_stats where variant_key = 'k4|') then raise exception 'FAIL: διάμεσος με 4 τεχνικούς'; end if;
  select count(*) into n from public.tech_price_stats;
  if n <> 2 then raise exception 'FAIL: % αποτελέσματα αντί για 2', n; end if;
end $$;

-- Συνδεδεμένος: βλέπει ΜΟΝΟ τα αποτελέσματα
select pg_temp.as_user(8);
set local role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.tech_price_stats;
  if n <> 2 then raise exception 'FAIL: ο χρήστης βλέπει % αποτελέσματα', n; end if;
end $$;
reset role;

-- ── Ανάκληση (τεχνικός 2): σβήνονται όλες οι τιμές του και η συγκατάθεση ──
select pg_temp.as_user(2);
set local role authenticated;
select public.set_tech_prices_consent(false, 1);
do $$ begin
  if exists (select 1 from public.tech_price_consent) then raise exception 'FAIL: η συγκατάθεση έμεινε μετά την ανάκληση'; end if;
  if public.submit_tech_price('hollow|40×40', 'μ.', 950) <> 'no-consent' then raise exception 'FAIL: αποστολή μετά την ανάκληση'; end if;
end $$;
reset role;
do $$ declare n int; begin
  select count(*) into n from public.tech_price_submissions;
  if n <> 9 then raise exception 'FAIL: μετά την ανάκληση % τιμές (αναμενόταν 9: 6 + 3)', n; end if;
end $$;
set local role service_role;
select public.refresh_tech_price_stats();
reset role;
do $$ begin
  if not exists (select 1 from public.tech_price_stats where region = 'GR') then raise exception 'FAIL: χάθηκε ο πανελλαδικός (5 τεχνικοί)'; end if;
  if exists (select 1 from public.tech_price_stats where region = 'GR-I') then raise exception 'FAIL: Αττική με 4 τεχνικούς'; end if;
end $$;

-- ── Διαγραφή λογαριασμού (τεχνικός 3, από το delete-account με service_role) ──
set local role service_role;
select public.forget_tech_prices('00000000-0000-4000-8000-00000000c003');
select public.refresh_tech_price_stats();
reset role;
do $$ declare n int; begin
  select count(*) into n from public.tech_price_stats;
  if n <> 0 then raise exception 'FAIL: % αποτελέσματα με < 5 τεχνικούς', n; end if;
  select count(*) into n from public.tech_price_consent where user_id = '00000000-0000-4000-8000-00000000c003';
  if n <> 0 then raise exception 'FAIL: η συγκατάθεση έμεινε μετά τη διαγραφή'; end if;
end $$;

-- ── Χωρίς μυστικό: καμία αποθήκευση ──
delete from vault.secrets where name = 'tech_price_pepper';
set local role service_role;
do $$ begin
  -- υπάρχουν ακόμη τιμές (τεχνικοί 1, 4–7) και λείπει το μυστικό → σφάλμα, όχι «διαγραφή» που αφήνει δεδομένα
  begin perform public.forget_tech_prices('00000000-0000-4000-8000-00000000c001'); raise exception 'FAIL: «σβήσιμο» χωρίς μυστικό';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
reset role;
select pg_temp.as_user(4);
set local role authenticated;
do $$ begin
  begin perform public.submit_tech_price('hollow|40×40', 'μ.', 1000); raise exception 'FAIL: αποθήκευση χωρίς μυστικό';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
reset role;

-- χωρίς μυστικό ΚΑΙ χωρίς καμία τιμή (π.χ. η migration έτρεξε, το μυστικό όχι ακόμα): η διαγραφή λογαριασμού δεν σπάει
delete from public.tech_price_submissions;
set local role service_role;
do $$ begin
  if public.forget_tech_prices('00000000-0000-4000-8000-00000000c008') <> 0 then raise exception 'FAIL: forget χωρίς τιμές'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.tech_price_consent where user_id = '00000000-0000-4000-8000-00000000c008') then
    raise exception 'FAIL: η συγκατάθεση έμεινε'; end if;
end $$;

rollback;
select 'TECH PRICES RLS OK';
