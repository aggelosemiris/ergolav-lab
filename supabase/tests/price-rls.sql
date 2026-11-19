-- Έλεγχος της παρακολούθησης τιμών (migration 20261120000000_price_monitoring.sql): απόρρητο ανάμεσα σε χρήστες,
-- προστασία της τιμής του χρήστη, μόνο η εργασία (service_role) γράφει τιμές, κλείδωμα εκτέλεσης.
-- Όλα σε μία συναλλαγή που ακυρώνεται (rollback). Επιτυχία = «PRICE RLS OK». Αποτυχία = σφάλμα «FAIL: …».
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'p-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b1', 'p-b@example.invalid', 'authenticated', 'authenticated');

-- ── Η εργασία (service_role) φτιάχνει προμηθευτή, προϊόν καταλόγου και τιμή ──
set local role service_role;
insert into public.suppliers (id, name, base_url, method) values ('toolcase', 'Toolcase', 'https://www.toolcase.gr', 'woo-store-api');
insert into public.price_products (match_key, catalog_ref, source, name, unit, spec)
  values ('v1;piece;θερμοσιφ;;l=80;;;', 'heater|ΚΩΔ. 30080', 'catalog', 'Θερμοσίφωνας 80 λ.', 'piece', '{}');
insert into public.supplier_offers (price_product_id, supplier_id, supplier_product_id, url, name, regular_cents, vat_included,
  vat_basis, unit_cents, verification, match_method, retrieved_at)
  select id, 'toolcase', '123', 'https://www.toolcase.gr/product/x/', 'Θερμοσίφωνας 80lt', 24800, true, 'retail-law', 20000, 'verified', 'spec', now()
    from public.price_products where catalog_ref = 'heater|ΚΩΔ. 30080';
do $$ begin
  begin
    insert into public.supplier_offers (price_product_id, supplier_id, supplier_product_id, url, name, vat_included, vat_basis, verification, match_method, retrieved_at)
      select id, 'toolcase', '124', 'https://www.toolcase.gr/product/y/', 'Χωρίς τιμή', true, 'retail-law', 'verified', 'spec', now()
        from public.price_products where catalog_ref = 'heater|ΚΩΔ. 30080';
    raise exception 'FAIL: «verified» χωρίς τιμή έγινε δεκτό';
  exception when check_violation then null; end;
end $$;
reset role;

-- ── Χρήστης Α: προσθέτει δικά του προϊόντα ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ declare n int; begin
  insert into public.user_products (user_id, key, name, unit, user_price_cents, updated_at)
    values ('00000000-0000-4000-8000-0000000000a1', '|κλιματιστικο 12000 btu', 'Κλιματιστικό 12000 BTU', 'τεμ.', 45000, now());
  begin
    insert into public.user_products (user_id, key, name, unit, user_price_cents, updated_at)
      values ('00000000-0000-4000-8000-0000000000b1', '|ξενο', 'Ξένο', 'τεμ.', 100, now());
    raise exception 'FAIL: ο Α έγραψε προϊόν στον Β';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_products (user_id, key, name, unit, user_price_cents, updated_at, price_product_id)
      values ('00000000-0000-4000-8000-0000000000a1', '|συνδεδεμενο', 'Χ', 'τεμ.', 100, now(), 1);
    raise exception 'FAIL: ο Α διάλεξε μόνος του σύνδεση με τιμή';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.price_products (match_key, source, name, unit, spec) values ('hack', 'user', 'hack', 'piece', '{}');
    raise exception 'FAIL: ο χρήστης έγραψε τιμή προμηθευτή (price_products)';
  exception when insufficient_privilege then null; end;
  begin
    update public.supplier_offers set regular_cents = 1;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL: ο χρήστης άλλαξε τιμή προμηθευτή'; end if;
  exception when insufficient_privilege then null; end;
  begin
    perform public.price_run_start();
    raise exception 'FAIL: ο χρήστης ξεκίνησε εκτέλεση';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.price_products where catalog_ref is not null;
  if n <> 1 then raise exception 'FAIL: ο Α δεν βλέπει τις τιμές του καταλόγου (%)', n; end if;
  select count(*) into n from public.supplier_offers;
  if n <> 1 then raise exception 'FAIL: ο Α δεν βλέπει τις τιμές προμηθευτών του καταλόγου (%)', n; end if;
end $$;
reset role;

-- ── Χρήστης Β: ίδιο προϊόν (ίδια προδιαγραφή) ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
insert into public.user_products (user_id, key, name, unit, user_price_cents, updated_at)
  values ('00000000-0000-4000-8000-0000000000b1', '|κλιματιστικο 12000 btu', 'κλιματιστικό 12000 btu', 'τεμ.', 39000, now());
