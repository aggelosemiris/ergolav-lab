-- ergolav — «Τιμές από τεχνικούς» (σχέδιο: docs/technician-prices.md). Ξανατρέξιμο.
-- Τρέχει στο SQL editor της Supabase ΜΕΤΑ τις προηγούμενες, ΜΟΝΟ από τον Άγγελο και μετά από review.
-- ΠΡΙΝ από τη χρήση: το μυστικό «tech_price_pepper» στο Vault (βήματα: docs/technician-prices.md, «Εγκατάσταση»). Η τιμή του
-- ΔΕΝ γράφεται ποτέ εδώ ή στο repo. Χωρίς αυτό η αποστολή αρνείται (σφάλμα 55000) — τίποτα δεν αποθηκεύεται χωρίς ψευδώνυμο.
--
-- Αρχές:
-- - Καταγράφεται ΜΟΝΟ: παραλλαγή της λίστας υλικών, τιμή ανά μονάδα, μήνας (ώρα του server), περιφέρεια (μόνο αν τη δώσει).
--   Ποτέ πελάτης, όνομα, προσφορά ή user id. Ο τεχνικός είναι ένα ψευδώνυμο: HMAC-SHA256(μυστικό, user_id ‖ παραλλαγή),
--   διαφορετικό σε κάθε παραλλαγή (δεν συνδέονται οι τιμές του ίδιου σε διαφορετικά υλικά).
-- - Οι μεμονωμένες τιμές ΔΕΝ διαβάζονται από κανέναν (RLS χωρίς πολιτικές, χωρίς GRANT). Γράφονται ΜΟΝΟ από τη συνάρτηση
--   submit_tech_price, με ρητή συγκατάθεση. Φαίνεται μόνο ο διάμεσος με ≥ 5 διαφορετικούς τεχνικούς (tech_price_stats),
--   μόνο σε συνδεδεμένους χρήστες, με το πλήθος σε κλίμακα (5–9 / 10–19 / 20+).
-- - Ανάκληση της συγκατάθεσης ή διαγραφή λογαριασμού → σβήνονται όλες οι τιμές του τεχνικού.
-- - Σε αυτό το project ό,τι φτιάχνει ο postgres δεν δίνει αυτόματα δικαιώματα: όλα τα GRANT είναι ρητά εδώ.

