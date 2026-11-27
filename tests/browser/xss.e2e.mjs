// XSS (στόχος 5): οι τρεις επιθέσεις του πλάνου σε όνομα πελάτη, τίτλο, γραμμές, στοιχεία επιχείρησης και PDF.
// Περνά όταν: κανένα στοιχείο <img src=x> / <svg> / attribute on* δεν δημιουργείται, κανένα alert δεν ανοίγει, και το
// κείμενο της επίθεσης φαίνεται αυτούσιο ως κείμενο.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/xss.e2e.mjs
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const ATTACKS = ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', "' onmouseover='alert(1)"];
const CONFIG = fs.readFileSync(new URL('../../src/config.js', import.meta.url), 'utf8')
  .replace('export const AUTH_ENABLED = true;', 'export const AUTH_ENABLED = false;');
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const PROFILE = {name: `Νίκος ${ATTACKS[0]}`, trade: `Υδραυλικός ${ATTACKS[1]}`, phone: '6912345678', email: `a@b.gr${ATTACKS[2]}`};
const quote = (no, i) => ({no, at: Date.parse('2026-11-20T10:00:00Z') + no * 60e3, title: `μπάνιο ${ATTACKS[i]}`, client: `Γιώργος ${ATTACKS[i]}`,
  rows: ATTACKS.map(a => ({name: `Λεκάνη ${a}`, qty: 1, unit: 'τεμ.', mat: 10000})),
  sum: {mat: 30000, lab: 5000, net: 35000, vat: 8400, total: 43400}, vatRate: 24, profile: PROFILE,
  scheduled_date: '2026-11-26', scheduled_time: null, duration_days: 1, status: 'sent'});
const QUOTES = ATTACKS.map((_, i) => quote(i + 1, i));

const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block'});
const p = await ctx.newPage();
const dialogs = [], errs = [];
p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
p.on('pageerror', e => errs.push(e.message));
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p.route(/\/src\/config\.js/, r => r.fulfill({contentType: 'text/javascript', body: CONFIG}));
await p.clock.setFixedTime(new Date('2026-11-26T08:00:00Z'));
await p.addInitScript(({profile, quotes}) => {
  window.SpeechRecognition = window.webkitSpeechRecognition = undefined;
  window.__xss = 0;
  if(sessionStorage.seeded) return;
  sessionStorage.seeded = '1';
  localStorage.clear();
  localStorage.setItem('ergolav.profile', JSON.stringify(profile));
  localStorage.setItem('ergolav.quotes', JSON.stringify(quotes));
  localStorage.setItem('ergolav.quoteNo', String(quotes.length));
}, {profile: PROFILE, quotes: QUOTES});

// Ό,τι θα είχε δημιουργήσει μια επιτυχημένη επίθεση. Το hover σε κάθε στοιχείο ενεργοποιεί και το onmouseover.
const injected = () => p.evaluate(() => {
  const all = [...document.querySelectorAll('*')];
  for(const e of all) e.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
  return {img: document.querySelectorAll('img[src="x"]').length, svg: document.querySelectorAll('svg[onload]').length,
    on: all.filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).map(e => e.tagName).length};
});
const clean = async (where, needles) => {
  await p.waitForTimeout(150);
  const r = await injected();
  ok(`${where}: κανένα στοιχείο από την επίθεση`, r.img === 0 && r.svg === 0 && r.on === 0, JSON.stringify(r));
  ok(`${where}: κανένα alert`, dialogs.length === 0, dialogs.join(' | '));
  const text = await p.evaluate(() => document.body.innerText);
  for(const n of needles) ok(`${where}: φαίνεται ως κείμενο «${n}»`, text.includes(n));
};

await p.goto(BASE);
await p.waitForSelector('#s-start.on');

// 1. Ημερολόγιο / λίστα προσφορών με πελάτες που έχουν την επίθεση στο όνομα.
await p.click('#historyOpen');
await p.waitForSelector('#s-history.on');
await clean('ημερολόγιο', [ATTACKS[0]]);
const list = await p.$('[data-v="list"], [data-view="list"]');
if(list){ await list.click(); await clean('λίστα', ATTACKS.map(a => `Γιώργος ${a}`).slice(0, 1)); }

// 2. Άνοιγμα αποθηκευμένης προσφοράς → PDF με στοιχεία επιχείρησης, πελάτη, τίτλο, γραμμές.
await p.click('.q-open:visible');
await p.waitForSelector('#s-pdf.on');
await clean('PDF αποθηκευμένης προσφοράς', [`Λεκάνη ${ATTACKS[0]}`, `Λεκάνη ${ATTACKS[1]}`, `Λεκάνη ${ATTACKS[2]}`]);

// 3. Νέα προσφορά: η επίθεση γράφεται στο όνομα πελάτη και στο κείμενο της δουλειάς.
await p.goto(BASE);
await p.waitForSelector('#s-start.on');
await p.fill('#client', `Μαρία ${ATTACKS[2]}`);
await p.click('#mic');
await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
await p.evaluate(t => { const el = document.getElementById('transcript'); el.textContent = t; el.dispatchEvent(new Event('input', {bubbles: true})); },
  `μπαταρία νιπτήρα ${ATTACKS[0]} και 2 μέτρα σωλήνα ${ATTACKS[1]}`);
await p.waitForFunction(() => { const b = document.getElementById('ctaBtn'); return b.textContent === 'Βγάλε τιμές' && !b.disabled; });
await p.click('#ctaBtn');
await p.waitForSelector('#s-lines.on');
await clean('γραμμές νέας προσφοράς', []);
await p.waitForFunction(() => !document.getElementById('ctaBtn').disabled);
await p.click('#ctaBtn');
await p.waitForSelector('#s-pdf.on');
await clean('PDF νέας προσφοράς', [`Μαρία ${ATTACKS[2]}`]);

ok('χωρίς σφάλματα JavaScript', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
