// Η διεύθυνση της υπηρεσίας «Άλλαξέ το» (worker/, Cloudflare Workers). Μπαίνει εδώ μετά το deploy του worker
// (βλ. worker/README.md). Κενό = η υπηρεσία δεν έχει ρυθμιστεί ακόμα· το «Άλλαξέ το» το λέει στον τεχνίτη.
// Δεν είναι μυστικό: το κλειδί του AI μένει μόνο στον worker, ποτέ στην εφαρμογή.
// ΑΣΦΑΛΕΙΑ: όταν μπει εδώ, η ΑΚΡΙΒΗΣ διεύθυνση (π.χ. https://xxx.ergolav.workers.dev) πρέπει να προστεθεί και στη
// CSP του index.html (connect-src) — ΠΟΤΕ wildcard (https://*.workers.dev): ο καθένας φτιάχνει δωρεάν subdomain
// workers.dev, οπότε το wildcard θα άνοιγε κανάλι εξαγωγής δεδομένων. Το test/account.test.js το ελέγχει.
export const REWRITE_URL = '';

// ── Λογαριασμός (Supabase Free + Google OAuth) — βλ. docs/AUTH_SETUP.md ──
// AUTH_ENABLED = false: η εφαρμογή είναι ακριβώς όπως πριν (ούτε κουμπί, ούτε φόρτωμα του Supabase).
// Το anon key είναι ΔΗΜΟΣΙΟ (το προστατεύει το Row Level Security) και επιτρέπεται εδώ. Το service_role key ΠΟΤΕ
// στην εφαρμογή ή στο git: υπάρχει μόνο στα secrets της Edge Function «delete-account».
// Η διεύθυνση γράφεται ΚΑΙ στη CSP του index.html (connect-src)· το test/account.test.js ελέγχει ότι ταιριάζουν.
export const AUTH_ENABLED = true;
export const SUPABASE_URL = 'https://myyecdraxrkkwojppglb.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15eWVjZHJheHJra3dvanBwZ2xiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NjYxOTgsImV4cCI6MjExMDQ0MjE5OH0._tiqtv66vgVAr37-BVfxgz8I9aJslmU8MFiPgCgXg_0';
// Cloudflare Turnstile (δωρεάν CAPTCHA) στην αποστολή κωδικού email. Το site key είναι δημόσιο· το secret key
// ΜΟΝΟ στο Supabase (Authentication → Attack Protection). Κενό = χωρίς CAPTCHA.
export const TURNSTILE_SITE_KEY = '0x4AAAAAAGEQsmQ8gtAQ0mHi';

// «Άλλαξέ το» χωρίς AI (bot με έτοιμα, εγκεκριμένα κείμενα) — βλ. docs/ALLAXE_BOT.md.
// false: η εφαρμογή είναι ακριβώς όπως πριν. true: η ανάλυση κάθε εργασίας διαλέγεται από επιλογή/κανόνα/φωνή/βασική,
// με ετικέτα μόνο στην οθόνη, και η εφαρμογή ΔΕΝ καλεί ποτέ τον worker (REWRITE_URL) ή οποιοδήποτε AI.
export const ALLAXE_BOT_ENABLED = true;

// Συγχρονισμός προσφορών με τον λογαριασμό (Φάση 3) — βλ. docs/sync.md.
// false: οι προσφορές μένουν μόνο στη συσκευή, όπως πριν. true ΜΟΝΟ αφού τρέξει στη Supabase η migration
// supabase/migrations/20261123000000_quotes.sql (και ενημερωθεί το Απόρρητο: οι προσφορές ανεβαίνουν στον λογαριασμό).
export const QUOTES_SYNC_ENABLED = false;

// Νέες λίστες υλικών ανά ειδικότητα (data/materials/*.txt) στην εβδομαδιαία ενημέρωση τιμών — βλ. docs/PRICE_MONITORING.md.
// false: ΑΚΡΙΒΩΣ η σημερινή συμπεριφορά (κανόνες αντιστοίχισης, προμηθευτές, οθόνη τιμών, «Άλλη τιμή»). true: συνώνυμα και
// παραλλαγές των νέων λιστών στο ταίριασμα, Vrontinos με τη διαγραμμένη τιμή ως κανονική και 20 υποκατηγορίες,
// «τιμή από…»/«έλεγξέ την» δίπλα στην τιμή προμηθευτών, και η δική σου τιμή για είδη εκτός καταλόγου προτείνεται αυτόματα.
// Το parser της εφαρμογής (src/parse.js) ΔΕΝ αλλάζει σε καμία περίπτωση.
export const MATERIALS_V2_ENABLED = false;
