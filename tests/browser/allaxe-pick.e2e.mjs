// Μέρος 3 του «Άλλαξέ το» χωρίς AI: ποια ανάλυση μπαίνει (φωνή, κανόνας, βασική), ετικέτα μόνο στην οθόνη (όχι στο PDF),
// σταλμένη προσφορά που δεν αλλάζει, χωρίς ίντερνετ, χωρίς κανένα αίτημα προς worker/AI, και flag false = όπως πριν.
// Το flag ανοίγει μόνο μέσα στο τεστ (route στο src/config.js) και τα κείμενα σερβίρονται «όλα εγκεκριμένα» (route στο
// src/cases-data.js), όπως θα είναι όταν περάσουν τον έλεγχο.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/allaxe-pick.e2e.mjs
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { compileAll, appData, appDataSource } = await import('../../tools/catalog/case-texts.mjs');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const {map, res} = await compileAll();
const approve = r => ({...r, out: {...r.out,
  cases: r.out.cases.map(c => c.review ? {...c, review: {...c.review, reviewed: true}} : c),
  extras: r.out.extras.map(x => ({...x, review: {...x.review, reviewed: true}})),
  items: Object.fromEntries(Object.entries(r.out.items).map(([id, it]) => [id, {...it, review: {...it.review, reviewed: true}}]))}});
