// Υποχρεωτικός λογαριασμός σε πραγματικό browser: η ΠΡΑΓΜΑΤΙΚΗ βιβλιοθήκη Supabase (vendor/) με την πραγματική CSP.
// Ψεύτικα είναι μόνο ο server του Supabase (απαντήσεις του Playwright στη διεύθυνση του src/config.js), το Turnstile και
// η σελίδα της Google (redirect πίσω με ?code=). Καμία πραγματική κλήση, κανένα πραγματικό email.
// Εκτέλεση: node server/app.mjs --auth off &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/account.e2e.mjs
// (το test ανοίγει μόνο του τον λογαριασμό: αλλάζει το config.js μέσω Playwright, άρα δουλεύει και με --auth off)
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const CONFIG_SRC = fs.readFileSync(new URL('../../src/config.js', import.meta.url), 'utf8');
const SB = CONFIG_SRC.match(/SUPABASE_URL = '([^']+)'/)[1];
const REF = new URL(SB).hostname.split('.')[0];
const SHOTS = process.env.SHOTS || '';            // φάκελος για στιγμιότυπα (προαιρετικό)
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [], leaked = [], allPages = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const UID = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'meletis.test@example.com', PHONE = '6977777777', NAME = 'Μελέτης Υδραυλικός';
const PW = 'ergolav2026', PW_NEW = 'Kainourgios-77', UNCONFIRMED = 'den.epivevaiose@example.com';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub: UID, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600})}.c2ln`;

// ── Ψεύτικος server του Supabase ──
const server = {row: null, files: {}, reqs: [], deleted: false, providers: ['email'], email: EMAIL, password: PW, refreshFail: false, refreshOffline: false};
const user = () => ({id: UID, aud: 'authenticated', role: 'authenticated', email: server.email, email_confirmed_at: '2026-11-17T10:00:00Z',
  app_metadata: {provider: server.providers[0], providers: server.providers}, identities: server.providers.map(p => ({provider: p})),
  user_metadata: server.providers.includes('google') ? {full_name: NAME} : {}, created_at: '2026-11-16T10:00:00Z'});
const session = (expiresIn = 3600) => ({access_token: jwt(), token_type: 'bearer', expires_in: expiresIn, expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  refresh_token: 'rt-' + Math.random().toString(36).slice(2), user: user()});
const H = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*'};
const json = (route, status, body) => route.fulfill({status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: H});
const fail = (route, status, code, msg) => json(route, status, {code: status, error_code: code, msg});
async function supabase(route){
  const req = route.request(), url = new URL(req.url()), path = url.pathname, m = req.method();
  if(m === 'OPTIONS') return json(route, 204);
  const body = req.postData() || '', p = body && /json/.test(req.headers()['content-type'] || '') ? JSON.parse(body) : {};
  server.reqs.push({m, path, search: url.search, body, p, auth: req.headers()['authorization'] || ''});
  const grant = url.searchParams.get('grant_type');
  if(path === '/auth/v1/signup'){
    if(p.email === server.email && server.exists) return json(route, 200, {id: 'fake', email: p.email, identities: []});   // όπως το Supabase
    return json(route, 200, {...user(), email: p.email, email_confirmed_at: null, identities: [{provider: 'email'}]});
  }
  if(path === '/auth/v1/token' && grant === 'password'){
    if(p.email === UNCONFIRMED) return fail(route, 400, 'email_not_confirmed', 'Email not confirmed');
    if(p.email !== server.email || p.password !== server.password) return fail(route, 400, 'invalid_credentials', 'Invalid login credentials');
    return json(route, 200, session());
  }
  if(path === '/auth/v1/token' && grant === 'refresh_token'){
    if(server.refreshOffline) return route.abort('internetdisconnected');
    if(server.refreshFail) return fail(route, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
    return json(route, 200, session());
  }
  if(path === '/auth/v1/token' && grant === 'pkce'){ server.providers = [...new Set(['google', ...server.providers])]; return json(route, 200, session()); }
  if(path === '/auth/v1/verify'){
    if(p.token !== '123456') return fail(route, 403, 'otp_expired', 'Token has expired or is invalid');
    if(p.type === 'email_change') server.email = p.email;
    return json(route, 200, session());
  }
  if(path === '/auth/v1/recover' || path === '/auth/v1/resend') return json(route, 200, {});
  if(path === '/auth/v1/user' && m === 'PUT'){
    if(p.password){
      if(p.current_password !== undefined && p.current_password !== server.password) return fail(route, 400, 'current_password_invalid', 'Current password required when setting new password.');
      if(p.password === server.password) return fail(route, 422, 'same_password', 'New password should be different');
      server.password = p.password;
    }
    return json(route, 200, user());
  }
  if(path === '/auth/v1/user') return json(route, 200, user());
  if(path === '/auth/v1/authorize'){
    return route.fulfill({status: 302, headers: {Location: url.searchParams.get('redirect_to') + '?code=test-code-123'}});
  }
  if(path === '/auth/v1/logout') return json(route, 204);
  if(path === '/rest/v1/profiles'){
    if(m === 'GET'){
      const row = server.row && {business_name: server.row.business_name, specialty: server.row.specialty, phone: server.row.phone, logo_path: server.row.logo_path};
      return /vnd\.pgrst\.object/.test(req.headers()['accept'] || '') ? (row ? json(route, 200, row) : json(route, 406, {code: 'PGRST116'})) : json(route, 200, row ? [row] : []);
    }
    server.row = {...server.row, ...JSON.parse(body)};
    return json(route, 201, [server.row]);
  }
  if(path.startsWith('/storage/v1/object/list/logos')) return json(route, 200, Object.keys(server.files).filter(k => k.startsWith(UID + '/')).map(k => ({name: k.split('/')[1]})));
  if(m === 'DELETE' && path === '/storage/v1/object/logos'){ for(const f of JSON.parse(body).prefixes || []) delete server.files[f]; return json(route, 200, []); }
  const obj = path.match(/^\/storage\/v1\/object\/(?:authenticated\/)?logos\/(.+)$/);
  if(obj && (m === 'POST' || m === 'PUT')){ server.files[decodeURIComponent(obj[1])] = req.postDataBuffer(); return json(route, 200, {Key: 'logos/' + obj[1]}); }
  if(obj && m === 'GET'){
    const f = server.files[decodeURIComponent(obj[1])];
    return f ? route.fulfill({status: 200, contentType: 'image/png', body: f, headers: H}) : json(route, 404, {error: 'not_found'});
  }
  if(path === '/rest/v1/rpc/has_password'){ server.rpcCalls = (server.rpcCalls || 0) + 1; return json(route, 200, server.hasPw ?? server.providers.includes('email')); }
  if(path === '/functions/v1/delete-account'){ server.deleted = true; server.row = null; server.files = {}; return json(route, 200, {deleted: true}); }
  console.log('  (άγνωστο αίτημα)', m, path);
  return json(route, 404, {});
}
const reqs = (path, grant) => server.reqs.filter(r => r.path === path && (!grant || r.search.includes('grant_type=' + grant)));

async function page({auth = true, viewport = {width: 390, height: 844}, ctx, siteKey = '0x4AAAAAAAtestSiteKey000000', turnstile = 'ok', scheme = 'light', clock = false} = {}){
  ctx = ctx || await b.newContext({viewport, colorScheme: scheme});
  const p = await ctx.newPage();
  allPages.push(p);
  p.errs = []; p.logs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => p.logs.push(m.text()));
  if(clock) await p.clock.install();
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route(SB + '/**', supabase);
  // Ψεύτικο Turnstile: 'ok' = δίνει token· 'fail' = το script δεν φορτώνει (μπλοκαρισμένο / χωρίς ίντερνετ)
  await p.route('https://challenges.cloudflare.com/**', r => turnstile === 'fail' ? r.abort() : r.fulfill({contentType: 'text/javascript', body: `
    window.turnstile = {n: 0, w: {}, render(el, o){ const id = 'w' + Object.keys(this.w).length; this.w[id] = o; el.dataset.rendered = o.sitekey + '|' + o.action;
        setTimeout(() => o.callback('ts-token-' + (++this.n)), 30); return id; },
      reset(id){ const o = this.w[id]; setTimeout(() => o.callback('ts-token-' + (++this.n)), 30); }};`}));
  await p.route('**/src/config.js', async r => {
    const res = await r.fetch();
    const src = (await res.text()).replace(/export const AUTH_ENABLED = (true|false)/, `export const AUTH_ENABLED = ${auth}`)
      .replace(/export const SUPABASE_ANON_KEY = '[^']*'/, "export const SUPABASE_ANON_KEY = 'test-anon-key'")
      .replace(/export const TURNSTILE_SITE_KEY = '[^']*'/, `export const TURNSTILE_SITE_KEY = '${siteKey}'`);
    return r.fulfill({response: res, body: src});
  });
  // Ασφάλεια: αίτημα προς οποιοδήποτε *.supabase.co που ΔΕΝ πιάστηκε παραπάνω = αποτυχία του test.
  await p.route(/^https:\/\/[^/]*\.supabase\.co\//, r => { if(!r.request().url().startsWith(SB)) { leaked.push(r.request().url()); return r.abort(); } return r.fallback(); });
  await p.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = undefined;
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.blockedURI + ' ' + e.violatedDirective));
  });
  return p;
}
const screen = p => p.evaluate(() => document.querySelector('.screen.on')?.id);
const onScreens = p => p.evaluate(() => [...document.querySelectorAll('.screen.on')].map(s => s.id).join(','));
const ls = (p, k) => p.evaluate(k => localStorage.getItem(k), k);
const text = (p, sel) => p.textContent(sel).then(t => t.trim());
const visible = (p, sel) => p.isVisible(sel);
const ready = p => p.waitForFunction(() => !document.getElementById('lgSubmit').disabled, null, {timeout: 10000});
const seed = (p, obj) => p.addInitScript(o => { if(!sessionStorage.seeded){ sessionStorage.seeded = 1; for(const [k, v] of Object.entries(o)) localStorage.setItem(k, v); } }, obj);
const storedSession = (expiresIn = 3600) => ({[`sb-${REF}-auth-token`]: JSON.stringify(session(expiresIn))});
const APP = {'ergolav.quotes': JSON.stringify([{no: 1}]), 'ergolav.prices': '{"wc|x":[{"c":1000,"at":1}]}', 'ergolav.quoteNo': '41'};
async function shot(p, name){ if(SHOTS) { await p.waitForTimeout(400); await p.screenshot({path: `${SHOTS}/${name}.png`}); } }
async function dictate(p, words){
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await p.evaluate(w => { const el = document.getElementById('transcript'); el.textContent = w; el.dispatchEvent(new Event('input', {bubbles: true})); }, words);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
}

try {
  // ── 0. Flag κλειστό: η εφαρμογή όπως πριν (χωρίς λογαριασμό) ──
  {
    const p = await page({auth: false});
    await p.goto(BASE); await p.waitForSelector('#s-profile.on');
    await p.waitForTimeout(400);
    ok('flag κλειστό: η εφαρμογή ανοίγει όπως πριν, κανένα κουμπί λογαριασμού', !(await visible(p, '#acctBtn')) && await visible(p, '#step'));
    ok('flag κλειστό: η βιβλιοθήκη Supabase δεν φορτώνεται, κανένα αίτημα', await p.evaluate(() => !window.supabase) && server.reqs.length === 0);
    ok('flag κλειστό: «Τα στοιχεία σου» λέει «μόνο σε αυτή τη συσκευή»', /μόνο σε αυτή τη συσκευή/.test(await text(p, '#pfWhere')));
    await p.context().close();
  }

  // ── 1. Χωρίς σύνδεση: ΜΟΝΟ η οθόνη σύνδεσης (υπάρχων χρήστης με δεδομένα στη συσκευή) ──
  const ctx1 = await b.newContext({viewport: {width: 390, height: 844}});
  const p1 = await page({ctx: ctx1});
  await seed(p1, {...APP, 'ergolav.profile': JSON.stringify({name: 'Παλιά Συσκευή ΟΕ', trade: 'Ηλεκτρολόγος'})});
  await p1.goto(BASE); await p1.waitForSelector('#s-login.on');
  ok('χωρίς συνεδρία: ανοίγει ΠΡΩΤΑ η οθόνη σύνδεσης (μόνο αυτή)', await onScreens(p1) === 's-login');
  ok('κεφαλίδα: χωρίς κουμπί λογαριασμού, χωρίς «‹ Πίσω», χωρίς τα στοιχεία της επιχείρησης', !(await visible(p1, '#acctBtn')) && !(await visible(p1, '#navBack')) &&
    await text(p1, '#brandName') === 'ergolav' && !(await visible(p1, '#brandLogo')));
  ok('«Συνέχεια με Google» πάνω από τις καρτέλες «Σύνδεση» / «Νέος λογαριασμός»', await p1.evaluate(() =>
    document.getElementById('lgGoogle').getBoundingClientRect().bottom < document.getElementById('tabIn').getBoundingClientRect().top) &&
    await text(p1, '#tabIn') === 'Σύνδεση' && await text(p1, '#tabUp') === 'Νέος λογαριασμός');
  // Προσπάθειες να ανοίξει άλλη οθόνη: κουμπιά (και κρυφά), διεύθυνση, «‹ Πίσω», ιστορικό.
  for(const [what, act] of [
    ['κλικ στην κεφαλίδα (στοιχεία)', () => p1.evaluate(() => document.getElementById('brand').click())],
    ['«Προσφορές» / «Ημερολόγιο» (κρυφά κουμπιά)', () => p1.evaluate(() => ['quotesOpen', 'calOpen', 'statsOpen', 'histOpen'].forEach(id => document.getElementById(id)?.click()))],
    ['μικρόφωνο', () => p1.evaluate(() => document.getElementById('mic').click())],
    ['αλλαγή # στη διεύθυνση', () => p1.evaluate(() => { location.hash = '#s-start'; window.dispatchEvent(new HashChangeEvent('hashchange')); })],
    ['«‹ Πίσω» (κρυφό)', () => p1.evaluate(() => document.getElementById('navBack').click())],
    ['πίσω στο ιστορικό του browser', () => p1.goBack().catch(() => {})],
  ]){
    await act(); await p1.waitForTimeout(250);
    ok(`χωρίς σύνδεση, ${what}: καμία άλλη οθόνη`, await onScreens(p1) === 's-login' && !(await visible(p1, '#cta')), await onScreens(p1));
  }
  await p1.goto(BASE); await p1.waitForSelector('#s-login.on');
  ok('ανανέωση: πάλι μόνο η σύνδεση', await onScreens(p1) === 's-login');
  await shot(p1, 'login-390-light');

  // ── 2. Νέος λογαριασμός: κανόνες, ένδειξη δύναμης, Όροι, κουμπί κλειδωμένο μέχρι να είναι όλα σωστά ──
  await p1.click('#tabUp');
  ok('«Νέος λογαριασμός»: email, κωδικός, ξανά, ματάκι, λίστα κανόνων, «Αποδέχομαι» (Όροι + Απόρρητο)', await visible(p1, '#upEmail') && await visible(p1, '#upPw') &&
    await visible(p1, '#upPw2') && await visible(p1, '[data-eye="upPw"]') && (await p1.$$('#upRules li')).length === 4 &&
    await visible(p1, '#upTerms') && await visible(p1, '#pUp a[href="legal/terms.html"]') && await visible(p1, '#pUp a[href="legal/privacy.html"]'));
  ok('autocomplete: email / new-password / current-password · πληκτρολόγιο email', await p1.getAttribute('#upEmail', 'autocomplete') === 'email' &&
    await p1.getAttribute('#upEmail', 'inputmode') === 'email' && await p1.getAttribute('#upPw', 'autocomplete') === 'new-password' &&
    await p1.getAttribute('#upPw2', 'autocomplete') === 'new-password' && await p1.getAttribute('#inPw', 'autocomplete') === 'current-password');
  ok('«Δημιουργία λογαριασμού» κλειδωμένο στην αρχή', await p1.isDisabled('#lgSubmit') && await text(p1, '#lgSubmit') === 'Δημιουργία λογαριασμού');
  await p1.fill('#upEmail', 'όχι-email'); await p1.click('#upPw');
  ok('άκυρο email → σφάλμα ΔΙΠΛΑ στο πεδίο', await visible(p1, '#upEmailErr') && /δεν φαίνεται σωστό/.test(await text(p1, '#upEmailErr')));
  await p1.fill('#upEmail', 'neos.texnitis@example.com');
  ok('διόρθωση email → το σφάλμα φεύγει', !(await visible(p1, '#upEmailErr')));
  await p1.fill('#upPw', 'abc');
  const rules = () => p1.evaluate(() => Object.fromEntries([...document.querySelectorAll('#upRules li')].map(li => [li.dataset.r, li.classList.contains('ok')])));
  ok('«abc»: Αδύναμος, τικ μόνο στα γράμματα', await text(p1, '#upMeterText') === 'Αδύναμος' && JSON.stringify(await rules()) === '{"len":false,"letter":true,"digit":false,"match":false}');
  await p1.fill('#upPw', PW);
  ok(`«${PW}»: Καλός, τικ σε 8+, γράμματα, αριθμούς`, await text(p1, '#upMeterText') === 'Καλός' && JSON.stringify(await rules()) === '{"len":true,"letter":true,"digit":true,"match":false}');
  await p1.fill('#upPw', PW_NEW);
  ok(`«${PW_NEW}»: Δυνατός`, await text(p1, '#upMeterText') === 'Δυνατός');
  await p1.click('[data-eye="upPw"]');
  ok('ματάκι: ο κωδικός φαίνεται (και ξανά κρύβεται)', await p1.getAttribute('#upPw', 'type') === 'text' && await p1.getAttribute('[data-eye="upPw"]', 'aria-pressed') === 'true');
  await p1.click('[data-eye="upPw"]');
  await p1.fill('#upPw2', PW_NEW + 'x'); await p1.click('#upEmail');
  ok('διαφορετική επανάληψη → «Οι δύο κωδικοί δεν είναι ίδιοι» δίπλα στο πεδίο, κουμπί κλειδωμένο', /δεν είναι ίδιοι/.test(await text(p1, '#upPw2Err')) && await p1.isDisabled('#lgSubmit'));
  await p1.fill('#upPw2', PW_NEW);
  ok('όλα σωστά αλλά χωρίς «Αποδέχομαι» → ακόμα κλειδωμένο', await p1.isDisabled('#lgSubmit') && (await rules()).match);
  await p1.check('#upTerms'); await ready(p1);
  ok('με «Αποδέχομαι» (και τον έλεγχο ασφαλείας) → ανοίγει', !(await p1.isDisabled('#lgSubmit')) &&
    (await p1.getAttribute('#lgCaptcha', 'data-rendered')) === '0x4AAAAAAAtestSiteKey000000|auth');
  await shot(p1, 'signup-390-light');
  // διπλό πάτημα → ΕΝΑ αίτημα
  await p1.evaluate(() => { const b = document.getElementById('lgSubmit'); b.click(); b.click(); });
  await p1.waitForSelector('#pConfirm:not([hidden])');
  const su = reqs('/auth/v1/signup');
  ok('εγγραφή: ΕΝΑ αίτημα (όχι διπλό), email + κωδικός + token Turnstile', su.length === 1 && su[0].p.email === 'neos.texnitis@example.com' &&
    su[0].p.password === PW_NEW && su[0].p.gotrue_meta_security?.captcha_token?.startsWith('ts-token-'), JSON.stringify(su.map(r => r.p.email)));
  ok('επιβεβαίωση email: «Σου στείλαμε κωδικό 6 ψηφίων στο …», πεδίο αριθμών με one-time-code', /κωδικό 6 ψηφίων στο neos\.texnitis@example\.com/.test(await text(p1, '#cfSentTo')) &&
    await p1.getAttribute('#cfCode', 'inputmode') === 'numeric' && await p1.getAttribute('#cfCode', 'autocomplete') === 'one-time-code');
  ok('«Στείλε ξανά» με αντίστροφη μέτρηση (κλειδωμένο)', /Στείλε ξανά \(\d+″\)/.test(await text(p1, '#lgResend')) && await p1.isDisabled('#lgResend'));
  ok('στην επιβεβαίωση: «‹ Πίσω» πάει στην εγγραφή (εμφανές)', await visible(p1, '#navBack'));
  await p1.fill('#cfCode', '000000');
  await p1.waitForSelector('#cfCodeErr:not([hidden])');
  ok('λάθος κωδικός → σφάλμα στο πεδίο, παραμένει χωρίς σύνδεση', /Λάθος κωδικός/.test(await text(p1, '#cfCodeErr')) && await onScreens(p1) === 's-login');
  // ο «νέος» χρήστης του ψεύτικου server είναι ο ίδιος UID· άδειος λογαριασμός, συσκευή με παλιά στοιχεία → ανεβαίνουν
  server.email = 'neos.texnitis@example.com'; server.password = PW_NEW; server.row = null;
  await p1.fill('#cfCode', '123456');
  await p1.waitForSelector('#s-start.on');
  const vf = reqs('/auth/v1/verify').at(-1);
  ok('σωστός κωδικός → verifyOtp type signup → συνδέθηκε', vf.p.type === 'signup' && vf.p.token === '123456' && await p1.getAttribute('#acctBtn', 'aria-label') !== 'Σύνδεση');
  ok('υπάρχων χρήστης με δεδομένα: ΤΙΠΟΤΑ δεν σβήστηκε, τα στοιχεία ανέβηκαν στον λογαριασμό', server.row?.business_name === 'Παλιά Συσκευή ΟΕ' &&
    await ls(p1, 'ergolav.quotes') === APP['ergolav.quotes'] && await ls(p1, 'ergolav.prices') === APP['ergolav.prices'] && await ls(p1, 'ergolav.quoteNo') === '41');
  ok('μετά τη σύνδεση: κεφαλίδα με τα στοιχεία, κουμπί λογαριασμού', await text(p1, '#brandName') === 'Παλιά Συσκευή ΟΕ' && await visible(p1, '#acctBtn'));
  ok('«Τα στοιχεία σου»: «στη συσκευή και στον λογαριασμό σου»', /στον λογαριασμό σου/.test(await text(p1, '#pfWhere')));

  // ── 3. Ο λογαριασμός μου: αλλαγή κωδικού, αλλαγή email, αποσύνδεση ──
  await p1.click('#acctBtn'); await p1.waitForSelector('#s-account.on');
  ok('«Ο λογαριασμός μου»: email, «Σύνδεση με email και κωδικό», αλλαγή κωδικού/email, αποσύνδεση (και από όλες), διαγραφή',
    await text(p1, '#acctEmail') === 'neos.texnitis@example.com' && await text(p1, '#acctVia') === 'Σύνδεση με email και κωδικό' &&
    await visible(p1, '#acctPwOpen') && await visible(p1, '#acctEmOpen') && await visible(p1, '#acctSignOut') && await visible(p1, '#acctSignOutAll') && await visible(p1, '#acctDelete'));
  await p1.click('#acctPwOpen');
  await p1.fill('#acctPwCur', 'lathos1234'); await p1.fill('#acctPw', 'Allagi-2026'); await p1.fill('#acctPw2', 'Allagi-2026');
  await p1.click('#acctPwSave'); await p1.waitForSelector('#acctPwCurErr:not([hidden])');
  ok('αλλαγή κωδικού με λάθος τωρινό → σφάλμα στο πεδίο «Τωρινός κωδικός»', /τωρινός κωδικός δεν είναι σωστός/i.test(await text(p1, '#acctPwCurErr')));
  await p1.fill('#acctPwCur', PW_NEW); await p1.click('#acctPwSave');
  await p1.waitForFunction(() => /Ο κωδικός άλλαξε/.test(document.getElementById('acctStatus').textContent));
  const pu = server.reqs.filter(r => r.path === '/auth/v1/user' && r.m === 'PUT').at(-1);
  ok('σωστός τωρινός → αλλάζει (στέλνεται current_password)', pu.p.current_password === PW_NEW && pu.p.password === 'Allagi-2026' && server.password === 'Allagi-2026');
  await p1.click('#acctEmOpen'); await p1.fill('#acctEm', 'neo.email@example.com'); await p1.click('#acctEmSend');
  await p1.waitForSelector('#acctEmCodeWrap:not([hidden])');
  ok('αλλαγή email → κωδικός στο ΝΕΟ email', server.reqs.filter(r => r.path === '/auth/v1/user' && r.m === 'PUT').at(-1).p.email === 'neo.email@example.com' &&
    /neo\.email@example\.com/.test(await text(p1, '#acctEmSentTo')));
  await p1.fill('#acctEmCode', '123456'); await p1.click('#acctEmVerify');
  await p1.waitForFunction(() => /Το email άλλαξε/.test(document.getElementById('acctStatus').textContent));
  ok('κωδικός → email_change → το νέο email φαίνεται', reqs('/auth/v1/verify').at(-1).p.type === 'email_change' && await text(p1, '#acctEmail') === 'neo.email@example.com');
  await shot(p1, 'account-390-light');
  await p1.click('#acctSignOut'); await p1.waitForSelector('#s-login.on');
  ok('Αποσύνδεση → οθόνη σύνδεσης (scope local), μήνυμα ότι οι προσφορές έμειναν', reqs('/auth/v1/logout').at(-1).search === '?scope=local' &&
    /προσφορές σου έμειναν/.test(await text(p1, '#lgStatus')) && await onScreens(p1) === 's-login');
  ok('μετά την αποσύνδεση: τοπικά δεδομένα μένουν, η συνεδρία φεύγει, κεφαλίδα κλειδωμένη',
    !!(await ls(p1, 'ergolav.profile')) && await ls(p1, 'ergolav.quotes') === APP['ergolav.quotes'] && await ls(p1, 'ergolav.quoteNo') === '41' &&
    await p1.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('sb-'))) && !(await visible(p1, '#acctBtn')) && await text(p1, '#brandName') === 'ergolav');
  await p1.evaluate(() => document.getElementById('brand').click()); await p1.waitForTimeout(200);
  ok('μετά την αποσύνδεση: καμία άλλη οθόνη', await onScreens(p1) === 's-login');

  // ── 4. Σύνδεση: λάθος κωδικός (ένα μήνυμα), 5 λάθη → αναμονή με μέτρηση, χωρίς αίτημα στο μεταξύ ──
  await ready(p1);
  await p1.fill('#inEmail', 'neo.email@example.com'); await p1.fill('#inPw', 'lathos-001');
  await p1.click('#lgSubmit'); await p1.waitForSelector('#inPwErr:not([hidden])');
  ok('λάθος κωδικός → «Λάθος email ή κωδικός» (δεν λέει ποιο), δίπλα στο πεδίο', /^Λάθος email ή κωδικός\./.test(await text(p1, '#inPwErr')));
  for(let i = 2; i <= 5; i++){ await ready(p1); await p1.fill('#inPw', 'lathos-00' + i); await p1.click('#lgSubmit'); await p1.waitForFunction(() => !document.getElementById('lgSubmit').hasAttribute('aria-busy')); }
  await p1.waitForFunction(() => /Πολλές λάθος προσπάθειες/.test(document.getElementById('lgError').textContent));
  const tries = reqs('/auth/v1/token', 'password').length;
  ok('5ο λάθος → «Πολλές λάθος προσπάθειες. Ξαναδοκίμασε σε 30″», κουμπί κλειδωμένο', /Ξαναδοκίμασε σε (30|29)″/.test(await text(p1, '#lgError')) && await p1.isDisabled('#lgSubmit'));
  await p1.waitForTimeout(2300);
  ok('η αναμονή μετράει αντίστροφα', /Ξαναδοκίμασε σε 2\d″/.test(await text(p1, '#lgError')), await text(p1, '#lgError'));
  await p1.evaluate(() => document.getElementById('lgSubmit').click());
  ok('μέσα στην αναμονή: κανένα αίτημα', reqs('/auth/v1/token', 'password').length === tries);
  // ανανέωση της καρτέλας: η αναμονή μένει (όχι μόνιμο κλείδωμα — λήγει)
  await p1.reload(); await p1.waitForSelector('#s-login.on');
  ok('ανανέωση: η αναμονή ισχύει ακόμα', await p1.isDisabled('#lgSubmit') && /Πολλές λάθος προσπάθειες/.test(await text(p1, '#lgError')));
  await p1.evaluate(() => sessionStorage.removeItem('ergolav.account.throttle'));
  await p1.reload(); await p1.waitForSelector('#s-login.on');

  // ── 5. Ξέχασα τον κωδικό: κωδικός 6 ψηφίων → νέος κωδικός δύο φορές → συνδέεται ──
  await p1.fill('#inEmail', 'neo.email@example.com');
  await p1.click('#inForgot');
  ok('«Ξέχασα τον κωδικό» → email (συμπληρωμένο), «‹ Πίσω» εμφανές', await p1.inputValue('#fgEmail') === 'neo.email@example.com' && await visible(p1, '#navBack'));
  await ready(p1); await p1.click('#lgSubmit'); await p1.waitForSelector('#pReset:not([hidden])');
  ok('→ /recover με token Turnstile· πεδίο κωδικού + νέος κωδικός δύο φορές + κανόνες', reqs('/auth/v1/recover').at(-1)?.p.gotrue_meta_security?.captcha_token?.startsWith('ts-token-') &&
    await visible(p1, '#rsCode') && await visible(p1, '#rsPw') && await visible(p1, '#rsPw2') && await visible(p1, '#rsRules'));
  await p1.fill('#rsCode', '999999'); await p1.fill('#rsPw', 'Xananeos-55'); await p1.fill('#rsPw2', 'Xananeos-55');
  await p1.click('#lgSubmit'); await p1.waitForSelector('#rsCodeErr:not([hidden])');
  ok('λάθος κωδικός email → σφάλμα στο πεδίο, ο κωδικός πρόσβασης ΔΕΝ άλλαξε', /Λάθος κωδικός/.test(await text(p1, '#rsCodeErr')) && server.password === 'Allagi-2026');
  await p1.fill('#rsCode', '123456'); await p1.click('#lgSubmit');
  await p1.waitForSelector('#s-start.on');
  const rput = server.reqs.filter(r => r.path === '/auth/v1/user' && r.m === 'PUT').at(-1);
  ok('σωστός → recovery → νέος κωδικός ΧΩΡΙΣ τον παλιό → συνδεδεμένος στην αρχική', reqs('/auth/v1/verify').at(-1).p.type === 'recovery' &&
    rput.p.password === 'Xananeos-55' && rput.p.current_password === undefined && server.password === 'Xananeos-55');
  ok('μήνυμα «Ο νέος κωδικός αποθηκεύτηκε»', /Ο νέος κωδικός αποθηκεύτηκε/.test(await text(p1, '#micNote')));

  // ── 6. Λήξη συνεδρίας ΜΕ ίντερνετ ενώ γράφει προσφορά → σύνδεση, και η προσφορά μένει ──
  {
    const p = await page({clock: true});
    await seed(p, {...APP, 'ergolav.profile': JSON.stringify({name: 'Παλιά Συσκευή ΟΕ', trade: 'Ηλεκτρολόγος'}), ...storedSession(3600)});
    await p.goto(BASE); await p.waitForSelector('#s-start.on');
    await p.waitForFunction(() => !!window.supabase);
    await dictate(p, 'δύο λεκάνες και τρία μέτρα σωλήνα');
    const lines = (await p.$$('#lines .ln')).length;
    server.refreshFail = true;
    await p.clock.fastForward('02:00:00');
    await p.waitForSelector('#s-login.on', {timeout: 15000});
    ok('η συνεδρία έληξε (ο server αρνήθηκε ανανέωση) → οθόνη σύνδεσης με «ό,τι έγραφες δεν χάθηκε»', /ό,τι έγραφες δεν χάθηκε/.test(await text(p, '#lgError')) && await onScreens(p) === 's-login');
    server.refreshFail = false;
    await ready(p);
    await p.fill('#inEmail', 'neo.email@example.com'); await p.fill('#inPw', 'Xananeos-55'); await p.click('#lgSubmit');
    await p.waitForSelector('#s-lines.on', {timeout: 8000}).catch(() => {});
    ok('σύνδεση ξανά → ΠΙΣΩ στην προσφορά, με τις ίδιες γραμμές', (await p.$$('#lines .ln')).length === lines && lines > 0, `${lines} γραμμές`);
    await p.context().close();
  }

  // ── 7. Χωρίς σήμα με αποθηκευμένη (και ληγμένη) συνεδρία: δουλεύει κανονικά, ποτέ κλείδωμα λόγω σήματος ──
  {
    const p = await page();
    server.refreshOffline = true;
    await seed(p, {...APP, 'ergolav.profile': JSON.stringify({name: 'Παλιά Συσκευή ΟΕ'}), ...storedSession(-7200)});
    await p.goto(BASE); await p.waitForSelector('#s-start.on');
    await p.context().setOffline(true);
    await p.waitForTimeout(1500);
    ok('ληγμένη συνεδρία, χωρίς σήμα: αρχική κανονικά, όχι κλείδωμα', await onScreens(p) === 's-start' && await visible(p, '#acctBtn'));
    await dictate(p, 'μία μπαταρία νιπτήρα');
    ok('χωρίς σήμα: η προσφορά δουλεύει', (await p.$$('#lines .ln')).length === 1);
    await p.waitForTimeout(1500);
    ok('…και μένει ξεκλείδωτη', await onScreens(p) === 's-lines');
    await p.context().setOffline(false);
    server.refreshOffline = false;
    await p.context().close();
  }

  // ── 8. Μη επιβεβαιωμένο email, email σε χρήση, Google ──
  {
    const p = await page();
    await p.goto(BASE); await p.waitForSelector('#s-login.on'); await ready(p);
    await p.fill('#inEmail', UNCONFIRMED); await p.fill('#inPw', 'kati12345'); await p.click('#lgSubmit');
    await p.waitForSelector('#inConfirm:not([hidden])');
    ok('μη επιβεβαιωμένο email → μήνυμα + κουμπί «Στείλε κωδικό επιβεβαίωσης»', /δεν έχει επιβεβαιωθεί/.test(await text(p, '#lgError')));
    await p.waitForFunction(() => !document.getElementById('inConfirm').disabled);
    await p.click('#inConfirm'); await p.waitForSelector('#pConfirm:not([hidden])');
    ok('→ /resend (signup) με token Turnstile → πεδίο κωδικού', reqs('/auth/v1/resend').at(-1).p.type === 'signup' && reqs('/auth/v1/resend').at(-1).p.email === UNCONFIRMED &&
      !!reqs('/auth/v1/resend').at(-1).p.gotrue_meta_security?.captcha_token);
    await p.click('#navBack'); await p.waitForSelector('#pUp:not([hidden])');
    server.exists = true; server.email = 'neo.email@example.com';
    await p.fill('#upEmail', 'neo.email@example.com'); await p.fill('#upPw', PW); await p.fill('#upPw2', PW); await p.check('#upTerms');
    await ready(p); await p.click('#lgSubmit'); await p.waitForSelector('#upEmailErr:not([hidden])');
    ok('email σε χρήση → «έχει ήδη λογαριασμό… Συνέχεια με Google / Ξέχασα τον κωδικό»', /έχει ήδη λογαριασμό/.test(await text(p, '#upEmailErr')) &&
      /Συνέχεια με Google/.test(await text(p, '#upEmailErr')));
    server.exists = false;
    // Google (PKCE): λογαριασμός με άλλα στοιχεία από τη συσκευή → ερώτηση· λογαριασμός ΔΕΝ μένει ποτέ χωρίς όνομα
    server.row = {id: UID, business_name: 'Άλλη Επιχείρηση ΑΕ', specialty: 'Πλακάς', phone: PHONE, logo_path: `${UID}/a1b2c3d4.png`};
    server.files[`${UID}/a1b2c3d4.png`] = Buffer.from(PNG, 'base64');
    await Promise.all([p.waitForURL(/127\.0\.0\.1|localhost/), p.click('#lgGoogle')]);
    await p.waitForSelector('#s-start.on', {timeout: 15000});
    const ap = new URLSearchParams(reqs('/auth/v1/authorize').at(-1)?.search || '');
    ok('Google: PKCE, redirect_to = η εφαρμογή, ?code= σβήστηκε από τη διεύθυνση', ap.get('provider') === 'google' && !!ap.get('code_challenge') &&
      ap.get('redirect_to') === BASE && !(await p.evaluate(() => location.search)));
    ok('Google σε νέα συσκευή: στοιχεία και λογότυπο ήρθαν από τον λογαριασμό', await text(p, '#brandName') === 'Άλλη Επιχείρηση ΑΕ' &&
      await p.getAttribute('#brandLogo img', 'src') === 'data:image/png;base64,' + PNG);
    await p.click('#acctBtn'); await p.waitForSelector('#s-account.on');
    ok('ίδιο email με Google και κωδικό: ΕΝΑΣ λογαριασμός, «email και κωδικό ή Google»', await text(p, '#acctVia') === 'Σύνδεση με email και κωδικό ή με Google');
    // Αποσύνδεση από όλες τις συσκευές
    await p.click('#acctSignOutAll'); await p.waitForSelector('#s-login.on');
    ok('«Αποσύνδεση από όλες τις συσκευές» → logout scope=global → σύνδεση', reqs('/auth/v1/logout').at(-1).search === '?scope=global' && /όλες τις συσκευές/.test(await text(p, '#lgStatus')));
    await p.context().close();
  }

  // ── 8β. Λογαριασμός Google που όρισε κωδικό («Ξέχασα τον κωδικό»): το Supabase δείχνει μόνο google — ρωτάμε τη βάση ──
  for(const hasPw of [true, false]){
    const p = await page();
    server.providers = ['google']; server.hasPw = hasPw; server.deleted = false; server.rpcCalls = 0;
    server.row = {id: UID, business_name: 'Google Επιχείρηση', specialty: null, phone: null, logo_path: null};
    await p.goto(BASE); await p.waitForSelector('#s-login.on');
    await Promise.all([p.waitForURL(/127\.0\.0\.1|localhost/), p.click('#lgGoogle')]);
    await p.waitForSelector('#s-start.on', {timeout: 15000});
    server.providers = ['google'];                      // (το pkce του ψεύτικου server προσθέτει google σε ό,τι υπήρχε)
    await p.click('#acctBtn'); await p.waitForSelector('#s-account.on');
    await p.click('#acctPwOpen'); await p.waitForSelector('#acctPwBox:not([hidden])');
    ok(`Google ${hasPw ? 'ΜΕ' : 'χωρίς'} κωδικό: η βάση ρωτήθηκε (has_password), «Τωρινός κωδικός» ${hasPw ? 'ζητείται' : 'δεν ζητείται'}`,
      server.rpcCalls >= 1 && (await p.isVisible('#acctPwCur')) === hasPw && await text(p, '#acctPwSave') === (hasPw ? 'Αλλαγή κωδικού' : 'Ορισμός κωδικού'));
    ok(`Google ${hasPw ? 'ΜΕ' : 'χωρίς'} κωδικό: «${hasPw ? 'email και κωδικό ή με Google' : 'Σύνδεση με Google'}»`,
      await text(p, '#acctVia') === (hasPw ? 'Σύνδεση με email και κωδικό ή με Google' : 'Σύνδεση με Google'));
    await p.click('#acctDelete'); await p.waitForSelector('#acctDelBox:not([hidden])');
    if(hasPw){
      ok('Google + κωδικός: η διαγραφή δέχεται ΚΑΙ κωδικό ΚΑΙ Google', await p.isVisible('#acctDelPw') && await p.isVisible('#acctDelGoogle'));
      await Promise.all([p.waitForURL(/127\.0\.0\.1|localhost/), p.click('#acctDelGoogle')]);
      await p.waitForSelector('#s-account.on #acctDelBox:not([hidden])', {timeout: 15000});
      ok('επιβεβαίωση με Google → πίσω στη διαγραφή, χωρίς να ζητά κωδικό', /Επιβεβαιώθηκες με Google/.test(await text(p, '#acctStatus')) &&
        !(await p.isVisible('#acctDelPw')) && await p.isEnabled('#acctDelYes') && !server.deleted);
      await p.click('#acctDelYes'); await p.waitForSelector('#s-login.on');
      ok('→ διαγραφή', server.deleted);
    } else {
      ok('μόνο Google: η διαγραφή ζητά νέα σύνδεση με Google (όχι κωδικό)', !(await p.isVisible('#acctDelPw')) && !(await p.isVisible('#acctDelGoogle')) &&
        await text(p, '#acctDelYes') === 'Σύνδεση με Google και διαγραφή');
    }
    await p.context().close();
  }
  server.hasPw = undefined; server.providers = ['email'];

  // ── 9. Νέα συσκευή, νέος λογαριασμός: «Τα στοιχεία σου» ΥΠΟΧΡΕΩΤΙΚΑ πριν από την αρχική ──
  {
    const p = await page();
    server.row = null; server.files = {}; server.providers = ['email']; server.email = 'allos@example.com'; server.password = PW;
    await p.goto(BASE); await p.waitForSelector('#s-login.on');
    await p.click('#tabUp'); await p.fill('#upEmail', 'allos@example.com'); await p.fill('#upPw', PW); await p.fill('#upPw2', PW); await p.check('#upTerms');
    await ready(p); await p.click('#lgSubmit'); await p.waitForSelector('#pConfirm:not([hidden])');
    await p.fill('#cfCode', '123456'); await p.waitForSelector('#s-profile.on');
    ok('νέος χρήστης: εγγραφή → επιβεβαίωση → «Τα στοιχεία σου» (χωρίς «‹ Πίσω»)', !(await visible(p, '#navBack')));
    await p.click('#brand'); await p.evaluate(() => document.getElementById('navBack').click()); await p.waitForTimeout(200);
    ok('χωρίς όνομα επιχείρησης δεν πάει πουθενά αλλού (κεφαλίδα, «‹ Πίσω»)', await screen(p) === 's-profile');
    await p.click('#pfSave'); await p.waitForTimeout(200);
    ok('κενό όνομα → δεν αποθηκεύεται', await screen(p) === 's-profile' && await visible(p, '#pfError'));
    await p.fill('#pfName', 'Νέος Τεχνίτης'); await p.click('#pfSave'); await p.waitForSelector('#s-start.on');
    await p.waitForTimeout(400);
    ok('→ αρχική, και το όνομα ανέβηκε στον λογαριασμό', server.row?.business_name === 'Νέος Τεχνίτης');
    // Διαγραφή: ζητά ξανά κωδικό (+ Turnstile)
    await p.click('#acctBtn'); await p.waitForSelector('#s-account.on');
    await p.click('#acctDelete'); await p.waitForSelector('#acctDelBox:not([hidden])');
    ok('διαγραφή → ζητά ξανά τον κωδικό (με έλεγχο ασφαλείας), κουμπί κλειδωμένο χωρίς κωδικό', await visible(p, '#acctDelPw') &&
      await p.getAttribute('#acctDelPw', 'autocomplete') === 'current-password' && await p.isDisabled('#acctDelYes') && !server.deleted);
    await p.fill('#acctDelPw', 'lathos-999');
    await p.waitForFunction(() => !document.getElementById('acctDelYes').disabled);
    await p.click('#acctDelYes'); await p.waitForSelector('#acctDelPwErr:not([hidden])');
    ok('λάθος κωδικός → σφάλμα στο πεδίο, ΤΙΠΟΤΑ δεν σβήστηκε', /Λάθος email ή κωδικός/.test(await text(p, '#acctDelPwErr')) && !server.deleted);
    await p.fill('#acctDelPw', PW);
    await p.waitForFunction(() => !document.getElementById('acctDelYes').disabled);
    await p.click('#acctDelYes'); await p.waitForSelector('#s-login.on');
    const del = server.reqs.find(r => r.path === '/functions/v1/delete-account');
    ok('σωστός κωδικός → νέα σύνδεση + Edge Function με JWT → οθόνη σύνδεσης', server.deleted && /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(del.auth) &&
      /διαγράφηκε/.test(await text(p, '#lgStatus')));
    ok('μετά τη διαγραφή: τα δεδομένα της συσκευής μένουν (δεν τσεκαρίστηκε το «σβήσε»)', JSON.parse(await ls(p, 'ergolav.profile')).name === 'Νέος Τεχνίτης');
    await p.context().close();
  }

  // ── 10. Turnstile που δεν φορτώνει, χωρίς ίντερνετ ──
  {
    const p = await page({turnstile: 'fail'});
    await p.goto(BASE); await p.waitForSelector('#s-login.on');
    await p.waitForFunction(() => /δεν φόρτωσε/.test(document.getElementById('lgCaptchaNote').textContent), null, {timeout: 15000});
    ok('Turnstile δεν φορτώνει → μήνυμα, «Σύνδεση» κλειδωμένο, το Google μένει', await p.isDisabled('#lgSubmit') && /Συνέχισε με Google/.test(await text(p, '#lgCaptchaNote')) && await p.isEnabled('#lgGoogle'));
    await p.context().close();
    const q = await page();
    await q.goto(BASE); await q.waitForSelector('#s-login.on'); await ready(q);
    await q.context().setOffline(true);
    await q.fill('#inEmail', 'neo.email@example.com'); await q.fill('#inPw', 'kati12345'); await q.click('#lgSubmit');
    await q.waitForFunction(() => !document.getElementById('lgError').hidden, null, {timeout: 20000});
    ok('χωρίς ίντερνετ → «Δεν υπάρχει σύνδεση στο ίντερνετ…»', /Δεν υπάρχει σύνδεση στο ίντερνετ/.test(await text(q, '#lgError')));
    await q.context().close();
  }

  // ── 11. Όροι, Απόρρητο ──
  {
    const p = await page();
    await p.goto(BASE); await p.waitForSelector('#s-login.on');
    await p.click('#tabUp'); await p.click('#pUp a[href="legal/privacy.html"]'); await p.waitForSelector('h1');
    ok('«Απόρρητο» από την εγγραφή → σελίδα· λέει για τον κωδικό πρόσβασης', await text(p, 'h1') === 'Απόρρητο' && /κωδικό πρόσβασης/.test(await text(p, 'main')));
    await p.goBack(); await p.waitForSelector('#s-login.on');
    ok('πίσω → πάλι μόνο η σύνδεση', await onScreens(p) === 's-login');
    await p.context().close();
  }

  // ── 12. Οθόνες σε 360px, 390px, desktop· φωτεινό και σκούρο ──
  for(const [width, scheme] of [[360, 'light'], [360, 'dark'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]){
    const p = await page({viewport: {width, height: 820}, scheme});
    await p.goto(BASE); await p.waitForSelector('#s-login.on');
    const check = () => p.evaluate(() => {
      const over = document.documentElement.scrollWidth > innerWidth;
      const out = [...document.querySelectorAll('#s-login.on input, #s-login.on button, #s-account.on input, #s-account.on button')]
        .filter(e => e.offsetParent).filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < -0.5; }).map(e => e.id);
      const bg = getComputedStyle(document.body).backgroundColor;
      return {over, out, bg};
    });
    const a = await check();
    await p.click('#tabUp'); await p.fill('#upPw', 'abc123'); await p.fill('#upPw2', 'x');
    await shot(p, `signup-${width}-${scheme}`);
    const c = await check();
    ok(`${width}px ${scheme}: σύνδεση και εγγραφή χωρίς οριζόντια κύλιση, τίποτα έξω από την οθόνη`, !a.over && !c.over && !a.out.length && !c.out.length,
      JSON.stringify({a, c}));
    if(scheme === 'dark') ok(`${width}px σκούρο: σκούρο φόντο`, /rgb\((1\d|2\d), (1\d|2\d), (1\d|2\d)\)/.test(c.bg), c.bg);
    await p.context().close();
  }

  // ── 13. CSP, απόρρητο, σφάλματα ──
  const csp = (await Promise.all(allPages.filter(p => !p.isClosed()).map(p => p.evaluate(() => window.__csp).catch(() => [])))).flat();
  ok('καμία παραβίαση CSP', csp.length === 0, csp.join(' | '));
  const logs = allPages.flatMap(p => p.logs);
  const leaks = logs.filter(l => [EMAIL, 'neo.email', 'neos.texnitis', PHONE, 'Μελέτης', 'test-code-123', 'rt-', PW, PW_NEW, 'Xananeos', 'Allagi'].some(x => l.includes(x)));
  ok('το console δεν έγραψε email, τηλέφωνο, όνομα, κωδικό ή token', leaks.length === 0, leaks.join(' | '));
  ok('κανένα αίτημα δεν βγήκε προς πραγματικό Supabase', leaked.length === 0, leaked.join(' | '));
  const errs = allPages.flatMap(p => p.errs);
  ok('χωρίς σφάλματα JavaScript', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
