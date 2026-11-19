-- ergolav — εβδομαδιαία παρακολούθηση τιμών προμηθευτών (χωρίς AI). Βλ. docs/PRICE_MONITORING.md.
-- Τρέχει μία φορά στο SQL editor του Supabase, μετά τις προηγούμενες. Ξανατρέξιμο.
--
-- Αρχές:
-- - Οι τιμές των προμηθευτών ζουν ΧΩΡΙΣΤΑ από τις τιμές που γράφει ο χρήστης. Η τιμή του χρήστη δεν αλλάζει ποτέ από
--   την εβδομαδιαία εργασία (φράζεται και με trigger, όχι μόνο με κώδικα).
-- - Μία εγγραφή ανά μοναδική προδιαγραφή (price_products.match_key): ίδιο προϊόν σε πολλούς χρήστες = μία αναζήτηση.
--   Οι εγγραφές των χρηστών (user_products) μένουν χωριστές και απλώς δείχνουν σε αυτήν.
-- - Γράφει μόνο η εβδομαδιαία εργασία (service_role). Οι χρήστες διαβάζουν τις τιμές του καταλόγου και των δικών τους
--   προϊόντων, και γράφουν μόνο τα δικά τους προϊόντα.

-- ── Προμηθευτές ─────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id            text primary key check (id ~ '^[a-z0-9-]{2,30}$'),
  name          text not null check (char_length(name) <= 60),
  base_url      text not null check (base_url ~ '^https://'),
  method        text not null check (char_length(method) <= 40),
  enabled       boolean not null default true,
  status        text not null default 'unknown' check (status in ('unknown', 'available', 'unavailable')),
  status_reason text check (char_length(status_reason) <= 300),
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  items_seen    integer check (items_seen >= 0)
);

-- ── Προϊόντα για παρακολούθηση (κοινά, ένα ανά προδιαγραφή) ─────────────────
create table if not exists public.price_products (
  id                  bigserial primary key,
  match_key           text not null unique check (char_length(match_key) between 1 and 600),
  catalog_ref         text unique check (char_length(catalog_ref) <= 120),     -- «id|κωδικός» του src/catalog.js
  source              text not null check (source in ('catalog', 'user')),
  name                text not null check (char_length(name) between 1 and 200),
  unit                text not null check (unit in ('piece', 'm', 'm2', 'bag', 'other')),
  kind                text not null default 'product' check (kind in ('product', 'service', 'per-area', 'too-generic')),
  spec                jsonb not null check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) <= 4000),
  created_at          timestamptz not null default now(),
  last_checked_at     timestamptz,
  last_checked_run    bigint,
  last_check_status   text check (last_check_status in ('matched', 'unmatched', 'not-applicable', 'error')),
  last_check_note     text check (char_length(last_check_note) <= 300),
  -- Τιμή αναφοράς: διάμεσος των επαληθευμένων κανονικών τιμών, ανά μονάδα, ΧΩΡΙΣ ΦΠΑ, σε λεπτά.
  -- Δεν γίνεται ποτέ 0: αν δεν υπάρχουν αρκετές τιμές, μένει η τελευταία έγκυρη και αλλάζει μόνο το status.
  reference_cents     integer check (reference_cents > 0),
  reference_status    text not null default 'none' check (reference_status in ('none', 'verified', 'insufficient', 'stale')),
  reference_at        timestamptz,                                              -- πότε επαληθεύτηκε τελευταία
  reference_suppliers integer check (reference_suppliers >= 0),
  reference_detail    jsonb check (reference_detail is null or pg_column_size(reference_detail) <= 4000)
);
create index if not exists price_products_checked on public.price_products (last_checked_at nulls first);

