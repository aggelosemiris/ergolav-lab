# Λογαριασμός — ρύθμιση (Supabase Free + Google)

Τα βήματα που γίνονται **μία φορά** στα dashboards, για να ανοίξει ο λογαριασμός στην εφαρμογή. Κόστος: μηδέν
(Supabase Free, Google OAuth). Μέχρι να γίνουν, η εφαρμογή μένει ακριβώς όπως πριν (`AUTH_ENABLED = false`).

Οι ονομασίες στα dashboards αλλάζουν συχνά· αν κάποιο κουμπί δεν είναι εκεί που γράφει, ψάξε το ίδιο όνομα ρύθμισης.

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

1. **Authentication → Sign In / Providers → Email**: ενεργό. **Email OTP Length: 6**, **Email OTP Expiration: 600**
   (10 λεπτά· ίδιο με το `OTP_TTL_S` στο `src/account.js`, που ξεχωρίζει το «λάθος» από το «έληξε»).
2. **Authentication → Emails → Templates**: άλλαξε **και** το **Magic Link** **και** το **Confirm signup** (το πρώτο email
   νέου χρήστη) ώστε να δείχνουν τον κωδικό και όχι link:
   - Θέμα: `Ο κωδικός σου για το ergolav`
   - Κείμενο:

     ```html
     <h2>Ο κωδικός σου για το ergolav</h2>
     <p>Γράψε αυτόν τον κωδικό στην εφαρμογή:</p>
     <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
     <p>Ισχύει για 10 λεπτά. Αν δεν τον ζήτησες εσύ, αγνόησε αυτό το email.</p>
     ```

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
2. **Σύνδεση** πάνω δεξιά → **Στείλε μου κωδικό** με το email σου → γράψε τον κωδικό → «Συνδέθηκες».
3. **Αποσύνδεση** → ξανά με **Συνέχεια με Google**.
4. Σε δεύτερο browser (ή σε ιδιωτικό παράθυρο): σύνδεση με τον ίδιο λογαριασμό → τα στοιχεία της επιχείρησης και το
   λογότυπο έρχονται μόνα τους.
5. Στο Supabase: **Table Editor → profiles** (μία γραμμή) και **Storage → logos** (ο φάκελός σου).
6. **Ο λογαριασμός μου → Διαγραφή λογαριασμού** → ο χρήστης φεύγει από το **Authentication → Users**, η γραμμή από το
   `profiles`, ο φάκελος από το `logos`. Στη συσκευή οι προσφορές μένουν.

## Δωρεάν όρια (Supabase Free)

- **Email:** το ενσωματωμένο email του Supabase έχει **πολύ χαμηλό όριο** (λίγα email την ώρα για όλο το project· δες
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
2. **CAPTCHA στην εγγραφή με Cloudflare Turnstile (δωρεάν).** Supabase: **Authentication → Attack Protection → CAPTCHA**
   → Turnstile, με τα κλειδιά από το Cloudflare. Χρειάζεται και αλλαγή κώδικα: το widget της Turnstile στην οθόνη
   σύνδεσης, το `captchaToken` στο `signInWithOtp`, και το `https://challenges.cloudflare.com` στη CSP
   (`script-src`, `frame-src`).
3. **Δικός μας πάροχος email** αντί του ενσωματωμένου (**Authentication → Emails → SMTP Settings**). Το email θα έρχεται
   από δική μας διεύθυνση, με τα όρια του παρόχου και όχι του Supabase.
4. **Supabase Pro** για **αυτόματα ημερήσια backup** (και χωρίς πάγωμα μετά από αδράνεια).
5. **Όροι** και **Απόρρητο**: πραγματικά κείμενα στη θέση των placeholders της οθόνης σύνδεσης.

## Τι ΔΕΝ κάνει ακόμα ο λογαριασμός

- Οι **προσφορές, το ημερολόγιο, οι τιμές** και ο **αριθμός προσφοράς** (`ergolav.quoteNo`) μένουν μόνο στη συσκευή. Ο
  συγχρονισμός τους είναι η επόμενη φάση.
- Σύνδεση και αποσύνδεση **δεν σβήνουν ποτέ** δεδομένα της συσκευής. Η αποσύνδεση αφορά **μόνο αυτή τη συσκευή**.
