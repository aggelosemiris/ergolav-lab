// Λογαριασμός (Supabase): σύνδεση με Google ή με email και κωδικό πρόσβασης (επιβεβαίωση email και επαναφορά κωδικού
// με κωδικό 6 ψηφίων), αποσύνδεση, διαγραφή, μεταφορά προφίλ.
// Χωρίς DOM: η οθόνη είναι στο account-ui.js. Ο client του Supabase δίνεται απ' έξω (στα τεστ, ψεύτικος).
//
// Κανόνες:
// - Σύνδεση/αποσύνδεση ΔΕΝ σβήνουν ποτέ προσφορές, ημερολόγιο, τιμές ή τον αριθμό προσφοράς (ergolav.quoteNo).
// - Πριν γραφτεί στη συσκευή προφίλ από τον λογαριασμό: αντίγραφο ασφαλείας (profile.js · backupProfile).
// - Κανένα μήνυμα ή log δεν περιέχει email, τηλέφωνο, όνομα ή token: τα λάθη γίνονται σταθερά ελληνικά μηνύματα.
// Ρυθμίσεις ως namespace: αν λείπουν (π.χ. παλιό ή δοκιμαστικό config.js), ο λογαριασμός μένει κλειστός —
// ποτέ σφάλμα φόρτωσης που θα σταματούσε όλη την εφαρμογή.
import * as CONFIG from './config.js';
import { loadProfile, saveProfile, getLogo, backupProfile } from './profile.js';
import { online as netOnline } from './net.js';

export const LIB_URL = 'vendor/supabase-2.118.0.js';
export const BUCKET = 'logos';
// Λήξη του κωδικού email: ίδια με το «Email OTP Expiration» του Supabase (docs/AUTH_SETUP.md: 600 δευτ.).
export const OTP_TTL_S = 600;
export const PENDING = 'ergolav.account.pendingUpload';   // στοιχεία που άλλαξαν χωρίς ίντερνετ: ανεβαίνουν μετά
// Παράμετροι που αφήνει η σύνδεση Google στη διεύθυνση (PKCE): σβήνονται μόλις διαβαστούν.
const AUTH_PARAMS = ['code', 'state', 'error', 'error_code', 'error_description'];

export const MSG = {
  offline: 'Δεν υπάρχει σύνδεση στο ίντερνετ. Η εφαρμογή δουλεύει κανονικά· δοκίμασε τη σύνδεση στον λογαριασμό αργότερα.',
  wrong: 'Λάθος κωδικός. Έλεγξε τα 6 ψηφία στο email και ξαναδοκίμασε.',
  expired: 'Ο κωδικός έληξε. Πάτα «Στείλε ξανά» για νέο κωδικό.',
  tooMany: 'Πολλές προσπάθειες. Περίμενε λίγα λεπτά και ξαναδοκίμασε.',
  // Το ενσωματωμένο email του Supabase στέλνει ελάχιστα email την ώρα: το Google δεν έχει αυτό το όριο.
  tooManySends: 'Πολλές αποστολές αυτή τη στιγμή. Συνέχισε με Google ή δοκίμασε σε λίγο.',
  captcha: 'Ο έλεγχος ασφαλείας δεν ολοκληρώθηκε. Ξαναδοκίμασε ή συνέχισε με Google.',
  captchaLoad: 'Ο έλεγχος ασφαλείας δεν φόρτωσε. Συνέχισε με Google ή δοκίμασε ξανά σε λίγο.',
  badEmail: 'Το email δεν φαίνεται σωστό. Έλεγξέ το (π.χ. onoma@gmail.com).',
  badCode: 'Ο κωδικός έχει 6 ψηφία.',
  google: 'Η σύνδεση με Google δεν ολοκληρώθηκε. Ξαναδοκίμασε.',
  session: 'Η σύνδεση έληξε. Συνδέσου ξανά και ξαναδοκίμασε.',
  noBackup: 'Η συσκευή δεν έχει χώρο για αντίγραφο ασφαλείας· τα στοιχεία της δεν άλλαξαν.',
  notConfigured: 'Ο λογαριασμός δεν έχει ρυθμιστεί ακόμα.',
  generic: 'Κάτι πήγε στραβά. Ξαναδοκίμασε σε λίγο.',
  // ── email + κωδικός πρόσβασης ──
  // Ποτέ «λάθος email» ή «λάθος κωδικός» χωριστά: δεν λέμε σε κανέναν αν ένα email έχει λογαριασμό.
  badLogin: 'Λάθος email ή κωδικός. Αν έφτιαξες τον λογαριασμό με Google, πάτα «Συνέχεια με Google» ή «Ξέχασα τον κωδικό» για να ορίσεις κωδικό.',
  exists: 'Αυτό το email έχει ήδη λογαριασμό. Πάτα «Σύνδεση». Αν τον έφτιαξες με Google, πάτα «Συνέχεια με Google» ή «Ξέχασα τον κωδικό» για να ορίσεις κωδικό.',
  weak: 'Ο κωδικός θέλει τουλάχιστον 8 χαρακτήρες, με τουλάχιστον 1 λατινικό γράμμα (a–z) και 1 αριθμό (0–9).',
  latin: 'Τα ελληνικά γράμματα δεν μετράνε· βάλε κι ένα λατινικό (a–z).',
  mismatch: 'Οι δύο κωδικοί δεν είναι ίδιοι.',
  samePassword: 'Ο νέος κωδικός είναι ίδιος με τον παλιό.',
  wrongCurrent: 'Ο τωρινός κωδικός δεν είναι σωστός.',
  notConfirmed: 'Το email δεν έχει επιβεβαιωθεί ακόμα. Πάτα «Στείλε κωδικό επιβεβαίωσης».',
  noPassword: 'Γράψε τον κωδικό σου.',
  terms: 'Για να φτιάξεις λογαριασμό, αποδέξου τους Όρους και το Απόρρητο.',
  reauth: 'Για ασφάλεια, επιβεβαίωσε ξανά ότι είσαι εσύ (κωδικός ή Google) και ξαναδοκίμασε.',
  sameEmail: 'Αυτό είναι ήδη το email του λογαριασμού σου.',
  needCurrent: 'Γράψε τον τωρινό κωδικό σου.',
  relogin: 'Η σύνδεση έληξε. Συνδέσου ξανά για να συνεχίσεις — ό,τι έγραφες δεν χάθηκε.',
};
/** Μετά από 5 λάθος κωδικούς: αναμονή (30″, 60″, … έως 5′) — ποτέ κλείδωμα για πάντα. */
export const throttleText = sec => `Πολλές λάθος προσπάθειες. Ξαναδοκίμασε σε ${sec >= 60 ? `${Math.ceil(sec / 60)}′` : `${sec}″`}.`;
export const THROTTLE_AFTER = 5, THROTTLE_BASE_S = 30, THROTTLE_MAX_S = 300;

