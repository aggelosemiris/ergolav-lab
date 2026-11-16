// Λογαριασμός (Supabase): σύνδεση με Google ή με 6ψήφιο κωδικό email, αποσύνδεση, διαγραφή, μεταφορά προφίλ.
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
};

export const configured = (c = CONFIG) =>
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.SUPABASE_URL || '') && !!c.SUPABASE_ANON_KEY && c.SUPABASE_ANON_KEY !== 'your-anon-key';

const isOnline = win => !(win?.navigator && win.navigator.onLine === false);
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
  return {id: u.id, email: u.email || '', name, provider: u.app_metadata?.provider || 'email'};
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

/** Φορτώνει τη βιβλιοθήκη από το vendor/ (ίδιο site, όπως ζητά η CSP) μόνο όταν χρειαστεί. */
export function loadClient(cfg, win = globalThis){
  return new Promise((ok, fail) => {
    const make = () => win.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
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
  let client = null, user = null, sentAt = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(user); } catch {} });
  const enabled = !!config.AUTH_ENABLED && configured(config);
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
        cl.auth.onAuthStateChange((_ev, session) => { const u = summarize(session?.user); if(u?.id !== user?.id){ user = u; emit(); } });
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

    /** captchaToken: το token του Cloudflare Turnstile (όταν το project έχει CAPTCHA). Ισχύει για μία αποστολή. */
    async sendCode(email, {captchaToken = ''} = {}){
      email = norm(email).toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return {error: MSG.badEmail};
      if(!enabled) return {error: MSG.notConfigured};
      try {
        const options = {shouldCreateUser: true, ...(captchaToken && {captchaToken})};
        const {error} = await call(cl => cl.auth.signInWithOtp({email, options}));
        if(error) return {error: errorText(error, {online: isOnline(win), send: true})};
        sentAt = now();
        return {error: ''};
      } catch(e) { return {error: err(e)}; }
    },

    async verifyCode(email, code){
      code = norm(code).replace(/\s/g, '');
      if(!/^\d{6}$/.test(code)) return {error: MSG.badCode};
      try {
        const {data, error} = await call(cl => cl.auth.verifyOtp({email: norm(email).toLowerCase(), token: code, type: 'email'}));
        if(error || !data?.user) return {error: err(error || {code: 'otp_expired'})};
        user = summarize(data.user); emit();
        return {error: '', user};
      } catch(e) { return {error: err(e)}; }
    },

    /** Αποσύνδεση ΜΟΝΟ αυτής της συσκευής. Δεν αγγίζει κανένα δεδομένο της εφαρμογής (ergolav.*). */
    async signOut(){
      try { const {error} = await (await c()).auth.signOut({scope: 'local'}); if(error) dropLocalSession(); }
      catch { dropLocalSession(); }
      user = null; emit();
      return {error: ''};
    },

    /** Διαγραφή λογαριασμού (Edge Function). wipeLocal: σβήνονται και τα δεδομένα της συσκευής (ergolav.*). */
    async deleteAccount({wipeLocal = false} = {}){
      try {
        const cl = await c();
        const {error} = await call(() => cl.functions.invoke('delete-account', {method: 'POST', body: {}}));
        if(error) return {error: error.context?.status === 401 ? MSG.session : err(error)};
        try { const {error: e} = await cl.auth.signOut({scope: 'local'}); if(e) dropLocalSession(); } catch { dropLocalSession(); }
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
