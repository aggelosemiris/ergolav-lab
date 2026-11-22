// Χωρίς σήμα (docs/offline.md): service worker, προσφορά και αποστολή χωρίς δίκτυο, φωνή, λογαριασμός, γεμάτη μνήμη,
// νέα έκδοση, iPhone/Android. Με υποχρεωτικό λογαριασμό (όπως στο live) και ψεύτικο Supabase: καμία πραγματική κλήση.
// Σηκώνει ΔΙΚΟ του server σε αντίγραφο της εφαρμογής (φάκελος temp, θύρα OFFLINE_PORT ή 8097), ώστε να «βγάλει νέα
// έκδοση» χωρίς να αγγίξει το repo.
// Εκτέλεση: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/offline.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, render } from '../../tools/sw-manifest.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.OFFLINE_PORT || 8097), BASE = `http://127.0.0.1:${PORT}/`;
const VOICE = 'Χωρίς σήμα η φωνή δεν δουλεύει. Γράψε τη δουλειά και η προσφορά θα βγει κανονικά.';   // mic.js · VOICE_OFFLINE
const NO_NET = 'Χρειάζεται σύνδεση στο internet';                                                       // net.js · NO_NET
const READY = 'Έτοιμο: το ergolav δουλεύει πλέον και χωρίς σήμα ✓';
const NET_BAR = 'Χωρίς σήμα · όλα αποθηκεύονται στο κινητό';
const FULL = 'Η μνήμη του κινητού γέμισε';
const TEXT = 'Δύο μέτρα σωλήνα πολυστρωματικό και μια μπαταρία νιπτήρα';

// ── Αντίγραφο της εφαρμογής και server ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ergolav-offline-'));
for(const f of ['index.html', 'src', 'vendor', 'media', 'legal', 'icons', 'manifest.webmanifest', 'sw.js', '.nojekyll', '_headers', '.github'])
  fs.cpSync(path.join(REPO, f), path.join(TMP, f), {recursive: true});
const srv = spawn(process.execPath, [path.join(REPO, 'server/app.mjs'), '--port', String(PORT), '--root', TMP], {stdio: 'ignore'});
for(let i = 0; i < 50; i++){ try { await fetch(BASE); break; } catch { await new Promise(r => setTimeout(r, 200)); } }

const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});

// ── Λογαριασμός: αποθηκευμένη συνεδρία και ψεύτικο Supabase ──
const REF = 'myyecdraxrkkwojppglb', SB_KEY = `sb-${REF}-auth-token`;
const UID = '11111111-2222-4333-8444-555555555555';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const user = {id: UID, aud: 'authenticated', role: 'authenticated', email: 'meletis.test@example.com', email_confirmed_at: '2026-11-17T10:00:00Z',
  app_metadata: {provider: 'email', providers: ['email']}, identities: [{provider: 'email'}], user_metadata: {}, created_at: '2026-11-16T10:00:00Z'};
const session = (expiresIn = 3600) => ({access_token: `${b64({alg: 'HS256'})}.${b64({sub: UID, exp: Math.floor(Date.now() / 1000) + expiresIn})}.c2ln`,
  token_type: 'bearer', expires_in: expiresIn, expires_at: Math.floor(Date.now() / 1000) + expiresIn, refresh_token: 'rt-offline', user});
