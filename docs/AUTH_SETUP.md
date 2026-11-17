# Λογαριασμός — ρύθμιση (Supabase Free + Google)

Τα βήματα που γίνονται **μία φορά** στα dashboards, για να ανοίξει ο λογαριασμός στην εφαρμογή. Κόστος: μηδέν
(Supabase Free, Google OAuth). Μέχρι να γίνουν, η εφαρμογή μένει ακριβώς όπως πριν (`AUTH_ENABLED = false`).

Οι ονομασίες στα dashboards αλλάζουν συχνά· αν κάποιο κουμπί δεν είναι εκεί που γράφει, ψάξε το ίδιο όνομα ρύθμισης.

## Τρέχουσα ρύθμιση του ergolav-lab (17/11/2026)

| Τι | Πού / τιμή |
|---|---|
| Supabase project | `myyecdraxrkkwojppglb` (eu-central-1, Φρανκφούρτη), Free |
| Βάση | migration του `supabase/migrations/` (μέσω Management API· βλ. βήμα 3), `rls.sql` → «RLS OK» |
| Function | `delete-account`, Verify JWT ενεργό, σύνδεση των τελευταίων 10′ (αλλιώς 403), CORS: `ALLOWED_ORIGINS` στο `handler.ts` |
| Σύνδεση | **υποχρεωτική**: email + κωδικός πρόσβασης (8+, γράμματα και αριθμοί), ή Google |
| Κωδικός πρόσβασης | Min length 8, «Letters and digits», αλλαγή μόνο με τον τωρινό (εκτός από την επαναφορά) |
| Email | δικό μας SMTP (Gmail, `myergolav@gmail.com`)· ελληνικά templates με κωδικό 6 ψηφίων, χωρίς link: Confirm signup, Reset password, Change email· ειδοποιήσεις «άλλαξε ο κωδικός» / «άλλαξε το email»· λήξη 10′ |
| `has_password()` | συνάρτηση βάσης: true/false μόνο για τον τρέχοντα χρήστη (migration `20261117000000_has_password.sql`) |
| Google | OAuth client στο Google Cloud· provider ενεργός στο Supabase |
| CAPTCHA | Cloudflare Turnstile (widget «ergolav»)· site key στο `src/config.js`, secret ΜΟΝΟ στο Supabase |
| Όρια ανά IP | 30 εγγραφές/συνδέσεις/αποστολές και 30 επαληθεύσεις κωδικού ανά 5′ (τα κινητά δίκτυα μοιράζονται IP)· 30 email/ώρα· στην εφαρμογή: μετά από 5 λάθος κωδικούς αναμονή 30″ που διπλασιάζεται έως 5′ |

## Κλείσιμο αμέσως, αν κάτι πάει στραβά

1. **Από την εφαρμογή:** `AUTH_ENABLED = false` στο `src/config.js` → commit → PR → merge στο `lab`. Σε ~1′ το site είναι
   όπως πριν (ούτε κουμπί, ούτε κλήσεις στο Supabase). Τα δεδομένα των συσκευών δεν αγγίζονται.
2. **Χωρίς deploy (σε δευτερόλεπτα):** Supabase → **Authentication → Sign In / Providers** → απενεργοποίηση του
   **Allow new users to sign up** (κλείνει τις νέες εγγραφές) ή των providers Email / Google (κλείνει και τις συνδέσεις).

## Τι θα χρειαστείς

