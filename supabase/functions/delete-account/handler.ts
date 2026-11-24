// Διαγραφή λογαριασμού: σβήνει ΜΟΝΟ τον χρήστη του JWT που ήρθε με την αίτηση.
// Ο έλεγχος ασφαλείας είναι το JWT (επαλήθευση από τον auth server του Supabase). Το CORS είναι μόνο για τους
// browsers: λέει από ποιες διευθύνσεις επιτρέπεται η κλήση· δεν αντικαθιστά τον έλεγχο του JWT.
// Κανένα log ή μήνυμα δεν περιέχει email, όνομα, τηλέφωνο ή token.

// Οι διευθύνσεις της εφαρμογής, σε ΜΙΑ λίστα: εδώ μπαίνει αργότερα και το δικό μας domain.
export const ALLOWED_ORIGINS = [
  'https://aggelosemiris.github.io',
  'http://localhost:8087',
  'http://127.0.0.1:8087',
];

export const BUCKET = 'logos';
// «Ο πίνακας δεν υπάρχει»: PostgREST (PGRST205) ή Postgres (42P01).
const NO_TABLE = ['PGRST205', '42P01'];
// Η συνάρτηση δεν υπάρχει ακόμα (η migration των τιμών τεχνικών δεν έτρεξε): τίποτα να σβηστεί.
const NO_FUNCTION = ['PGRST202', '42883'];
// Η διαγραφή θέλει ΠΡΟΣΦΑΤΗ επιβεβαίωση ταυτότητας: η τελευταία σύνδεση (κωδικός, Google, κωδικός email) μέσα σε
// τόσα δευτερόλεπτα. Το JWT το γράφει στο «amr» (μέθοδος + χρόνος). Παλιό token (π.χ. κλεμμένο) → 403.
export const REAUTH_MAX_AGE_S = 600;

/** Ο πιο πρόσφατος χρόνος σύνδεσης (δευτερόλεπτα) από το amr του JWT· 0 αν δεν υπάρχει. */
export function lastAuthAt(jwt: string): number {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)));
    const amr = Array.isArray(claims.amr) ? claims.amr : [];
    return Math.max(0, ...amr.map((a: { timestamp?: number }) => Number(a?.timestamp) || 0));
  } catch { return 0; }
}

type Admin = {
  auth: {
    getUser(jwt: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    admin: { deleteUser(id: string): Promise<{ error: unknown }> };
  };
  // Ο πίνακας quotes (Φάση 3): delete().eq('user_id', uid).
  from(table: string): {
    delete(): { eq(column: string, value: string): Promise<{ error: { code?: string } | null }> };
  };
  // Τιμές από τεχνικούς: forget_tech_prices(p_uid) σβήνει όλες τις τιμές του (ψευδώνυμα) και τη συγκατάθεσή του.
  rpc(fn: string, args: Record<string, unknown>): Promise<{ error: { code?: string } | null }>;
  storage: {
    from(bucket: string): {
      list(prefix: string, opts: { limit: number; offset: number }): Promise<{ data: { name: string }[] | null; error: unknown }>;
      remove(paths: string[]): Promise<{ error: unknown }>;
    };
  };
};

export function corsHeaders(origin: string | null, allowed: string[] = ALLOWED_ORIGINS): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

/** Όλα τα αρχεία του χρήστη στο bucket (ο φάκελος <user_id>/), σε σελίδες των 100. */
async function userFiles(admin: Admin, uid: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const { data, error } = await admin.storage.from(BUCKET).list(uid, { limit: 100, offset });
    if (error) throw new Error('list_failed');
    for (const f of data ?? []) paths.push(`${uid}/${f.name}`);
    if (!data || data.length < 100) break;
  }
  return paths;
}

export async function handle(req: Request, admin: Admin, allowed: string[] = ALLOWED_ORIGINS, now: () => number = Date.now): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), allowed);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json(401, { error: 'not_signed_in' }, cors);
  const { data, error } = await admin.auth.getUser(jwt);
  const uid = data?.user?.id;
  if (error || !uid) return json(401, { error: 'not_signed_in' }, cors);
  // Το JWT επαληθεύτηκε παραπάνω· εδώ μόνο ο χρόνος της τελευταίας σύνδεσης.
  if (now() / 1000 - lastAuthAt(jwt) > REAUTH_MAX_AGE_S) return json(403, { error: 'reauth_required' }, cors);

  try {
    // Πρώτα τα αρχεία: το «on delete cascade» σβήνει το profile, όχι τα αρχεία του Storage.
    const files = await userFiles(admin, uid);
    if (files.length) {
      const { error: rmError } = await admin.storage.from(BUCKET).remove(files);
      if (rmError) throw new Error('remove_failed');
    }
    // Μετά οι προσφορές (Φάση 3). Το «on delete cascade» θα τις έπαιρνε κι αυτές· το κάνουμε ρητά ώστε μια αλλαγή
    // στο σχήμα να μην αφήσει ποτέ στοιχεία πελατών. Αν ο πίνακας δεν υπάρχει ακόμα (η migration δεν έτρεξε), συνεχίζει.
    const { error: qError } = await admin.from('quotes').delete().eq('user_id', uid);
    if (qError && !NO_TABLE.includes(String(qError.code ?? ''))) throw new Error('quotes_failed');
    // Οι τιμές από τεχνικούς δεν συνδέονται με τον λογαριασμό (μόνο ψευδώνυμο): σβήνονται ΠΡΙΝ φύγει το uid.
    const { error: tError } = await admin.rpc('forget_tech_prices', { p_uid: uid });
    if (tError && !NO_FUNCTION.includes(String(tError.code ?? ''))) throw new Error('tech_prices_failed');
    const { error: delError } = await admin.auth.admin.deleteUser(uid);
    if (delError) throw new Error('delete_failed');
  } catch (e) {
    // Μόνο ο κωδικός του βήματος που απέτυχε· κανένα στοιχείο χρήστη.
    console.error('delete-account:', e instanceof Error ? e.message : 'failed');
    return json(500, { error: 'delete_failed' }, cors);
  }
  return json(200, { deleted: true }, cors);
}
