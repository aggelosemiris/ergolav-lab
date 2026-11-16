// Λογαριασμός σε πραγματικό browser: η ΠΡΑΓΜΑΤΙΚΗ βιβλιοθήκη Supabase (vendor/) με την πραγματική CSP της εφαρμογής.
// Ψεύτικος είναι μόνο ο server του Supabase (απαντήσεις του Playwright στο https://your-project-ref.supabase.co) και
// η σελίδα σύνδεσης της Google (redirect πίσω με ?code=). Καμία πραγματική κλήση, κανένα πραγματικό email.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/account.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const SB = 'https://your-project-ref.supabase.co';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const UID = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'meletis.test@example.com', PHONE = '6977777777', NAME = 'Μελέτης Υδραυλικός';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub: UID, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600})}.c2ln`;
const user = provider => ({id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {provider},
  user_metadata: provider === 'google' ? {full_name: NAME} : {}, created_at: '2026-11-16T10:00:00Z'});
const session = provider => ({access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'rt-' + provider, user: user(provider)});

// ── Ψεύτικος server του Supabase ──
const server = {row: null, files: {}, reqs: [], otpStatus: 200, deleted: false, provider: 'email'};
function json(route, status, body, headers = {}){
  return route.fulfill({status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body),
    headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*', ...headers}});
}
async function supabase(route){
  const req = route.request(), url = new URL(req.url()), path = url.pathname, m = req.method();
  if(m === 'OPTIONS') return json(route, 204);
  const body = req.postData() || '';
  server.reqs.push({m, path, search: url.search, body, auth: req.headers()['authorization'] || ''});
  if(path === '/auth/v1/otp') return server.otpStatus === 200 ? json(route, 200, {})
    : json(route, server.otpStatus, {code: 'over_email_send_rate_limit', error_code: 'over_email_send_rate_limit', msg: 'rate limit'});
  if(path === '/auth/v1/verify'){
    const p = JSON.parse(body);
    if(p.token !== '123456') return json(route, 403, {code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid'});
    server.provider = 'email';
    return json(route, 200, session('email'));
  }
  if(path === '/auth/v1/authorize'){
    // «Η Google»: επιστρέφει αμέσως στη διεύθυνση της εφαρμογής με ?code= (PKCE)
    server.provider = 'google';
    return route.fulfill({status: 302, headers: {Location: url.searchParams.get('redirect_to') + '?code=test-code-123'}});
  }
  if(path === '/auth/v1/token') return json(route, 200, session(url.searchParams.get('grant_type') === 'pkce' ? 'google' : server.provider));
  if(path === '/auth/v1/user') return json(route, 200, user(server.provider));
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
  if(m === 'DELETE' && path === '/storage/v1/object/logos'){ for(const p of JSON.parse(body).prefixes || []) delete server.files[p]; return json(route, 200, []); }
  const obj = path.match(/^\/storage\/v1\/object\/(?:authenticated\/)?logos\/(.+)$/);
  if(obj && (m === 'POST' || m === 'PUT')){ server.files[decodeURIComponent(obj[1])] = req.postDataBuffer(); return json(route, 200, {Key: 'logos/' + obj[1]}); }
  if(obj && m === 'GET'){
    const f = server.files[decodeURIComponent(obj[1])];
    return f ? route.fulfill({status: 200, contentType: 'image/png', body: f, headers: {'Access-Control-Allow-Origin': '*'}}) : json(route, 404, {error: 'not_found'});
  }
  if(path === '/functions/v1/delete-account'){ server.deleted = true; return json(route, 200, {deleted: true}); }
  console.log('  (άγνωστο αίτημα)', m, path);
  return json(route, 404, {});
}

async function page({auth = true, viewport = {width: 390, height: 844}, ctx} = {}){
  ctx = ctx || await b.newContext({viewport});
  const p = await ctx.newPage();
  p.errs = []; p.csp = []; p.logs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => p.logs.push(m.text()));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route(SB + '/**', supabase);
  if(auth) await p.route('**/src/config.js', async r => {
    const res = await r.fetch();
    const src = (await res.text()).replace('export const AUTH_ENABLED = false', 'export const AUTH_ENABLED = true').replace("'your-anon-key'", "'test-anon-key'");
    return r.fulfill({response: res, body: src});
  });
  await p.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = undefined;
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.blockedURI + ' ' + e.violatedDirective));
  });
  return p;
}
const screen = p => p.evaluate(() => document.querySelector('.screen.on')?.id);
const ls = (p, k) => p.evaluate(k => localStorage.getItem(k), k);
const APP = {'ergolav.quotes': JSON.stringify([{no: 1}]), 'ergolav.prices': '{"wc|x":[{"c":1000,"at":1}]}', 'ergolav.quoteNo': '41'};