- Λογαριασμό στο [Supabase](https://supabase.com/dashboard) (δωρεάν, χωρίς κάρτα).
- Λογαριασμό Google για το [Google Cloud Console](https://console.cloud.google.com/).
- Node.js 20+ στον υπολογιστή σου (μόνο για το deploy της function, βήμα 7).

## 1. Project στο Supabase

1. **New project** → όνομα `ergolav`, κωδικός βάσης (κράτα τον κάπου ασφαλές), περιοχή **Frankfurt (eu-central-1)**, πλάνο **Free**.
2. Όταν ετοιμαστεί: **Project Settings → API** (ή **API Keys**). Κράτα:
   - το **Project URL**, π.χ. `https://abcdefghijkl.supabase.co`
   - το **anon** (ή **publishable**) key. Είναι δημόσιο και μπαίνει στην εφαρμογή.
   - Το **service_role** (ή **secret**) key **ΔΕΝ** το αντιγράφεις πουθενά: ούτε στην εφαρμογή, ούτε στο git, ούτε σε chat.

## 2. Η εφαρμογή

1. `src/config.js`: βάλε το Project URL στο `SUPABASE_URL` και το anon key στο `SUPABASE_ANON_KEY`.
2. `index.html`, γραμμή της CSP (`Content-Security-Policy`): άλλαξε το `https://your-project-ref.supabase.co` στο
   **ίδιο** Project URL. Μόνο αυτή η διεύθυνση, χωρίς `*`.
3. `npm test`: το `test/account.test.js` αποτυγχάνει αν η CSP και το `config.js` δεν ταιριάζουν.
4. Μόνο όταν τελειώσουν όλα τα βήματα: `AUTH_ENABLED = true` στο `src/config.js`.

## 3. Βάση: πίνακας, κανόνες, λογότυπα (SQL)

Στο ergolav-lab η migration πέρασε μέσω του Management API (`POST /v1/projects/<ref>/database/query`), γιατί το
`supabase db push` θέλει απευθείας σύνδεση Postgres με τον κωδικό της βάσης. Και οι δύο τρόποι τρέχουν το ίδιο αρχείο.

1. **SQL Editor → New query** → επικόλλησε όλο το `supabase/migrations/20261116000000_auth_profiles.sql` → **Run**.
   Φτιάχνει τον πίνακα `profiles` με Row Level Security, τον trigger για κάθε νέο χρήστη και το ιδιωτικό bucket
   `logos` με κανόνες μόνο για τον φάκελο `<user_id>/`. Μπορεί να ξανατρέξει χωρίς πρόβλημα.
2. Νέο query → επικόλλησε το `supabase/tests/rls.sql` → **Run**. Πρέπει να δεις **`RLS OK`**. Ελέγχει ότι ο χρήστης
   Α δεν διαβάζει, δεν αλλάζει και δεν σβήνει το profile ή το λογότυπο του Β. Όλα ακυρώνονται στο τέλος (δεν μένει
   κανένας δοκιμαστικός χρήστης). Αν δεις `FAIL: …`, σταμάτα και στείλε το μήνυμα.

## 4. Διευθύνσεις επιστροφής

**Authentication → URL Configuration**:

- **Site URL:** `https://aggelosemiris.github.io/ergolav-lab/`
- **Redirect URLs** (Add URL, μία-μία):
  - `https://aggelosemiris.github.io/ergolav-lab/`
  - `http://localhost:8087/` και `http://127.0.0.1:8087/` (το `npm start` της εφαρμογής τρέχει στο **8087**)
  - `http://localhost:8080/`, μόνο αν τη σερβίρεις και αλλιώς σε αυτή τη θύρα

## 5. Κωδικός 6 ψηφίων στο email

**Προσοχή:** στο Free, με το ενσωματωμένο email του Supabase, τα templates **δεν αλλάζουν** (αγγλικό email με link, χωρίς
κωδικό) και το όριο είναι 2 email/ώρα. Γι' αυτό χρειάζεται δικό μας SMTP (δωρεάν με Gmail):

- Στο Gmail του αποστολέα: Επαλήθευση σε 2 βήματα → [κωδικός εφαρμογής](https://myaccount.google.com/apppasswords).
- Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**: host `smtp.gmail.com`, port `465`,
  username/sender το Gmail, password ο κωδικός εφαρμογής (μόνο εκεί), sender name `ergolav` → **Save**.


1. **Authentication → Sign In / Providers → Email**: ενεργό, **Confirm email** ενεργό, **Secure email change** ΚΛΕΙΣΤΟ
   (ο κωδικός πάει μόνο στο νέο email· το παλιό παίρνει ειδοποίηση), **Email OTP Length: 6**, **Email OTP Expiration: 600**
   (10 λεπτά· ίδιο με το `OTP_TTL_S` στο `src/account.js`, που ξεχωρίζει το «λάθος» από το «έληξε»).
2. **Authentication → Sign In / Providers → Email → Password**: **Minimum length 8**, **Password requirements: Letters and
   digits** (ίδιο με το `passwordCheck` του `src/account.js`), **Require current password when updating** ενεργό.
3. **Authentication → Emails → Templates** (στα ελληνικά, με `{{ .Token }}` και ΧΩΡΙΣ link):
   **Confirm signup** (επιβεβαίωση εγγραφής), **Reset password** (Ξέχασα τον κωδικό), **Change email address** (κωδικός στο
   νέο email). Και στις **Security notifications**: «Password changed» και «Email address changed» ενεργά, στα ελληνικά.
   Το ακριβές κείμενο που μπήκε στο ergolav-lab μπαίνει με ένα PATCH στο Management API (`/v1/projects/<ref>/config/auth`,
   πεδία `mailer_templates_*_content`, `mailer_subjects_*`).

   Κωδικός και όχι link: στο iPhone ένα link από το email ανοίγει στο Safari και όχι στην εφαρμογή της αρχικής οθόνης.

## 6. Σύνδεση με Google

**Στο Google Cloud Console:**

1. Νέο project `ergolav`.
2. **APIs & Services → OAuth consent screen** (ή **Google Auth Platform**): τύπος **External**, όνομα εφαρμογής
   `ergolav`, email υποστήριξης, πεδία (scopes) μόνο `openid`, `email`, `profile`. Όσο είναι σε **Testing**, πρόσθεσε τα
   email των δοκιμαστών στους **Test users**. Για όλους: **Publish app**. Για τα βασικά scopes δεν χρειάζεται έλεγχος
   από τη Google.
3. **Credentials → Create credentials → OAuth client ID** → τύπος **Web application**:
   - **Authorized JavaScript origins:** `https://aggelosemiris.github.io`, `http://localhost:8087`
   - **Authorized redirect URIs:** `https://<το-project-σου>.supabase.co/auth/v1/callback`. Το ακριβές URL το δείχνει
     το Supabase στη σελίδα του provider Google.
4. Κράτα το **Client ID** και το **Client secret**.

**Στο Supabase:**

5. **Authentication → Sign In / Providers → Google** → Enable → επικόλλησε Client ID και Client secret → Save.
   Το secret μένει μόνο στο Supabase.

## 7. Function διαγραφής λογαριασμού

Η `supabase/functions/delete-account` σβήνει μόνο τον χρήστη του JWT που την καλεί. Πρώτα σβήνει τα λογότυπά του,
μετά τον λογαριασμό (το profile φεύγει με cascade).

```sh
npx supabase login
npx supabase link --project-ref <το-project-ref>        # το «abcdefghijkl» από το Project URL
npx supabase functions deploy delete-account
```

- **Secrets:** το `SUPABASE_URL` και το `SUPABASE_SERVICE_ROLE_KEY` τα δίνει **αυτόματα** το Supabase σε κάθε function
  του project. Δεν χρειάζεται να ορίσεις τίποτα, και το service_role key δεν περνά ποτέ από τα χέρια σου ή από το git.
  Τα βλέπεις στο **Edge Functions → Secrets**.
- Άφησε ενεργό το **Verify JWT** (προεπιλογή): η κλήση χωρίς έγκυρη σύνδεση απορρίπτεται πριν φτάσει στον κώδικα.
- Νέο domain στο μέλλον: μία γραμμή στη λίστα `ALLOWED_ORIGINS` του `supabase/functions/delete-account/handler.ts`
  και ξανά `functions deploy`.

## 8. Δοκιμή

1. `AUTH_ENABLED = true` → `npm start` → άνοιξε `http://localhost:8087/`.
2. Ανοίγει μόνο η οθόνη σύνδεσης. **Νέος λογαριασμός** → email, κωδικός δύο φορές, «Αποδέχομαι» → κωδικός 6 ψηφίων από
   το email → «Τα στοιχεία σου» → αρχική.
3. **Αποσύνδεση** → σύνδεση με email και κωδικό· **Ξέχασα τον κωδικό** → κωδικός 6 ψηφίων → νέος κωδικός· **Συνέχεια με Google**.
4. Σε δεύτερο browser (ή σε ιδιωτικό παράθυρο): σύνδεση με τον ίδιο λογαριασμό → τα στοιχεία της επιχείρησης και το
   λογότυπο έρχονται μόνα τους.
5. Στο Supabase: **Table Editor → profiles** (μία γραμμή) και **Storage → logos** (ο φάκελός σου).
6. **Ο λογαριασμός μου → Διαγραφή λογαριασμού** → ξανά ο κωδικός (ή Google) → ο χρήστης φεύγει από το **Authentication → Users**, η γραμμή από το
   `profiles`, ο φάκελος από το `logos`. Στη συσκευή οι προσφορές μένουν.

## 9. CAPTCHA με Cloudflare Turnstile (δωρεάν)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile → Add widget**: όνομα `ergolav`, hostname
   `aggelosemiris.github.io` (για δοκιμές προσωρινά και `localhost`, `127.0.0.1`), Widget Mode **Managed**.
2. **Site key** (δημόσιο) → `TURNSTILE_SITE_KEY` στο `src/config.js`.
3. **Secret key** → ΜΟΝΟ στο Supabase: **Authentication → Attack Protection → CAPTCHA → Turnstile** → Save.
4. CSP: `https://challenges.cloudflare.com` μόνο σε `script-src`, `frame-src`, `connect-src` (ήδη στο `index.html`).
   Ζητείται σε εγγραφή, σύνδεση με κωδικό, «Ξέχασα τον κωδικό», «Στείλε ξανά» και στην επιβεβαίωση πριν από τη διαγραφή.
   Αν το Turnstile δεν φορτώσει, αυτά κλειδώνουν με μήνυμα· το «Συνέχεια με Google» δουλεύει κανονικά.
   Τα μηνύματα «Fetch API cannot load data:,» στην κονσόλα έρχονται από το iframe του Turnstile (δική του CSP), όχι από την εφαρμογή.

## Δωρεάν όρια (Supabase Free)

- **Email:** με δικό μας SMTP (Gmail) το όριο είναι 30 email/ώρα στο Supabase και ~500/ημέρα στο Gmail. Χωρίς αυτό, το
  ενσωματωμένο email του Supabase έχει **πολύ χαμηλό όριο** (λίγα email την ώρα για όλο το project· δες
  **Authentication → Rate Limits**) και είναι **μόνο για δοκιμές**. Η σύνδεση με Google δεν έχει αυτό το θέμα.
- **Πάγωμα:** το project του Free **παγώνει μετά από 1 εβδομάδα χωρίς χρήση**. Ξεπαγώνει από το dashboard (Restore). Όσο
  είναι παγωμένο, η σύνδεση δεν δουλεύει. Η εφαρμογή συνεχίζει κανονικά με τα δεδομένα της συσκευής.
- **Backup:** το Free **δεν έχει αυτόματα backup**.
- Αρκετά για δοκιμές: 50.000 ενεργοί χρήστες/μήνα, 500 MB βάση, 1 GB αρχεία, 500.000 κλήσεις function/μήνα.

## Πριν μπουν πραγματικοί χρήστες

1. **Δικό μας domain.** Το `aggelosemiris.github.io` είναι **κοινή διεύθυνση για όλα τα repos του λογαριασμού**. Η
   συνεδρία σύνδεσης (`sb-…-auth-token` στον browser) μπορεί να διαβαστεί από οποιαδήποτε σελίδα σε άλλο repo του ίδιου
   λογαριασμού. Με δικό μας domain (π.χ. `app.ergolav.gr` στο GitHub Pages, δωρεάν πέρα από το κόστος του domain): νέο
   domain στα βήματα 4 και 6, στη CSP και στο `ALLOWED_ORIGINS` της function.
2. ✅ **CAPTCHA στην εγγραφή με Cloudflare Turnstile (δωρεάν)** — έγινε (βήμα 9).
   Αρχική περιγραφή: Supabase: **Authentication → Attack Protection → CAPTCHA**
   → Turnstile, με τα κλειδιά από το Cloudflare. Χρειάζεται και αλλαγή κώδικα: το widget της Turnstile στην οθόνη
   σύνδεσης, το `captchaToken` στο `signInWithOtp`, και το `https://challenges.cloudflare.com` στη CSP
   (`script-src`, `frame-src`).
3. ✅ **Δικός μας πάροχος email** — έγινε με Gmail (βήμα 5)· για μεγαλύτερο όγκο, πάροχος με δικό μας domain.
   Αρχική περιγραφή: αντί του ενσωματωμένου (**Authentication → Emails → SMTP Settings**). Το email θα έρχεται
   από δική μας διεύθυνση, με τα όρια του παρόχου και όχι του Supabase.
4. **Supabase Pro** για **αυτόματα ημερήσια backup** (και χωρίς πάγωμα μετά από αδράνεια).
5. **Όροι** και **Απόρρητο**: υπάρχουν (`legal/`) ως «Προσωρινό κείμενο, υπό νομικό έλεγχο» — θέλουν νομικό έλεγχο.
6. **Google σε Production:** όσο η εφαρμογή OAuth είναι σε **Testing**, συνδέονται μόνο οι Test users. Για όλους:
   Google Cloud → OAuth consent screen → **Publish app**.

## Τι ΔΕΝ κάνει ακόμα ο λογαριασμός

- Οι **προσφορές, το ημερολόγιο, οι τιμές** και ο **αριθμός προσφοράς** (`ergolav.quoteNo`) μένουν μόνο στη συσκευή. Ο
  συγχρονισμός τους είναι η επόμενη φάση.
- Σύνδεση και αποσύνδεση **δεν σβήνουν ποτέ** δεδομένα της συσκευής. Η «Αποσύνδεση» αφορά μόνο αυτή τη συσκευή· η
  «Αποσύνδεση από όλες τις συσκευές» ανακαλεί όλες τις συνεδρίες.
- Χωρίς ίντερνετ, με αποθηκευμένη συνεδρία (ακόμα και ληγμένη) η εφαρμογή δουλεύει κανονικά: κλειδώνει μόνο όταν ο server
  πει ότι η συνεδρία δεν ισχύει πια, και τότε ό,τι έγραφε ο τεχνίτης μένει μέχρι να συνδεθεί ξανά.
- Λογαριασμοί που φτιάχτηκαν με τον παλιό «κωδικό στο email» (πριν από τον κωδικό πρόσβασης): μπαίνουν με
  **Ξέχασα τον κωδικό** μία φορά (ή με Google, αν είναι Google).
- Το Supabase δέχεται ακόμα σύνδεση με κωδικό στο email (OTP) μέσω API· η εφαρμογή δεν τη δείχνει πια.