const ALL = appData(map, Object.fromEntries(Object.entries(res).map(([k, r]) => [k, approve(r)])));
const CASES_JS = appDataSource(ALL);
const CONFIG = fs.readFileSync(new URL('../../src/config.js', import.meta.url), 'utf8');
const caseTitle = id => res[id.split(':')[0]].out.cases.find(c => c.id === id).title;
const PROFILE = JSON.stringify({name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'});

const b = await chromium.launch({...(process.env.CHROMIUM_PATH && {executablePath: process.env.CHROMIUM_PATH})});
async function page(ctx, {flag = true} = {}){
  const p = await ctx.newPage();
  p.errs = []; p.hosts = new Set(); p.paths = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('request', r => { const u = new URL(r.url()); p.hosts.add(u.host); p.paths.push(u.pathname); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route(/supabase\.co|challenges\.cloudflare\.com/, r => r.abort());
  await p.route('**/src/config.js', r => r.fulfill({contentType: 'text/javascript',
    body: CONFIG.replace('export const ALLAXE_BOT_ENABLED = false;', `export const ALLAXE_BOT_ENABLED = ${flag};`)
      .replace('export const AUTH_ENABLED = true;', 'export const AUTH_ENABLED = false;')}));
  if(flag) await p.route('**/src/cases-data.js', r => r.fulfill({contentType: 'text/javascript', body: CASES_JS}));
  await p.addInitScript(profile => {
    try { if(!localStorage.getItem('ergolav.profile')) localStorage.setItem('ergolav.profile', profile); } catch {}
    window.__say = [];
    class FakeSR {
      start(){ const text = window.__say.shift() || ''; this.t = setTimeout(() => { if(text) this.onresult?.({results: [Object.assign([{transcript: text}], {isFinal: true})]}); }, 100); }
      stop(){ clearTimeout(this.t); setTimeout(() => this.onend?.(), 20); }
      abort(){ this.stop(); }
    }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  }, PROFILE);
  return p;
}
const waitCta = (p, re) => p.waitForFunction(r => new RegExp(r).test(document.getElementById('ctaBtn').textContent) && !document.getElementById('ctaBtn').disabled, re.source, {timeout: 60000});
async function makeQuote(p, say, {reload = true} = {}){
  if(reload) await p.goto(BASE);
  await p.fill('#client', 'Γιώργος Αντωνίου');
  await p.evaluate(t => window.__say.push(t), say);
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').textContent.length > 10);
  await p.click('#ctaBtn');
  await waitCta(p, /^Βγάλε τιμές$/);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await waitCta(p, /^Στείλε/);
  await p.waitForTimeout(800);
}
async function openAnalysis(p){
  await p.click('#anOpen'); await p.waitForSelector('#s-analysis.on');
  await waitCta(p, /^Στείλε και τα δύο PDF$/);
}
const tags = p => p.$$eval('#apdf .an-case', els => els.map(e => e.textContent));
const titles = p => p.$$eval('#apdf h3', els => els.map(e => e.textContent.replace(/^\d+\.\s*/, '')));
const SAY = 'Αλλαγή λεκάνης κρεμαστής σε ξηρά δόμηση, και μια μπαταρία νιπτήρα';

{
  const ctx = await b.newContext({viewport: {width: 390, height: 860}, acceptDownloads: true});
  const p = await page(ctx);
  await makeQuote(p, SAY);
  await openAnalysis(p);
  ok('φωνή: «αλλαγή … κρεμαστής … ξηρά δόμηση» → η εγκεκριμένη περίπτωση Αλλαγή · Κρεμαστή · Γυψοσανίδα',
    (await titles(p))[0] === caseTitle('wc:replace.hung.drywall'), (await titles(p)).join(' | '));
  const t = await tags(p);
  ok('ετικέτα κάτω από τον τίτλο: περίπτωση και προέλευση· η μπαταρία μένει στη βασική',
    t[0] === 'Λεκάνη: Αλλαγή παλιάς · Κρεμαστή · Γυψοσανίδα · από όσα είπες' && /· βασική περίπτωση$/.test(t[1]), t.join(' | '));
  // Η ετικέτα δεν μπαίνει στο PDF: ο κλώνος που ζωγραφίζει η βιβλιοθήκη του PDF δεν την έχει.
  const inPdf = await p.evaluate(async () => {
    let seen = null;
    await window.html2pdf().set({html2canvas: {scale: 1, onclone: doc => { seen = { tag: !!doc.querySelector('.an-case'), title: !!doc.querySelector('h3') }; }}})
      .from(document.getElementById('apdf')).outputPdf('blob');
    return seen;
  });
  ok('η ετικέτα ΔΕΝ μπαίνει στο PDF (οι τίτλοι μπαίνουν)', inPdf && !inPdf.tag && inPdf.title, JSON.stringify(inPdf));
  // Πάτημα σε βήμα: με το flag ανοίγει το bot χωρίς AI, ποτέ το «Άλλαξέ το» με AI.
  await p.locator('#apdf li[data-sel="steps"]').first().click();
  await p.click('.sel-go');
  ok('πάτημα σε βήμα → το bot χωρίς AI, όχι το «Άλλαξέ το» με AI', await p.isVisible('#botDialog[open]') && !(await p.isVisible('#rwDialog[open]')));
  await p.keyboard.press('Escape');
  ok('καμία κλήση σε worker/AI: μόνο η εφαρμογή (127.0.0.1)', [...p.hosts].every(h => h === new URL(BASE).host || /fonts|supabase|cloudflare/.test(h))
    && !p.paths.some(x => !/\.m?js$/.test(x) && /rewrite|anthropic|openai|messages/i.test(x)), [...p.hosts].join(', '));
  await p.screenshot({path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/allaxe-pick-390.png` : '/dev/null', fullPage: false}).catch(() => {});

  // Αποστολή (κατέβασμα) → η προσφορά «Στάλθηκε». Μετά μπαίνει κανόνας· η σταλμένη κρατά ΑΚΡΙΒΩΣ την ανάλυσή της.
  const pdfText = () => p.$eval('#apdf', e => { const c = e.cloneNode(true); c.querySelectorAll('button').forEach(b => b.remove()); return c.innerText; });
  const before = await pdfText();
  await p.evaluate(() => { navigator.canShare = () => false; });
  await p.click('#ctaBtn'); await p.waitForSelector('#sheet.on');
  const dl = p.waitForEvent('download');
  await p.click('[data-send="download"]'); await dl;
  await p.waitForSelector('#s-done.on');
  await p.evaluate(() => {
    localStorage.setItem('ergolav.caseRules', JSON.stringify({wc: {answers: {job: 'new', type: 'hung', wall: 'front'}, label: 'x', created: 1}}));
    localStorage.setItem('ergolav.speechRule', '"s"');
  });
  await p.click('#navBack'); await p.waitForSelector('#s-pdf.on');
  await p.waitForTimeout(800);
  await openAnalysis(p);
  ok('σταλμένη προσφορά: ίδια ανάλυση, ίδιες ετικέτες, παρά τον νέο κανόνα· χωρίς «Άλλαξέ το»', await pdfText() === before && !(await p.$('#apdf .an-change')));

  // Νέα προσφορά: ο κανόνας περίπτωσης και ο κανόνας λόγου μπαίνουν.
  await makeQuote(p, SAY);
  await openAnalysis(p);
  const t2 = await tags(p);
  ok('νέα προσφορά με τον κανόνα: «Σε νέα θέση · Κρεμαστή · Μπροστά…», από τον κανόνα σου, απλά λόγια',
    (await titles(p))[0] === caseTitle('wc:new.hung.front') && /^Λεκάνη: Σε νέα θέση · Κρεμαστή · Μπροστά.* · από τον κανόνα σου · απλά λόγια$/.test(t2[0]), t2[0]);
  const firstItem = await p.textContent('#apdf [data-task="plumb-wc-wall-hung"] li');
  ok('απλά λόγια σε κάθε σημείο που έχει εγκεκριμένη απλή εκδοχή',
    Object.values(ALL.items).some(it => it.s && firstItem.startsWith(it.s)), firstItem);

  // Χωρίς ίντερνετ: η επιλογή και το PDF γίνονται στη συσκευή.
  await p.click('#anBack'); await p.waitForSelector('#s-pdf.on');
  await ctx.setOffline(true);
  await p.evaluate(() => localStorage.removeItem('ergolav.speechRule'));
  await p.waitForTimeout(800);
  await openAnalysis(p);
  ok('χωρίς ίντερνετ: η ανάλυση και το PDF βγαίνουν', /από τον κανόνα σου$/.test((await tags(p))[0]) && await p.textContent('#ctaBtn') === 'Στείλε και τα δύο PDF');
  await ctx.setOffline(false);
  ok('κανένα σφάλμα σελίδας', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}

// Κινητό 360px σκούρο και desktop φωτεινό: η ετικέτα χωράει, χωρίς οριζόντια κύλιση.
for(const [w, h, scheme] of [[360, 780, 'dark'], [1280, 900, 'light']]){
  const ctx = await b.newContext({viewport: {width: w, height: h}, colorScheme: scheme});
  const p = await page(ctx);
  await makeQuote(p, SAY);
  await openAnalysis(p);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const box = await p.locator('#apdf .an-case').first().boundingBox();
  ok(`${w}px ${scheme}: χωρίς οριζόντια κύλιση, η ετικέτα μέσα στη σελίδα`, over <= 0 && box && box.x >= 0 && box.x + box.width <= w, `overflow ${over}`);
  if(process.env.SHOT_DIR) await p.screenshot({path: `${process.env.SHOT_DIR}/allaxe-pick-${w}-${scheme}.png`});
  await ctx.close();
}

// Flag false: ακριβώς όπως πριν — καμία ετικέτα, η σημερινή ανάλυση, το «Άλλαξέ το» με AI στη θέση του.
{
  const ctx = await b.newContext({viewport: {width: 390, height: 860}});
  const p = await page(ctx, {flag: false});
  await makeQuote(p, SAY);
  await openAnalysis(p);
  ok('flag false: καμία ετικέτα, η σημερινή ανάλυση (κρεμαστή λεκάνη)',
    !(await tags(p)).length && (await titles(p))[0] === 'Τοποθέτηση κρεμαστής λεκάνης με καζανάκι εντοιχισμού', (await titles(p)).join(' | '));
  await p.locator('#apdf li[data-sel="steps"]').first().click();
  ok('flag false: το πάτημα σε βήμα δείχνει το «Άλλαξέ το» όπως σήμερα', await p.isVisible('.sel-go'));
  ok('flag false: κανένα σφάλμα σελίδας', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} πέρασαν`);
process.exit(failed.length ? 1 : 0);
