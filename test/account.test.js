import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Ψεύτικο localStorage ανά test (όπως στο profile.test.js).
let data;
function env(initial = {}){
  data = {...initial};
  const ls = {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; },
    key: i => Object.keys(data)[i] ?? null, get length(){ return Object.keys(data).length; }};
  globalThis.localStorage = ls;
  return ls;
}
const acc = await import('../src/account.js');
const { createAccount, MSG, OTP_TTL_S, PENDING, errorText } = acc;
const prof = await import('../src/profile.js');

const CFG = {AUTH_ENABLED: true, SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: 'test-anon-key'};
const UID = '00000000-0000-4000-8000-0000000000aa';
const EMAIL = 'nikos.test@example.com', PHONE = '6912345678', NAME = 'Νίκος Παπαδάκης';
const PNG = 'data:image/png;base64,' + Buffer.from('ψεύτικο-png-λογότυπο').toString('base64');
const APP_DATA = {'ergolav.quotes': '[{"no":1}]', 'ergolav.prices': '{"x":1}', 'ergolav.quoteNo': '7', 'ergolav.calView': 'list'};

/** Ψεύτικος Supabase client: κρατά ό,τι του ζητήθηκε (calls) και απαντά από τα δεδομένα του. */
function fakeClient({session = null, remote = {}, files = {}, fail = {}} = {}){
  const calls = [], authCbs = [];
  const err = f => f && (typeof f === 'object' ? f : {code: f});
  const user = {id: UID, email: EMAIL, user_metadata: {full_name: NAME}, app_metadata: {provider: 'email'}};
  const c = {calls, remote, files, authCbs,
    auth: {
      getSession: async () => { calls.push(['getSession']); return {data: {session}, error: null}; },
      onAuthStateChange: cb => { authCbs.push(cb); return {data: {subscription: {unsubscribe(){}}}}; },
      signInWithOAuth: async a => { calls.push(['oauth', a]); return {error: err(fail.oauth) || null}; },
      signInWithOtp: async a => { calls.push(['otp', a]); return {error: err(fail.otp) || null}; },
      verifyOtp: async a => { calls.push(['verify', a]);
        if(fail.verify) return {data: {user: null, session: null}, error: err(fail.verify)};
        return {data: {user, session: {user}}, error: null}; },
      signOut: async a => { calls.push(['signOut', a]); return {error: err(fail.signOut) || null}; },
    },
    from: table => ({
      select: () => ({eq: (_k, id) => ({maybeSingle: async () => { calls.push(['select', table, id]);
        if(fail.select) throw err(fail.select); return {data: remote.row ?? null, error: null}; }})}),
      upsert: async row => { calls.push(['upsert', table, row]); if(fail.upsert) return {error: err(fail.upsert)}; remote.row = {...row}; return {error: null}; },
    }),
    storage: {from: bucket => ({
      upload: async (path, blob, opts) => { calls.push(['upload', bucket, path, opts]);
        if(fail.upload) return {error: err(fail.upload)}; files[path] = blob; return {error: null}; },
      download: async path => { calls.push(['download', bucket, path]); return files[path] ? {data: files[path], error: null} : {data: null, error: {status: 404}}; },
      list: async prefix => ({data: Object.keys(files).filter(p => p.startsWith(prefix + '/')).map(p => ({name: p.split('/')[1]})), error: null}),
      remove: async paths => { calls.push(['remove', bucket, paths]); paths.forEach(p => delete files[p]); return {error: null}; },
    })},
    functions: {invoke: async (name, opts) => { calls.push(['invoke', name, opts]); return {data: null, error: err(fail.invoke) || null}; }},
  };
  c.user = user;
  return c;
}
function makeWin(href = 'https://aggelosemiris.github.io/ergolav-lab/', online = true){
  const u = new URL(href);
  const win = {localStorage: globalThis.localStorage, navigator: {onLine: online}, replaced: [],
    location: {get href(){ return u.href; }, origin: u.origin, pathname: u.pathname},
    history: {state: {keep: 1}, replaceState(state, _t, url){ win.replaced.push({state, url}); const n = new URL(url, u); u.search = n.search; u.hash = n.hash; }}};
  return win;
}
function setup({cfg = CFG, client = fakeClient(), href, online, now} = {}){
  const win = makeWin(href, online);
  let made = 0;
  const a = createAccount({config: cfg, getClient: async () => { made++; return client; }, win, now});
  return {a, client, win, made: () => made};
}
async function signedIn(opts = {}){
  const s = setup(opts);
  await s.a.sendCode(EMAIL);
  const r = await s.a.verifyCode(EMAIL, '123456');
  assert.equal(r.error, '');
  return s;
}
// Κανένα console.* δεν γράφει στοιχεία χρήστη (ελέγχεται σε όλα τα tests).
const logged = [];
for(const k of ['log', 'info', 'warn', 'error', 'debug']){ const o = console[k]; console[k] = (...a) => { logged.push(a.map(String).join(' ')); }; console[k].orig = o; }
beforeEach(() => env());