try {
  // ── 0. Flag κλειστό: η εφαρμογή όπως πριν ──
  {
    const p = await page({auth: false});
    await p.goto(BASE); await p.waitForSelector('#s-profile.on');
    await p.waitForTimeout(500);
    ok('flag κλειστό: κανένα κουμπί λογαριασμού, η ένδειξη βήματος όπως πριν', !(await p.isVisible('#acctBtn')) && await p.isVisible('#step'));
    ok('flag κλειστό: η βιβλιοθήκη Supabase δεν φορτώνεται, κανένα αίτημα προς Supabase',
      await p.evaluate(() => !window.supabase && !document.querySelector('script[src*="supabase"]')) && server.reqs.length === 0);
    await p.context().close();
  }

  // ── 1. Νέο κινητό, σύνδεση με κωδικό email· ο λογαριασμός έχει ήδη στοιχεία και λογότυπο ──
  server.row = {id: UID, business_name: NAME, specialty: 'Υδραυλικός', phone: PHONE, logo_path: `${UID}/a1b2c3d4.png`};
  server.files[`${UID}/a1b2c3d4.png`] = Buffer.from(PNG, 'base64');
  const ctx = await b.newContext({viewport: {width: 390, height: 844}});
  const p = await page({ctx});
  await p.addInitScript(app => { if(!sessionStorage.seeded){ sessionStorage.seeded = 1; for(const [k, v] of Object.entries(app)) localStorage.setItem(k, v); } }, APP);
  await p.goto(BASE); await p.waitForSelector('#s-profile.on');
  await p.waitForSelector('#acctBtn:not([hidden])');
  ok('flag ανοιχτό: «Σύνδεση» πάνω δεξιά στη θέση της ένδειξης βήματος', await p.textContent('#acctBtn') === 'Σύνδεση' && !(await p.isVisible('#step')));
  await p.click('#acctBtn'); await p.waitForSelector('#s-login.on');
  ok('«Σύνδεση ή εγγραφή»: Google, email, Όροι/Απόρρητο, «‹ Πίσω»', await p.isVisible('#loginGoogle') && await p.isVisible('#loginEmail') &&
    await p.isVisible('[data-legal="terms"]') && await p.isVisible('#navBack'));
  await p.fill('#loginEmail', 'όχι-email'); await p.click('#loginSend');
  ok('άκυρο email → μήνυμα, κανένα αίτημα', /δεν φαίνεται σωστό/.test(await p.textContent('#loginError')) && !server.reqs.some(r => r.path === '/auth/v1/otp'));
  server.otpStatus = 429;
  await p.fill('#loginEmail', EMAIL); await p.click('#loginSend');
  await p.waitForFunction(() => !document.getElementById('loginError').hidden);
  ok('όριο αποστολών (429) → «Πολλές προσπάθειες»', /Πολλές προσπάθειες/.test(await p.textContent('#loginError')));
  server.otpStatus = 200;
  await p.click('#loginSend'); await p.waitForSelector('#loginCode:not([hidden])');
  const otp = server.reqs.filter(r => r.path === '/auth/v1/otp').at(-1);
  ok('«Στείλε μου κωδικό» → signInWithOtp με δημιουργία χρήστη', JSON.parse(otp.body).create_user === true && JSON.parse(otp.body).email === EMAIL, otp.body);
  await p.fill('#loginOtp', '000000');
  await p.waitForFunction(() => !document.getElementById('loginError').hidden);
  ok('λάθος κωδικός → «Λάθος κωδικός»', /Λάθος κωδικός/.test(await p.textContent('#loginError')));
  await p.click('#navBack');
  ok('«‹ Πίσω» στον κωδικό → πίσω στο email (ίδια οθόνη)', await screen(p) === 's-login' && await p.isVisible('#loginStart'));
  await p.click('#loginSend'); await p.waitForSelector('#loginCode:not([hidden])');
  await p.fill('#loginOtp', '123456');
  await p.waitForSelector('#s-account.on');
  ok('σωστός κωδικός → συνδέθηκε· στοιχεία και λογότυπο ήρθαν από τον λογαριασμό', /ήρθαν από τον λογαριασμό/.test(await p.textContent('#acctStatus')) &&
    await p.textContent('#acctEmail') === EMAIL);
  const prof = JSON.parse(await ls(p, 'ergolav.profile'));
  const logos = JSON.parse(await ls(p, 'ergolav.logos') || '{}');
  ok('στη συσκευή: όνομα, ειδικότητα, τηλέφωνο, λογότυπο', prof.name === NAME && prof.trade === 'Υδραυλικός' && prof.phone === PHONE &&
    logos[prof.logo]?.url === 'data:image/png;base64,' + PNG);
  ok('η κεφαλίδα δείχνει το όνομα στο κουμπί', await p.textContent('#acctBtn') === EMAIL.split('@')[0].slice(0, 16));
  await p.click('#ctaBtn');
  ok('«Συνέχεια» → αρχική (η φόρμα στοιχείων δεν χρειάζεται)', await screen(p) === 's-start' && await p.textContent('#brandName') === NAME &&
    await p.getAttribute('#brandLogo img', 'src') === 'data:image/png;base64,' + PNG);
  ok('προσφορές, τιμές, αριθμός προσφοράς: ανέγγιχτα', await ls(p, 'ergolav.quotes') === APP['ergolav.quotes'] &&
    await ls(p, 'ergolav.prices') === APP['ergolav.prices'] && await ls(p, 'ergolav.quoteNo') === '41');

  // ── 2. Η συνεδρία μένει μετά από κλείσιμο/άνοιγμα ──
  await p.close();
  const p2 = await page({ctx});
  await p2.goto(BASE); await p2.waitForSelector('#s-start.on');
  await p2.waitForFunction(() => document.getElementById('acctBtn').classList.contains('on'));
  ok('ξανά άνοιγμα: παραμένει συνδεδεμένος (χωρίς νέα σύνδεση)', await p2.textContent('#acctBtn') !== 'Σύνδεση');

  // ── 3. Αποσύνδεση μόνο αυτής της συσκευής ──
  await p2.click('#acctBtn'); await p2.waitForSelector('#s-account.on');
  await p2.click('#acctSignOut'); await p2.waitForSelector('#s-start.on');
  const lo = server.reqs.filter(r => r.path === '/auth/v1/logout').at(-1);
  ok('Αποσύνδεση → logout με scope=local, πίσω εκεί που ήταν, «Σύνδεση»', lo?.search === '?scope=local' && await p2.textContent('#acctBtn') === 'Σύνδεση', lo?.search);
  ok('μετά την αποσύνδεση: στοιχεία, προσφορές, τιμές, αριθμός μένουν· η συνεδρία φεύγει',
    JSON.parse(await ls(p2, 'ergolav.profile')).name === NAME && await ls(p2, 'ergolav.quotes') === APP['ergolav.quotes'] &&
    await ls(p2, 'ergolav.quoteNo') === '41' && await p2.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('sb-'))));

  // ── 4. Google (PKCE): επιστροφή με ?code= → σβήνεται από τη διεύθυνση· τα στοιχεία διαφέρουν → ερώτηση ──
  server.row = {...server.row, business_name: 'Άλλη Επιχείρηση ΑΕ', logo_path: null};
  await p2.click('#acctBtn'); await p2.waitForSelector('#s-login.on');
  const histBefore = await p2.evaluate(() => history.length);
  await Promise.all([p2.waitForURL(/\?code=|ergolav|127\.0\.0\.1/), p2.click('#loginGoogle')]);
  await p2.waitForSelector('#s-pchoice.on', {timeout: 15000});
  const auth = server.reqs.find(r => r.path === '/auth/v1/authorize');
  const ap = new URLSearchParams(auth.search);
  ok('Google: provider=google, PKCE (code_challenge), redirect_to = η διεύθυνση της εφαρμογής', ap.get('provider') === 'google' && !!ap.get('code_challenge') &&
    ap.get('redirect_to') === BASE, ap.get('redirect_to'));
  ok('ανταλλαγή ?code= με συνεδρία (grant_type=pkce)', server.reqs.some(r => r.path === '/auth/v1/token' && /grant_type=pkce/.test(r.search)));
  ok('μετά τη σύνδεση: ΚΑΝΕΝΑ ?code= στη διεύθυνση (replaceState)', !(await p2.evaluate(() => location.search)) && p2.url() === BASE, p2.url());
  ok('στοιχεία συσκευής ≠ λογαριασμού → «Ποια στοιχεία κρατάς;» με δύο κάρτες', (await p2.$$('#pchoiceList .pc')).length === 2 &&
    /Άλλη Επιχείρηση ΑΕ/.test(await p2.textContent('#pchoiceList')) && /Μελέτης/.test(await p2.textContent('#pchoiceList')));
  await p2.click('[data-keep="account"]'); await p2.waitForSelector('#s-account.on');
  const backups = await p2.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ergolav.profile.backup.')));
  ok('«του λογαριασμού» → στη συσκευή, με αντίγραφο ασφαλείας των προηγούμενων', JSON.parse(await ls(p2, 'ergolav.profile')).name === 'Άλλη Επιχείρηση ΑΕ' &&
    backups.length >= 1 && JSON.parse(JSON.parse(await ls(p2, backups.at(-1))).profile).name === NAME);
  ok('Google: «Σύνδεση με Google», το όνομα από τον λογαριασμό στο κουμπί', await p2.textContent('#acctVia') === 'Σύνδεση με Google' && await p2.textContent('#acctBtn') === 'Μελέτης');
  await p2.click('#ctaBtn');
  // η πλοήγηση της εφαρμογής δεν μπερδεύεται: οθόνες, «‹ Πίσω», ανανέωση
  await p2.click('#quotesOpen').catch(() => {});
  if(await screen(p2) === 's-history'){ await p2.click('#navBack'); }
  ok('μετά το Google: η πλοήγηση δουλεύει (Προσφορές ↔ αρχική με «‹ Πίσω»)', await screen(p2) === 's-start');
  const tokenCalls = server.reqs.filter(r => r.path === '/auth/v1/token' && /pkce/.test(r.search)).length;
  await p2.reload(); await p2.waitForSelector('#s-start.on'); await p2.waitForTimeout(600);
  ok('ανανέωση: καμία δεύτερη ανταλλαγή κωδικού, η διεύθυνση καθαρή, ακόμα συνδεδεμένος',
    server.reqs.filter(r => r.path === '/auth/v1/token' && /pkce/.test(r.search)).length === tokenCalls && !(await p2.evaluate(() => location.search)) &&
    await p2.textContent('#acctBtn') === 'Μελέτης');
  ok('το ιστορικό του browser δεν μεγάλωσε από την καθαριστική replaceState (μόνο από το Google)', await p2.evaluate(() => history.length) <= histBefore + 2);

  // ── 5. Αλλαγή στοιχείων ενώ είναι συνδεδεμένος → ανεβαίνουν ──
  await p2.click('#brand'); await p2.waitForSelector('#s-profile.on');
  await p2.fill('#pfTrade', 'Θερμοϋδραυλικός'); await p2.click('#pfSave');
  await p2.waitForFunction(() => true); await p2.waitForTimeout(500);
  ok('αλλαγή στοιχείων → ανεβαίνουν στον λογαριασμό', server.row.specialty === 'Θερμοϋδραυλικός');

  // ── 6. Χωρίς ίντερνετ ──
  await p2.context().setOffline(true);
  await p2.click('#mic');
  await p2.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await p2.evaluate(() => { const el = document.getElementById('transcript'); el.textContent = 'δύο λεκάνες'; el.dispatchEvent(new Event('input', {bubbles: true})); });
  await p2.click('#ctaBtn'); await p2.waitForSelector('#s-lines.on');
  ok('χωρίς ίντερνετ: η προσφορά δουλεύει κανονικά', (await p2.$$('#lines .ln')).length === 1);
  await p2.click('#navBack'); await p2.click('#navBack'); await p2.waitForSelector('#s-start.on');
  await p2.context().setOffline(false);

  // ── 7. Διαγραφή λογαριασμού (με δεύτερη επιβεβαίωση) ──
  await p2.click('#acctBtn'); await p2.waitForSelector('#s-account.on');
  await p2.click('#acctDelete');
  ok('«Διαγραφή λογαριασμού» → δεύτερη επιβεβαίωση, τίποτα δεν σβήστηκε ακόμα', await p2.isVisible('#acctDelYes') && !server.deleted);
  await p2.click('#acctDelNo');
  ok('«Άκυρο» → τίποτα', !(await p2.isVisible('#acctDelBox')) && !server.deleted);
  await p2.click('#acctDelete'); await p2.click('#acctDelYes'); await p2.waitForSelector('#s-start.on');
  const del = server.reqs.find(r => r.path === '/functions/v1/delete-account');
  ok('διαγραφή → Edge Function με το JWT του χρήστη, μετά αποσύνδεση', server.deleted && /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(del.auth) &&
    await p2.textContent('#acctBtn') === 'Σύνδεση');
  ok('μετά τη διαγραφή: τα δεδομένα της συσκευής μένουν (δεν τσεκαρίστηκε το «σβήσε»)', await ls(p2, 'ergolav.quotes') === APP['ergolav.quotes'] &&
    !!(await ls(p2, 'ergolav.profile')));

  // ── 7β. Σύνδεση χωρίς ίντερνετ → καθαρό μήνυμα ──
  {
    const p3 = await page();
    await p3.goto(BASE); await p3.waitForSelector('#acctBtn:not([hidden])');
    await p3.waitForFunction(() => !!window.supabase);
    await p3.click('#acctBtn'); await p3.waitForSelector('#s-login.on');
    await p3.context().setOffline(true);
    await p3.fill('#loginEmail', EMAIL); await p3.click('#loginSend');
    await p3.waitForFunction(() => !document.getElementById('loginError').hidden, null, {timeout: 20000});
    ok('χωρίς ίντερνετ → «Δεν υπάρχει σύνδεση στο ίντερνετ…»', /Δεν υπάρχει σύνδεση στο ίντερνετ/.test(await p3.textContent('#loginError')), await p3.textContent('#loginError'));
    await p3.context().close();
  }

  // ── 8. CSP, απόρρητο, στενή οθόνη ──
  ok('καμία παραβίαση CSP (η βιβλιοθήκη και οι κλήσεις περνούν από την πολιτική ασφαλείας)', (await p2.evaluate(() => window.__csp)).length === 0,
    (await p2.evaluate(() => window.__csp)).join(' | '));
  const leaks = [...p.logs, ...p2.logs].filter(l => [EMAIL, PHONE, 'Μελέτης', 'test-code-123', 'rt-'].some(x => l.includes(x)));
  ok('το console δεν έγραψε email, τηλέφωνο, όνομα ή token', leaks.length === 0, leaks.join(' | '));
  await p2.setViewportSize({width: 320, height: 700});
  ok('320px: το κουμπί χωράει στην κεφαλίδα, χωρίς οριζόντια κύλιση', await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok('χωρίς σφάλματα JavaScript', p.errs.length + p2.errs.length === 0, [...p.errs, ...p2.errs].join(' | '));
} finally {
  await b.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
