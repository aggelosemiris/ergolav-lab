-- ergolav — λογαριασμός: στοιχεία επιχείρησης (profiles) και λογότυπο (bucket «logos»).
-- Τρέχει μία φορά στο SQL editor του Supabase (βλ. docs/AUTH_SETUP.md). Ξανατρέξιμο: δεν σπάει αν υπάρχουν ήδη.
-- Οι προσφορές, το ημερολόγιο και οι τιμές ΔΕΝ είναι εδώ: μένουν στη συσκευή (επόμενη φάση).

-- ── Στοιχεία επιχείρησης: μία γραμμή ανά χρήστη ─────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  business_name text check (char_length(business_name) <= 80),
  specialty     text check (char_length(specialty) <= 80),
  phone         text check (char_length(phone) <= 30),
  logo_path     text check (char_length(logo_path) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Ο χρήστης διαβάζει και γράφει ΜΟΝΟ τη δική του γραμμή. Καμία πολιτική delete: η γραμμή φεύγει μόνο με τη
-- διαγραφή του λογαριασμού (on delete cascade).
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Ο ανώνυμος ρόλος δεν βλέπει τίποτα.
revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;

-- updated_at σε κάθε αλλαγή
create or replace function public.profiles_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.profiles_touch();

-- Σε κάθε νέο χρήστη (Google ή κωδικός email) φτιάχνεται άδεια γραμμή.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Λογότυπο: ιδιωτικό bucket, κάθε χρήστης μόνο στον φάκελο <user_id>/ ─────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 512000, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "logos: read own folder" on storage.objects;
create policy "logos: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "logos: insert own folder" on storage.objects;
create policy "logos: insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "logos: update own folder" on storage.objects;
create policy "logos: update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "logos: delete own folder" on storage.objects;
create policy "logos: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
