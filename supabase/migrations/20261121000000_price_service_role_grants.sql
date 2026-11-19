-- ergolav — δικαιώματα της εβδομαδιαίας ενημέρωσης τιμών (service_role). Τρέχει ΜΕΤΑ την 20261120. Ξανατρέξιμο.
--
-- Λόγος: σε αυτό το project ό,τι φτιάχνει ο postgres ΔΕΝ δίνει αυτόματα δικαιώματα σε κανέναν ρόλο
-- (default privileges: πίνακες μόνο TRUNCATE/REFERENCES/TRIGGER, συναρτήσεις και ακολουθίες τίποτα).
-- Το service_role παρακάμπτει το RLS, αλλά χωρίς GRANT δεν διαβάζει ούτε γράφει: η εργασία σταματούσε στο
-- price_run_start με «permission denied». Εδώ παίρνει ΜΟΝΟ ό,τι κάνει η tools/prices/stores/supabase.mjs:
--   price_runs        διάβασμα, αλλαγή (heartbeat/τέλος)· νέα εκτέλεση μόνο μέσω price_run_start
--   user_products     διάβασμα, αλλαγή (μόνο η σύνδεση με τιμή: το trigger φράζει την τιμή του χρήστη)
--   suppliers, price_products, supplier_offers   διάβασμα, προσθήκη, αλλαγή (upsert)
--   supplier_price_history, price_reference_history   προσθήκη (και διάβασμα για έλεγχο)
-- Καμία διαγραφή γραμμών. Κανένα δικαίωμα σε anon/authenticated πέρα από όσα έδωσε η 20261120.
grant select, update on public.price_runs to service_role;
grant select, update on public.user_products to service_role;
grant select, insert, update on public.suppliers, public.price_products, public.supplier_offers to service_role;
grant select, insert on public.supplier_price_history, public.price_reference_history to service_role;
grant usage on sequence public.price_products_id_seq, public.supplier_offers_id_seq, public.supplier_price_history_id_seq,
  public.price_reference_history_id_seq to service_role;
grant execute on function public.price_run_start(integer) to service_role;
