// Η διεύθυνση της υπηρεσίας «Άλλαξέ το» (worker/, Cloudflare Workers). Μπαίνει εδώ μετά το deploy του worker
// (βλ. worker/README.md). Κενό = η υπηρεσία δεν έχει ρυθμιστεί ακόμα· το «Άλλαξέ το» το λέει στον τεχνίτη.
// Δεν είναι μυστικό: το κλειδί του AI μένει μόνο στον worker, ποτέ στην εφαρμογή.
export const REWRITE_URL = '';

// ── Λογαριασμός (Supabase Free + Google OAuth) — βλ. docs/AUTH_SETUP.md ──
// AUTH_ENABLED = false: η εφαρμογή είναι ακριβώς όπως πριν (ούτε κουμπί, ούτε φόρτωμα του Supabase).
// Το anon key είναι ΔΗΜΟΣΙΟ (το προστατεύει το Row Level Security) και επιτρέπεται εδώ. Το service_role key ΠΟΤΕ
// στην εφαρμογή ή στο git: υπάρχει μόνο στα secrets της Edge Function «delete-account».
// Η διεύθυνση γράφεται ΚΑΙ στη CSP του index.html (connect-src)· το test/account.test.js ελέγχει ότι ταιριάζουν.
export const AUTH_ENABLED = false;
export const SUPABASE_URL = 'https://your-project-ref.supabase.co';
export const SUPABASE_ANON_KEY = 'your-anon-key';
// Cloudflare Turnstile (δωρεάν CAPTCHA) στην αποστολή κωδικού email. Το site key είναι δημόσιο· το secret key
// ΜΟΝΟ στο Supabase (Authentication → Attack Protection). Κενό = χωρίς CAPTCHA.
export const TURNSTILE_SITE_KEY = '';
