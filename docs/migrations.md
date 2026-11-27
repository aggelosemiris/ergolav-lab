# Migrations: dev και prod

Δύο projects στη Supabase, και τα δύο στη Φρανκφούρτη (EU):

| Περιβάλλον | Project | Για τι |
|---|---|---|
| **prod** | `myyecdraxrkkwojppglb` | Η εφαρμογή στο `ergolav.github.io/ergolav-lab/`, πραγματικοί χρήστες |
| **dev** | `ergolav-dev` (`xykffuqjeruljtwpbrdf`) | Δοκιμές: κάθε migration, κάθε αλλαγή κλειδιών ή ρυθμίσεων |

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
| 1 | `20261116000000_auth_profiles` | Στοιχεία επιχείρησης (`profiles`), bucket λογότυπου | `rls.sql` | ✓ | ✓ | Η σύνδεση και τα στοιχεία δουλεύουν στην παραγωγή |
| 2 | `20261117000000_has_password` | `has_password()` για λογαριασμούς Google | `rls.sql` | ✓ | ✓ | |
| 3 | `20261118000000_allaxe_bot` | Κανόνες/βιβλιοθήκη «Άλλαξέ το», είδη που λείπουν, μετρήσεις | `rls.sql` | ✓ | ✓ | Στις 18/11 δεν είχε τρέξει |
| 4 | `20261119000000_bot_metrics_strict` | Αυστηρό σχήμα για τις ανώνυμες μετρήσεις | `rls.sql` | ✓ | ✓ | Μετά την 3 |
| 5 | `20261120000000_price_monitoring` | Προμηθευτές, προσφορές, ιστορικό τιμών, `user_products` | `price-rls.sql` | ✓ | ✓ | Το workflow τιμών γράφει στο `supplier_offers` |
| 6 | `20261121000000_price_service_role_grants` | Δικαιώματα της εβδομαδιαίας ενημέρωσης | `price-rls.sql` | ✓ | ✓ | Χωρίς αυτήν το workflow σταματούσε πριν το `supplier_offers` |
| 7 | `20261123000000_quotes` | Προσφορές στον λογαριασμό (συγχρονισμός, PR #27) | `quotes-rls.sql` | ✓ | ✓ | Εφαρμόστηκε 27/11: QUOTES RLS OK σε dev και prod |
| 8 | `20261125000000_tech_prices` | «Τιμές από τεχνικούς» | `tech-prices-rls.sql` | ✓ | ✗ | Θέλει το `tech_price_pepper` στο Vault πριν· το flag μένει κλειστό |
| 9 | `20261126000000_product_catalog_prices` | Επαληθευμένες τιμές καταλόγου ανά προμηθευτή | `product-catalog-prices-rls.sql` | ✓ | ✓ | PR #40–#43 |
| 10 | `20261127000000_product_catalog_prices_report_read` | Ανάγνωση των προηγούμενων τιμών από την εβδομαδιαία εργασία | `product-catalog-prices-rls.sql` | ✓ | ✓ | Μετά την 9 |

## Έλεγχος 27/11/2026

Πηγή SQL: commit `7ce11525e44eef3ddf99d77dc19ea21b238207cd`. Το `migration-status.sql` έδωσε
**dev: 10 true**, **prod: 9 true, tech_prices false**. Ο έλεγχος αφορά τα κύρια αντικείμενα που περιγράφει το script,
όχι πλήρη σύγκριση κάθε ορισμού της βάσης.

- Dev: εφαρμόστηκαν διαδοχικά και οι 10 migrations. Πέρασαν `RLS OK`, `PRICE RLS OK`, `QUOTES RLS OK`,
  `TECH PRICES RLS OK` και `product_catalog_prices: ok`. Το test του Vault χρησιμοποιεί πλέον `vault.create_secret()`.
- Dev: το seed έδωσε 1.767 ενεργές παραλλαγές. Site URL `http://localhost:8087`, redirects `http://localhost:8087/`
  και `http://127.0.0.1:8087/`. Email ενεργό, επιβεβαίωση email ενεργή, OTP 6 ψηφίων / 600 δευτερολέπτων,
  κωδικός 8+ με γράμματα και αριθμούς, απαίτηση τωρινού κωδικού στην αλλαγή. Η αλλαγή email επιβεβαιώνεται μόνο
  στο νέο email, με ρητή έγκριση του Άγγελου. Ενεργές οι ειδοποιήσεις αλλαγής κωδικού και email.
- Prod: εφαρμόστηκε η migration `20261123000000_quotes` αφού πέρασε στο dev. Πέρασαν `QUOTES RLS OK` και `RLS OK`.
- Το `pg_cron` ενεργοποιήθηκε πρώτα στο dev και μετά στο prod. Ο καθαρισμός `ergolav-purge-deleted-quotes`
  είναι ενεργός καθημερινά στις `03:23 UTC` και στα δύο. Στο dev υπάρχει και `ergolav-tech-price-stats`, Δευτέρα `02:41 UTC`.
- Το `QUOTES_SYNC_ENABLED` μένει **false**, μέχρι να ολοκληρωθούν η έγκριση απορρήτου και οι δοκιμές δύο πραγματικών κινητών.
- Η μετάβαση κλειδιών, το μόνιμο `tech_price_pepper` και το λειτουργικό test διαγραφής λογαριασμού παραμένουν εκκρεμή.
  Δεν υπάρχει ακόμα κοινό 1Password. Το dev δεν έχει SMTP: το dashboard απαιτεί SMTP πριν επιτρέψει αλλαγή των email templates,
  οπότε τα ελληνικά templates και η πραγματική παραλαβή email στο dev παραμένουν εκκρεμή.
- Η `delete-account` αναπτύχθηκε πρώτα στο dev και μετά στο prod από τον ίδιο κώδικα του παραπάνω commit,
  με Verify JWT ενεργό και στα δύο. Το POST χωρίς διαπιστευτήρια απορρίφθηκε με 401 και στα δύο.
  Στο prod, POST με το δημόσιο anon key απορρίφθηκε από τον handler με `not_signed_in` και επέστρεψε CORS για
  `https://ergolav.github.io`. Δεν διαγράφηκε λογαριασμός. Αυτό δεν αντικαθιστά το λειτουργικό test με λογαριασμό δοκιμής.

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
