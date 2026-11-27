-- ergolav — ποιες migrations έχουν εφαρμοστεί σε ΑΥΤΟ το project (dev ή prod). ΜΟΝΟ ανάγνωση: δεν αλλάζει τίποτα.
-- Supabase → SQL Editor → επικόλληση → Run. Μία γραμμή ανά migration: applied = true / false.
-- Οι migrations τρέχουν από το SQL Editor, άρα δεν υπάρχει πίνακας ιστορικού· ο έλεγχος κοιτάζει το κύριο αντικείμενο
-- που φτιάχνει η καθεμία. Τα αποτελέσματα γράφονται στον πίνακα του docs/migrations.md (στήλες dev / prod).
-- Νέα migration = νέα γραμμή εδώ (το test/migrations-table.test.js το ελέγχει).
select migration, coalesce(applied, false) as applied from (values
  ('20261116000000_auth_profiles',
    to_regclass('public.profiles') is not null),
  ('20261117000000_has_password',
    to_regprocedure('public.has_password()') is not null),
  ('20261118000000_allaxe_bot',
    to_regclass('public.user_rules') is not null and to_regclass('public.missing_items') is not null),
  ('20261119000000_bot_metrics_strict',
    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bot_metrics'
            and policyname = 'bot_metrics: insert' and with_check like '%pg_column_size%')),
  ('20261120000000_price_monitoring',
    to_regclass('public.price_products') is not null and to_regclass('public.user_products') is not null),
  ('20261121000000_price_service_role_grants',
    case when to_regclass('public.supplier_offers') is null then false
         else has_table_privilege('service_role', 'public.supplier_offers', 'INSERT') end),
  ('20261123000000_quotes',
    to_regclass('public.quotes') is not null),
  ('20261125000000_tech_prices',
    to_regclass('public.tech_price_keys') is not null),
  ('20261126000000_product_catalog_prices',
    to_regclass('public.product_catalog_prices') is not null),
  ('20261127000000_product_catalog_prices_report_read',
    case when to_regclass('public.product_catalog_prices') is null then false
         else has_table_privilege('service_role', 'public.product_catalog_prices', 'SELECT') end)
) as m(migration, applied)
order by migration;