test('flag κλειστό: τίποτα δεν φορτώνεται, καμία αλλαγή στη συσκευή', async () => {
  env({...APP_DATA});
  const before = JSON.stringify(data);
  for(const cfg of [{...CFG, AUTH_ENABLED: false}, {AUTH_ENABLED: true, SUPABASE_URL: 'https://your-project-ref.supabase.co', SUPABASE_ANON_KEY: 'your-anon-key'}]){
    const {a, made} = setup({cfg});
    assert.equal(a.enabled, false);
    assert.deepEqual(await a.init(), {user: null});
    assert.equal((await a.sendCode(EMAIL)).error, MSG.notConfigured);
    assert.equal(made(), 0, 'η βιβλιοθήκη δεν φορτώθηκε');
  }
  assert.equal(JSON.stringify(data), before);
});

test('ο τρέχων config.js: κλειστό, με placeholders, και η CSP έχει ΜΟΝΟ τη διεύθυνση του project', async () => {
  const cfg = await import('../src/config.js');
  assert.equal(cfg.AUTH_ENABLED, false, 'στο repo το flag μένει κλειστό');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const connect = csp.match(/connect-src ([^;]+)/)[1].split(/\s+/);
  const origin = new URL(cfg.SUPABASE_URL).origin;
  assert.ok(connect.includes(origin), `η CSP χρειάζεται ${origin} στο connect-src`);
  assert.equal(connect.filter(x => /supabase/.test(x)).length, 1, 'καμία άλλη διεύθυνση Supabase (ούτε *.supabase.co)');
  assert.ok(!/supabase/.test(csp.replace(/connect-src [^;]+/, '')), 'το Supabase μόνο στο connect-src');
  const dir = n => (csp.match(new RegExp(`(?:^|; )${n} ([^;]+)`)) || [])[1]?.split(/\s+/) || [];
  assert.deepEqual(dir('script-src'), ["'self'", 'https://challenges.cloudflare.com'], 'κώδικας μόνο από το ίδιο site και το Turnstile');
  assert.deepEqual(dir('frame-src'), ['https://challenges.cloudflare.com'], 'iframe μόνο του Turnstile');
  assert.ok(connect.includes('https://challenges.cloudflare.com'));
  assert.equal(csp.match(/cloudflare/g).length, 3, 'το Turnstile μόνο σε script-src, frame-src, connect-src');
  assert.ok(fs.existsSync(new URL('../' + acc.LIB_URL, import.meta.url)), 'η βιβλιοθήκη υπάρχει στο vendor/');
});

test('config.js χωρίς τις ρυθμίσεις λογαριασμού (παλιό ή δοκιμαστικό): κλειστό, χωρίς σφάλμα', () => {
  const {a, made} = setup({cfg: {REWRITE_URL: ''}});
  assert.equal(a.enabled, false);
  assert.equal(made(), 0);
});

