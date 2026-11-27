# Κλειδιά Supabase: ένα ανά χρήση

Στόχος 10 της εβδομάδας ασφαλείας (εύρημα M3). Σήμερα **ένα** `service_role` JWT κάνει τα πάντα: το workflow τιμών και
την Edge Function `delete-account`. Αν διαρρεύσει από τη μία χρήση, δεν ανακαλείται χωρίς να πέσει και η άλλη. Το παλιό
σύστημα κλειδιών (JWT `anon` / `service_role`) η Supabase το αποσύρει μέσα στο 2027.

**Κανόνας:** κανένα κλειδί σε chat, email, Claude Code ή στο repo. Τα μυστικά υπάρχουν μόνο σε δύο σημεία: εκεί που
τα χρησιμοποιεί κάποιος (GitHub environment `prices`, Supabase) και στο **κοινό vault «ergolav» του 1Password**.
Το `test/secret-keys.test.js` αποτυγχάνει αν βρεθεί `sb_secret_…` ή `service_role` JWT σε αρχείο του repo.

## Τι υπάρχει και τι θέλουμε

| Χρήση | Σήμερα | Στόχος | Πού μπαίνει | Ποιος το διαβάζει |
|---|---|---|---|---|
| Εφαρμογή (browser) | `anon` JWT στο `src/config.js` (δημόσιο) | `sb_publishable_…` (δημόσιο) | `src/config.js`, με PR | Όλοι: το προστατεύει το RLS |
| Workflow τιμών | `service_role` JWT, secret `SUPABASE_SERVICE_ROLE_KEY` | secret key **`github-prices`** | GitHub → Environments → `prices` → `SUPABASE_SERVICE_ROLE_KEY` (νέα τιμή, ίδιο όνομα· βλ. βήμα 3) | `tools/prices/run.mjs` (`serverKey`) |
| Edge Function `delete-account` | `service_role` (αυτόματα) | secret key **`edge-functions`** | Αυτόματα στο `SUPABASE_SECRET_KEYS` της function | `adminKey` στο `handler.ts` |
| Το `default` secret key | δημιουργείται μαζί με τα νέα | **ανακαλείται** | — | κανείς |
| Αντίγραφα | — | όλα τα παραπάνω + κωδικός βάσης | 1Password, vault «ergolav» | Φίλιππος, Άγγελος |

Ο κώδικας είναι ήδη έτοιμος και για τα δύο συστήματα:
- Το εργαλείο τιμών παίρνει το `SUPABASE_SECRET_KEY` αν υπάρχει, αλλιώς το `SUPABASE_SERVICE_ROLE_KEY`, και δέχεται εκεί
  είτε `sb_secret_…` είτε το παλιό JWT. Το workflow σήμερα περνά μόνο το `SUPABASE_SERVICE_ROLE_KEY`.
- Η function παίρνει το `edge-functions` και, αν λείπει, το `SUPABASE_SERVICE_ROLE_KEY`.
- Δημόσιο κλειδί στη θέση του μυστικού απορρίπτεται.
- Τα logs γράφουν μόνο το **είδος** του κλειδιού, π.χ. «κλειδί sb_secret», ποτέ την τιμή.

## Μετάβαση χωρίς διακοπή (πρώτα στο dev, μετά στο prod)

Κάθε βήμα γυρίζει πίσω χωριστά. Σε κανένα σημείο δεν υπάρχει στιγμή χωρίς κλειδί που δουλεύει.

1. **Merge αυτού του PR.** Δεν αλλάζει τίποτα: χωρίς νέα κλειδιά, ο κώδικας συνεχίζει με τα παλιά.
2. **Νέα κλειδιά** (Supabase → Settings → **API Keys**):
   - Create new keys, αν δεν υπάρχουν. Φτιάχνονται τα `default` publishable και secret. Τα παλιά **συνεχίζουν να δουλεύουν**.
   - Add new secret key → όνομα `github-prices`.
   - Add new secret key → όνομα `edge-functions`.
   - Καθένα μπαίνει αμέσως στο 1Password («ergolav / supabase-<dev|prod> / github-prices» κ.λπ.).