-- ── Προϊόντα των χρηστών (από τη ροή «δεν είναι στον κατάλογο») ───────────────
create table if not exists public.user_products (
  user_id          uuid not null references auth.users (id) on delete cascade,
  key              text not null check (char_length(key) between 1 and 200),   -- το priceKey της εφαρμογής
  name             text not null check (char_length(name) between 1 and 200),
  said             text check (char_length(said) <= 300),                          -- η φράση όπως ειπώθηκε (κρατά τα μεγέθη)
  unit             text not null check (char_length(unit) between 1 and 20),
  user_price_cents integer check (user_price_cents >= 0 and user_price_cents < 1000000000),   -- όπως το έγραψε ο χρήστης
  user_labor_cents integer check (user_labor_cents >= 0 and user_labor_cents < 1000000000),
  brand            text check (char_length(brand) <= 60),
  mpn              text check (char_length(mpn) <= 40),
  gtin             text check (gtin ~ '^\d{8,14}$'),
  deleted          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null,
  price_product_id bigint references public.price_products (id) on delete set null,   -- το βάζει η εργασία
  linked_at        timestamptz,
  primary key (user_id, key)
);
alter table public.user_products add column if not exists said text check (char_length(said) <= 300);
create index if not exists user_products_link on public.user_products (price_product_id);
create index if not exists user_products_updated on public.user_products (updated_at);

-- ── Τιμές των προμηθευτών (η τελευταία ανά προϊόν προμηθευτή) ───────────────
create table if not exists public.supplier_offers (
  id                  bigserial primary key,
  price_product_id    bigint not null references public.price_products (id) on delete cascade,
  supplier_id         text not null references public.suppliers (id) on delete cascade,
  supplier_product_id text not null check (char_length(supplier_product_id) between 1 and 120),
  url                 text not null check (url ~ '^https://' and char_length(url) <= 600),
  name                text not null check (char_length(name) <= 300),
  regular_cents       integer check (regular_cents > 0),            -- κανονική τιμή όπως τη δείχνει ο προμηθευτής
  currency            text not null default 'EUR' check (currency = 'EUR'),
  vat_included        boolean not null,
  vat_basis           text not null check (vat_basis in ('explicit', 'retail-law')),
  unit_cents          integer check (unit_cents > 0),               -- ανά μονάδα του προϊόντος μας, χωρίς ΦΠΑ
  unit_basis          text check (char_length(unit_basis) <= 40),
  promo               boolean not null default false,               -- ήταν σε προσφορά (κρατήθηκε η ρητή κανονική)
  verification        text not null check (verification in ('verified', 'unverified', 'unit-mismatch')),
  verification_reason text check (char_length(verification_reason) <= 120),
  match_method        text not null check (match_method in ('gtin', 'mpn', 'spec')),
  retrieved_at        timestamptz not null,
  last_success_at     timestamptz,                                  -- τελευταία φορά με επαληθευμένη τιμή
  seen_run            bigint,
  unique (price_product_id, supplier_id, supplier_product_id),
  check (verification <> 'verified' or (regular_cents is not null and unit_cents is not null))
);
create index if not exists supplier_offers_product on public.supplier_offers (price_product_id);

-- ── Ιστορικό: κάθε αλλαγή επαληθευμένης τιμής και κάθε αλλαγή της τιμής αναφοράς ─
create table if not exists public.supplier_price_history (
  id               bigserial primary key,
  offer_id         bigint not null references public.supplier_offers (id) on delete cascade,
  price_product_id bigint not null references public.price_products (id) on delete cascade,
  supplier_id      text not null,
  regular_cents    integer not null check (regular_cents > 0),
  unit_cents       integer not null check (unit_cents > 0),
  observed_at      timestamptz not null,
  run_id           bigint
);
create index if not exists supplier_price_history_product on public.supplier_price_history (price_product_id, observed_at desc);

create table if not exists public.price_reference_history (
  id               bigserial primary key,
  price_product_id bigint not null references public.price_products (id) on delete cascade,
  reference_cents  integer not null check (reference_cents > 0),
  suppliers        integer not null,
  observed_at      timestamptz not null,
  run_id           bigint
);
create index if not exists price_reference_history_product on public.price_reference_history (price_product_id, observed_at desc);

-- ── Εκτελέσεις της εβδομαδιαίας εργασίας (και κλείδωμα: το πολύ μία «running») ─
create table if not exists public.price_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'done', 'partial', 'failed', 'aborted')),
  stats        jsonb check (stats is null or pg_column_size(stats) <= 60000),
  error        text check (char_length(error) <= 2000)
);
create unique index if not exists price_runs_one_running on public.price_runs ((true)) where status = 'running';

