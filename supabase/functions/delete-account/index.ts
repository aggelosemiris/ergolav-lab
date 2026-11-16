// Edge Function «delete-account» (Supabase, Deno). Λογική: ./handler.ts.
// Το SUPABASE_URL και το SUPABASE_SERVICE_ROLE_KEY τα δίνει το ίδιο το Supabase στις functions του project.
// Το service_role key υπάρχει ΜΟΝΟ εδώ (στα secrets της function) — ποτέ στην εφαρμογή ή στο git.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(req => handle(req, admin));