const H = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'};
const sbReqs = [];
async function supabase(route){
  const req = route.request(), url = new URL(req.url());
  sbReqs.push(`${req.method()} ${url.pathname}`);
  if(req.method() === 'OPTIONS') return route.fulfill({status: 204, headers: H});
  const json = (status, body) => route.fulfill({status, headers: {...H, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if(url.pathname === '/auth/v1/user') return json(200, user);
  if(url.pathname === '/auth/v1/token') return json(200, session());
  if(url.pathname.startsWith('/rest/v1/rpc/')) return json(200, null);
  if(url.pathname.startsWith('/rest/v1/')) return req.method() === 'GET' ? json(200, []) : json(201, []);
  return json(404, {message: 'not found'});
}

// Φωνή: ψεύτικη αναγνώριση· localStorage['test.sr'] = 'network' → σφάλμα «network» μόλις ξεκινήσει.
// Αποστολή: ψεύτικο share sheet (window.__shared).
function stubs(){
  class FakeSR {
    start(){ setTimeout(() => { if(localStorage.getItem('test.sr') === 'network'){ this.onerror?.({error: 'network'}); this.onend?.(); } else this.onstart?.(); }, 50); }
    stop(){ setTimeout(() => this.onend?.(), 10); }
    abort(){ this.stop(); }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
  navigator.mediaDevices && (navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('no mic')));
  Object.defineProperty(navigator, 'canShare', {value: () => true, configurable: true});
  Object.defineProperty(navigator, 'share', {value: async () => { window.__shared = (window.__shared || 0) + 1; }, configurable: true});
}
async function newPage({seed = {}, ua} = {}){
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, ...(ua && {userAgent: ua})});
  await ctx.route(/supabase\.co\//, supabase);
  await ctx.route(/challenges\.cloudflare\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.dialogs = [];
  p.on('dialog', d => { p.dialogs.push(d.message()); d.dismiss(); });
  await p.addInitScript(stubs);
  await p.addInitScript(s => { if(sessionStorage.seeded) return; sessionStorage.seeded = '1'; for(const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, seed);
  return {ctx, p};
}
const PROFILE = JSON.stringify({name: 'Μελέτης Υδραυλικός', trade: 'Υδραυλικός', phone: '6977777777'});
const visibleText = async (p, sel) => (await p.locator(sel).isVisible()) ? (await p.textContent(sel)).replace(/\s+/g, ' ').trim() : '';
const screen = p => p.evaluate(() => document.querySelector('.screen.on')?.id);
const controlled = p => p.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 20000});
const quotes = p => p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes') || '[]'));

// Κείμενο → γραμμές → PDF → «Στείλε» (ψεύτικο share sheet).
async function quote(p, text = TEXT){
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await p.evaluate(t => { const el = document.getElementById('transcript'); el.textContent = t; el.dispatchEvent(new Event('input', {bubbles: true})); }, text);
  await p.waitForFunction(() => { const b = document.getElementById('ctaBtn'); return b.textContent === 'Βγάλε τιμές' && !b.disabled; });
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.waitForFunction(() => !document.getElementById('ctaBtn').disabled);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
}
const send = async p => { await p.click('#ctaBtn'); await p.waitForSelector('#s-done.on'); };

try {
  // ── 1. Πρώτο άνοιγμα με σήμα: εγκατάσταση, «Έτοιμο» μία φορά ──
  const {ctx, p} = await newPage({seed: {'ergolav.profile': PROFILE, [SB_KEY]: JSON.stringify(session())}});
  await p.goto(BASE); await p.waitForSelector('#s-start.on');
  await controlled(p);
  await p.waitForSelector('#readyBar:not([hidden])');
  ok('πρώτη εγκατάσταση: «Έτοιμο: … και χωρίς σήμα ✓»', await visibleText(p, '#readyBar') === READY);
  ok('με σήμα: καμία ένδειξη «Χωρίς σήμα»', !(await p.isVisible('#netBar')));

  // ── 2. Χωρίς σήμα: reload, ανοίγει, ένδειξη, συνδεδεμένος ──
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('#s-start.on');
  ok('χωρίς σήμα + reload: το ergolav ανοίγει (αρχική οθόνη)', await screen(p) === 's-start');
  ok('ένδειξη επάνω: «Χωρίς σήμα · όλα αποθηκεύονται στο κινητό»', await visibleText(p, '#netBar') === NET_BAR);
  ok('το «Έτοιμο» δεν ξαναφαίνεται', !(await p.isVisible('#readyBar')));
  ok('συνδεδεμένος: κουμπί λογαριασμού με το όνομα, όχι «Σύνδεση»', await p.textContent('#acctLabel') !== 'Σύνδεση');

  // ── 3. Φωνή χωρίς σήμα → κατευθείαν κείμενο, με το μήνυμα ──
  await p.click('#mic'); await p.waitForSelector('#s-listen.on');
  ok('φωνή χωρίς σήμα: το μήνυμα', await visibleText(p, '#notice') === VOICE);
  ok('φωνή χωρίς σήμα: ανοιχτό πεδίο κειμένου', await p.evaluate(() => document.getElementById('transcript').contentEditable === 'true'));
  await p.click('#navBack'); await p.waitForSelector('#s-start.on');

  // ── 4. Προσφορά με κείμενο, PDF, αποστολή, χωρίς σήμα ──
  const t0 = Date.now();
  await quote(p);
  await send(p);
  ok('χωρίς σήμα: γραμμές → PDF → «Στείλε» (share sheet)', await p.evaluate(() => window.__shared) === 1 && await p.textContent('#doneTitle') === 'Στάλθηκε', `${Date.now() - t0} ms`);
  ok('μόνιμη αποθήκευση ζητήθηκε μία φορά (navigator.storage.persist)', await p.evaluate(() => !!localStorage.getItem('ergolav.persistAsked')));
  const before = sbReqs.length;
  await p.reload(); await p.waitForSelector('#s-start.on');
  const q1 = await quotes(p);
  ok('μετά από reload χωρίς σήμα: η προσφορά είναι εκεί, «Στάλθηκε»', q1.length === 1 && q1[0].status === 'sent' && /\(1\)/.test(await p.textContent('#quotesOpen')));
  ok('χωρίς σήμα: κανένα αίτημα έφτασε στο Supabase', sbReqs.length === before);

  // ── 5. Λογαριασμός χωρίς σήμα: ό,τι θέλει server κλειδωμένο, η τοπική αποσύνδεση όχι ──
  await p.click('#acctBtn'); await p.waitForSelector('#s-account.on');
  ok('«Ο λογαριασμός μου» χωρίς σήμα: «Χρειάζεται σύνδεση στο internet»', await visibleText(p, '#acctNet') === NO_NET);
  const dis = await p.evaluate(() => Object.fromEntries(['acctDelete', 'acctSignOutAll', 'acctEmOpen', 'acctPwOpen', 'acctSignOut'].map(id => [id, document.getElementById(id).disabled])));
  ok('διαγραφή, αλλαγή email/κωδικού, αποσύνδεση παντού: απενεργοποιημένα', dis.acctDelete && dis.acctSignOutAll && dis.acctEmOpen && dis.acctPwOpen, JSON.stringify(dis));
  ok('αποσύνδεση ΜΟΝΟ από αυτή τη συσκευή: ενεργή (δεν θέλει server)', !dis.acctSignOut);
  await p.click('#navBack'); await p.waitForSelector('#s-start.on');

  // Ληγμένο token χωρίς σήμα: η βιβλιοθήκη δεν ανανεώνει, ο τεχνίτης ΔΕΝ αποσυνδέεται.
  await p.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)); s.expires_at = Math.floor(Date.now() / 1000) - 600; localStorage.setItem(k, JSON.stringify(s)); }, SB_KEY);
  await p.reload(); await p.waitForSelector('#s-start.on');
  await p.waitForTimeout(3000);
  ok('ληγμένη συνεδρία χωρίς σήμα: καμία αποσύνδεση, καμία οθόνη σύνδεσης', await screen(p) === 's-start' && await p.evaluate(k => !!localStorage.getItem(k), SB_KEY));

  // ── 6. Ξανά σήμα ──
  await ctx.setOffline(false);
  await p.waitForSelector('#netBar', {state: 'hidden', timeout: 15000});
  ok('με σήμα ξανά: η ένδειξη φεύγει', !(await p.isVisible('#netBar')));

  // «Σήμα» που δεν περνά τίποτα: το navigator.onLine λέει ναι, αλλά το αίτημα αποτυγχάνει → χωρίς σήμα.
  await p.route(/supabase\.co\//, r => r.abort('internetdisconnected'));
  await p.evaluate(() => fetch('https://myyecdraxrkkwojppglb.supabase.co/rest/v1/profiles').catch(() => {}));
  await p.waitForSelector('#netBar:not([hidden])', {timeout: 5000}).catch(() => {});
  ok('fetch που αποτυγχάνει (με navigator.onLine = true): «Χωρίς σήμα»', await p.isVisible('#netBar') && await p.evaluate(() => navigator.onLine));
  await p.unroute(/supabase\.co\//);
  await p.evaluate(() => fetch('https://myyecdraxrkkwojppglb.supabase.co/rest/v1/profiles').catch(() => {}));
  await p.waitForSelector('#netBar', {state: 'hidden', timeout: 5000}).catch(() => {});
  ok('το επόμενο αίτημα που περνά: η ένδειξη φεύγει', !(await p.isVisible('#netBar')));

  // Φωνή με σήμα αλλά σφάλμα «network» της αναγνώρισης.
  await p.evaluate(() => localStorage.setItem('test.sr', 'network'));
  await p.click('#mic'); await p.waitForSelector('#s-listen.on');
  await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  ok('φωνή, σφάλμα «network»: το μήνυμα και πεδίο κειμένου', await visibleText(p, '#notice') === VOICE);
  await p.evaluate(() => localStorage.removeItem('test.sr'));
  await p.click('#navBack'); await p.waitForSelector('#s-start.on');

  // ── 7. Γεμάτη μνήμη (QuotaExceededError): μήνυμα, τίποτα δεν χάνεται, η προσφορά μένει μέχρι να σταλεί ──
  await ctx.setOffline(true);
  await p.waitForSelector('#netBar:not([hidden])');
  const filled = await p.evaluate(() => {
    const chunk = n => 'x'.repeat(n);
    let i = 0;
    for(const size of [1 << 20, 1 << 16, 1 << 12, 1 << 8, 16, 1]){
      for(;;){ try { localStorage.setItem(`test.fill.${i}`, chunk(size)); i++; } catch { break; } }
    }
    document.getElementById('storageBar').hidden = true;     // το γέμισμα του τεστ ήδη το έδειξε
    return i;
  });
  const oldQuotes = JSON.stringify(await quotes(p));
  await quote(p, 'Μια λεκάνη κρεμαστή και ένα καζανάκι εντοιχισμού');
  ok('γεμάτη μνήμη: το μήνυμα επάνω', (await visibleText(p, '#storageBar')).startsWith(FULL), `${filled} κομμάτια γεμίσματος`);
  ok('γεμάτη μνήμη: «Δεν αποθηκεύτηκε…» κάτω από το «Στείλε»', /Δεν αποθηκεύτηκε/.test(await p.textContent('#ctaNote')));
  ok('γεμάτη μνήμη: οι παλιές προσφορές άθικτες', JSON.stringify(await quotes(p)) === oldQuotes);
  // Νέα προσφορά πριν σταλεί αυτή → ερώτηση, και μένει.
  await p.click('#navBack'); await p.waitForSelector('#s-lines.on');
  await p.click('#editText'); await p.waitForSelector('#s-listen.on');
  await p.click('#navBack');
  await p.waitForTimeout(500);
  ok('προσφορά που δεν χώρεσε: ερώτηση πριν χαθεί, και μένει ανοιχτή', p.dialogs.length === 1 && /δεν αποθηκεύτηκε/.test(p.dialogs[0]) && await screen(p) === 's-listen');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.waitForFunction(() => !document.getElementById('ctaBtn').disabled);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
  await send(p);
  ok('γεμάτη μνήμη: η προσφορά στάλθηκε κανονικά', await p.evaluate(() => window.__shared) === 1);
  await p.click('#again'); await p.waitForSelector('#s-start.on');
  ok('σταλμένη: «Νέα προσφορά» χωρίς ερώτηση', p.dialogs.length === 1);
  await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('test.fill.')).forEach(k => localStorage.removeItem(k)));
  await ctx.setOffline(false);

  // ── 8. Νέα έκδοση: μπάρα, κανένα αυτόματο reload ──
  fs.appendFileSync(path.join(TMP, 'src/dates.js'), '\n// νέα έκδοση (offline.e2e)\n');
  fs.writeFileSync(path.join(TMP, 'sw.js'), render(fs.readFileSync(path.join(TMP, 'sw.js'), 'utf8'), buildManifest(TMP)));
  let loads = 0; p.on('load', () => loads++);
  await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await p.waitForSelector('#updateBar:not([hidden])', {timeout: 20000});
  await p.waitForTimeout(2000);
  ok('νέα έκδοση: «Υπάρχει νέα έκδοση · Ανανέωση», κανένα αυτόματο reload', loads === 0 && /Ανανέωση/.test(await p.textContent('#updateBar')));
  await Promise.all([p.waitForEvent('load'), p.click('#updateBar [data-update]')]);
  await p.waitForSelector('#s-start.on');
  ok('«Ανανέωση» → νέα έκδοση, μία cache', (await p.evaluate(() => caches.keys())).length === 1);
  ok('καμία JS εξαίρεση', !p.errs.length, p.errs.join(' | '));
  await ctx.close();

  // ── 9. Πρώτη φορά σε αυτή τη συσκευή, χωρίς σήμα: η σύνδεση θέλει σήμα ──
  {
    const {ctx, p} = await newPage();
    await p.goto(BASE); await p.waitForSelector('#s-login.on');
    await controlled(p);
    await ctx.setOffline(true);
    await p.reload(); await p.waitForSelector('#s-login.on');
    ok('χωρίς σήμα, ποτέ συνδεδεμένος: εξήγηση ότι την πρώτη φορά θέλει σήμα', /πρώτη φορά/.test(await visibleText(p, '#lgNet')) && (await visibleText(p, '#lgNet')).startsWith(NO_NET));
    const d = await p.evaluate(() => ({g: document.getElementById('lgGoogle').disabled, s: document.getElementById('lgSubmit').disabled}));
    ok('χωρίς σήμα: «Συνέχεια με Google» και «Σύνδεση» απενεργοποιημένα', d.g && d.s, JSON.stringify(d));
    await p.click('#tabUp');
    await p.fill('#upEmail', 'new@example.com'); await p.fill('#upPw', 'Kainourgios-77'); await p.fill('#upPw2', 'Kainourgios-77'); await p.check('#upTerms');
    ok('χωρίς σήμα: «Δημιουργία λογαριασμού» απενεργοποιημένο', await p.locator('#lgSubmit').isDisabled());
    await ctx.setOffline(false);
    await p.waitForFunction(() => !document.getElementById('lgGoogle').disabled, null, {timeout: 15000});
    ok('με σήμα ξανά: η σύνδεση ανοίγει', !(await p.isVisible('#lgNet')));
    await ctx.close();
  }

  // ── 10. iPhone στο Safari: οδηγία για την αρχική οθόνη, μία φορά ──
  {
    const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const {ctx, p} = await newPage({ua: UA, seed: {'ergolav.profile': PROFILE, [SB_KEY]: JSON.stringify(session())}});
    await p.goto(BASE); await p.waitForSelector('#s-start.on');
    ok('iPhone (Safari): «Πρόσθεσέ το στην αρχική οθόνη…»', /^Πρόσθεσέ το στην αρχική οθόνη για να δουλεύει χωρίς σήμα και να μη σβηστούν οι προσφορές/.test(await visibleText(p, '#iosBar')));
    await p.click('#iosBar [data-close]');
    await p.reload(); await p.waitForSelector('#s-start.on');
    ok('iPhone: μία φορά μόνο', !(await p.isVisible('#iosBar')));
    await ctx.close();
  }
  {
    const {ctx, p} = await newPage({seed: {'ergolav.profile': PROFILE, [SB_KEY]: JSON.stringify(session())}});
    await p.goto(BASE); await p.waitForSelector('#s-start.on');
    ok('όχι iPhone: καμία οδηγία', !(await p.isVisible('#iosBar')));
    // ── 11. Android: κουμπί εγκατάστασης από το beforeinstallprompt ──
    ok('χωρίς beforeinstallprompt: κανένα κουμπί εγκατάστασης', !(await p.isVisible('#installApp')));
    await p.evaluate(() => { const e = new Event('beforeinstallprompt', {cancelable: true}); e.prompt = async () => { window.__prompted = true; }; e.userChoice = Promise.resolve({outcome: 'accepted'}); window.dispatchEvent(e); });
    ok('Android: κουμπί «Βάλ’ το στην αρχική οθόνη»', await p.isVisible('#installApp'));
    await p.click('#installApp');
    ok('Android: το πάτημα ανοίγει την εγκατάσταση του browser', await p.evaluate(() => window.__prompted) === true && !(await p.isVisible('#installApp')));

    // ── 12. Απενεργοποίηση (docs/offline.md): tools/sw-off.js + SW_ENABLED = false ──
    await controlled(p);
    fs.copyFileSync(path.join(REPO, 'tools/sw-off.js'), path.join(TMP, 'sw.js'));
    const off = path.join(TMP, 'src/offline.js');
    fs.writeFileSync(off, fs.readFileSync(off, 'utf8').replace('export const SW_ENABLED = true;', 'export const SW_ENABLED = false;'));
    await Promise.all([p.waitForEvent('load', {timeout: 20000}), p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())]);
    await p.waitForSelector('#s-start.on');
    await p.waitForTimeout(3000);
    const st = await p.evaluate(async () => ({regs: (await navigator.serviceWorker.getRegistrations()).length, ctrl: !!navigator.serviceWorker.controller,
      caches: (await caches.keys()).filter(k => k.startsWith('ergolav-')).length, profile: !!localStorage.getItem('ergolav.profile')}));
    ok('απενεργοποίηση: κανένας service worker, καμία cache «ergolav-», τα δεδομένα μένουν', st.regs === 0 && !st.ctrl && st.caches === 0 && st.profile, JSON.stringify(st));
    await ctx.close();
  }
} catch(e) {
  ok('το τεστ ολοκληρώθηκε', false, e.stack || e.message);
} finally {
  await b.close();
  srv.kill();
  fs.rmSync(TMP, {recursive: true, force: true});
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exitCode = failed.length ? 1 : 0;
