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
const { createAccount, MSG, OTP_TTL_S, PENDING, errorText, passwordCheck, needsLatin, authGate, storedSession, throttleText, THROTTLE_AFTER } = acc;
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
  const user = {id: UID, email: EMAIL, user_metadata: {full_name: NAME}, app_metadata: {provider: 'email', providers: ['email']},
    identities: [{provider: 'email'}], email_confirmed_at: '2026-11-17T10:00:00Z'};
  const c = {calls, remote, files, authCbs,
    auth: {
      getSession: async () => { calls.push(['getSession']); return {data: {session}, error: null}; },
      onAuthStateChange: cb => { authCbs.push(cb); return {data: {subscription: {unsubscribe(){}}}}; },
      signInWithOAuth: async a => { calls.push(['oauth', a]); return {error: err(fail.oauth) || null}; },
      signUp: async a => { calls.push(['signUp', a]);
        if(fail.signUp) return {data: {user: null, session: null}, error: err(fail.signUp)};
        // Υπάρχον email: το Supabase επιστρέφει «χρήστη» χωρίς ταυτότητες, χωρίς σφάλμα (δεν αποκαλύπτει τίποτα).
        if(fail.exists) return {data: {user: {id: 'x', identities: []}, session: null}, error: null};
        return {data: {user: {...user, identities: [{provider: 'email'}]}, session: null}, error: null}; },
      signInWithPassword: async a => { calls.push(['password', a]);
        if(fail.password) return {data: {user: null, session: null}, error: err(typeof fail.password === 'function' ? fail.password(a) : fail.password)};
        return {data: {user, session: {user}}, error: null}; },
      resend: async a => { calls.push(['resend', a]); return {error: err(fail.resend) || null}; },
      resetPasswordForEmail: async (e, o) => { calls.push(['reset', e, o]); return {error: err(fail.reset) || null}; },
      updateUser: async a => { calls.push(['updateUser', a]); return fail.updateUser ? {data: {user: null}, error: err(fail.updateUser)} : {data: {user}, error: null}; },
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
    rpc: async name => { calls.push(['rpc', name]); if(fail.rpc) return {data: null, error: err(fail.rpc)}; return {data: remote.hasPassword ?? true, error: null}; },
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
const PW = 'ergolav2026', PW2 = 'Nero-sto-banio9';
async function signedIn(opts = {}){
  const s = setup(opts);
  const r = await s.a.signIn(EMAIL, PW);
  assert.ok(r.user, r.error);
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
    assert.equal((await a.signUp(EMAIL, PW)).error, MSG.notConfigured);
    assert.deepEqual(authGate(cfg, {localStorage: globalThis.localStorage}), {required: false, locked: false}, 'κλειστό: καμία οθόνη δεν κλειδώνει');
    assert.equal(made(), 0, 'η βιβλιοθήκη δεν φορτώθηκε');
  }
  assert.equal(JSON.stringify(data), before);
});

