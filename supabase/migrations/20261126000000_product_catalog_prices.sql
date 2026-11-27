-- Τελευταία επαληθευμένη τιμή λιανικής ανά προϊόν του καταλόγου και προμηθευτή.
create table if not exists public.product_catalog_prices (
  product_id text not null check (product_id ~ '^[0-9a-f]{24}$'),
  supplier_id text not null check (supplier_id ~ '^[a-z0-9-]{1,80}$'),
  cents integer not null check (cents > 0),
  price_kind text not null check (price_kind in ('regular', 'listed')),
  verified_at timestamptz not null,
  primary key (product_id, supplier_id)
);

alter table public.product_catalog_prices enable row level security;
revoke all on public.product_catalog_prices from public, anon, authenticated, service_role;
grant select on public.product_catalog_prices to authenticated;
drop policy if exists "product_catalog_prices: read" on public.product_catalog_prices;
create policy "product_catalog_prices: read" on public.product_catalog_prices for select to authenticated using (true);

-- Μία δημοσίευση ανά παρτίδα. Παλιότερες παρατηρήσεις και επανάληψη της ίδιας παρτίδας δεν γράφουν αλλαγή.
create or replace function public.publish_product_catalog_prices(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' or pg_catalog.jsonb_array_length(p_rows) > 500 then
    raise exception 'Μη έγκυρη παρτίδα τιμών';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(20261126, 1);

  with incoming as materialized (
    select * from pg_catalog.jsonb_to_recordset(p_rows)
      as x(product_id text, supplier_id text, cents integer, price_kind text, verified_at timestamptz)
  ), previous as materialized (
    select i.product_id, i.supplier_id, p.cents
    from incoming i left join public.product_catalog_prices p using (product_id, supplier_id)
  ), saved as (
    insert into public.product_catalog_prices as target (product_id, supplier_id, cents, price_kind, verified_at)
      select product_id, supplier_id, cents, price_kind, verified_at from incoming
    on conflict (product_id, supplier_id) do update set cents = excluded.cents, price_kind = excluded.price_kind, verified_at = excluded.verified_at
      where target.verified_at < excluded.verified_at
    returning product_id, supplier_id, cents
  )
  select pg_catalog.jsonb_build_object(
    'new', count(*) filter (where p.cents is null),
    'changed', coalesce(pg_catalog.jsonb_agg(s.product_id) filter (where p.cents is not null and p.cents <> s.cents), '[]'::jsonb)
  ) into result
  from saved s join previous p using (product_id, supplier_id);
  return result;
end
$$;

revoke all on function public.publish_product_catalog_prices(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.publish_product_catalog_prices(jsonb) to service_role;
