-- Δοκιμές του πραγματικού RPC και των δικαιωμάτων, με προσωρινά δεδομένα.
begin;

set local role service_role;
do $test$
declare
  item jsonb := '[{"product_id":"0a0a0a0a0a0a0a0a0a0a0a0a","supplier_id":"test","cents":1900,"price_kind":"regular","verified_at":"2026-11-27T10:00:00Z"}]';
begin
  if public.publish_product_catalog_prices(item) <> '{"new":1,"changed":[]}'::jsonb then
    raise exception 'Αποτυχία πρώτης καταχώρισης';
  end if;
  if public.publish_product_catalog_prices(item) <> '{"new":0,"changed":[]}'::jsonb then
    raise exception 'Η επανάληψη της ίδιας παρατήρησης έγραψε αλλαγή';
  end if;
  if public.publish_product_catalog_prices(jsonb_set(item, '{0,verified_at}', '"2026-11-20T10:00:00Z"')) <> '{"new":0,"changed":[]}'::jsonb then
    raise exception 'Παλιότερη παρατήρηση έγινε δεκτή';
  end if;
  begin
    perform public.publish_product_catalog_prices(jsonb_set(item, '{0,cents}', '0'));
    raise exception 'Μηδενική τιμή έγινε δεκτή';
  exception when check_violation then null;
  end;
  begin
    perform public.publish_product_catalog_prices(jsonb_set(item, '{0,verified_at}', '"2026-11-28T10:00:00Z"') || jsonb_set(item, '{0,verified_at}', '"2026-11-28T10:00:00Z"'));
    raise exception 'Πακέτο με διπλό κλειδί έγινε δεκτό';
  exception when cardinality_violation then null;
  end;
end
$test$;

set local role authenticated;
do $test$
begin
  if (select count(*) from public.product_catalog_prices where supplier_id = 'test') <> 1 then
    raise exception 'Η εφαρμογή δεν διαβάζει τα δεδομένα ή υπάρχει διπλό';
  end if;
  begin
    perform public.publish_product_catalog_prices('[]');
    raise exception 'Ο χρήστης εκτέλεσε το RPC του workflow';
  exception when insufficient_privilege then null;
  end;
end
$test$;

set local role anon;
do $test$
begin
  begin
    perform 1 from public.product_catalog_prices;
    raise exception 'Ανώνυμη ανάγνωση επιτράπηκε';
  exception when insufficient_privilege then null;
  end;
end
$test$;

reset role;
rollback;
select 'product_catalog_prices: ok';