test('ο τρέχων config.js: η CSP έχει ΜΟΝΟ τη διεύθυνση του project του config', async () => {
  const cfg = await import('../src/config.js');
  assert.equal(typeof cfg.AUTH_ENABLED, 'boolean', 'AUTH_ENABLED: true (ανοιχτό) ή false (κλειστό, όπως πριν)');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const connect = csp.match(/connect-src ([^;]+)/)[1].split(/\s+/);
  const origin = new URL(cfg.SUPABASE_URL).origin;
  assert.ok(connect.includes(origin), `η CSP χρειάζεται ${origin} στο connect-src`);
  // Καμία wildcard διεύθυνση: ο worker (όταν μπει) πρέπει να γραφτεί με το ΑΚΡΙΒΕΣ host του, όχι https://*.workers.dev,
  // αλλιώς ανοίγει κανάλι εξαγωγής δεδομένων (ο καθένας φτιάχνει δωρεάν subdomain workers.dev).
  assert.ok(!connect.some(x => x.includes('*')), 'καμία wildcard διεύθυνση στο connect-src');
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
  assert.ok(/Φρανκφούρτη/.test(legal[1]) && /Διαγραφή λογαριασμού/.test(legal[1]));   // τι ανεβαίνει: test/privacy.test.js
  if(!cfg.AUTH_ENABLED) return;
  assert.ok(acc.configured(cfg), 'AUTH_ENABLED χωρίς πραγματικό SUPABASE_URL / anon key');
  assert.ok(!/your-project-ref/.test(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')));
  for(const html of legal) assert.ok(!html.includes('[email επικοινωνίας]'), 'λείπει το email επικοινωνίας στους Όρους/Απόρρητο');
  if(cfg.TURNSTILE_SITE_KEY) assert.match(cfg.TURNSTILE_SITE_KEY, /^0x[0-9A-Za-z_-]{20,}$/, 'site key Turnstile (0x…)');
});

test('κανόνες κωδικού: 8+ χαρακτήρες, γράμματα ΚΑΙ αριθμοί, ίδιος δύο φορές· ένδειξη δύναμης', () => {
  assert.deepEqual(passwordCheck('abc12'), {rules: {len: false, letter: true, digit: true}, ok: false, strength: 'weak'});
  assert.equal(passwordCheck('abcdefgh').ok, false, 'χωρίς αριθμούς');
  assert.equal(passwordCheck('12345678').ok, false, 'χωρίς γράμματα');
  assert.equal(passwordCheck('αβγδεζηθ1').rules.letter, false, 'ελληνικά γράμματα δεν μετράνε (όπως στο Supabase: a–z)');
  assert.deepEqual(passwordCheck(PW), {rules: {len: true, letter: true, digit: true}, ok: true, strength: 'good'});
  assert.equal(passwordCheck(PW2).strength, 'strong');
  assert.equal(passwordCheck(PW, 'ergolav2025').ok, false, 'διαφορετική επανάληψη');
  assert.equal(passwordCheck(PW, PW).ok, true);
  assert.equal(passwordCheck('', '').rules.match, false);
});

test('κωδικός μόνο με ελληνικά γράμματα: δεν περνά, και η οθόνη λέει γιατί (MSG.latin)', () => {
  for(const pw of ['καλημέρα12', 'ΚΑΛΗΜΕΡΑ12', 'άέήίόύώ12', 'ϊΐϋΰς1234', 'Ελλάδα 2026!']){
    const c = passwordCheck(pw, pw);
    assert.equal(c.rules.letter, false, `${pw}: τα ελληνικά δεν μετράνε ως γράμμα`);
    assert.equal(c.ok, false, `${pw}: δεν δίνει λογαριασμό`);
    assert.equal(needsLatin(pw), true, `${pw}: φαίνεται το μήνυμα`);
  }
  // Ελληνικά ΜΑΖΙ με ένα λατινικό: περνά (το Supabase θέλει τουλάχιστον ένα a–z, όχι μόνο a–z)
  assert.equal(passwordCheck('καλημέρα1a', 'καλημέρα1a').ok, true);
  assert.equal(needsLatin('καλημέρα1a'), false);
  // Χωρίς κανένα ελληνικό: κανένα μήνυμα για ελληνικά (λείπει απλώς το γράμμα ή κάτι άλλο)
  for(const pw of ['', '12345678', '1234-5678!', 'ergolav2026', 'abc', 'Ergolav']) assert.equal(needsLatin(pw), false, JSON.stringify(pw));
  assert.match(MSG.latin, /ελληνικά γράμματα δεν μετράνε/);
  assert.match(MSG.latin, /λατινικό \(a–z\)/);
  for(const part of ['τουλάχιστον 8 χαρακτήρες', 'τουλάχιστον 1 λατινικό γράμμα (a–z)', '1 αριθμό (0–9)']) assert.ok(MSG.weak.includes(part), part);
});

test('οθόνες κωδικού (εγγραφή, επαναφορά, αλλαγή): ίδιοι κανόνες «τουλάχιστον 1», με θέση για το μήνυμα των ελληνικών', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const RULES = {len: 'Τουλάχιστον 8 χαρακτήρες', letter: 'Τουλάχιστον 1 λατινικό γράμμα (a–z)', digit: 'Τουλάχιστον 1 αριθμός (0–9)', match: 'Ίδιος και στις δύο φορές'};
  for(const pre of ['up', 'rs', 'acct']){
    const list = html.match(new RegExp(`<ul class="rules" id="${pre}Rules">([\\s\\S]*?)</ul>`));
    assert.ok(list, `${pre}Rules`);
    const items = [...list[1].matchAll(/<li data-r="(\w+)">([^<]+)/g)].map(m => [m[1], m[2]]);
    assert.deepEqual(Object.fromEntries(items), RULES, `${pre}Rules`);
    assert.match(list[1], new RegExp(`<li data-r="letter">[^<]+<small class="pw-hint" id="${pre}Hint" role="status"></small></li>`), `${pre}Hint μέσα στον κανόνα «γράμμα»`);
  }
});

test('εγγραφή: έλεγχοι πριν από κάθε κλήση· email + κωδικός + CAPTCHA → κωδικός 6 ψηφίων για επιβεβαίωση', async () => {
  const {a, client} = setup();
  assert.deepEqual(await a.signUp('όχι-email', PW, {repeat: PW}), {error: MSG.badEmail, field: 'email'});
  assert.deepEqual(await a.signUp(EMAIL, 'abc', {repeat: 'abc'}), {error: MSG.weak, field: 'password'});
  assert.deepEqual(await a.signUp(EMAIL, PW, {repeat: PW + 'x'}), {error: MSG.mismatch, field: 'repeat'});
  assert.deepEqual(await a.signUp(EMAIL, PW, {repeat: PW, terms: false}), {error: MSG.terms, field: 'terms'});
  assert.equal(client.calls.length, 0, 'καμία κλήση με λάθος στοιχεία');
  assert.deepEqual(await a.signUp(' Nikos.Test@Example.com ', PW, {repeat: PW, captchaToken: 'tok-1'}), {needsConfirm: true});
  assert.deepEqual(client.calls.at(-1), ['signUp', {email: EMAIL, password: PW, options: {captchaToken: 'tok-1'}}]);
  assert.equal(a.user(), null, 'πριν από την επιβεβαίωση: όχι συνδεδεμένος');
  assert.deepEqual(await a.confirmSignup(EMAIL, '12345'), {error: MSG.badCode, field: 'code'});
  const r = await a.confirmSignup(EMAIL, '123 456');
  assert.deepEqual(client.calls.at(-1), ['verify', {email: EMAIL, token: '123456', type: 'signup'}]);
  assert.equal(r.user.id, UID);
  assert.equal(a.user().confirmed, true);
  assert.deepEqual(a.user().providers, ['email']);
  // «Στείλε ξανά»: ίδιο endpoint επιβεβαίωσης, με CAPTCHA
  assert.equal((await a.resendConfirm(EMAIL, {captchaToken: 'tok-2'})).error, '');
  assert.deepEqual(client.calls.at(-1), ['resend', {type: 'signup', email: EMAIL, options: {captchaToken: 'tok-2'}}]);
});

test('εγγραφή με email που ήδη υπάρχει (και με Google): μήνυμα που δείχνει «Σύνδεση» / Google / «Ξέχασα τον κωδικό»', async () => {
  const {a} = setup({client: fakeClient({fail: {exists: true}})});
  assert.deepEqual(await a.signUp(EMAIL, PW, {repeat: PW}), {error: MSG.exists, field: 'email'});
  assert.ok(/Συνέχεια με Google/.test(MSG.exists) && /Ξέχασα τον κωδικό/.test(MSG.exists));
  const b = setup({client: fakeClient({fail: {signUp: {code: 'user_already_exists', status: 422}}})});
  assert.equal((await b.a.signUp(EMAIL, PW, {repeat: PW})).error, MSG.exists);
  const w = setup({client: fakeClient({fail: {signUp: {code: 'weak_password', status: 422, name: 'AuthWeakPasswordError'}}})});
  assert.deepEqual(await w.a.signUp(EMAIL, PW, {repeat: PW}), {error: MSG.weak, field: 'password'});
});

test('σύνδεση: email + κωδικός + CAPTCHA· λάθος → ΕΝΑ μήνυμα (όχι ποιο από τα δύο)· μη επιβεβαιωμένο email', async () => {
  const {a, client} = setup();
  assert.deepEqual(await a.signIn(EMAIL, ''), {error: MSG.noPassword, field: 'password'});
  assert.deepEqual(await a.signIn('x@', PW), {error: MSG.badEmail, field: 'email'});
  const r = await a.signIn(EMAIL.toUpperCase(), PW, {captchaToken: 'tok'});
  assert.deepEqual(client.calls.at(-1), ['password', {email: EMAIL, password: PW, options: {captchaToken: 'tok'}}]);
  assert.equal(r.user.id, UID);
  const bad = setup({client: fakeClient({fail: {password: {code: 'invalid_credentials', status: 400, message: 'Invalid login credentials'}}})});
  const e = await bad.a.signIn(EMAIL, 'λάθος123');
  assert.equal(e.error, MSG.badLogin);
  assert.ok(!/το email δεν|ο κωδικός δεν/i.test(MSG.badLogin) && /email ή κωδικός/.test(MSG.badLogin), 'δεν λέει ποιο είναι λάθος');
  assert.ok(/Συνέχεια με Google/.test(MSG.badLogin), 'λογαριασμός Google χωρίς κωδικό: δείχνει τον δρόμο');
  const nc = setup({client: fakeClient({fail: {password: {code: 'email_not_confirmed', status: 400}}})});
  const n = await nc.a.signIn(EMAIL, PW);
  assert.equal(n.error, MSG.notConfirmed); assert.equal(n.notConfirmed, true);
  assert.ok(/Στείλε κωδικό επιβεβαίωσης/.test(MSG.notConfirmed));
});

test('5 λάθος κωδικοί → αναμονή που μεγαλώνει (30″, 60″ …, έως 5′), χωρίς κλήση στο μεταξύ· ποτέ μόνιμο κλείδωμα', async () => {
  let t = 5_000_000;
  const ss = {}; const sessionStorage = {getItem: k => ss[k] ?? null, setItem: (k, v) => { ss[k] = v; }, removeItem: k => { delete ss[k]; }};
  const client = fakeClient({fail: {password: {code: 'invalid_credentials', status: 400}}});
  const win = {...makeWin(), sessionStorage};
  const a = createAccount({config: CFG, getClient: async () => client, win, now: () => t});
  for(let i = 1; i < THROTTLE_AFTER; i++) assert.equal((await a.signIn(EMAIL, 'wrong' + i)).wait, undefined, `λάθος ${i}: χωρίς αναμονή`);
  const fifth = await a.signIn(EMAIL, 'wrong5');
  assert.equal(fifth.wait, 30); assert.equal(fifth.error, throttleText(30));
  const n = client.calls.length;
  t += 10_000;
  const blocked = await a.signIn(EMAIL, PW);
  assert.equal(blocked.wait, 20, 'μέσα στην αναμονή: καμία κλήση, μένουν 20″');
  assert.equal(client.calls.length, n);
  t += 21_000;
  assert.equal((await a.signIn(EMAIL, 'wrong6')).wait, 60, 'το επόμενο λάθος διπλασιάζει');
  for(let i = 0; i < 6; i++){ t += 400_000; await a.signIn(EMAIL, 'w'); }
  assert.equal(a.throttleLeft(), 300, 'το πολύ 5 λεπτά');
  t += 301_000;
  assert.equal(a.throttleLeft(), 0, 'μετά την αναμονή ξαναδοκιμάζει');
  client.auth.signInWithPassword = async () => ({data: {user: client.user, session: {user: client.user}}, error: null});
  assert.ok((await a.signIn(EMAIL, PW)).user);
  assert.equal(ss['ergolav.account.throttle'], '{}', 'σωστή σύνδεση: ο μετρητής μηδενίζεται');
  assert.ok(/Ξαναδοκίμασε σε 5′/.test(throttleText(300)));
});

test('ξέχασα τον κωδικό: κωδικός 6 ψηφίων (recovery) → νέος κωδικός δύο φορές, ΧΩΡΙΣ τον παλιό', async () => {
  const {a, client} = setup();
  assert.deepEqual(await a.requestReset('λάθος'), {error: MSG.badEmail, field: 'email'});
  assert.equal((await a.requestReset(EMAIL, {captchaToken: 'tok'})).error, '');
  assert.deepEqual(client.calls.at(-1), ['reset', EMAIL, {captchaToken: 'tok'}]);
  assert.equal((await a.verifyReset(EMAIL, '654321')).user.id, UID);
  assert.deepEqual(client.calls.at(-1), ['verify', {email: EMAIL, token: '654321', type: 'recovery'}]);
  assert.deepEqual(await a.setPassword(PW2, PW2 + '!'), {error: MSG.mismatch, field: 'repeat'});
  assert.deepEqual(await a.setPassword('short1', 'short1'), {error: MSG.weak, field: 'password'});
  assert.ok((await a.setPassword(PW2, PW2)).user);
  assert.deepEqual(client.calls.at(-1), ['updateUser', {password: PW2}], 'στην επαναφορά δεν ζητείται ο παλιός');
  const same = setup({client: fakeClient({fail: {updateUser: {code: 'same_password', status: 422}}})});
  assert.equal((await same.a.setPassword(PW, PW)).error, MSG.samePassword);
});

test('αλλαγή κωδικού από τον λογαριασμό: ζητά τον τωρινό (current_password)· λάθος τωρινός → στο πεδίο του', async () => {
  const s = await signedIn();
  assert.deepEqual(await s.a.setPassword(PW2, PW2, {current: ''}), {error: MSG.noPassword, field: 'current'});
  assert.ok((await s.a.setPassword(PW2, PW2, {current: PW})).user);
  assert.deepEqual(s.client.calls.at(-1), ['updateUser', {password: PW2, current_password: PW}]);
  const bad = await signedIn({client: fakeClient({fail: {updateUser: {code: 'current_password_invalid', status: 400}}})});
  assert.deepEqual(await bad.a.setPassword(PW2, PW2, {current: 'λάθος'}), {error: MSG.wrongCurrent, field: 'current'});
  assert.ok(s.a.hasPassword());
});

test('έχει κωδικό; ρωτά τη βάση (has_password, χωρίς παραμέτρους)· Google που όρισε κωδικό = true· χωρίς ίντερνετ: από τους τρόπους σύνδεσης', async () => {
  const g = {...fakeClient().user, app_metadata: {provider: 'google', providers: ['google']}, identities: [{provider: 'google'}]};
  const c = fakeClient({remote: {hasPassword: true}});
  c.auth.signInWithPassword = async () => ({data: {user: g, session: {user: g}}, error: null});
  const {a} = setup({client: c});
  await a.signIn(EMAIL, PW);
  assert.equal(await a.hasPassword(), true, 'Google + κωδικός: η βάση λέει true (το Supabase δείχνει μόνο google)');
  assert.deepEqual(c.calls.at(-1), ['rpc', 'has_password']);
  c.remote.hasPassword = false;
  assert.equal(await a.hasPassword(), false);
  const off = fakeClient({fail: {rpc: {name: 'AuthRetryableFetchError', status: 0}}});
  const o = setup({client: off}); await o.a.signIn(EMAIL, PW);
  assert.equal(await o.a.hasPassword(), true, 'χωρίς απάντηση: ταυτότητα email → true');
  // ο server ζήτησε τον τωρινό κωδικό: από εκεί και πέρα ξέρουμε ότι υπάρχει
  const req = setup({client: fakeClient({fail: {updateUser: {code: 'current_password_required', status: 400}, rpc: {status: 0, name: 'AuthRetryableFetchError'}}})});
  await req.a.signIn(EMAIL, PW);
  assert.deepEqual(await req.a.setPassword(PW2, PW2), {error: MSG.needCurrent, field: 'current'});
  assert.equal(await req.a.hasPassword(), true);
  const none = setup(); assert.equal(await none.a.hasPassword(), false, 'χωρίς σύνδεση: false, καμία κλήση');
  assert.equal(none.client.calls.length, 0);
});

test('αλλαγή email: κωδικός 6 ψηφίων στο ΝΕΟ email (email_change)', async () => {
  const s = await signedIn();
  assert.deepEqual(await s.a.changeEmail(EMAIL), {error: MSG.sameEmail, field: 'email'});
  assert.deepEqual(await s.a.changeEmail('όχι'), {error: MSG.badEmail, field: 'email'});
  assert.equal((await s.a.changeEmail('Neo@Example.com')).error, '');
  assert.deepEqual(s.client.calls.at(-1), ['updateUser', {email: 'neo@example.com'}]);
  assert.ok((await s.a.confirmEmailChange('neo@example.com', '111222')).user);
  assert.deepEqual(s.client.calls.at(-1), ['verify', {email: 'neo@example.com', token: '111222', type: 'email_change'}]);
});

test('λάθη στα ελληνικά: λάθος/ληγμένος κωδικός email, πολλές αποστολές, CAPTCHA, χωρίς ίντερνετ', async () => {
  let t = 1_000_000;
  const wrong = setup({client: fakeClient({fail: {verify: {code: 'otp_expired', status: 403, message: `Token has expired or is invalid for ${EMAIL}`}}}), now: () => t});
  await wrong.a.signUp(EMAIL, PW, {repeat: PW});
  assert.equal((await wrong.a.confirmSignup(EMAIL, '000000')).error, MSG.wrong, 'μέσα στον χρόνο = λάθος κωδικός');
  t += (OTP_TTL_S + 1) * 1000;
  assert.equal((await wrong.a.confirmSignup(EMAIL, '000000')).error, MSG.expired, 'μετά τη λήξη = ληγμένος');
  const many = setup({client: fakeClient({fail: {resend: {status: 429, code: 'over_email_send_rate_limit'}}})});
  assert.equal((await many.a.resendConfirm(EMAIL)).error, MSG.tooManySends);
  const verify429 = setup({client: fakeClient({fail: {verify: {status: 429, code: 'over_request_rate_limit'}}})});
  assert.equal((await verify429.a.verifyReset(EMAIL, '123456')).error, MSG.tooMany);
  const cap = setup({client: fakeClient({fail: {password: {status: 400, code: 'captcha_failed', message: 'captcha protection: request disallowed'}}})});
  assert.equal((await cap.a.signIn(EMAIL, PW, {captchaToken: 'x'})).error, MSG.captcha);
  const off = setup({client: fakeClient({fail: {password: {name: 'AuthRetryableFetchError', status: 0}}})});
  assert.equal((await off.a.signIn(EMAIL, PW)).error, MSG.offline);
  const off2 = setup({online: false});
  assert.equal((await off2.a.signUp(EMAIL, PW, {repeat: PW})).error, MSG.offline);
  assert.equal(off2.client.calls.length, 0);
  // Το κείμενο του σφάλματος (που μπορεί να έχει το email) δεν φτάνει ποτέ στην οθόνη.
  for(const m of Object.values(MSG)) assert.ok(![EMAIL, PHONE, NAME].some(x => m.includes(x)));
  assert.equal(errorText({message: `weird ${EMAIL} ${PHONE}`}), MSG.generic);
});

test('server που δεν απαντά: μήνυμα μετά το όριο χρόνου, όχι κουμπί που περιμένει', async () => {
  const t0 = Date.now();
  const hang = fakeClient();
  hang.auth.signInWithPassword = () => new Promise(() => {});
  const a = createAccount({config: CFG, getClient: async () => hang, win: makeWin(), timeoutMs: 50});
  assert.equal((await a.signIn(EMAIL, PW)).error, MSG.offline);
  assert.ok(Date.now() - t0 < 2000);
});

test('υποχρεωτικός λογαριασμός: κλειδωμένο χωρίς αποθηκευμένη συνεδρία· ΛΗΓΜΕΝΗ συνεδρία χωρίς σήμα = ανοιχτό', async () => {
  const win = () => ({localStorage: globalThis.localStorage});
  assert.deepEqual(authGate(CFG, win()), {required: true, locked: true});
  const user = fakeClient().user;
  const expired = {access_token: 'a', refresh_token: 'r', expires_at: 1, user};      // έληξε το 1970
  env({'sb-abcdefgh-auth-token': JSON.stringify(expired)});
  assert.deepEqual(authGate(CFG, win()), {required: true, locked: false});
  assert.equal(storedSession(CFG, win()).user.id, UID);
  env({'sb-otherproj-auth-token': JSON.stringify(expired)});
  assert.equal(authGate(CFG, win()).locked, true, 'συνεδρία ΑΛΛΟΥ project δεν μετράει');
  env({'sb-abcdefgh-auth-token': '{χαλασμένο'});
  assert.equal(authGate(CFG, win()).locked, true);
  // Χωρίς ίντερνετ: ο χρήστης υπάρχει από την πρώτη στιγμή και μένει μετά το init (η βιβλιοθήκη δεν ανανεώνει).
  env({'sb-abcdefgh-auth-token': JSON.stringify(expired)});
  const client = fakeClient();
  client.auth.getSession = async () => ({data: {session: null}, error: {name: 'AuthRetryableFetchError', status: 0}});
  const {a} = setup({client, online: false});
  assert.equal(a.user().id, UID, 'πριν από κάθε δίκτυο');
  await a.init();
  assert.equal(a.user().id, UID, 'χωρίς σήμα δεν κλειδώνει');
});

test('η συνεδρία ανακλήθηκε (π.χ. «Αποσύνδεση από όλες τις συσκευές» αλλού): ειδοποίηση κλειδώματος· όχι στη δική μας αποσύνδεση', async () => {
  const live = () => fakeClient({session: {user: fakeClient().user}});
  const s = await signedIn({client: live()});
  await s.a.init();
  const locks = [];
  s.a.onLock(r => locks.push(r));
  s.client.authCbs.forEach(cb => cb('SIGNED_OUT', null));
  assert.deepEqual(locks, ['expired']);
  assert.equal(s.a.user(), null);
  const t = await signedIn({client: live()});
  await t.a.init();
  const l2 = [];
  t.a.onLock(r => l2.push(r));
  const p = t.a.signOut();
  t.client.authCbs.forEach(cb => cb('SIGNED_OUT', null));
  await p;
  assert.deepEqual(l2, [], 'δική μας αποσύνδεση: κανένα «έληξε»');
});

test('αποσύνδεση από όλες τις συσκευές: scope global· χωρίς ίντερνετ → μήνυμα, μένει συνδεδεμένος', async () => {
  const s = await signedIn();
  assert.equal((await s.a.signOut({global: true})).error, '');
  assert.deepEqual(s.client.calls.at(-1), ['signOut', {scope: 'global'}]);
  assert.equal(s.a.user(), null);
  const off = await signedIn({client: fakeClient({fail: {signOut: {name: 'AuthRetryableFetchError', status: 0}}})});
  assert.equal((await off.a.signOut({global: true})).error, MSG.offline);
  assert.equal(off.a.user().id, UID);
});

test('CAPTCHA (Turnstile): το token πάει σε εγγραφή, σύνδεση, επαναφορά, «στείλε ξανά»· χωρίς token δεν στέλνεται κενό', async () => {
  const {a, client} = setup();
  await a.signIn(EMAIL, PW);
  assert.deepEqual(client.calls.at(-1)[1].options, {});
  await a.requestReset(EMAIL);
  assert.deepEqual(client.calls.at(-1)[2], {});
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
  // Παλιά σύνδεση (πάνω από 10′): ο server ζητά ξανά κωδικό ή Google → reauth, τίποτα δεν σβήνεται.
  const old = await signedIn({client: fakeClient({fail: {invoke: {name: 'FunctionsHttpError', context: {status: 403}}}})});
  assert.deepEqual(await old.a.deleteAccount({wipeLocal: true}), {error: MSG.reauth, reauth: true});
  assert.equal(data['ergolav.quotes'], APP_DATA['ergolav.quotes']);
  assert.equal(old.a.user().id, UID);
});

test('επιβεβαίωση ταυτότητας πριν από τη διαγραφή: κωδικός (νέα σύνδεση) ή Google με σημάδι σκοπού', async () => {
  const s = await signedIn();
  assert.deepEqual(await s.a.reauthPassword(''), {error: MSG.noPassword, field: 'password'});
  assert.equal((await s.a.reauthPassword(PW, {captchaToken: 't'})).error, '');
  assert.deepEqual(s.client.calls.at(-1), ['password', {email: EMAIL, password: PW, options: {captchaToken: 't'}}]);
  const ss = {}, win = {...makeWin(), sessionStorage: {getItem: k => ss[k] ?? null, setItem: (k, v) => { ss[k] = v; }, removeItem: k => { delete ss[k]; }}};
  let t = 1000;
  const g = createAccount({config: CFG, getClient: async () => fakeClient(), win, now: () => t});
  assert.equal((await g.reauthGoogle('delete')).error, '');
  assert.equal(g.takeReauth(), 'delete');
  assert.equal(g.takeReauth(), '', 'μία φορά');
  await g.reauthGoogle('delete'); t += 11 * 60_000;
  assert.equal(g.takeReauth(), '', 'μετά από 10′ δεν ισχύει');
});

test('κανένα console.* δεν έγραψε email, τηλέφωνο, όνομα ή token', () => {
  for(const l of logged) assert.ok(![EMAIL, PHONE, NAME, 'Νίκος', 'test-anon-key', '123456'].some(x => l.includes(x)), l);
});