-- Ξεκίνημα με κλείδωμα: νέα εκτέλεση μόνο αν δεν τρέχει άλλη. Αν η άλλη δεν έδωσε σημείο ζωής για p_stale_minutes
-- (π.χ. σκοτώθηκε), σημειώνεται 'aborted' και ξεκινά η νέα. Επιστρέφει το id ή null (τρέχει ήδη άλλη).
create or replace function public.price_run_start(p_stale_minutes integer default 120)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  update public.price_runs set status = 'aborted', finished_at = now(), error = 'χωρίς σημείο ζωής: θεωρήθηκε διακομμένη'
   where status = 'running' and heartbeat_at < now() - make_interval(mins => greatest(p_stale_minutes, 5));
  begin
    insert into public.price_runs default values returning id into rid;
  exception when unique_violation then
    return null;
  end;
  return rid;
end $$;
revoke all on function public.price_run_start(integer) from public, anon, authenticated;

-- ── Η τιμή του χρήστη δεν αλλάζει από την εργασία (ούτε από λάθος στον κώδικα της) ─
create or replace function public.user_products_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'service_role' and (new.user_price_cents is distinct from old.user_price_cents
      or new.user_labor_cents is distinct from old.user_labor_cents or new.name is distinct from old.name or new.said is distinct from old.said
      or new.unit is distinct from old.unit or new.deleted is distinct from old.deleted
      or new.updated_at is distinct from old.updated_at or new.user_id is distinct from old.user_id or new.key is distinct from old.key) then
    raise exception 'price monitoring must not change user-entered product data' using errcode = '42501';
  end if;
  if current_user <> 'service_role' and (new.price_product_id is distinct from old.price_product_id
      or new.linked_at is distinct from old.linked_at) then
    new.price_product_id := old.price_product_id;          -- ο χρήστης δεν διαλέγει σε ποια τιμή «δείχνει»
    new.linked_at := old.linked_at;
  end if;
  return new;
end $$;
drop trigger if exists user_products_guard on public.user_products;
create trigger user_products_guard before update on public.user_products
  for each row execute function public.user_products_guard();

-- ── Δικαιώματα ──────────────────────────────────────────────────────────────
alter table public.suppliers enable row level security;
alter table public.price_products enable row level security;
alter table public.user_products enable row level security;
alter table public.supplier_offers enable row level security;
alter table public.supplier_price_history enable row level security;
alter table public.price_reference_history enable row level security;
alter table public.price_runs enable row level security;

do $$ declare t text; begin
  foreach t in array array['suppliers', 'price_products', 'user_products', 'supplier_offers', 'supplier_price_history',
                           'price_reference_history', 'price_runs'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- Ο χρήστης: τα δικά του προϊόντα (διάβασμα, προσθήκη, αλλαγή· όχι διαγραφή γραμμής: σβήσιμο = deleted).
drop policy if exists "user_products: read own" on public.user_products;
create policy "user_products: read own" on public.user_products for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "user_products: insert own" on public.user_products;
create policy "user_products: insert own" on public.user_products for insert to authenticated
  with check (user_id = (select auth.uid()) and price_product_id is null and linked_at is null);
drop policy if exists "user_products: update own" on public.user_products;
create policy "user_products: update own" on public.user_products for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.user_products to authenticated;

-- Τιμές: του καταλόγου για όλους τους συνδεδεμένους· των προϊόντων χρηστών μόνο σε όσους τα έχουν.
drop policy if exists "price_products: catalog or own" on public.price_products;
create policy "price_products: catalog or own" on public.price_products for select to authenticated
  using (catalog_ref is not null or exists (select 1 from public.user_products u
    where u.price_product_id = price_products.id and u.user_id = (select auth.uid()) and not u.deleted));
grant select on public.price_products to authenticated;

drop policy if exists "supplier_offers: visible products" on public.supplier_offers;
create policy "supplier_offers: visible products" on public.supplier_offers for select to authenticated
  using (price_product_id in (select id from public.price_products));
grant select on public.supplier_offers to authenticated;

drop policy if exists "suppliers: read" on public.suppliers;
create policy "suppliers: read" on public.suppliers for select to authenticated using (true);
grant select on public.suppliers to authenticated;
-- supplier_price_history, price_reference_history, price_runs: μόνο service_role (και εμείς από το SQL editor).