// ── Κανόνες κωδικού: ΙΔΙΟΙ με του Supabase (password_min_length 8, γράμματα και αριθμοί) ──
export const PASSWORD_MIN = 8;
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
/** {rules: {len, letter, digit, match}, ok, strength: 'weak' | 'good' | 'strong'} */
export function passwordCheck(pw = '', repeat = null){
  const rules = {len: pw.length >= PASSWORD_MIN, letter: /[A-Za-z]/.test(pw), digit: /\d/.test(pw)};
  if(repeat !== null) rules.match = pw.length > 0 && pw === repeat;
  const base = rules.len && rules.letter && rules.digit;
  const extra = [pw.length >= 12, /[a-z]/.test(pw) && /[A-Z]/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
  const strength = !base ? 'weak' : extra >= 2 ? 'strong' : 'good';
  return {rules, ok: Object.values(rules).every(Boolean), strength};
}

/** Ελληνικά γράμματα χωρίς κανένα λατινικό: ο κανόνας «γράμμα» δεν περνά (το Supabase μετρά μόνο a–z)· η οθόνη
 * το λέει ρητά (MSG.latin), αλλιώς ο τεχνίτης βλέπει γράμματα στον κωδικό του και δεν καταλαβαίνει γιατί δεν περνά. */
export const needsLatin = (pw = '') => /\p{Script=Greek}/u.test(pw) && !/[A-Za-z]/.test(pw);

export const configured = (c = CONFIG) =>
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.SUPABASE_URL || '') && !!c.SUPABASE_ANON_KEY && c.SUPABASE_ANON_KEY !== 'your-anon-key';

// Σήμα: ο browser (navigator.onLine) ΚΑΙ ό,τι έμαθε το net.js από αιτήματα που απέτυχαν.
const isOnline = win => !(win?.navigator && win.navigator.onLine === false) && netOnline();
// Χωρίς απάντηση σε τόσο χρόνο (κακό σήμα): μήνυμα «χωρίς ίντερνετ» αντί για κουμπί που περιμένει για πάντα.
export const TIMEOUT_MS = 15000;
function timeout(p, ms = TIMEOUT_MS){
  let t;
  return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new TypeError('timeout')), ms); })]).finally(() => clearTimeout(t));
}

