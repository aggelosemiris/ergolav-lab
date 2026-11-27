# Migrations: dev και prod

Δύο projects στη Supabase, και τα δύο στη Φρανκφούρτη (EU):

| Περιβάλλον | Project | Για τι |
|---|---|---|
| **prod** | `myyecdraxrkkwojppglb` | Η εφαρμογή στο `ergolav.github.io/ergolav-lab/`, πραγματικοί χρήστες |
| **dev** | `ergolav-dev` (ref: _συμπληρώνεται μόλις φτιαχτεί_) | Δοκιμές: κάθε migration, κάθε αλλαγή κλειδιών ή ρυθμίσεων |

## Κανόνας: πρώτα dev, μετά prod

Από 27/11/2026 κάθε αλλαγή στη βάση ακολουθεί αυτή τη σειρά:

1. Νέο αρχείο στο `supabase/migrations/` (ξανατρέξιμο: `if not exists`, `create or replace`, `drop policy if exists`).
2. Νέα γραμμή στον πίνακα παρακάτω και στο `supabase/tests/migration-status.sql`. Το `npm test`
   (`test/migrations-table.test.js`) αποτυγχάνει αν λείπει κάποια από τις δύο.
3. Τοπικά, αν υπάρχει PostgreSQL: `bash supabase/tests/run-local.sh` → όλα τα `… OK` και στο τέλος `MIGRATIONS OK`.
4. **dev:** SQL Editor → η migration → Run. Μετά τα tests της στο ίδιο SQL Editor (`supabase/tests/*-rls.sql`), που
   πρέπει να δώσουν `… OK`, και το `migration-status.sql`. Στη στήλη **dev** μπαίνει ✓.
5. Review του PR και merge.
6. **prod**, μόνο με «ναι» του Άγγελου: τα ίδια βήματα με το 4. Στη στήλη **prod** μπαίνει ✓, με νέο PR για τον πίνακα.

Οι ρυθμίσεις του dashboard (Auth, SMTP, Rate Limits, κλειδιά, Edge Functions) αλλάζουν κι αυτές πρώτα στο dev.

## Πίνακας

✓ = εφαρμόστηκε, ✗ = δεν εφαρμόστηκε, ? = δεν έχει ελεγχθεί. Η αλήθεια βγαίνει από το `supabase/tests/migration-status.sql`
(μόνο ανάγνωση), που τρέχει σε κάθε project.

| # | Migration | Τι κάνει | Tests | dev | prod | Σημείωση |
|---|---|---|---|---|---|---|
| 1 | `20261116000000_auth_profiles` | Στοιχεία επιχείρησης (`profiles`), bucket λογότυπου | `rls.sql` | ? | ✓ | Η σύνδεση και τα στοιχεία δουλεύουν στην παραγωγή |
| 2 | `20261117000000_has_password` | `has_password()` για λογαριασμούς Google | `rls.sql` | ? | ? | |
| 3 | `20261118000000_allaxe_bot` | Κανόνες/βιβλιοθήκη «Άλλαξέ το», είδη που λείπουν, μετρήσεις | `rls.sql` | ? | ? | Στις 18/11 δεν είχε τρέξει |
| 4 | `20261119000000_bot_metrics_strict` | Αυστηρό σχήμα για τις ανώνυμες μετρήσεις | `rls.sql` | ? | ? | Μετά την 3 |
| 5 | `20261120000000_price_monitoring` | Προμηθευτές, προσφορές, ιστορικό τιμών, `user_products` | `price-rls.sql` | ? | ✓ | Το workflow τιμών γράφει στο `supplier_offers` |
| 6 | `20261121000000_price_service_role_grants` | Δικαιώματα της εβδομαδιαίας ενημέρωσης | `price-rls.sql` | ? | ✓ | Χωρίς αυτήν το workflow σταματούσε πριν το `supplier_offers` |
| 7 | `20261123000000_quotes` | Προσφορές στον λογαριασμό (συγχρονισμός, PR #27) | `quotes-rls.sql` | ? | ? | Στόχος 7, ο Άγγελος |
| 8 | `20261125000000_tech_prices` | «Τιμές από τεχνικούς» | `tech-prices-rls.sql` | ? | ? | Θέλει το `tech_price_pepper` στο Vault πριν· το flag μένει κλειστό |
| 9 | `20261126000000_product_catalog_prices` | Επαληθευμένες τιμές καταλόγου ανά προμηθευτή | `product-catalog-prices-rls.sql` | ? | ? | PR #40–#43 |
| 10 | `20261127000000_product_catalog_prices_report_read` | Ανάγνωση των προηγούμενων τιμών από την εβδομαδιαία εργασία | `product-catalog-prices-rls.sql` | ? | ? | Μετά την 9 |

## Στήσιμο του dev (μία φορά)

1. Supabase → **New project** → όνομα `ergolav-dev`, region **Central EU (Frankfurt)**, ίδιο πλάνο με το prod. Ο κωδικός
   της βάσης πηγαίνει **μόνο** στο 1Password (vault ergolav).
2. SQL Editor: οι migrations **με τη σειρά του πίνακα**, μία-μία → Run. Και οι δέκα είναι ξανατρέξιμες.
3. Μετά από κάθε migration, το test της στη στήλη «Tests». Στο τέλος: `migration-status.sql` → όλα `true`.
4. Το μυστικό `tech_price_pepper` στο Vault του **dev** (διαφορετικό από του prod, βλ. `docs/technician-prices.md`),
   μετά το `supabase/seed/tech-price-keys.sql`.
5. Auth όπως στο `docs/AUTH_SETUP.md`: email με κωδικό 6 ψηφίων, κωδικός 8+ με γράμματα και αριθμούς, Site URL
   `http://localhost:8087`. Το Google και το Turnstile στο dev δεν χρειάζονται για τις migrations.
6. `supabase functions deploy delete-account --project-ref <ref του dev>`.
7. Στον πίνακα: η στήλη **dev** με ✓/✗ από το `migration-status.sql`, και το ref του dev στην αρχή αυτής της σελίδας.

Τα κλειδιά του dev είναι **χωριστά** από του prod: ούτε ένα κοινό. Ποτέ στο repo ή σε chat, μόνο στο 1Password
(`docs/security/keys.md`).
