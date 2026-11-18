-- ergolav — «Άλλαξέ το» χωρίς AI: κανόνες και βιβλιοθήκη του μάστορα, λίστα ομάδας, ανώνυμες μετρήσεις.
-- Τρέχει μία φορά στο SQL editor του Supabase (όπως τα προηγούμενα, βλ. docs/AUTH_SETUP.md). Ξανατρέξιμο.
-- Η εφαρμογή τα χρησιμοποιεί μόνο με ALLAXE_BOT_ENABLED = true· χωρίς λογαριασμό όλα μένουν στη συσκευή.

-- ── Κανόνες του μάστορα (περίπτωση ανά υλικό, λόγος, αλλαγές) και βιβλιοθήκη του (είδη εκτός καταλόγου).
-- Μία γραμμή ανά κλειδί· value = null σημαίνει «σβήστηκε» (ώστε να σβήνει και στις άλλες συσκευές).
-- Συγχρονισμός: η πιο πρόσφατη αλλαγή (updated_at) κερδίζει.
create table if not exists public.user_rules (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 120),
  value      jsonb check (value is null or pg_column_size(value) <= 20000),
  updated_at timestamptz not null,
  primary key (user_id, key)
);
create table if not exists public.user_analyses (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 60),
  value      jsonb check (value is null or pg_column_size(value) <= 60000),
  updated_at timestamptz not null,
  primary key (user_id, key)
);

alter table public.user_rules enable row level security;
alter table public.user_analyses enable row level security;

-- Ο καθένας μόνο τα δικά του: διαβάζει, γράφει, αλλάζει. Δεν σβήνει γραμμές (σβήσιμο = value null).
do $$ declare t text; begin
  foreach t in array array['user_rules', 'user_analyses'] loop
    execute format('drop policy if exists "%1$s: read own" on public.%1$s', t);
    execute format('create policy "%1$s: read own" on public.%1$s for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('drop policy if exists "%1$s: insert own" on public.%1$s', t);
    execute format('create policy "%1$s: insert own" on public.%1$s for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('drop policy if exists "%1$s: update own" on public.%1$s', t);
    execute format('create policy "%1$s: update own" on public.%1$s for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('revoke all on public.%1$s from authenticated', t);
    execute format('grant select, insert, update on public.%1$s to authenticated', t);
  end loop;
end $$;

-- ── Λίστα ομάδας: είδη εκτός καταλόγου που ζήτησαν οι μάστορες. ΜΟΝΟ κανονικοποιημένο όνομα και μετρητές.
-- ΟΧΙ κείμενο μάστορα, χρήστης ή προσφορά. Κανείς δεν τη διαβάζει ή την αλλάζει από την εφαρμογή:
-- μόνο μετρητές μέσω της bump_missing_item. Τη βλέπουμε εμείς από το SQL editor (docs/ANALYSIS_LIBRARY.md).
create table if not exists public.missing_items (
  name       text primary key check (name ~ '^[a-zα-ω ]{2,40}$'),
  count      integer not null default 0 check (count >= 0),
  categories jsonb not null default '{}'::jsonb,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now()
);
alter table public.missing_items enable row level security;
revoke all on public.missing_items from anon;
revoke all on public.missing_items from authenticated;

create or replace function public.bump_missing_item(p_name text, p_category text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare cat text := case when p_category ~ '^[a-z-]{2,30}$' then p_category else null end;
begin
  if p_name is null or p_name !~ '^[a-zα-ω ]{2,40}$' then raise exception 'invalid name'; end if;
  insert into public.missing_items as m (name, count, categories)
    values (p_name, 1, case when cat is null then '{}'::jsonb else jsonb_build_object(cat, 1) end)
  on conflict (name) do update set
    count = m.count + 1,
    last_at = now(),
    categories = case when cat is null then m.categories
      else jsonb_set(m.categories, array[cat], to_jsonb(coalesce((m.categories ->> cat)::int, 0) + 1)) end;
end $$;
revoke all on function public.bump_missing_item(text, text) from public, anon;
grant execute on function public.bump_missing_item(text, text) to authenticated;

-- ── Ανώνυμες μετρήσεις χρήσης του bot: ποιο κουμπί, ποιο υλικό/ανάλυση, «Κράτα το»/«Άκυρο».
-- ΧΩΡΙΣ κείμενα, χρήστη ή πελάτη (καμία στήλη χρήστη). Μόνο εισαγωγή· κανείς δεν διαβάζει από την εφαρμογή.
create table if not exists public.bot_metrics (
  id    bigserial primary key,
  at    timestamptz not null default now(),
  event jsonb not null check (jsonb_typeof(event) = 'object' and pg_column_size(event) <= 600)
);
alter table public.bot_metrics enable row level security;
drop policy if exists "bot_metrics: insert" on public.bot_metrics;
create policy "bot_metrics: insert" on public.bot_metrics for insert to authenticated
  with check (not (event ?| array['text', 'name', 'client', 'user', 'email', 'phone']));
revoke all on public.bot_metrics from anon;
revoke all on public.bot_metrics from authenticated;
grant insert on public.bot_metrics to authenticated;
grant usage on sequence public.bot_metrics_id_seq to authenticated;