/** Σφάλμα του Supabase → ένα από τα MSG. Ποτέ το κείμενο του σφάλματος (μπορεί να περιέχει το email). */
export function errorText(err, {sentAt = 0, now = Date.now(), online = true, send = false} = {}){
  if(!err) return '';
  const code = String(err.code || err.error_code || ''), status = Number(err.status || err.context?.status || 0);
  const name = String(err.name || ''), text = String(err.message || '');
  if(!online || name === 'AuthRetryableFetchError' || name === 'FunctionsFetchError' || err instanceof TypeError
    || /failed to fetch|networkerror|load failed/i.test(text)) return MSG.offline;
  if(/captcha/.test(code) || /captcha/i.test(text)) return MSG.captcha;
  if(code === 'invalid_credentials' || /invalid login credentials/i.test(text)) return MSG.badLogin;
  if(code === 'email_not_confirmed' || /email not confirmed/i.test(text)) return MSG.notConfirmed;
  if(/user_already_exists|email_exists|identity_already_exists/.test(code) || /already registered/i.test(text)) return MSG.exists;
  if(code === 'weak_password' || err.name === 'AuthWeakPasswordError') return MSG.weak;
  if(code === 'same_password') return MSG.samePassword;
  if(code === 'current_password_required') return MSG.needCurrent;
  if(/current_password|invalid_current_password/.test(code) || /current password/i.test(text)) return MSG.wrongCurrent;
  if(code === 'reauthentication_needed' || code === 'reauth_required' || /reauthenticat/i.test(text)) return MSG.reauth;
  if(/over_email_send_rate_limit/.test(code) || (send && (status === 429 || /rate_limit|too_many/.test(code)))) return MSG.tooManySends;
  if(status === 429 || /rate_limit|too_many/.test(code)) return MSG.tooMany;
  if(code === 'otp_expired' || /token has expired or is invalid|invalid otp|otp has expired/i.test(text))
    return sentAt && now - sentAt > OTP_TTL_S * 1000 ? MSG.expired : MSG.wrong;
  if(/email_address_invalid|validation_failed/.test(code) || /invalid.*email|email.*invalid/i.test(text)) return MSG.badEmail;
  if(status === 401 || /session_not_found|bad_jwt|no_authorization/.test(code)) return MSG.session;
  return MSG.generic;
}

/** Ό,τι χρειάζεται η οθόνη από τον χρήστη: id, email, όνομα για την κεφαλίδα, τρόπος σύνδεσης. */
export function summarize(u){
  if(!u?.id) return null;
  const meta = u.user_metadata || {};
  const full = String(meta.full_name || meta.name || meta.given_name || '').trim();
  const name = (full.split(/\s+/)[0] || String(u.email || '').split('@')[0] || 'Λογαριασμός').slice(0, 16);
  const providers = [...new Set([...(u.identities || []).map(i => i.provider), ...(u.app_metadata?.providers || [])].filter(Boolean))];
  return {id: u.id, email: u.email || '', name, provider: u.app_metadata?.provider || 'email',
    providers: providers.length ? providers : [u.app_metadata?.provider || 'email'], confirmed: !!(u.email_confirmed_at || u.confirmed_at)};
}

const refOf = cfg => { try { return new URL(cfg.SUPABASE_URL).hostname.split('.')[0]; } catch { return ''; } };
/**
 * Η συνεδρία που κράτησε η βιβλιοθήκη στη συσκευή (sb-<project>-auth-token), ΧΩΡΙΣ δίκτυο. Ακόμα και ληγμένη μετράει:
 * ο τεχνίτης στο εργοτάξιο δεν κλειδώνεται έξω επειδή δεν έχει σήμα· ανανεώνεται μόνη της όταν βρει.
 */
export function storedSession(cfg = CONFIG, win = globalThis){
  try {
    const raw = win.localStorage?.getItem(`sb-${refOf(cfg)}-auth-token`);
    const s = raw ? JSON.parse(raw) : null;
    const sess = s?.currentSession || s;           // παλιές και νέες μορφές της βιβλιοθήκης
    return sess?.refresh_token && sess?.user?.id ? sess : null;
  } catch { return null; }
}
/** Υποχρεωτικός λογαριασμός: required = ανοιχτό και ρυθμισμένο· locked = χωρίς αποθηκευμένη συνεδρία. */
export function authGate(cfg = CONFIG, win = globalThis){
  const required = !!cfg.AUTH_ENABLED && configured(cfg);
  return {required, locked: required && !storedSession(cfg, win)};
}

