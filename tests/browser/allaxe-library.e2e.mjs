// Μέρος 5: υλικά εκτός καταλόγου χωρίς AI. σίτες → «Φτιάξε ανάλυση» → γενική («Σε κούφωμα») → βιβλιοθήκη → επόμενη
// προσφορά από τη βιβλιοθήκη · «Μοιάζει με…» (ντουζ σετ → Σετ ντους) · «Θα το πω εγώ» · χωρίς ίντερνετ · λίστα ομάδας
// χωρίς στοιχεία · «Υπάρχει πλέον έτοιμη ανάλυση» · βιβλιοθήκη στις ρυθμίσεις · flag false.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/allaxe-library.e2e.mjs
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
const CONFIG = fs.readFileSync(new URL('../../src/config.js', import.meta.url), 'utf8').replace('export const AUTH_ENABLED = true;', 'export const AUTH_ENABLED = false;');
const PROFILE = JSON.stringify({name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'});

const b = await chromium.launch({...(process.env.CHROMIUM_PATH && {executablePath: process.env.CHROMIUM_PATH})});
async function page(ctx, {flag = true, data = ALL} = {}){
  const p = await ctx.newPage();
  p.errs = []; p.paths = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('request', r => p.paths.push(new URL(r.url()).pathname));
  await p.route(/fonts\.(googleapis|gstatic)\.com|supabase\.co|challenges\.cloudflare\.com/, r => r.abort());
  await p.route('**/src/config.js', r => r.fulfill({contentType: 'text/javascript', body: CONFIG.replace(/export const ALLAXE_BOT_ENABLED = (true|false);/, `export const ALLAXE_BOT_ENABLED = ${flag};`)}));
  if(flag) await p.route('**/src/cases-data.js', r => r.fulfill({contentType: 'text/javascript', body: appDataSource(data)}));
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
async function quoteToAnalysis(p, say, client = 'Γιώργος Αντωνίου'){
  await p.goto(BASE);
  await p.fill('#client', client);
  await p.evaluate(t => window.__say.push(t), say);
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').textContent.length > 5);
  await p.click('#ctaBtn'); await waitCta(p, /^Βγάλε τιμές$/);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  // Είδη εκτός καταλόγου: τιμή με το χέρι και «Κράτα την».
  for(let i = 0; i < 4; i++){
    const input = await p.$('[data-p="cmat"]');
    if(!input) break;
    await input.fill('30'); await p.click('[data-a="keep"]'); await p.waitForTimeout(120);
  }
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await waitCta(p, /^Στείλε/); await p.waitForTimeout(800);
  await p.click('#anOpen'); await p.waitForSelector('#s-analysis.on');
  await waitCta(p, /^(Στείλε και τα δύο PDF|Πίσω στην προσφορά)$/);
}
const lastBot = p => p.$$eval('#botLog .msg.bot', els => els.at(-1)?.textContent);
const opts = p => p.$$eval('#botLog .bot-opts', b => [...(b.at(-1)?.querySelectorAll('button:not(:disabled)') || [])].map(e => e.textContent));
async function say(p, label){
  await p.locator('#botLog .bot-opts').last().locator('button:not(:disabled)', {hasText: label}).first().click();
  await p.waitForTimeout(150);
}
async function type(p, text){ await p.fill('#botText', text); await p.click('.bot-send'); await p.waitForTimeout(150); }
const titles = p => p.$$eval('#s-analysis #apdf h3', els => els.map(e => e.textContent.replace(/^\d+\.\s*/, '')));
const tagOf = (p, i) => p.$$eval('#s-analysis #apdf .an-case', els => els.map(e => e.textContent)).then(t => t[i]);

{
  const ctx = await b.newContext({viewport: {width: 390, height: 860}});
  const p = await page(ctx);
  await quoteToAnalysis(p, 'δύο σίτες και λεκάνη κρεμαστή');
  const box = await p.textContent('#anWithout');
  ok('πλαίσιο: «Δεν υπάρχει έτοιμη ανάλυση για «Σίτες»…» με [Φτιάξε ανάλυση]· το PDF χωρίς σίτες',
    /Δεν υπάρχει έτοιμη ανάλυση για «Σίτες»\. Ο πελάτης δεν βλέπει αυτή την εργασία μέχρι να φτιαχτεί\./.test(box)
    && await p.isVisible('[data-make]') && (await titles(p)).length === 1, (await titles(p)).join(' | '));
  await p.click('[data-make]'); await p.waitForSelector('#botDialog[open]');
  ok('«Έψαξα στον κατάλογο για κάτι παρόμοιο. Δεν βρέθηκε.» και «Τι δουλειά είναι…» με 6 κατηγορίες + 2',
    await p.$$eval('#botLog .msg.bot', els => els.some(e => e.textContent === 'Έψαξα στον κατάλογο για κάτι παρόμοιο. Δεν βρέθηκε.'))
    && await lastBot(p) === 'Τι δουλειά είναι, για να βάλω την ανάλογη;' && (await opts(p)).length === 8 && (await opts(p))[0] === 'Σε κούφωμα (πόρτα ή παράθυρο)');
  await say(p, 'Σε κούφωμα');
  const card = await p.$$eval('#botLog .bcard', c => c.at(-1).textContent);
  ok('γενική ανάλυση με «τις σίτες» μέσα και [Κράτα το] [Άλλο άρθρο] [Άλλο είδος δουλειάς] [Θα το πω εγώ]',
    /με τις σίτες μέσα:/.test(await p.$$eval('#botLog .msg.bot', e => e.at(-1).textContent)) && /τις σίτες/.test(card) && !/\{είδος\}/.test(card)
    && (await opts(p)).join('|') === 'Κράτα το|Άλλο άρθρο|Άλλο είδος δουλειάς|Θα το πω εγώ');
  await say(p, 'Κράτα το');
  ok('«Το «Σίτες» μπήκε στη λίστα της ομάδας, χωρίς στοιχεία πελάτη…»', /^Το «Σίτες» μπήκε στη λίστα της ομάδας, χωρίς στοιχεία πελάτη/.test(await lastBot(p)));
  await say(p, 'Κλείσε');
  ok('η εργασία μπήκε στο PDF, με ετικέτα «γενική ανάλυση»· το πλαίσιο έφυγε',
    (await titles(p)).includes('Τοποθέτηση εξαρτήματος σε κούφωμα: Σίτες') && /γενική ανάλυση/.test(await tagOf(p, 1)) && !(await p.isVisible('[data-make]')),
    (await titles(p)).join(' | '));
  const queue = await p.evaluate(() => localStorage.getItem('ergolav.missingQueue'));
  ok('λίστα ομάδας: μόνο κανονικοποιημένο όνομα και κατηγορία, χωρίς πελάτη', queue === JSON.stringify([{name: 'σιτεσ', category: 'frame'}]), queue);

  // Επόμενη προσφορά: από τη βιβλιοθήκη, αυτόματα.
  await quoteToAnalysis(p, 'τρεις σίτες', 'Μαρία Κ.');
  ok('επόμενη προσφορά: οι σίτες μπαίνουν μόνες τους, «από τη βιβλιοθήκη σου»',
    (await titles(p))[0] === 'Τοποθέτηση εξαρτήματος σε κούφωμα: Σίτες' && /από τη βιβλιοθήκη σου/.test(await tagOf(p, 0)));

  // «Μοιάζει με…» και «Θα το πω εγώ», χωρίς ίντερνετ.
  await quoteToAnalysis(p, 'ένα ντουζ σετ και ένα τζάκι ηλεκτρικό');
  await ctx.setOffline(true);
  await p.locator('[data-make]').first().click(); await p.waitForSelector('#botDialog[open]');
  ok('χωρίς ίντερνετ, «Μοιάζει με: Σετ ντους. Να βάλω αυτή την ανάλυση;» [Ναι] [Όχι]',
    await lastBot(p) === 'Μοιάζει με: Σετ ντους. Να βάλω αυτή την ανάλυση;' && (await opts(p)).join('|') === 'Ναι|Όχι');
  await say(p, 'Ναι');
  await say(p, 'Απλό, με μπάρα'); await say(p, 'Αλλαγή παλιού');
  ok('οι ερωτήσεις περίπτωσης εκείνου του υλικού και κάρτα', /Βρήκα την ανάλογη ανάλυση/.test(await p.$$eval('#botLog .msg.bot', e => e.at(-1).textContent)));
  await say(p, 'Κράτα το'); await say(p, 'Κλείσε');
  await p.locator('[data-make]').first().click(); await p.waitForSelector('#botDialog[open]');
  await say(p, 'Θα το πω εγώ');
  ok('«Θα το πω εγώ»: «Πες μου με δικά σου λόγια. Τι κάνεις πρώτα;» με πεδίο και μικρόφωνο',
    await lastBot(p) === 'Πες μου με δικά σου λόγια. Τι κάνεις πρώτα;' && await p.isVisible('#botInput') && /π\.χ\./.test(await p.getAttribute('#botText', 'placeholder')));
  await type(p, 'Ελέγχουμε τον τοίχο και την πρίζα.');
  await say(p, 'Και κάτι ακόμα'); await type(p, 'Σημαδεύουμε τα σημεία στήριξης.');
  await type(p, 'Στερεώνουμε τη βάση και κρεμάμε το τζάκι.');
  await type(p, 'Το ανάβουμε και ελέγχουμε όλες τις λειτουργίες.');
  ok('«Έτσι θα φαίνεται στον πελάτη:» [Κράτα το] [Και κάτι ακόμα] [Άκυρο]',
    /Έτσι θα φαίνεται στον πελάτη/.test(await p.$$eval('#botLog .msg.bot', e => e.at(-1).textContent)) && (await opts(p)).join('|') === 'Κράτα το|Και κάτι ακόμα|Άκυρο');
  await say(p, 'Κράτα το'); await say(p, 'Κλείσε');
  const t3 = await titles(p);
  ok('και τα δύο μπήκαν: σετ ντους (επιλογή σου) και τζάκι (γραμμένη από σένα), χωρίς κενές ενότητες',
    t3.includes('Τζάκι ηλεκτρικό') && t3.length === 2 && /γραμμένη από σένα/.test((await p.$$eval('#s-analysis #apdf .an-case', e => e.map(x => x.textContent))).join('|'))
    && await p.$eval('#s-analysis #apdf [data-task="lib:τζακι ηλεκτρικο"]', s => !s.querySelector('.an-dur') && s.querySelectorAll('h4').length === 3), t3.join(' | '));
  ok('χωρίς ίντερνετ: το PDF βγαίνει', await p.textContent('#ctaBtn') === 'Στείλε και τα δύο PDF');
  await ctx.setOffline(false);

  // Η βιβλιοθήκη στις ρυθμίσεις: τη βλέπει, τη σβήνει.
  await p.click('#anRules'); await p.waitForSelector('#s-rules.on');
  const libText = await p.textContent('#botLibrary');
  ok('«Η βιβλιοθήκη μου»: τρία είδη', /Σίτες/.test(libText) && /Τζάκι ηλεκτρικό/.test(libText) && /Ντουζ σετ/.test(libText));
  const row = p.locator('#botLibrary .lib-row', {hasText: 'Τζάκι ηλεκτρικό'});
  await row.locator('[data-a="del"]').click(); await row.locator('[data-a="del"]').click();
  ok('σβήσιμο από τη βιβλιοθήκη (δύο πατήματα)', !/Τζάκι ηλεκτρικό/.test(await p.textContent('#botLibrary')));
  ok('καμία κλήση σε worker/AI', !p.paths.some(x => !/\.m?js$/.test(x) && /rewrite|anthropic|openai|messages/i.test(x)));
  ok('κανένα σφάλμα σελίδας', !p.errs.length, p.errs.join(' | '));
  if(process.env.SHOT_DIR) await p.screenshot({path: `${process.env.SHOT_DIR}/allaxe-library-rules.png`, fullPage: true});
  await ctx.close();
}

// «Υπάρχει πλέον έτοιμη ανάλυση…»: το είδος μπήκε στον χάρτη (promoted) → ερώτηση μία φορά.
{
  const ctx = await b.newContext({viewport: {width: 360, height: 780}, colorScheme: 'dark'});
  const p = await page(ctx, {data: {...ALL, promoted: {'σιτεσ': 'cabin'}}});
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem('ergolav.library', JSON.stringify({'σιτεσ': {name: 'Σίτες', kind: 'own', updated: 1,
    analysis: {id: 'own-sites', title: 'Σίτες', trade: '', typical_duration: '', related_consumables: [], requires_licensed_professional: false, notes_for_master: '',
      sections: [{key: 'prerequisites', title: 'Τι χρειάζεται πριν ξεκινήσουμε', items: []}, {key: 'preparation', title: 'Προεργασία', items: [{id: 'a', text: 'Παίρνουμε μέτρα στα κουφώματα.'}]},
        {key: 'steps', title: 'Στάδια τοποθέτησης', items: [{id: 'b', text: 'Βιδώνουμε τις σίτες στα κουφώματα.'}]}, {key: 'checks', title: 'Έλεγχοι πριν την παράδοση', items: [{id: 'c', text: 'Ανοιγοκλείνουν χωρίς τριβή.'}]},
        {key: 'handover', title: 'Καθαρισμός και παράδοση', items: []}]}}})));
  await quoteToAnalysis(p, 'δύο σίτες');
  ok('«Υπάρχει πλέον έτοιμη ανάλυση για «Σίτες». Να τη χρησιμοποιώ;» [Ναι] [Κράτα τη δική μου]',
    /Υπάρχει πλέον έτοιμη ανάλυση για «Σίτες»\. Να τη χρησιμοποιώ;/.test(await p.textContent('#anWithout')) && await p.isVisible('[data-official][data-yes]'));
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok('360 σκούρο: χωρίς οριζόντια κύλιση', over <= 0, `overflow ${over}`);
  if(process.env.SHOT_DIR) await p.screenshot({path: `${process.env.SHOT_DIR}/allaxe-library-360-dark.png`, fullPage: true});
  await p.click('[data-official][data-yes]'); await p.waitForTimeout(300);
  ok('«Ναι»: μπαίνει η έτοιμη ανάλυση, και η ερώτηση δεν ξαναγίνεται',
    (await titles(p))[0] !== 'Σίτες' && !/Υπάρχει πλέον/.test(await p.textContent('#anWithout')), (await titles(p)).join(' | '));
  ok('κανένα σφάλμα σελίδας (360)', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}

// Flag false: όπως πριν — οι σίτες στη λίστα «Χωρίς ανάλυση», κανένα «Φτιάξε ανάλυση».
{
  const ctx = await b.newContext({viewport: {width: 390, height: 860}});
  const p = await page(ctx, {flag: false});
  await quoteToAnalysis(p, 'δύο σίτες και λεκάνη κρεμαστή');
  ok('flag false: «Χωρίς ανάλυση · δεν μπαίνουν στο PDF» με τις σίτες, χωρίς [Φτιάξε ανάλυση]',
    /Χωρίς ανάλυση · δεν μπαίνουν στο PDF/.test(await p.textContent('#anWithout')) && /Σίτες/.test(await p.textContent('#anWithout')) && !(await p.$('[data-make]')));
  ok('flag false: κανένα σφάλμα σελίδας', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} πέρασαν`);
process.exit(failed.length ? 1 : 0);