3. **Workflow τιμών:**
   - Πρώτα το παλιό JWT στο 1Password, αν δεν είναι ήδη, ως επιστροφή.
   - GitHub → Settings → Environments → `prices` → `SUPABASE_SERVICE_ROLE_KEY` → **Update** με το `github-prices` (`sb_secret_…`).
   - Actions → Weekly supplier prices → Run workflow (στο `lab`). Στο log πρέπει να φαίνεται «Supabase: κλειδί sb_secret
     (στο παλιό όνομα secret)».
   - Επιστροφή: ξανά το παλιό JWT στο ίδιο secret.
   - Προαιρετικά, αργότερα: μετονομασία σε `SUPABASE_SECRET_KEY` στο `.github/workflows/prices.yml`. Θέλει δικαίωμα
     αλλαγής workflows, άρα γίνεται από τον Άγγελο στο GitHub ή με token που έχει `workflow` scope.
4. **Edge Function:**
   - `supabase functions deploy delete-account --project-ref <ref>`.
   - Δοκιμή με λογαριασμό δοκιμής: Ο λογαριασμός μου → Διαγραφή. Στα logs της function πρέπει να φαίνεται `"key":"sb_secret"`.
   - Αν γράφει `service_role`, το όνομα του κλειδιού δεν είναι ακριβώς `edge-functions`.
5. **Εφαρμογή** (νέο PR): `SUPABASE_ANON_KEY` → το `sb_publishable_…` στο `src/config.js`, μετά `npm run sw:manifest`.
   - Δοκιμή στο dev πρώτα: σύνδεση, στοιχεία, λογότυπο, συγχρονισμός.
   - Το «Verify JWT» της function μένει ενεργό, γιατί ελέγχει το token του χρήστη και όχι το κλειδί.
6. **Έλεγχος ότι τίποτα δεν χρησιμοποιεί τα παλιά.** Η Supabase δεν δείχνει χρήση, άρα ο έλεγχος γίνεται με το χέρι:
   - το workflow
   - η function
   - η εφαρμογή στο live, με hard refresh, σε κινητό με εγκατεστημένη εφαρμογή (service worker)
   - κανένα script ή cron με το παλιό κλειδί
7. **Απενεργοποίηση των παλιών** (Settings → API Keys → Legacy → Disable). Το `anon` και το `service_role` απενεργοποιούνται **μαζί**.
   - Επιστρέφει πίσω με Enable, αν φανεί κάτι που ξεχάσαμε.
   - Το GitHub secret `SUPABASE_SERVICE_ROLE_KEY` **δεν διαγράφεται όσο το workflow διαβάζει αυτό το όνομα**:
     μετά το βήμα 3 περιέχει το νέο `github-prices`, όχι το παλιό JWT. Διαγράφεται μόνο αφού γίνει η προαιρετική
     μετονομασία σε `SUPABASE_SECRET_KEY`, δημοσιευτεί το workflow και περάσει επιτυχής εκτέλεση με το νέο όνομα.
   - Το παλιό JWT στο 1Password διαγράφεται μόνο αφού ολοκληρωθεί η επαλήθευση της μετάβασης.
8. **Ανάκληση του `default` secret key**: δεν το χρησιμοποιεί κανείς. Η διαγραφή ενός secret key **δεν αναιρείται**, οπότε γίνεται μόνο μετά το 6.

Τα κλειδιά του **dev** είναι εντελώς χωριστά από του prod. Ίδια ονόματα, άλλες τιμές, άλλα αντίγραφα στο 1Password.

## Διαρροή κλειδιού: ποιο ανακαλείται και πώς

| Τι διέρρευσε | Τι κάνουμε αμέσως | Τι πέφτει |
|---|---|---|
| `github-prices` | Νέο secret key `github-prices-2` → GitHub secret του workflow → διαγραφή του παλιού | Τίποτα, αν γίνει με αυτή τη σειρά |
| `edge-functions` | Νέο key με όνομα `edge-functions`, αφού σβηστεί πρώτα το παλιό (το όνομα πρέπει να μείνει ίδιο) → redeploy | Η διαγραφή λογαριασμού, για λίγα λεπτά |
| Παλιό `service_role` | Disable legacy keys (πέφτουν **και** τα δύο παλιά). Αν η εφαρμογή χρησιμοποιεί ακόμα `anon`, πρώτα το βήμα 5 | Ό,τι δεν έχει περάσει στα νέα |
| `sb_publishable` / `anon` | Τίποτα επείγον: είναι δημόσια. Έλεγχος ότι το RLS κρατά (`supabase/tests/*-rls.sql`) | — |
| Κωδικός βάσης | Settings → Database → Reset password → 1Password | Ό,τι συνδέεται απευθείας (κανένα σήμερα) |

Μετά από κάθε διαρροή: σημείωση στο `docs/security/incident.md` (στόχος 16), με ώρα, τι διέρρευσε και τι ανακλήθηκε.