// ── εικόνα ↔ data URL χωρίς FileReader (δουλεύει και στα τεστ) ──
export function dataUrlToBlob(url){
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(url || '');
  if(!m) return null;
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {type: m[1]});
}
export async function blobToDataUrl(blob){
  const type = /^image\/(png|jpeg)$/.test(blob?.type) ? blob.type : null;
  if(!type) return '';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for(let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/** Το id του λογοτύπου μέσα στη διαδρομή του bucket: <user_id>/<id>.<png|jpg>. */
const logoIdOf = path => /\/([0-9a-f]{8})\.(?:png|jpe?g)$/.exec(path || '')?.[1] || '';
const norm = v => String(v ?? '').trim();

/** Ίδια στοιχεία; (όνομα, ειδικότητα, τηλέφωνο, λογότυπο) */
export function sameProfile(local, remote){
  return norm(local?.name) === norm(remote?.business_name) && norm(local?.trade) === norm(remote?.specialty)
    && norm(local?.phone) === norm(remote?.phone) && norm(local?.logo) === logoIdOf(remote?.logo_path);
}
/** Ο λογαριασμός έχει στοιχεία επιχείρησης; (η γραμμή φτιάχνεται άδεια με την εγγραφή) */
export const remoteHasProfile = r => !!norm(r?.business_name);

/**
 * fetch για τη βιβλιοθήκη: απάντηση του /auth/v1/ που ΔΕΝ είναι JSON (σελίδα Wi-Fi ξενοδοχείου, «captive portal»)
 * γίνεται σφάλμα δικτύου. Αλλιώς η βιβλιοθήκη θα τη θεωρούσε απόρριψη του token και θα έσβηνε τη συνεδρία: ο τεχνίτης
 * θα αποσυνδεόταν χωρίς να έχει πραγματικά σήμα.
 */
export function authFetch(cfg, win = globalThis){
  const auth = `${cfg.SUPABASE_URL}/auth/v1/`;
  return async (input, init) => {
    const r = await win.fetch(input, init);
    const url = typeof input === 'string' ? input : input?.url || '';
    if(url.startsWith(auth) && r.status !== 204 && !/json/i.test(r.headers.get('content-type') || '')) throw new TypeError('Failed to fetch (όχι JSON)');
    return r;
  };
}

/** Φορτώνει τη βιβλιοθήκη από το vendor/ (ίδιο site, όπως ζητά η CSP) μόνο όταν χρειαστεί. */
export function loadClient(cfg, win = globalThis){
  return new Promise((ok, fail) => {
    const make = () => win.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
      global: {fetch: authFetch(cfg, win)},
    });
    if(win.supabase?.createClient) return ok(make());
    const s = win.document.createElement('script');
    s.src = LIB_URL; s.async = true;
    s.onload = () => win.supabase?.createClient ? ok(make()) : fail(new TypeError('load failed'));
    s.onerror = () => fail(new TypeError('load failed'));
    win.document.head.appendChild(s);
  });
}

/**
 * config: {AUTH_ENABLED, SUPABASE_URL, SUPABASE_ANON_KEY}. getClient(config) → client του Supabase.
 * win: window (location, history, localStorage, navigator). now(): η ώρα (για τα τεστ).
 */
