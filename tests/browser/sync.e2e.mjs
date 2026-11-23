// Συγχρονισμός προσφορών (Φάση 3) σε πραγματικό browser, με την ΠΡΑΓΜΑΤΙΚΗ βιβλιοθήκη Supabase και ψεύτικο server
// (Playwright) που ακολουθεί τους κανόνες της migration: ο καθένας μόνο τα δικά του, νεότερο updated_at κερδίζει,
// synced_at από τον server. Δύο «κινητά» = δύο ξεχωριστά browser contexts (δική του αποθήκευση το καθένα).
//
//   Α: παλιά προσφορά στη συσκευή (πριν από τον συγχρονισμό) + νέα προσφορά από τη φωνή → ανεβαίνουν, μία φορά η καθεμία
//   Β: σύνδεση στον ίδιο λογαριασμό → οι προσφορές της Α εμφανίζονται· σβήσιμο ΧΩΡΙΣ σήμα → «Θα συγχρονιστεί…»,
//      καμία κλήση· με σήμα → deleted_at στον server → φεύγει και από την Α
//   Αποσύνδεση στη Β με «σβήσε τις προσφορές από τη συσκευή».
// Εκτέλεση: node server/app.mjs --auth off &  και  PLAYWRIGHT_MODULE=… node tests/browser/sync.e2e.mjs
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const CONFIG_SRC = fs.readFileSync(new URL('../../src/config.js', import.meta.url), 'utf8');
const SB = CONFIG_SRC.match(/SUPABASE_URL = '([^']+)'/)[1];
const REF = new URL(SB).hostname.split('.')[0];
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [], leaked = [], pages = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const UID = '22222222-3333-4444-8555-666666666666';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub: UID, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600})}.c2ln`;
const user = () => ({id: UID, aud: 'authenticated', role: 'authenticated', email: 'sync.test@example.com', email_confirmed_at: '2026-11-17T10:00:00Z',
  app_metadata: {provider: 'email', providers: ['email']}, identities: [{provider: 'email'}], user_metadata: {}, created_at: '2026-11-16T10:00:00Z'});
const session = () => ({access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'rt-' + Math.random().toString(36).slice(2), user: user()});

// ── Ψεύτικος server ──
const server = {quotes: new Map(), reqs: [], tick: 0, profile: {business_name: 'Υδραυλικές Δοκιμές', specialty: null, phone: null, logo_path: null}};
const ts = () => `2026-11-23T10:00:00.${String(++server.tick).padStart(6, '0')}+00:00`;
const H = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*'};
const json = (route, status, body) => route.fulfill({status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: H});
async function supabase(route){
  const req = route.request(), url = new URL(req.url()), path = url.pathname, m = req.method();
  if(m === 'OPTIONS') return json(route, 204);
  const body = req.postData() || '';
  server.reqs.push({m, path, search: url.search});
  if(path === '/auth/v1/token') return json(route, 200, session());
  if(path === '/auth/v1/user') return json(route, 200, user());
  if(path === '/auth/v1/logout') return json(route, 204);
  if(path === '/rest/v1/quotes'){
    if(m === 'GET'){
      const owner = url.searchParams.get('user_id')?.replace(/^eq\./, ''), from = url.searchParams.get('synced_at')?.replace(/^gte\./, '') || '';
      const limit = Number(url.searchParams.get('limit')) || 1000;
      const rows = [...server.quotes.values()].filter(r => r.user_id === UID && owner === UID && r.synced_at >= from)
        .sort((a, b) => a.synced_at.localeCompare(b.synced_at)).slice(0, limit);
      return json(route, 200, rows);
    }
    if(m === 'POST'){
      for(const r of JSON.parse(body)){
        if(r.user_id !== UID) return json(route, 403, {code: '42501', message: 'new row violates row-level security policy'});
        const old = server.quotes.get(r.id);
        if(old && Date.parse(r.updated_at) <= Date.parse(old.updated_at)) continue;          // trigger: νεότερο κερδίζει
        server.quotes.set(r.id, {...r, synced_at: ts()});
      }
      return json(route, 201, undefined);
    }
  }
  if(path === '/rest/v1/profiles'){
    if(m === 'GET') return /vnd\.pgrst\.object/.test(req.headers()['accept'] || '') ? json(route, 200, server.profile) : json(route, 200, [server.profile]);
    return json(route, 201, [server.profile]);
  }
  if(path.startsWith('/rest/v1/rpc/')) return json(route, 200, path.endsWith('has_password') ? true : null);
  if(path.startsWith('/rest/v1/')) return json(route, 200, m === 'GET' ? [] : undefined);
  if(path.startsWith('/storage/v1/')) return json(route, 200, []);
  return json(route, 404, {});
}
const quoteReqs = () => server.reqs.filter(r => r.path === '/rest/v1/quotes');

async function device(name){
  // Χωρίς service worker: αλλιώς μετά το πρώτο άνοιγμα το config.js έρχεται από την cache του και όχι από το route.
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block'});
  const p = await ctx.newPage();
  p.errs = []; p.label = name; pages.push(p);
  p.on('pageerror', e => p.errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route(SB + '/**', supabase);
  await p.route('https://challenges.cloudflare.com/**', r => r.abort());
  await p.route('**/src/config.js', async r => {
    const res = await r.fetch();
    const src = (await res.text()).replace(/export const AUTH_ENABLED = (true|false)/, 'export const AUTH_ENABLED = true')
      .replace(/export const SUPABASE_ANON_KEY = '[^']*'/, "export const SUPABASE_ANON_KEY = 'test-anon-key'")
      .replace(/export const TURNSTILE_SITE_KEY = '[^']*'/, "export const TURNSTILE_SITE_KEY = ''")
      .replace(/export const QUOTES_SYNC_ENABLED = (true|false)/, 'export const QUOTES_SYNC_ENABLED = true');
    return r.fulfill({response: res, body: src});
  });
  await p.route(/^https:\/\/[^/]*\.supabase\.co\//, r => { if(!r.request().url().startsWith(SB)) { leaked.push(r.request().url()); return r.abort(); } return r.fallback(); });
  await p.addInitScript(() => { window.SpeechRecognition = window.webkitSpeechRecognition = undefined; });
  return p;
}
const seed = (p, obj) => p.addInitScript(o => { if(!sessionStorage.seeded){ sessionStorage.seeded = 1; for(const [k, v] of Object.entries(o)) localStorage.setItem(k, v); } }, obj);
const signedIn = () => ({[`sb-${REF}-auth-token`]: JSON.stringify(session()), 'ergolav.profile': JSON.stringify({name: 'Υδραυλικές Δοκιμές'})});
const ls = (p, k) => p.evaluate(k => localStorage.getItem(k), k);
const until = (cond, ms = 15000) => new Promise((res, rej) => { const t0 = Date.now(); const f = () => cond() ? res() : Date.now() - t0 > ms ? rej(new Error('timeout')) : setTimeout(f, 100); f(); });
const OLD = {no: 1, at: Date.parse('2026-11-01T09:00:00Z'), title: 'μπάνιο', client: 'Παλιός Πελάτης, Χαλάνδρι', vatRate: 24,
  rows: [{name: 'Λεκάνη κρεμαστή', qty: 1, unit: 'τεμ.', mat: 18000}], sum: {mat: 18000, lab: 6000, net: 24000, vat: 5760, total: 29760},
  profile: {name: 'Υδραυλικές Δοκιμές', trade: '', phone: ''}, scheduled_date: '2026-11-25', scheduled_time: null, duration_days: 1, status: 'sent'};

try {
  // ── Συσκευή Α: παλιά προσφορά (πριν από τον συγχρονισμό) + νέα από τη φωνή ──
  const A = await device('A');
  await seed(A, {...signedIn(), 'ergolav.quotes': JSON.stringify([OLD]), 'ergolav.quoteNo': '1'});
  await A.goto(BASE); await A.waitForSelector('#s-start.on');
  await until(() => server.quotes.size === 1).catch(() => {});
  ok('Α, πρώτη σύνδεση με τοπική προσφορά: ανεβαίνει (μία γραμμή)', server.quotes.size === 1);
  const oldId = JSON.parse(await ls(A, 'ergolav.quotes'))[0].id;
  ok('η παλιά προσφορά πήρε σταθερό id (uuid) = το id της γραμμής', /^[0-9a-f-]{36}$/.test(oldId) && server.quotes.has(oldId));
  await A.fill('#client', 'Μαρία Νέα, Κηφισιά');
  await A.click('#mic');
  await A.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await A.evaluate(() => { const el = document.getElementById('transcript'); el.textContent = 'δύο λεκάνες και τρία μέτρα σωλήνα'; el.dispatchEvent(new Event('input', {bubbles: true})); });
  await A.click('#ctaBtn'); await A.waitForSelector('#s-lines.on');
  await A.click('#ctaBtn'); await A.waitForSelector('#s-pdf.on');
  await until(() => server.quotes.size === 2).catch(() => {});
  const newRow = [...server.quotes.values()].find(r => r.id !== oldId);
  ok('Α, νέα προσφορά (PDF): ανεβαίνει στο παρασκήνιο, με αριθμό 2 και τον πελάτη', newRow?.data?.no === 2 && newRow?.data?.client === 'Μαρία Νέα, Κηφισιά', JSON.stringify(newRow?.data?.no));
  await A.reload(); await A.waitForSelector('#s-start.on'); await A.waitForTimeout(1500);
  ok('Α, ξανά άνοιγμα: κανένα διπλότυπο', server.quotes.size === 2);
  await A.click('#quotesOpen'); await A.waitForSelector('#s-history.on');
  await A.waitForFunction(() => /Συγχρονίστηκε/.test(document.getElementById('syncState').textContent));
  ok('Α: ένδειξη «✓ Συγχρονίστηκε»', (await A.textContent('#syncState')) === '✓ Συγχρονίστηκε');

  // ── Συσκευή Β: ίδιος λογαριασμός, άδεια συσκευή → οι προσφορές της Α εμφανίζονται ──
  const B = await device('B');
  await seed(B, signedIn());
  await B.goto(BASE); await B.waitForSelector('#s-start.on');
  await B.waitForFunction(() => /\(2\)/.test(document.getElementById('quotesOpen').textContent), null, {timeout: 15000}).catch(() => {});
  ok('Β: «Προσφορές (2)» χωρίς να κάνει τίποτα', /\(2\)/.test(await B.textContent('#quotesOpen')), await B.textContent('#quotesOpen'));
  await B.click('#quotesOpen'); await B.waitForSelector('#s-history.on');
  await B.click('[data-view="list"]').catch(() => {});
  const listB = await B.textContent('#s-history');
  ok('Β: στη λίστα οι πελάτες της Α', /Μαρία Νέα/.test(listB) && /Παλιός Πελάτης/.test(listB));
  ok('Β: ο αριθμός προσφοράς προχωρά πάνω από της Α (επόμενη = 3)', await ls(B, 'ergolav.quoteNo') === '2');
  await B.click(`.q-open[data-id="${oldId}"]`); await B.waitForSelector('#s-pdf.on');
  ok('Β: η προσφορά της Α ανοίγει ως PDF (ίδια σύνολα)', /297,60/.test(await B.textContent('#pdf')));
  await B.click('#histBack'); await B.waitForSelector('#s-history.on');

  // ── Β χωρίς σήμα: σβήσιμο → «Θα συγχρονιστεί όταν έχεις σήμα», καμία κλήση· με σήμα → deleted_at ──
  await B.context().setOffline(true);
  await B.evaluate(() => window.dispatchEvent(new Event('offline')));
  const before = quoteReqs().length;
  const del = B.locator(`.q-del[data-id="${oldId}"]`);
  await del.click(); await del.click();
  await B.waitForTimeout(2500);
  ok('Β χωρίς σήμα: σβήνεται τοπικά, κανένα αίτημα, «Θα συγχρονιστεί όταν έχεις σήμα»', quoteReqs().length === before &&
    (await B.textContent('#syncState')) === 'Θα συγχρονιστεί όταν έχεις σήμα' && !(await B.textContent('#s-history')).includes('Παλιός Πελάτης'));
  ok('Β χωρίς σήμα: χωρίς σφάλματα', B.errs.length === 0, B.errs.join(' | '));
  await B.context().setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(() => !!server.quotes.get(oldId)?.deleted_at).catch(() => {});
  ok('Β με σήμα: στον server deleted_at (η γραμμή μένει, χωρίς περιεχόμενο)', !!server.quotes.get(oldId)?.deleted_at && server.quotes.get(oldId).data === null);
  await B.waitForFunction(() => /Συγχρονίστηκε/.test(document.getElementById('syncState').textContent), null, {timeout: 10000}).catch(() => {});
  ok('Β: ξανά «✓ Συγχρονίστηκε»', (await B.textContent('#syncState')) === '✓ Συγχρονίστηκε');
  // Η Α το μαθαίνει όταν ο τεχνίτης ξαναγυρίσει στην εφαρμογή (visibilitychange), χωρίς ξαναφόρτωμα.
  await A.click('#histBack').catch(() => {});
  await A.evaluate(() => { document.querySelector('#s-history.on') && document.getElementById('navBack').click(); });
  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await A.waitForFunction(() => /\(1\)/.test(document.getElementById('quotesOpen').textContent), null, {timeout: 15000}).catch(() => {});
  ok('Α: η προσφορά που σβήστηκε στη Β έφυγε', /\(1\)/.test(await A.textContent('#quotesOpen')));

  // ── Β: αποσύνδεση με «σβήσε τις προσφορές από αυτή τη συσκευή» ──
  await B.click('#acctBtn'); await B.waitForSelector('#s-account.on');
  await B.click('#acctSignOut'); await B.waitForSelector('#acctOutBox:not([hidden])');
  ok('αποσύνδεση: ρωτά για τις προσφορές της συσκευής (όλες στον λογαριασμό)', /Όλες οι προσφορές σου είναι και στον λογαριασμό/.test(await B.textContent('#acctOutNote')) &&
    await B.isEnabled('#acctOutWipe'));
  await B.check('#acctOutWipe'); await B.click('#acctOutYes'); await B.waitForSelector('#s-login.on');
  ok('αποσύνδεση + «σβήσε»: οι προσφορές έφυγαν από τη Β, το προφίλ έμεινε', await ls(B, 'ergolav.quotes') === null && !!(await ls(B, 'ergolav.profile')));
  ok('…και στον server δεν σβήστηκε τίποτα', server.quotes.size === 2 && !server.quotes.get(newRow.id).deleted_at);

  ok('κανένα αίτημα προς πραγματικό Supabase', leaked.length === 0, leaked.join(' | '));
  const errs = pages.flatMap(p => p.errs.map(e => `${p.label}: ${e}`));
  ok('χωρίς σφάλματα JavaScript', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