-- ── Πίνακες ──
-- Οι επιτρεπτές παραλλαγές (από το data/materials.json· τις φορτώνει το supabase/seed/tech-price-keys.sql).
create table if not exists public.tech_price_keys (
  key        text primary key check (length(key) between 3 and 200),
  unit       text not null check (length(unit) between 1 and 20),
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Οι 13 περιφέρειες (ISO 3166-2:GR, GR-A … GR-M).
create or replace function public.tech_price_region_ok(r text) returns boolean
language sql immutable set search_path = '' as $$
  select r is null or r = any (array['GR-A','GR-B','GR-C','GR-D','GR-E','GR-F','GR-G','GR-H','GR-I','GR-J','GR-K','GR-L','GR-M'])
$$;

-- Συγκατάθεση (opt-in). Υπάρχει γραμμή ΜΟΝΟ όσο ισχύει η συγκατάθεση· η ανάκληση τη σβήνει.
create table if not exists public.tech_price_consent (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  version      integer not null check (version between 1 and 1000),
  region       text check (public.tech_price_region_ok(region)),
  consented_at timestamptz not null default now()
);

-- Οι μεμονωμένες τιμές. ΚΑΝΕΝΑ user_id: μόνο το ψευδώνυμο (contributor).
create table if not exists public.tech_price_submissions (
  id          bigint generated always as identity primary key,
  variant_key text not null references public.tech_price_keys (key) on delete cascade,
  price_cents integer not null check (price_cents between 1 and 100000000),
  month       date not null check (extract(day from month) = 1),
  region      text check (public.tech_price_region_ok(region)),
  contributor bytea not null check (length(contributor) = 32),
  created_at  timestamptz not null default now(),
  unique (contributor, variant_key, month)              -- μία τιμή ανά τεχνικό, παραλλαγή και μήνα (η νεότερη)
);
create index if not exists tech_price_submissions_key_month on public.tech_price_submissions (variant_key, month);

-- Όριο αποστολών ανά ημέρα (ψευδώνυμο ξεχωριστό από αυτό των τιμών).
create table if not exists public.tech_price_rate (
  digest bytea not null check (length(digest) = 32),
  day    date not null,
  n      integer not null default 0,
  primary key (digest, day)
);

-- Το αποτέλεσμα: διάμεσος ανά παραλλαγή, πανελλαδικά (region = 'GR') και ανά περιφέρεια. Μόνο ≥ 5 τεχνικοί.
create table if not exists public.tech_price_stats (
  variant_key  text not null references public.tech_price_keys (key) on delete cascade,
  region       text not null check (region = 'GR' or public.tech_price_region_ok(region)),
  median_cents integer not null check (median_cents > 0),
  band         text not null check (band in ('5-9', '10-19', '20+')),
  period_from  date not null,
  period_to    date not null,
  computed_at  timestamptz not null default now(),
  primary key (variant_key, region)
);

-- ── Ψευδώνυμο (μόνο μέσα στη βάση· κανείς δεν το καλεί απευθείας) ──
create or replace function public.tech_price_digest(p_uid uuid, p_key text)
returns bytea language plpgsql stable security definer set search_path = '' as $$
declare pepper text;
begin
  select decrypted_secret into pepper from vault.decrypted_secrets where name = 'tech_price_pepper' limit 1;
  if pepper is null or length(pepper) < 32 then
    raise exception 'tech_price_pepper: λείπει το μυστικό στο Vault (docs/technician-prices.md)' using errcode = '55000';
  end if;
  return extensions.hmac(convert_to(p_uid::text || '|' || p_key, 'UTF8'), convert_to(pepper, 'UTF8'), 'sha256');
end $$;

-- ── Σβήσιμο όλων των τιμών ενός τεχνικού (διαγραφή λογαριασμού, ανάκληση συγκατάθεσης) ──
create or replace function public.forget_tech_prices(p_uid uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_uid is null then return 0; end if;
  -- Χωρίς μυστικό δεν μπορεί να έχει αποθηκευτεί καμία τιμή (η αποστολή αρνείται): τότε μόνο η συγκατάθεση. Αν όμως
  -- υπάρχουν τιμές και λείπει το μυστικό, σφάλμα — ποτέ «διαγραφή» που αφήνει δεδομένα πίσω.
  if not exists (select 1 from vault.decrypted_secrets where name = 'tech_price_pepper') then
    if exists (select 1 from public.tech_price_submissions) then
      raise exception 'tech_price_pepper: λείπει το μυστικό, δεν σβήνονται οι τιμές' using errcode = '55000';
    end if;
    delete from public.tech_price_consent where user_id = p_uid;
    return 0;
  end if;
  -- ένα ψευδώνυμο ανά παραλλαγή (~1.800 HMAC), μετά σβήσιμο με το ζεύγος (παραλλαγή, ψευδώνυμο)
  delete from public.tech_price_submissions
    where (variant_key, contributor) in (select k.key, public.tech_price_digest(p_uid, k.key) from public.tech_price_keys k);
  get diagnostics n = row_count;
  delete from public.tech_price_rate where digest = public.tech_price_digest(p_uid, '#rate');
  delete from public.tech_price_consent where user_id = p_uid;
  return n;
end $$;

-- ── Συγκατάθεση: ναι (με έκδοση κειμένου και προαιρετική περιφέρεια) ή ανάκληση (= σβήσιμο όλων) ──
create or replace function public.set_tech_prices_consent(p_consent boolean, p_version integer, p_region text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'tech prices: not signed in' using errcode = '42501'; end if;
  if p_consent is not true then return public.forget_tech_prices(uid); end if;
  if not public.tech_price_region_ok(p_region) then raise exception 'tech prices: unknown region' using errcode = '22023'; end if;
  insert into public.tech_price_consent (user_id, version, region, consented_at) values (uid, p_version, p_region, now())
    on conflict (user_id) do update set version = excluded.version, region = excluded.region, consented_at = now();
  return 0;
end $$;

-- ── Αποστολή μιας τιμής. Επιστρέφει 'ok' ή τον λόγο που δεν μπήκε (χωρίς να αποκαλύπτει τίποτα άλλο). ──
create or replace function public.submit_tech_price(p_key text, p_unit text, p_price_cents integer)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c record; k record; used integer;
begin
  if uid is null then raise exception 'tech prices: not signed in' using errcode = '42501'; end if;
  select version, region into c from public.tech_price_consent where user_id = uid;
  if not found then return 'no-consent'; end if;
  select unit, active into k from public.tech_price_keys where key = p_key;
  if not found or not k.active then return 'unknown-variant'; end if;
  if k.unit is distinct from p_unit then return 'unit-mismatch'; end if;
  if p_price_cents is null or p_price_cents < 1 or p_price_cents > 100000000 then return 'bad-price'; end if;
  insert into public.tech_price_rate as t (digest, day, n) values (public.tech_price_digest(uid, '#rate'), current_date, 1)
    on conflict (digest, day) do update set n = t.n + 1 returning t.n into used;
  if used > 300 then return 'rate-limited'; end if;
  insert into public.tech_price_submissions (variant_key, price_cents, month, region, contributor)
    values (p_key, p_price_cents, date_trunc('month', now())::date, c.region, public.tech_price_digest(uid, p_key))
    on conflict (contributor, variant_key, month)
    do update set price_cents = excluded.price_cents, region = excluded.region, created_at = now();
  return 'ok';
end $$;

-- ── Εβδομαδιαίος υπολογισμός: διάμεσος 6 μηνών, χωρίς ακραίες, μόνο με ≥ 5 τεχνικούς ──
create or replace function public.refresh_tech_price_stats()
returns integer language plpgsql security definer set search_path = '' as $$
declare cnt integer; since date := (date_trunc('month', now()) - interval '5 months')::date;
begin
  -- Διατήρηση: οι μεμονωμένες τιμές 12 μήνες, τα όρια αποστολών 2 ημέρες.
  delete from public.tech_price_submissions where month < (date_trunc('month', now()) - interval '12 months')::date;
  delete from public.tech_price_rate where day < current_date - 2;
  delete from public.tech_price_stats;
  with win as (           -- από κάθε τεχνικό, η πιο πρόσφατη τιμή του στο παράθυρο
    select distinct on (contributor, variant_key) variant_key, contributor, region, price_cents
      from public.tech_price_submissions where month >= since
      order by contributor, variant_key, month desc, created_at desc
  ), grp as (             -- πανελλαδικά + ανά περιφέρεια
    select variant_key, 'GR'::text as region, contributor, price_cents from win
    union all select variant_key, region, contributor, price_cents from win where region is not null
  ), q as (
    select variant_key, region,
           percentile_cont(0.25) within group (order by price_cents) as q1,
           percentile_cont(0.5)  within group (order by price_cents) as med,
           percentile_cont(0.75) within group (order by price_cents) as q3
      from grp group by variant_key, region
  ), kept as (            -- εκτός: έξω από [Q1 − 1,5·IQR, Q3 + 1,5·IQR] ή > ×3 από τον διάμεσο
    select g.variant_key, g.region, g.contributor, g.price_cents
      from grp g join q on q.variant_key = g.variant_key and q.region = g.region
     where g.price_cents between q.q1 - 1.5 * (q.q3 - q.q1) and q.q3 + 1.5 * (q.q3 - q.q1)
       and g.price_cents * 3 >= q.med and g.price_cents <= q.med * 3
  ), agg as (
    select variant_key, region, count(distinct contributor) as n,
           round(percentile_cont(0.5) within group (order by price_cents))::integer as med
      from kept group by variant_key, region
  )
  insert into public.tech_price_stats (variant_key, region, median_cents, band, period_from, period_to, computed_at)
    select variant_key, region, med, case when n >= 20 then '20+' when n >= 10 then '10-19' else '5-9' end,
           since, date_trunc('month', now())::date, now()
      from agg where n >= 5;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ── Δικαιώματα ──
alter table public.tech_price_keys enable row level security;
alter table public.tech_price_consent enable row level security;
alter table public.tech_price_submissions enable row level security;
alter table public.tech_price_rate enable row level security;
alter table public.tech_price_stats enable row level security;

revoke all on public.tech_price_keys, public.tech_price_consent, public.tech_price_submissions, public.tech_price_rate,
  public.tech_price_stats from anon, authenticated, service_role;
-- Μεμονωμένες τιμές και όρια: ΚΑΝΕΝΑ δικαίωμα σε κανέναν ρόλο της εφαρμογής (μόνο οι συναρτήσεις, ως ιδιοκτήτης).
-- Παραλλαγές: τις φορτώνει ο διαχειριστής (SQL editor) ή το service_role.
grant select, insert, update on public.tech_price_keys to service_role;
-- Συγκατάθεση: ο χρήστης βλέπει ΜΟΝΟ τη δική του· αλλάζει μόνο μέσω set_tech_prices_consent.
grant select on public.tech_price_consent to authenticated;
drop policy if exists "tech_price_consent: read own" on public.tech_price_consent;
create policy "tech_price_consent: read own" on public.tech_price_consent for select to authenticated
  using (user_id = (select auth.uid()));
-- Αποτέλεσμα: μόνο συνδεδεμένοι (όχι anon).
grant select on public.tech_price_stats to authenticated;
drop policy if exists "tech_price_stats: read" on public.tech_price_stats;
create policy "tech_price_stats: read" on public.tech_price_stats for select to authenticated using (true);

revoke all on function public.tech_price_digest(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.tech_price_region_ok(text) from public, anon;
grant execute on function public.tech_price_region_ok(text) to authenticated, service_role;
revoke all on function public.forget_tech_prices(uuid) from public, anon, authenticated;
grant execute on function public.forget_tech_prices(uuid) to service_role;           -- Edge Function delete-account
revoke all on function public.set_tech_prices_consent(boolean, integer, text) from public, anon;
grant execute on function public.set_tech_prices_consent(boolean, integer, text) to authenticated;
revoke all on function public.submit_tech_price(text, text, integer) from public, anon;
grant execute on function public.submit_tech_price(text, text, integer) to authenticated;
revoke all on function public.refresh_tech_price_stats() from public, anon, authenticated;
grant execute on function public.refresh_tech_price_stats() to service_role;

-- ── Υπολογισμός κάθε Δευτέρα 02:41 UTC (αν υπάρχει το pg_cron· αλλιώς χειροκίνητα: select public.refresh_tech_price_stats();) ──
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ergolav-tech-price-stats';
    perform cron.schedule('ergolav-tech-price-stats', '41 2 * * 1', 'select public.refresh_tech_price_stats()');
  else
    raise notice 'pg_cron δεν είναι ενεργό: ο υπολογισμός των τιμών τεχνικών γίνεται χειροκίνητα (docs/technician-prices.md)';
  end if;
end $$;