export function createAccount({config = CONFIG, getClient = c => loadClient(c), win = globalThis, now = Date.now, timeoutMs = TIMEOUT_MS} = {}){
  let client = null, sentAt = 0, expectSignOut = false, pwKnown = null;
  const listeners = new Set(), lockListeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(user); } catch {} });
  const enabled = !!config.AUTH_ENABLED && configured(config);
  // Από την αποθηκευμένη συνεδρία, χωρίς δίκτυο: η εφαρμογή ανοίγει αμέσως, και χωρίς σήμα.
  let user = enabled ? summarize(storedSession(config, win)?.user) : null;
  // Λάθος κωδικοί στη σύνδεση: μετά από THROTTLE_AFTER, αναμονή που διπλασιάζεται (μένει στη συνεδρία της καρτέλας).
  const ss = () => { try { return win.sessionStorage ?? null; } catch { return null; } };
  const THR = 'ergolav.account.throttle';
  const thr = () => { try { return JSON.parse(ss()?.getItem(THR) || '{}'); } catch { return {}; } };
  const setThr = v => { try { ss()?.setItem(THR, JSON.stringify(v)); } catch {} };
  const waitLeft = () => Math.max(0, Math.ceil(((thr().until || 0) - now()) / 1000));
  const fail = field => e => ({error: err(e), field});
  const setUser = u => { user = summarize(u); emit(); return user; };
  const knowPw = v => { pwKnown = user ? {id: user.id, v} : null; };
  const err = e => errorText(e, {sentAt, now: now(), online: isOnline(win)});
  const store = () => { try { return win.localStorage ?? null; } catch { return null; } };
  const ref = enabled ? new URL(config.SUPABASE_URL).hostname.split('.')[0] : '';
  async function c(){ if(!client) client = await getClient(config); return client; }
  // Κλήση προς το Supabase: χωρίς ίντερνετ απαντά αμέσως, αλλιώς το πολύ σε TIMEOUT_MS.
  const call = async f => { if(!isOnline(win)) throw new TypeError('offline'); return timeout(f(await c()), timeoutMs); };

  /** Σβήνει τις παραμέτρους της σύνδεσης Google από τη διεύθυνση: όχι στο ιστορικό, όχι ξανά σε ανανέωση. */
  function cleanUrl(){
    try {
      const url = new URL(win.location.href);
      if(!AUTH_PARAMS.some(k => url.searchParams.has(k))) return false;
      AUTH_PARAMS.forEach(k => url.searchParams.delete(k));
      const q = url.searchParams.toString();
      win.history.replaceState(win.history.state, '', url.pathname + (q ? `?${q}` : '') + url.hash);
      return true;
    } catch { return false; }
  }
  // Η συνεδρία του Supabase στη συσκευή (sb-<project>-…): μόνο αυτή σβήνεται στην αποσύνδεση.
  function dropLocalSession(){
    const s = store(); if(!s || !ref) return;
    const keys = [];
    for(let i = 0; i < s.length; i++){ const k = s.key(i); if(k?.startsWith(`sb-${ref}-`)) keys.push(k); }
    keys.forEach(k => { try { s.removeItem(k); } catch {} });
  }

  return {
    enabled,
    user: () => user,
    onChange(f){ listeners.add(f); return () => listeners.delete(f); },

    /** Στο άνοιγμα: συνεδρία που έμεινε ανοιχτή, ή επιστροφή από το Google. {user, fresh, error}. Δεν ρίχνει ποτέ. */
    async init(){
      if(!enabled) return {user: null};
      let fresh = false, error = '';
      try {
        const url = new URL(win.location.href);
        const fromGoogle = url.searchParams.has('code'), denied = url.searchParams.has('error');
        const cl = await c();
        // Το getSession περιμένει να ολοκληρωθεί η ανταλλαγή του ?code= (PKCE) από τη βιβλιοθήκη.
        const {data, error: e} = await cl.auth.getSession();
        user = summarize(data?.session?.user);
        if(fromGoogle && user) fresh = true;
        if(denied) error = MSG.google;
        else if(fromGoogle && !user) error = !isOnline(win) ? MSG.offline : (e ? err(e) : MSG.google);
        // Χωρίς σήμα η βιβλιοθήκη δεν ανανεώνει τη συνεδρία· η αποθηκευμένη ισχύει μέχρι να βρει σήμα.
        if(!user && !fromGoogle) user = summarize(storedSession(config, win)?.user);
        cl.auth.onAuthStateChange((ev, session) => {
          const u = summarize(session?.user);
          // Η συνεδρία έληξε ή ανακλήθηκε (π.χ. «Αποσύνδεση από όλες τις συσκευές» αλλού) ΧΩΡΙΣ να το ζητήσει εδώ.
          // Χωρίς σήμα ΠΟΤΕ: ο τεχνίτης δεν αποσυνδέεται επειδή δεν βρήκε τον server.
          if(ev === 'SIGNED_OUT' && !expectSignOut && user && !isOnline(win)) return;
          if(ev === 'SIGNED_OUT' && !expectSignOut && user){ user = null; emit(); lockListeners.forEach(f => { try { f('expired'); } catch {} }); return; }
          if(u && (u.id !== user?.id || u.email !== user?.email || u.confirmed !== user?.confirmed)){ user = u; emit(); }
        });
      } catch(e) { error = err(e); }
      cleanUrl();
      emit();
      return {user, fresh, error};
    },

    async signInGoogle(){
      if(!enabled) return {error: MSG.notConfigured};
      try {
        const {error} = await call(cl => cl.auth.signInWithOAuth({provider: 'google',
          options: {redirectTo: win.location.origin + win.location.pathname}}));
        return {error: error ? err(error) : ''};
      } catch(e) { return {error: err(e)}; }
    },

    // ── Εγγραφή: email + κωδικός → κωδικός 6 ψηφίων στο email (επιβεβαίωση) ──
    /** {error, field} ή {needsConfirm: true} (στάλθηκε κωδικός) ή {user} (το project δεν ζητά επιβεβαίωση). */
    async signUp(email, password, {captchaToken = '', repeat = null, terms = true} = {}){
      email = norm(email).toLowerCase();
      if(!validEmail(email)) return {error: MSG.badEmail, field: 'email'};
      const chk = passwordCheck(password || '', repeat);
      if(!chk.rules.len || !chk.rules.letter || !chk.rules.digit) return {error: MSG.weak, field: 'password'};
      if(repeat !== null && !chk.rules.match) return {error: MSG.mismatch, field: 'repeat'};
      if(!terms) return {error: MSG.terms, field: 'terms'};
      if(!enabled) return {error: MSG.notConfigured};
      try {
        const {data, error} = await call(cl => cl.auth.signUp({email, password, options: {...(captchaToken && {captchaToken})}}));
        if(error) return {error: errorText(error, {online: isOnline(win), send: true}), field: /exists|registered/.test(String(error.code || error.message)) ? 'email' : (error.code === 'weak_password' ? 'password' : undefined)};
        // Υπάρχον email: το Supabase δεν το λέει ρητά (προστασία) — επιστρέφει χρήστη χωρίς ταυτότητες.
        if(data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return {error: MSG.exists, field: 'email'};
        sentAt = now();
        if(data?.session) return {user: setUser(data.session.user)};
        return {needsConfirm: true};
      } catch(e) { return fail()(e); }
    },
    /** Ο κωδικός 6 ψηφίων της επιβεβαίωσης email. */
    async confirmSignup(email, code){
      code = norm(code).replace(/\s/g, '');
      if(!/^\d{6}$/.test(code)) return {error: MSG.badCode, field: 'code'};
      try {
        const {data, error} = await call(cl => cl.auth.verifyOtp({email: norm(email).toLowerCase(), token: code, type: 'signup'}));
        if(error || !data?.user) return {error: err(error || {code: 'otp_expired'}), field: 'code'};
        return {user: setUser(data.user)};
      } catch(e) { return fail('code')(e); }
    },
    async resendConfirm(email, {captchaToken = ''} = {}){
      email = norm(email).toLowerCase();
      if(!validEmail(email)) return {error: MSG.badEmail, field: 'email'};
      try {
        const {error} = await call(cl => cl.auth.resend({type: 'signup', email, options: {...(captchaToken && {captchaToken})}}));
        if(error) return {error: errorText(error, {online: isOnline(win), send: true})};
        sentAt = now();
        return {error: ''};
      } catch(e) { return fail()(e); }
    },

    // ── Σύνδεση: email + κωδικός ──
    /** Μετά από THROTTLE_AFTER λάθος κωδικούς: {error, wait} χωρίς κλήση, μέχρι να περάσει η αναμονή. */
    async signIn(email, password, {captchaToken = ''} = {}){
      email = norm(email).toLowerCase();
      const left = waitLeft();
      if(left) return {error: throttleText(left), wait: left};
      if(!validEmail(email)) return {error: MSG.badEmail, field: 'email'};
      if(!password) return {error: MSG.noPassword, field: 'password'};
      try {
        const {data, error} = await call(cl => cl.auth.signInWithPassword({email, password, options: {...(captchaToken && {captchaToken})}}));
        if(error){
          const msg = err(error);
          if(msg === MSG.badLogin){
            const t = thr(), n = (t.n || 0) + 1, over = n - THROTTLE_AFTER;
            const wait = over >= 0 ? Math.min(THROTTLE_MAX_S, THROTTLE_BASE_S * 2 ** over) : 0;
            setThr({n, until: wait ? now() + wait * 1000 : 0});
            if(wait) return {error: throttleText(wait), wait, field: 'password'};
          }
          return {error: msg, field: msg === MSG.badLogin ? 'password' : undefined, notConfirmed: msg === MSG.notConfirmed};
        }
        setThr({});
        return {user: setUser(data.user)};
      } catch(e) { return fail()(e); }
    },
    throttleLeft: waitLeft,

    // ── Ξέχασα τον κωδικό: κωδικός 6 ψηφίων στο email → νέος κωδικός ──
    async requestReset(email, {captchaToken = ''} = {}){
      email = norm(email).toLowerCase();
      if(!validEmail(email)) return {error: MSG.badEmail, field: 'email'};
      try {
        const {error} = await call(cl => cl.auth.resetPasswordForEmail(email, {...(captchaToken && {captchaToken})}));
        if(error) return {error: errorText(error, {online: isOnline(win), send: true})};
        sentAt = now();
        return {error: ''};
      } catch(e) { return fail()(e); }
    },
    async verifyReset(email, code){
      code = norm(code).replace(/\s/g, '');
      if(!/^\d{6}$/.test(code)) return {error: MSG.badCode, field: 'code'};
      try {
        const {data, error} = await call(cl => cl.auth.verifyOtp({email: norm(email).toLowerCase(), token: code, type: 'recovery'}));
        if(error || !data?.user) return {error: err(error || {code: 'otp_expired'}), field: 'code'};
        setThr({});
        return {user: setUser(data.user)};
      } catch(e) { return fail('code')(e); }
    },
    /** Νέος κωδικός (μετά την επαναφορά, ή αλλαγή με τον τωρινό: current). */
    async setPassword(password, repeat, {current = null} = {}){
      const chk = passwordCheck(password || '', repeat);
      if(!chk.rules.len || !chk.rules.letter || !chk.rules.digit) return {error: MSG.weak, field: 'password'};
      if(!chk.rules.match) return {error: MSG.mismatch, field: 'repeat'};
      if(current !== null && !current) return {error: MSG.noPassword, field: 'current'};
      try {
        const attrs = {password, ...(current !== null && {current_password: current})};
        const {data, error} = await call(cl => cl.auth.updateUser(attrs));
        if(error){ const m = err(error); if(m === MSG.needCurrent) knowPw(true); return {error: m, field: [MSG.wrongCurrent, MSG.needCurrent].includes(m) ? 'current' : 'password'}; }
        knowPw(true);
        return {user: setUser(data.user)};
      } catch(e) { return fail()(e); }
    },

    // ── Αλλαγή email: κωδικός 6 ψηφίων στο ΝΕΟ email ──
    async changeEmail(newEmail){
      newEmail = norm(newEmail).toLowerCase();
      if(!validEmail(newEmail)) return {error: MSG.badEmail, field: 'email'};
      if(newEmail === user?.email) return {error: MSG.sameEmail, field: 'email'};
      try {
        const {error} = await call(cl => cl.auth.updateUser({email: newEmail}));
        if(error) return {error: errorText(error, {online: isOnline(win), send: true}), field: 'email'};
        sentAt = now();
        return {error: ''};
      } catch(e) { return fail('email')(e); }
    },
    async confirmEmailChange(newEmail, code){
      code = norm(code).replace(/\s/g, '');
      if(!/^\d{6}$/.test(code)) return {error: MSG.badCode, field: 'code'};
      try {
        const {data, error} = await call(cl => cl.auth.verifyOtp({email: norm(newEmail).toLowerCase(), token: code, type: 'email_change'}));
        if(error || !data?.user) return {error: err(error || {code: 'otp_expired'}), field: 'code'};
        return {user: setUser(data.user)};
      } catch(e) { return fail('code')(e); }
    },

    /** Επιβεβαίωση ταυτότητας πριν από τη διαγραφή: ο κωδικός (νέα σύνδεση, φρέσκια). */
    async reauthPassword(password, {captchaToken = ''} = {}){
      if(!password) return {error: MSG.noPassword, field: 'password'};
      if(!user?.email) return {error: MSG.session};
      const r = await this.signIn(user.email, password, {captchaToken});
      return r.user ? {error: ''} : {error: r.error, field: 'password', wait: r.wait};
    },
    /** Για λογαριασμούς Google: νέα σύνδεση με Google· μετά την επιστροφή, το reauth() δίνει 'delete'. */
    async reauthGoogle(purpose = 'delete'){
      try { ss()?.setItem('ergolav.account.reauth', JSON.stringify({purpose, at: now()})); } catch {}
      return this.signInGoogle();
    },
    /** Αν μόλις έγινε επανασύνδεση με Google για κάποιον σκοπό (μέσα σε 10′): ο σκοπός, μία φορά. */
    takeReauth(){
      try {
        const r = JSON.parse(ss()?.getItem('ergolav.account.reauth') || 'null');
        ss()?.removeItem('ergolav.account.reauth');
        return r && now() - r.at < 600000 ? r.purpose : '';
      } catch { return ''; }
    },
    /**
     * Έχει ο λογαριασμός κωδικό πρόσβασης; Το Supabase δεν το δείχνει (λογαριασμός Google που όρισε κωδικό μένει
     * providers: ['google']): ρωτάμε τη βάση, has_password() — μόνο για τον τρέχοντα χρήστη, μόνο true/false.
     * Χωρίς απάντηση (π.χ. χωρίς ίντερνετ): ό,τι ξέρουμε, αλλιώς από τους τρόπους σύνδεσης.
     */
    async hasPassword(){
      if(!user) return false;
      try {
        const {data, error} = await call(cl => cl.rpc('has_password'));
        if(!error && typeof data === 'boolean') knowPw(data);
      } catch {}
      return pwKnown?.id === user.id ? pwKnown.v : !!user.providers?.includes('email');
    },
    onLock(f){ lockListeners.add(f); return () => lockListeners.delete(f); },

    /** Αποσύνδεση: αυτής της συσκευής (προεπιλογή) ή όλων (global). Δεν αγγίζει δεδομένα της εφαρμογής (ergolav.*). */
    async signOut({global = false} = {}){
      expectSignOut = true;
      try {
        const {error} = await (global ? call(cl => cl.auth.signOut({scope: 'global'})) : (await c()).auth.signOut({scope: 'local'}));
        if(error){ if(global) { expectSignOut = false; return {error: err(error)}; } dropLocalSession(); }
      } catch(e) { if(global){ expectSignOut = false; return {error: err(e)}; } dropLocalSession(); }
      user = null; emit();
      setTimeout(() => { expectSignOut = false; }, 0);
      return {error: ''};
    },

    /** Διαγραφή λογαριασμού (Edge Function). wipeLocal: σβήνονται και τα δεδομένα της συσκευής (ergolav.*). */
    async deleteAccount({wipeLocal = false} = {}){
      try {
        const cl = await c();
        const {error} = await call(() => cl.functions.invoke('delete-account', {method: 'POST', body: {}}));
        if(error){
          const st = error.context?.status;
          if(st === 403) return {error: MSG.reauth, reauth: true};
          return {error: st === 401 ? MSG.session : err(error)};
        }
        expectSignOut = true;
        try { const {error: e} = await cl.auth.signOut({scope: 'local'}); if(e) dropLocalSession(); } catch { dropLocalSession(); }
        setTimeout(() => { expectSignOut = false; }, 0);
      } catch(e) { return {error: err(e)}; }
      user = null;
      if(wipeLocal){
        const s = store(), keys = [];
        for(let i = 0; s && i < s.length; i++){ const k = s.key(i); if(k?.startsWith('ergolav.')) keys.push(k); }
        keys.forEach(k => { try { s.removeItem(k); } catch {} });
      }
      emit();
      return {error: ''};
    },

    /** Ο client της βάσης για τον συνδεδεμένο χρήστη (συγχρονισμός του «Άλλαξέ το»)· null χωρίς σύνδεση. */
    // Χωρίς σήμα: null (οι συγχρονισμοί στο παρασκήνιο δεν ξεκινούν καν, ούτε περιμένουν).
    async db(){ return enabled && user && isOnline(win) ? {client: await c(), userId: user.id} : null; },

    // ── Στοιχεία επιχείρησης ──
    async remote(){
      const {data, error} = await (await c()).from('profiles').select('business_name,specialty,phone,logo_path').eq('id', user.id).maybeSingle();
      if(error) throw error;
      return data || {};
    },

    /** Ανεβάζει το τοπικό προφίλ (και το λογότυπο) στον λογαριασμό. */
    async upload(local = loadProfile()){
      if(!user) return {error: MSG.session};
      try {
        const cl = await c();
        let logo_path = null;
        const url = local?.logo ? getLogo(local.logo) : '';
        const blob = dataUrlToBlob(url);
        if(blob){
          logo_path = `${user.id}/${local.logo}.${blob.type === 'image/png' ? 'png' : 'jpg'}`;
          const {error} = await cl.storage.from(BUCKET).upload(logo_path, blob, {upsert: true, contentType: blob.type});
          if(error) throw error;
        }
        const {error} = await cl.from('profiles').upsert({id: user.id, business_name: norm(local?.name) || null,
          specialty: norm(local?.trade) || null, phone: norm(local?.phone) || null, logo_path});
        if(error) throw error;
        // Παλιά λογότυπα του χρήστη που δεν χρησιμοποιούνται πια: σβήνονται (μόνο στον δικό του φάκελο).
        try {
          const {data: files} = await cl.storage.from(BUCKET).list(user.id, {limit: 100});
          const old = (files || []).map(f => `${user.id}/${f.name}`).filter(p => p !== logo_path);
          if(old.length) await cl.storage.from(BUCKET).remove(old);
        } catch {}
        try { store()?.removeItem(PENDING); } catch {}
        return {error: ''};
      } catch(e) {
        try { store()?.setItem(PENDING, '1'); } catch {}
        return {error: err(e)};
      }
    },

    /** Γράφει στη συσκευή το προφίλ του λογαριασμού — ΠΑΝΤΑ με αντίγραφο ασφαλείας πρώτα. */
    async download(remote){
      try {
        let logo = '';
        if(remote?.logo_path){
          const {data, error} = await (await c()).storage.from(BUCKET).download(remote.logo_path);
          if(error) throw error;
          logo = await blobToDataUrl(data);
        }
        const backup = backupProfile(now());
        if(backup === null) return {error: MSG.noBackup};
        const r = saveProfile({name: remote.business_name, trade: remote.specialty, phone: remote.phone, logo});
        if(r.error) return {error: MSG.generic};
        return {error: '', profile: r.profile, backup};
      } catch(e) { return {error: err(e)}; }
    },

    /**
     * Μετά τη σύνδεση. {action}:
     *  'uploaded'   λογαριασμός άδειος, η συσκευή έχει προφίλ → ανέβηκε
     *  'downloaded' η συσκευή χωρίς προφίλ, ο λογαριασμός έχει → κατέβηκε (με αντίγραφο)
     *  'conflict'   έχουν και τα δύο και διαφέρουν → ρωτάμε (local, remote)
     *  'same' | 'none'
     */
    async syncProfile(){
      if(!user) return {action: 'none'};
      try {
        const local = loadProfile(), remote = await this.remote();
        const pending = (() => { try { return store()?.getItem(PENDING) === '1'; } catch { return false; } })();
        if(local && (!remoteHasProfile(remote) || pending)){
          const r = await this.upload(local);
          return r.error ? {action: 'none', error: r.error} : {action: 'uploaded'};
        }
        if(!local && remoteHasProfile(remote)){
          const r = await this.download(remote);
          return r.error ? {action: 'none', error: r.error} : {action: 'downloaded', profile: r.profile};
        }
        if(local && remoteHasProfile(remote)) return sameProfile(local, remote) ? {action: 'same'} : {action: 'conflict', local, remote};
        return {action: 'none'};
      } catch(e) { return {action: 'none', error: err(e)}; }
    },

    /** Απάντηση στη διαφορά: 'device' (ανεβαίνει το τοπικό) ή 'account' (κατεβαίνει, με αντίγραφο). */
    async keep(choice, remote){
      if(choice === 'device') return this.upload(loadProfile());
      if(choice === 'account') return this.download(remote);
      return {error: ''};
    },

    /** Ο τεχνίτης άλλαξε τα στοιχεία του: ανεβαίνουν, αν είναι συνδεδεμένος (αλλιώς μένουν για μετά). */
    async profileSaved(){ return user ? this.upload(loadProfile()) : {error: ''}; },
  };
}
