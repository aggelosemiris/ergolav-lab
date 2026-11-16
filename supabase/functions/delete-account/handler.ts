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

type Admin = {
  auth: {
    getUser(jwt: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    admin: { deleteUser(id: string): Promise<{ error: unknown }> };
  };
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

export async function handle(req: Request, admin: Admin, allowed: string[] = ALLOWED_ORIGINS): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), allowed);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json(401, { error: 'not_signed_in' }, cors);
  const { data, error } = await admin.auth.getUser(jwt);
  const uid = data?.user?.id;
  if (error || !uid) return json(401, { error: 'not_signed_in' }, cors);

  try {
    // Πρώτα τα αρχεία: το «on delete cascade» σβήνει το profile, όχι τα αρχεία του Storage.
    const files = await userFiles(admin, uid);
    if (files.length) {
      const { error: rmError } = await admin.storage.from(BUCKET).remove(files);
      if (rmError) throw new Error('remove_failed');
    }
    const { error: delError } = await admin.auth.admin.deleteUser(uid);
    if (delError) throw new Error('delete_failed');
  } catch (e) {
    // Μόνο ο κωδικός του βήματος που απέτυχε· κανένα στοιχείο χρήστη.
    console.error('delete-account:', e instanceof Error ? e.message : 'failed');
    return json(500, { error: 'delete_failed' }, cors);
  }
  return json(200, { deleted: true }, cors);
}