test('πριν ανοίξει ο λογαριασμός: πραγματική διεύθυνση και key, email επικοινωνίας στους Όρους/Απόρρητο', async () => {
  const cfg = await import('../src/config.js');
  const legal = ['terms', 'privacy'].map(n => fs.readFileSync(new URL(`../legal/${n}.html`, import.meta.url), 'utf8'));
  for(const html of legal){
    assert.ok(/Προσωρινό κείμενο, υπό νομικό έλεγχο/.test(html));
    assert.ok(/script-src 'none'/.test(html), 'οι σελίδες δεν τρέχουν κώδικα');
  }
  assert.ok(/Φρανκφούρτη/.test(legal[1]) && /μόνο στη συσκευή σου/.test(legal[1]) && /Διαγραφή λογαριασμού/.test(legal[1]));
  if(!cfg.AUTH_ENABLED) return;
  assert.ok(acc.configured(cfg), 'AUTH_ENABLED χωρίς πραγματικό SUPABASE_URL / anon key');
  assert.ok(!/your-project-ref/.test(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')));
  for(const html of legal) assert.ok(!html.includes('[email επικοινωνίας]'), 'λείπει το email επικοινωνίας στους Όρους/Απόρρητο');
  if(cfg.TURNSTILE_SITE_KEY) assert.match(cfg.TURNSTILE_SITE_KEY, /^0x[0-9A-Za-z_-]{20,}$/, 'site key Turnstile (0x…)');
});

test('κωδικός email: αποστολή με δημιουργία χρήστη, χωρίς link· σύνδεση με τα 6 ψηφία', async () => {
  const {a, client} = setup();
  const seen = [];
  a.onChange(u => seen.push(u?.id ?? null));
  assert.equal((await a.sendCode('όχι-email')).error, MSG.badEmail);
  assert.equal(client.calls.length, 0);
  assert.equal((await a.sendCode('  Nikos.Test@Example.com ')).error, '');
  assert.deepEqual(client.calls.at(-1), ['otp', {email: EMAIL, options: {shouldCreateUser: true}}]);
  assert.equal((await a.verifyCode(EMAIL, '12345')).error, MSG.badCode);
  const r = await a.verifyCode(EMAIL, '123 456');
  assert.equal(r.error, '');
  assert.deepEqual(client.calls.at(-1), ['verify', {email: EMAIL, token: '123456', type: 'email'}]);
  assert.deepEqual(a.user(), {id: UID, email: EMAIL, name: 'Νίκος', provider: 'email'});
  assert.deepEqual(seen, [UID]);
});

test('λάθη στα ελληνικά: λάθος, ληγμένος, πολλές προσπάθειες, χωρίς ίντερνετ', async () => {
  let t = 1_000_000;
  const wrong = setup({client: fakeClient({fail: {verify: {code: 'otp_expired', status: 403, message: `Token has expired or is invalid for ${EMAIL}`}}}), now: () => t});
  await wrong.a.sendCode(EMAIL);
  assert.equal((await wrong.a.verifyCode(EMAIL, '000000')).error, MSG.wrong, 'μέσα στον χρόνο = λάθος κωδικός');
  t += (OTP_TTL_S + 1) * 1000;
  assert.equal((await wrong.a.verifyCode(EMAIL, '000000')).error, MSG.expired, 'μετά τη λήξη = ληγμένος');
  const many = setup({client: fakeClient({fail: {otp: {status: 429, code: 'over_email_send_rate_limit'}}})});
  assert.equal((await many.a.sendCode(EMAIL)).error, MSG.tooManySends, 'όριο αποστολών email → «Συνέχισε με Google»');
  assert.ok(/Συνέχισε με Google/.test(MSG.tooManySends));
  const many429 = setup({client: fakeClient({fail: {otp: {status: 429}}})});
  assert.equal((await many429.a.sendCode(EMAIL)).error, MSG.tooManySends);
  const verify429 = setup({client: fakeClient({fail: {verify: {status: 429, code: 'over_request_rate_limit'}}})});
  assert.equal((await verify429.a.verifyCode(EMAIL, '123456')).error, MSG.tooMany, 'πολλές προσπάθειες κωδικού');
  const cap = setup({client: fakeClient({fail: {otp: {status: 400, code: 'captcha_failed', message: 'captcha protection: request disallowed'}}})});
  assert.equal((await cap.a.sendCode(EMAIL, {captchaToken: 'x'})).error, MSG.captcha);
  const off = setup({client: fakeClient({fail: {otp: {name: 'AuthRetryableFetchError', status: 0}}})});
  assert.equal((await off.a.sendCode(EMAIL)).error, MSG.offline);
  const off2 = setup({online: false, client: fakeClient({fail: {verify: {status: 0}}})});
  assert.equal((await off2.a.verifyCode(EMAIL, '123456')).error, MSG.offline);
  // Το κείμενο του σφάλματος (που μπορεί να έχει το email) δεν φτάνει ποτέ στην οθόνη.
  for(const m of Object.values(MSG)) assert.ok(![EMAIL, PHONE, NAME].some(x => m.includes(x)));
  assert.equal(errorText({message: `weird ${EMAIL} ${PHONE}`}), MSG.generic);
});

test('χωρίς ίντερνετ: απάντηση αμέσως· server που δεν απαντά: μήνυμα μετά το όριο χρόνου, όχι κουμπί που περιμένει', async () => {
  const off = setup({online: false});
  const t0 = Date.now();
  assert.equal((await off.a.sendCode(EMAIL)).error, MSG.offline);
  assert.equal(off.client.calls.length, 0, 'καμία κλήση χωρίς ίντερνετ');
  const hang = fakeClient();
  hang.auth.signInWithOtp = () => new Promise(() => {});
  const win = makeWin();
  const a = createAccount({config: CFG, getClient: async () => hang, win, timeoutMs: 50});
  assert.equal((await a.sendCode(EMAIL)).error, MSG.offline);
  assert.ok(Date.now() - t0 < 2000);
});

test('CAPTCHA (Turnstile): το token πάει στην αποστολή κωδικού· χωρίς token, όπως πριν', async () => {
  const {a, client} = setup();
  await a.sendCode(EMAIL, {captchaToken: 'turnstile-token-1'});
  assert.deepEqual(client.calls.at(-1), ['otp', {email: EMAIL, options: {shouldCreateUser: true, captchaToken: 'turnstile-token-1'}}]);
  await a.sendCode(EMAIL);
  assert.deepEqual(client.calls.at(-1), ['otp', {email: EMAIL, options: {shouldCreateUser: true}}]);
});

test('Google (PKCE): redirectTo = η διεύθυνση της εφαρμογής, και στο υπο-path και στο localhost', async () => {
  for(const href of ['https://aggelosemiris.github.io/ergolav-lab/', 'http://localhost:8087/', 'http://127.0.0.1:8087/index.html']){
    const {a, client} = setup({href});
    assert.equal((await a.signInGoogle()).error, '');
    const u = new URL(href);
    assert.deepEqual(client.calls.at(-1), ['oauth', {provider: 'google', options: {redirectTo: u.origin + u.pathname}}]);
  }
});

test('επιστροφή από Google: το ?code= σβήνεται με replaceState (μένουν άλλες παράμετροι και το #)· χωρίς code τίποτα', async () => {
  const user = fakeClient().user;
  const {a, win} = setup({href: 'https://aggelosemiris.github.io/ergolav-lab/?code=abc&state=s1&x=1#top', client: fakeClient({session: {user}})});
  const r = await a.init();
  assert.equal(r.fresh, true);
  assert.equal(r.error, '');
  assert.deepEqual(win.replaced, [{state: {keep: 1}, url: '/ergolav-lab/?x=1#top'}], 'ίδιο history.state: η πλοήγηση της εφαρμογής δεν αλλάζει');
  assert.equal(win.location.href, 'https://aggelosemiris.github.io/ergolav-lab/?x=1#top');
  // ανανέωση: δεν υπάρχει πια code → καμία νέα ανταλλαγή, καμία νέα replaceState
  const again = setup({href: win.location.href, client: fakeClient({session: {user}})});
  assert.equal((await again.a.init()).fresh, false);
  assert.deepEqual(again.win.replaced, []);
  // ακύρωση στο Google
  const denied = setup({href: 'https://aggelosemiris.github.io/ergolav-lab/?error=access_denied&error_description=User+denied'});
  const d = await denied.a.init();
  assert.equal(d.error, MSG.google);
  assert.equal(denied.win.location.href, 'https://aggelosemiris.github.io/ergolav-lab/');
});

test('συνεδρία που έμεινε ανοιχτή: ο χρήστης είναι συνδεδεμένος στο άνοιγμα (όχι «fresh»)', async () => {
  const c = fakeClient();
  const {a} = setup({client: fakeClient({session: {user: c.user}})});
  const r = await a.init();
  assert.equal(r.fresh, false);
  assert.equal(a.user().id, UID);
});

test('αποσύνδεση: scope local, δεν σβήνει προσφορές/τιμές/αριθμό· μόνο η συνεδρία του Supabase', async () => {
  env({...APP_DATA, 'ergolav.profile': '{"name":"Ν"}', 'sb-abcdefgh-auth-token': 'x', 'sb-other-auth-token': 'y'});
  const {a, client} = await signedIn();
  await a.signOut();
  assert.deepEqual(client.calls.at(-1), ['signOut', {scope: 'local'}]);
  assert.equal(a.user(), null);
  for(const [k, v] of Object.entries(APP_DATA)) assert.equal(data[k], v, k);
  assert.equal(data['ergolav.profile'], '{"name":"Ν"}');
  // Χωρίς ίντερνετ η βιβλιοθήκη αποτυγχάνει: σβήνεται τοπικά ΜΟΝΟ η συνεδρία αυτού του project.
  const off = await signedIn({client: fakeClient({fail: {signOut: {status: 0, name: 'AuthRetryableFetchError'}}})});
  await off.a.signOut();
  assert.equal(data['sb-abcdefgh-auth-token'], undefined);
  assert.equal(data['sb-other-auth-token'], 'y');
  assert.equal(data['ergolav.quoteNo'], '7');
});

test('πρώτο login: τοπικό προφίλ + άδειος λογαριασμός → ανεβαίνουν στοιχεία και λογότυπο· ο αριθμός προσφοράς δεν αγγίζεται', async () => {
  env({...APP_DATA});
  prof.saveProfile({name: NAME, trade: 'Υδραυλικός', phone: PHONE, logo: PNG});
  const logoId = prof.loadProfile().logo;
  const {a, client} = await signedIn({client: fakeClient({remote: {row: {business_name: null}}})});
  const r = await a.syncProfile();
  assert.equal(r.action, 'uploaded');
  const up = client.calls.find(c => c[0] === 'upload');
  assert.deepEqual(up.slice(1), ['logos', `${UID}/${logoId}.png`, {upsert: true, contentType: 'image/png'}]);
  assert.deepEqual(client.remote.row, {id: UID, business_name: NAME, specialty: 'Υδραυλικός', phone: PHONE, logo_path: `${UID}/${logoId}.png`});
  assert.equal(data['ergolav.quoteNo'], '7');
});

test('νέο κινητό: λογαριασμός με στοιχεία, συσκευή χωρίς → κατεβαίνουν (και το λογότυπο), με αντίγραφο ασφαλείας', async () => {
  env({...APP_DATA, 'ergolav.logos': '{"old":1}'});
  const blob = acc.dataUrlToBlob(PNG);
  const files = {[`${UID}/1234abcd.png`]: blob};
  const {a} = await signedIn({client: fakeClient({remote: {row: {business_name: NAME, specialty: 'Ηλεκτρολόγος', phone: PHONE, logo_path: `${UID}/1234abcd.png`}}, files})});
  const r = await a.syncProfile();
  assert.equal(r.action, 'downloaded');
  const p = prof.loadProfile();
  assert.equal(p.name, NAME); assert.equal(p.trade, 'Ηλεκτρολόγος'); assert.equal(p.phone, PHONE);
  assert.equal(prof.getLogo(p.logo), PNG, 'το λογότυπο ήρθε ακέραιο');
  const backups = Object.keys(data).filter(k => k.startsWith(prof.PROFILE_BACKUP));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(data[backups[0]]).logos, '{"old":1}', 'το αντίγραφο κρατά ό,τι υπήρχε πριν');
  for(const [k, v] of Object.entries(APP_DATA)) assert.equal(data[k], v, k);
});

test('και τα δύο, διαφορετικά → ρωτάμε· «της συσκευής» ανεβαίνει, «του λογαριασμού» κατεβαίνει με αντίγραφο· ίδια → τίποτα', async () => {
  env({...APP_DATA});
  prof.saveProfile({name: 'Συσκευή ΑΕ', trade: '', phone: ''});
  const remoteRow = {business_name: 'Λογαριασμός ΑΕ', specialty: 'Πλακάς', phone: null, logo_path: null};
  const {a, client} = await signedIn({client: fakeClient({remote: {row: {...remoteRow}}})});
  const r = await a.syncProfile();
  assert.equal(r.action, 'conflict');
  assert.equal(r.local.name, 'Συσκευή ΑΕ'); assert.equal(r.remote.business_name, 'Λογαριασμός ΑΕ');
  assert.equal(client.calls.filter(c => c[0] === 'upsert').length, 0, 'τίποτα δεν γράφτηκε πριν απαντήσει');
  assert.equal(prof.loadProfile().name, 'Συσκευή ΑΕ');
  // του λογαριασμού
  assert.equal((await a.keep('account', r.remote)).error, '');
  assert.equal(prof.loadProfile().name, 'Λογαριασμός ΑΕ');
  const bk = Object.keys(data).find(k => k.startsWith(prof.PROFILE_BACKUP));
  assert.equal(JSON.parse(JSON.parse(data[bk]).profile).name, 'Συσκευή ΑΕ', 'τα προηγούμενα φυλάχτηκαν');
  // της συσκευής
  prof.saveProfile({name: 'Συσκευή ΑΕ', trade: '', phone: ''});
  assert.equal((await a.keep('device')).error, '');
  assert.equal(client.remote.row.business_name, 'Συσκευή ΑΕ');
  assert.equal((await a.syncProfile()).action, 'same');
  assert.equal(data['ergolav.quoteNo'], '7');
});

test('αλλαγή στοιχείων χωρίς ίντερνετ: μένει σημείωση και ανεβαίνει στην επόμενη σύνδεση (όχι ερώτηση)', async () => {
  env({...APP_DATA});
  prof.saveProfile({name: 'Πρώτο', trade: '', phone: ''});
  const client = fakeClient({remote: {row: {business_name: 'Πρώτο'}}, fail: {upsert: {name: 'AuthRetryableFetchError'}}});
  const {a} = await signedIn({client});
  prof.saveProfile({name: 'Δεύτερο', trade: '', phone: ''});
  assert.equal((await a.profileSaved()).error, MSG.offline);
  assert.equal(data[PENDING], '1');
  delete client.calls; client.calls = [];
  const ok = fakeClient({remote: {row: {business_name: 'Πρώτο'}}});
  const s2 = await signedIn({client: ok});
  assert.equal((await s2.a.syncProfile()).action, 'uploaded');
  assert.equal(ok.remote.row.business_name, 'Δεύτερο');
  assert.equal(data[PENDING], undefined);
});

test('διαγραφή λογαριασμού: Edge Function + αποσύνδεση· τα δεδομένα μένουν, εκτός αν ζητηθεί', async () => {
  env({...APP_DATA, 'ergolav.profile': '{"name":"Ν"}', 'other.app': 'κρατιέται'});
  const s = await signedIn();
  assert.equal((await s.a.deleteAccount()).error, '');
  assert.deepEqual(s.client.calls.slice(-2).map(c => c.slice(0, 2)), [['invoke', 'delete-account'], ['signOut', {scope: 'local'}]]);
  assert.equal(s.a.user(), null);
  assert.equal(data['ergolav.quotes'], APP_DATA['ergolav.quotes']);
  const w = await signedIn();
  await w.a.deleteAccount({wipeLocal: true});
  assert.deepEqual(Object.keys(data).filter(k => k.startsWith('ergolav.')), [], 'σβήστηκαν όλα τα ergolav.*');
  assert.equal(data['other.app'], 'κρατιέται', 'τίποτα έξω από την εφαρμογή');
  env({...APP_DATA});
  const bad = await signedIn({client: fakeClient({fail: {invoke: {name: 'FunctionsHttpError', context: {status: 401}}}})});
  assert.equal((await bad.a.deleteAccount({wipeLocal: true})).error, MSG.session);
  assert.equal(bad.a.user().id, UID, 'αποτυχία: μένει συνδεδεμένος');
  assert.equal(data['ergolav.quotes'], APP_DATA['ergolav.quotes'], 'αποτυχία: τίποτα δεν σβήστηκε');
});

test('κανένα console.* δεν έγραψε email, τηλέφωνο, όνομα ή token', () => {
  for(const l of logged) assert.ok(![EMAIL, PHONE, NAME, 'Νίκος', 'test-anon-key', '123456'].some(x => l.includes(x)), l);
});