insert into public.user_products (user_id, key, name, unit, user_price_cents, updated_at)
  values ('00000000-0000-4000-8000-0000000000b1', '|μονο του β', 'Μόνο του Β 25kg', 'σακί', 1200, now());
reset role;

-- ── Η εργασία: μία κοινή εγγραφή για το ίδιο προϊόν, σύνδεση και των δύο ──
set local role service_role;
insert into public.price_products (match_key, source, name, unit, spec) values ('v1;piece;κλιματιστικ;;btu=12000;;;', 'user', 'Κλιματιστικό 12000 BTU', 'piece', '{}');
insert into public.price_products (match_key, source, name, unit, spec) values ('v1;bag;μονο+β;;kg=25;;;', 'user', 'Μόνο του Β 25kg', 'bag', '{}');
update public.user_products u set price_product_id = p.id, linked_at = now() from public.price_products p
 where p.match_key = 'v1;piece;κλιματιστικ;;btu=12000;;;' and u.key = '|κλιματιστικο 12000 btu';
update public.user_products u set price_product_id = p.id, linked_at = now() from public.price_products p
 where p.match_key = 'v1;bag;μονο+β;;kg=25;;;' and u.key = '|μονο του β';
do $$ declare n int; begin
  select count(*) into n from public.user_products where key = '|κλιματιστικο 12000 btu';
  if n <> 2 then raise exception 'FAIL: οι εγγραφές των χρηστών συγχωνεύτηκαν ή χάθηκαν (%)', n; end if;
  begin
    update public.user_products set user_price_cents = 1 where key = '|κλιματιστικο 12000 btu';
    raise exception 'FAIL: η εργασία άλλαξε την τιμή του χρήστη';
  exception when insufficient_privilege then null; end;
  begin
    update public.user_products set deleted = true;
    raise exception 'FAIL: η εργασία έσβησε προϊόν χρήστη';
  exception when insufficient_privilege then null; end;
  -- κλείδωμα: δεύτερη εκτέλεση δεν ξεκινά· διακομμένη (χωρίς σημείο ζωής) αντικαθίσταται
  if public.price_run_start() is null then raise exception 'FAIL: η πρώτη εκτέλεση δεν ξεκίνησε'; end if;
  if public.price_run_start() is not null then raise exception 'FAIL: δύο εκτελέσεις ταυτόχρονα'; end if;
  update public.price_runs set heartbeat_at = now() - interval '3 hours' where status = 'running';
  if public.price_run_start() is null then raise exception 'FAIL: η διακομμένη εκτέλεση κλείδωσε για πάντα'; end if;
  select count(*) into n from public.price_runs where status = 'aborted';
  if n <> 1 then raise exception 'FAIL: η διακομμένη εκτέλεση δεν σημειώθηκε aborted'; end if;
end $$;
reset role;

-- ── Ο Α βλέπει μόνο τη δική του σύνδεση, όχι το προϊόν του Β· δεν αλλάζει μόνος του σύνδεση ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ declare n int; p bigint; begin
  select count(*) into n from public.user_products;
  if n <> 1 then raise exception 'FAIL: ο Α βλέπει % προϊόντα χρηστών αντί για 1', n; end if;
  select count(*) into n from public.price_products where source = 'user';
  if n <> 1 then raise exception 'FAIL: ο Α βλέπει % ιδιωτικά προϊόντα τιμών αντί για 1 (το δικό του)', n; end if;
  select count(*) into n from public.price_products where name like 'Μόνο του Β%';
  if n <> 0 then raise exception 'FAIL: ο Α βλέπει προϊόν του Β'; end if;
  select price_product_id into p from public.user_products;
  update public.user_products set price_product_id = p + 1000, user_price_cents = 46000, updated_at = now();
  select count(*) into n from public.user_products where price_product_id = p and user_price_cents = 46000;
  if n <> 1 then raise exception 'FAIL: η αλλαγή τιμής από τον χρήστη χάθηκε ή η σύνδεση άλλαξε από τον χρήστη'; end if;
  begin
    delete from public.user_products;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL: διαγραφή γραμμής από τον χρήστη (πρέπει deleted = true)'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── Ανώνυμος: τίποτα ──
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ declare n int; begin
  begin select count(*) into n from public.price_products; exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'FAIL: ο ανώνυμος βλέπει τιμές'; end if;
  begin select count(*) into n from public.user_products; exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'FAIL: ο ανώνυμος βλέπει προϊόντα χρηστών'; end if;
end $$;
reset role;

select 'PRICE RLS OK' as result;
rollback;
