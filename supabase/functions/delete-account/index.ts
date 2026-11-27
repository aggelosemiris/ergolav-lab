// Edge Function «delete-account» (Supabase, Deno). Λογική: ./handler.ts.
// Το SUPABASE_URL και τα κλειδιά (SUPABASE_SECRET_KEYS, και όσο ζουν τα παλιά το SUPABASE_SERVICE_ROLE_KEY) τα δίνει
// το ίδιο το Supabase στις functions του project. Ποιο κλειδί: adminKey στο ./handler.ts (docs/security/keys.md).
// Το μυστικό κλειδί υπάρχει ΜΟΝΟ εδώ — ποτέ στην εφαρμογή ή στο git.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle, adminKey } from './handler.ts';

const { key, kind } = adminKey(name => Deno.env.get(name));
console.log(JSON.stringify({event: 'delete-account-start', key: kind}));   // μόνο το είδος, ποτέ η τιμή
const admin = createClient(Deno.env.get('SUPABASE_URL')!, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(req => handle(req, admin));
