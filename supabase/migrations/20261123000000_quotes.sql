-- ergolav — Φάση 3: οι προσφορές στον λογαριασμό (συγχρονισμός μεταξύ κινητών). Βλ. docs/sync.md.
-- Τρέχει στο SQL editor της Supabase ΜΕΤΑ τις προηγούμενες, ΜΟΝΟ από τον Άγγελο και μετά από review. Ξανατρέξιμο.
--
-- Αρχές:
-- - id = το uuid της προσφοράς (σταθερό· το ίδιο και στη Φάση 4). Ο αριθμός (no) είναι μέσα στο data.
-- - Κάθε χρήστης βλέπει και γράφει ΜΟΝΟ τις δικές του γραμμές (RLS από την αρχή). Καμία διαγραφή από την εφαρμογή:
--   το σβήσιμο είναι deleted_at (ώστε να το μάθουν και τα άλλα κινητά). Οι σβησμένες καθαρίζονται μετά από 30 μέρες.
-- - Σύγκρουση: κερδίζει το νεότερο updated_at. Το φράζει ο server (trigger), όχι μόνο ο κώδικας της εφαρμογής.
-- - synced_at: πότε το είδε ο server (ώρα του server, όχι του κινητού). Με αυτό ζητά η εφαρμογή «τι άλλαξε από τότε».
-- - Σε αυτό το project ό,τι φτιάχνει ο postgres δεν δίνει αυτόματα δικαιώματα: όλα τα GRANT είναι ρητά εδώ.

create table if not exists public.quotes (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  data       jsonb,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at  timestamptz not null default clock_timestamp(),
  -- ζωντανή προσφορά = αντικείμενο· σβησμένη = χωρίς περιεχόμενο (δεν κρατάμε στοιχεία πελάτη που σβήστηκαν)
  constraint quotes_data_shape check (
    (deleted_at is null and data is not null and jsonb_typeof(data) = 'object' and pg_column_size(data) <= 60000)
    or (deleted_at is not null and data is null))
);
create index if not exists quotes_user_updated on public.quotes (user_id, updated_at);
create index if not exists quotes_user_synced on public.quotes (user_id, synced_at);
create index if not exists quotes_deleted on public.quotes (deleted_at) where deleted_at is not null;

-- ── Ακεραιότητα: νεότερο κερδίζει, ο ιδιοκτήτης δεν αλλάζει, ώρα από τον server ──
create or replace function public.quotes_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Ώρα κινητού πολύ στο μέλλον (λάθος ρολόι): δεν αφήνουμε μια γραμμή να «κερδίζει» για πάντα.
  if new.updated_at > now() + interval '1 day' then new.updated_at := now(); end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.id is distinct from old.id then
      raise exception 'quotes: id and owner never change' using errcode = '42501';
    end if;
    -- Παλιότερη (ή ίδια) αλλαγή: αγνοείται σιωπηλά — η γραμμή μένει όπως ήταν.
    if new.updated_at <= old.updated_at then return null; end if;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists quotes_guard on public.quotes;
create trigger quotes_guard before insert or update on public.quotes
  for each row execute function public.quotes_guard();

-- ── Δικαιώματα ──
alter table public.quotes enable row level security;
revoke all on public.quotes from anon;
revoke all on public.quotes from authenticated;
revoke all on public.quotes from service_role;
grant select, insert, update on public.quotes to authenticated;
-- service_role: μόνο η διαγραφή λογαριασμού (delete-account) και το καθάρισμα των σβησμένων.
grant select, delete on public.quotes to service_role;
revoke all on function public.quotes_guard() from public, anon, authenticated;

drop policy if exists "quotes: read own" on public.quotes;
create policy "quotes: read own" on public.quotes for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "quotes: insert own" on public.quotes;
create policy "quotes: insert own" on public.quotes for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "quotes: update own" on public.quotes;
create policy "quotes: update own" on public.quotes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- ΚΑΜΙΑ πολιτική delete: η εφαρμογή δεν σβήνει γραμμές (μόνο deleted_at).

-- ── Καθάρισμα των σβησμένων μετά από 30 μέρες ──
-- Με το pg_cron (αν είναι ενεργό στο project): κάθε μέρα 03:23 UTC. Αν δεν είναι, δες docs/sync.md
-- («Καθάρισμα σβησμένων»): ενεργοποίηση του pg_cron και ξανατρέξιμο αυτής της migration, ή χειροκίνητα το ίδιο delete.
create or replace function public.purge_deleted_quotes()
returns integer language sql security definer set search_path = '' as $$
  with gone as (delete from public.quotes where deleted_at < now() - interval '30 days' returning 1)
  select count(*)::integer from gone
$$;
revoke all on function public.purge_deleted_quotes() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ergolav-purge-deleted-quotes';
    perform cron.schedule('ergolav-purge-deleted-quotes', '23 3 * * *', 'select public.purge_deleted_quotes()');
  else
    raise notice 'pg_cron δεν είναι ενεργό: το καθάρισμα των σβησμένων προσφορών γίνεται χειροκίνητα (docs/sync.md)';
  end if;
end $$;
