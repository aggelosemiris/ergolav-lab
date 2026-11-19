// Τιμές προμηθευτών στην οθόνη ελέγχου (src/price-watch.js): χωρίς δεδομένα η οθόνη είναι όπως πριν· με δεδομένα
// φαίνεται η τιμή αγοράς, και αλλάζει τη γραμμή ΜΟΝΟ με «Βάλ’ αυτή την τιμή»· προϊόν εκτός καταλόγου καταγράφεται
// αυτόματα με το «Κράτα την». Οι αποθηκευμένες προσφορές δεν αλλάζουν.
// Εκτέλεση: node server/app.mjs --auth off &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/prices.e2e.mjs
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); const { chromium } = pw.default ?? pw;
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const PROFILE = JSON.stringify({name: 'Δοκιμή Τιμών', trade: 'Υδραυλικός', phone: ''});
const REFS = JSON.stringify({at: Date.now(), byKey: {
  'heater|ΚΩΔ. 30080': {id: 7, cents: 24500, status: 'verified', at: Date.parse('2026-11-16T03:00:00Z'), n: 3, checked: Date.parse('2026-11-16T03:00:00Z'), check: 'matched'},
  'heater|ΚΩΔ. 30100': {id: 8, cents: 27900, status: 'stale', at: Date.parse('2026-10-01T03:00:00Z'), n: 2, checked: Date.parse('2026-11-16T03:00:00Z'), check: 'unmatched'}}});

async function page({refs = null, quotes = null} = {}){
  const ctx = await b.newContext({viewport: {width: 400, height: 860}});
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => { if(/Content Security Policy|Refused to/i.test(m.text())) p.errs.push(m.text().slice(0, 140)); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.addInitScript(({profile, refs, quotes}) => {
    window.SpeechRecognition = window.webkitSpeechRecognition = undefined;
    if(sessionStorage.seeded) return; sessionStorage.seeded = '1';
    localStorage.setItem('ergolav.profile', profile);
    if(refs) localStorage.setItem('ergolav.refPrices', refs);
    if(quotes) localStorage.setItem('ergolav.quotes', quotes);
  }, {profile: PROFILE, refs, quotes});
  await p.goto(BASE);
  return p;
}
async function toLines(p, text){
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await p.evaluate(t => { const el = document.getElementById('transcript'); el.textContent = t; el.dispatchEvent(new Event('input', {bubbles: true})); }, text);
  await p.waitForFunction(() => { const b = document.getElementById('ctaBtn'); return b.textContent === 'Βγάλε τιμές' && !b.disabled; });
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
}
const heaterCard = p => p.locator('.ln:has(.ln-name:has-text("Θερμοσίφωνας"))').first();

// ══ 1. Χωρίς δεδομένα τιμών: ίδια οθόνη με πριν ══
{
  const p = await page();
  await toLines(p, 'ένας θερμοσίφωνας 80 λίτρα');
  ok('χωρίς δεδομένα: καμία ένδειξη τιμής αγοράς', await p.locator('.refp').count() === 0);
  ok('χωρίς δεδομένα: η τιμή καταλόγου ως έχει (260,00 €)', /260,00/.test(await heaterCard(p).locator('.ln-sum').textContent()));
  ok('χωρίς σφάλματα', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}

// ══ 2. Με δεδομένα: φαίνεται, αλλά δεν αλλάζει τίποτα μόνο του ══
{
  const p = await page({refs: REFS});
  await toLines(p, 'ένας θερμοσίφωνας 80 λίτρα');
  const card = heaterCard(p);
  const ref = await card.locator('.refp').textContent();
  ok('τιμή αγοράς: 245,00 € ανά τεμ. χωρίς ΦΠΑ, επαληθευμένη, 3 προμηθευτές', /245,00/.test(ref) && /χωρίς ΦΠΑ/.test(ref) && /επαληθευμένη 16\/11\/2026/.test(ref) && /3 προμηθευτές/.test(ref), ref.replace(/\s+/g, ' ').trim());
  ok('η γραμμή κρατά την τιμή καταλόγου μέχρι να διαλέξει ο τεχνίτης', /260,00/.test(await card.locator('.ln-sum').textContent()));
  await card.locator('[data-a="ref-use"]').click();
  ok('«Βάλ’ αυτή την τιμή»: η γραμμή γίνεται 245,00 €', /245,00/.test(await heaterCard(p).locator('.ln-sum').textContent()));
  ok('…και φαίνεται «Τη χρησιμοποιείς»', /Τη χρησιμοποιείς/.test(await heaterCard(p).locator('.refp').textContent()));
  const mem = await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.prices') || '{}')['heater|ΚΩΔ. 30080']);
  ok('η επιλογή μπαίνει στη μνήμη τιμών του τεχνίτη (ως δική του επιλογή)', mem?.[0]?.c === 24500);
  // άλλο μέγεθος: παλιά τιμή με ημερομηνία
  await p.click('#editText'); await p.waitForSelector('#s-listen.on').catch(() => {});
  ok('χωρίς σφάλματα', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}
{
  const p = await page({refs: REFS});
  await toLines(p, 'ένας θερμοσίφωνας 100 λίτρα');
  const ref = await heaterCard(p).locator('.refp').textContent();
  ok('παλιά τιμή: γράφει «παλιά τιμή» και την ημερομηνία της', /παλιά τιμή/.test(ref) && /1\/10\/2026/.test(ref), ref.replace(/\s+/g, ' ').trim());
  await p.context().close();
}

// ══ 3. Εκτός καταλόγου: αυτόματη καταγραφή με το «Κράτα την», με την τιμή του χρήστη ══
{
  const p = await page();
  await toLines(p, 'δύο κλιματιστικά 12000 btu');
  const card = p.locator('.ln:has([data-p="cmat"])').first();
  ok('το είδος εκτός καταλόγου ζητά τιμή όπως πριν', await card.count() === 1);
  await card.locator('[data-p="cmat"]').fill('450');
  await card.locator('[data-a="keep"]').click();
  const custom = await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.customProducts') || '{}'));
  const entry = Object.entries(custom)[0];
  ok('καταγράφηκε αυτόματα για τον εβδομαδιαίο έλεγχο', entry && entry[0].startsWith('unknown|') && /κλιματιστικ/i.test(entry[1].name), JSON.stringify(entry));
  ok('με την τιμή που έγραψε (450,00 €)', entry?.[1].cents === 45000);
  ok('χωρίς σφάλματα', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}

// ══ 4. Αποθηκευμένη προσφορά: οι τιμές της δεν αλλάζουν από τις τιμές αναφοράς ══
{
  const quotes = JSON.stringify([{no: 1, at: Date.parse('2026-11-01T10:00:00Z'), title: 'θερμοσίφωνας', client: 'Πελάτης',
    rows: [{name: 'Θερμοσίφωνας 80 λ.', qty: 1, unit: 'τεμ.', mat: 26000}], sum: {mat: 26000, lab: 0, net: 26000, vat: 6240, total: 32240},
    vatRate: 24, profile: JSON.parse(PROFILE), scheduled_date: '2026-11-02', scheduled_time: null, duration_days: 1, status: 'sent'}]);
  const p = await page({refs: REFS, quotes});
  await p.waitForSelector('#s-start.on');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes'))[0]);
  ok('η παλιά προσφορά κρατά τις τιμές της (260,00 € / σύνολο 322,40 €)', saved.rows[0].mat === 26000 && saved.sum.total === 32240);
  await p.context().close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} πέρασαν`);
process.exit(failed.length ? 1 : 0);
