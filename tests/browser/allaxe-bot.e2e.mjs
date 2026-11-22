// Μέρος 4: το bot του «Άλλαξέ το» χωρίς AI. Οι ροές του demo: λεκάνη → περίπτωση → Κράτα → Ναι πάντα → νέα προσφορά
// με τον κανόνα · Πολύ τεχνικό (απλά λόγια) · Λάθος σειρά · Λείπει κάτι · Κάτι άλλο → Βγάλ' το · Αναίρεση · κλείσιμο
// με ×/Esc/κλικ έξω · κινητό 360 σκούρο · χωρίς κανένα αίτημα σε worker/AI.
// Το flag ανοίγει μόνο μέσα στο τεστ και τα κείμενα σερβίρονται «όλα εγκεκριμένα» (όπως στο allaxe-pick.e2e.mjs).
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/allaxe-bot.e2e.mjs
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
const CONFIG = fs.readFileSync(new URL('../../src/config.js', import.meta.url), 'utf8')
  .replace(/export const ALLAXE_BOT_ENABLED = (true|false);/, 'export const ALLAXE_BOT_ENABLED = true;')
  .replace('export const AUTH_ENABLED = true;', 'export const AUTH_ENABLED = false;');
const caseTitle = id => res[id.split(':')[0]].out.cases.find(c => c.id === id).title;
const PROFILE = JSON.stringify({name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'});

// serviceWorkers: 'block' — το test κάνει route σε αρχεία της εφαρμογής (src/, vendor/)· με τον service worker (sw.js)
// θα έρχονταν από την cache του και το route δεν θα έπιανε. Ο service worker ελέγχεται στα υπόλοιπα tests.
const b = await chromium.launch({...(process.env.CHROMIUM_PATH && {executablePath: process.env.CHROMIUM_PATH})});
async function page(ctx){
  const p = await ctx.newPage();
  p.errs = []; p.paths = []; p.hosts = new Set();
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('request', r => { const u = new URL(r.url()); p.hosts.add(u.host); p.paths.push(u.pathname); });
  await p.route(/fonts\.(googleapis|gstatic)\.com|supabase\.co|challenges\.cloudflare\.com/, r => r.abort());
  await p.route('**/src/config.js', r => r.fulfill({contentType: 'text/javascript', body: CONFIG}));
  await p.route('**/src/cases-data.js', r => r.fulfill({contentType: 'text/javascript', body: CASES_JS}));
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
async function quoteToAnalysis(p, say){
  await p.goto(BASE);
  await p.fill('#client', 'Γιώργος Αντωνίου');
  await p.evaluate(t => window.__say.push(t), say);
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').textContent.length > 5);
  await p.click('#ctaBtn'); await waitCta(p, /^Βγάλε τιμές$/);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await waitCta(p, /^Στείλε/); await p.waitForTimeout(800);
  await p.click('#anOpen'); await p.waitForSelector('#s-analysis.on');
  await waitCta(p, /^Στείλε και τα δύο PDF$/);
}
// Μόνο η ζωντανή οθόνη: μετά από κάθε αλλαγή το PDF ξαναφτιάχνεται και το html2pdf βάζει για λίγο ένα αντίγραφο του #apdf στο body.
const W = '#s-analysis #apdf [data-task="plumb-wc-wall-hung"]';
const lastBot = p => p.$$eval('#botLog .msg.bot', els => els.at(-1)?.textContent);
const opts = p => p.$$eval('#botLog .bot-opts', b => [...(b.at(-1)?.querySelectorAll('button:not(:disabled)') || [])].map(e => e.textContent));
async function say(p, label){
  const btn = p.locator('#botLog .bot-opts').last().locator('button:not(:disabled)', {hasText: label}).first();
  await btn.click();
  await p.waitForTimeout(120);
}
const openTaskBot = async p => { await p.click(`${W} .an-change`); await p.waitForSelector('#botDialog[open]'); };
const titleOf = p => p.$eval(`${W} h3`, e => e.textContent.replace(/^\d+\.\s*/, ''));
const stepsOf = (p, key) => p.$$eval(`${W} li[data-sel="${key}"]`, els => els.map(e => e.textContent));

{
  const ctx = await b.newContext({serviceWorkers: 'block', viewport: {width: 390, height: 860}});
  const p = await page(ctx);
  await quoteToAnalysis(p, 'λεκάνη κρεμαστή και μια μπαταρία νιπτήρα');

  // 1. «Δεν είναι έτσι η δουλειά» → ερωτήσεις → κάρτα → Κράτα → Ναι, πάντα
  await openTaskBot(p);
  ok('πάνελ: «Άλλαξέ το», υπότιτλος η εργασία και η περίπτωση, «Τι δεν σου αρέσει εδώ;» με τα 6 κουμπιά',
    await p.textContent('#botTitle') === 'Άλλαξέ το' && /Τοποθέτηση κρεμαστής λεκάνης.*Αλλαγή παλιάς · Κρεμαστή · Τούβλο ή μπετό/.test(await p.textContent('#botSub'))
    && await lastBot(p) === 'Τι δεν σου αρέσει εδώ;' && (await opts(p)).join('|') === 'Δεν είναι έτσι η δουλειά|Πολύ τεχνικό|Πολύ μεγάλο|Λάθος σειρά|Λείπει κάτι|Κάτι άλλο…',
    (await opts(p)).join('|'));
  ok('το πεδίο κειμένου κρυφό όσο το bot δεν περιμένει κείμενο', await p.isHidden('#botInput'));
  await say(p, 'Δεν είναι έτσι η δουλειά');
  ok('μήνυμα του μάστορα δεξιά, τα παλιά κουμπιά απενεργοποιημένα',
    await p.$eval('#botLog .msg.me', e => e.textContent) === 'Δεν είναι έτσι η δουλειά' && await p.$$eval('#botLog .bot-opts', b => b[0].querySelectorAll('button:disabled').length === 6));
  ok('ερώτηση περίπτωσης: ό,τι ξέρει από τη γραμμή το λέει, ρωτά τα υπόλοιπα', /Αλλάζει παλιά λεκάνη ή μπαίνει καινούργια;/.test(await lastBot(p))
    && await p.$$eval('#botLog .msg.bot', els => els.some(e => /Από τη γραμμή της προσφοράς ξέρω: Κρεμαστή/.test(e.textContent))));
  await say(p, 'Αλλαγή παλιάς');
  ok('υπο-ερώτηση μόνο όταν ισχύει: «Σε τι τοίχο θα μπει το καζανάκι;» (κρεμαστή)', await lastBot(p) === 'Σε τι τοίχο θα μπει το καζανάκι;');
  await say(p, 'Γυψοσανίδα');
  const cardTxt = await p.$$eval('#botLog .bcard', c => c.at(-1).textContent);
  ok('«Βρήκα την ανάλογη ανάλυση:» και κάρτα ΠΡΙΝ (διαγραμμένη) / ΜΕΤΑ (όλες οι ενότητες)',
    await p.$$eval('#botLog .msg.bot', els => els.some(e => e.textContent === 'Βρήκα την ανάλογη ανάλυση:'))
    && await p.$$eval('#botLog .bcard', c => c.at(-1).querySelector('.was').textContent.startsWith('Τοποθέτηση κρεμαστής λεκάνης με καζανάκι εντοιχισμού'))
    && cardTxt.includes(caseTitle('wc:replace.hung.drywall')) && /Στάδια τοποθέτησης/.test(cardTxt) && /Καθαρισμός και παράδοση/.test(cardTxt)
    && (await opts(p)).join('|') === 'Κράτα το|Κι άλλο…|Άκυρο');
  ok('τίποτα δεν αλλάζει πριν από το «Κράτα το»', !/γυψοσανίδα/.test(await titleOf(p)));
  await say(p, 'Κράτα το');
  ok('μετά το «Κράτα το»: η ανάλυση έγινε η νέα περίπτωση, «Αναίρεση» ορατή', await titleOf(p) === caseTitle('wc:replace.hung.drywall') && await p.isVisible('#botUndo'));
  ok('«Να το κάνω έτσι πάντα στις επόμενες προσφορές;»', await lastBot(p) === 'Να το κάνω έτσι πάντα στις επόμενες προσφορές;');
  await say(p, 'Ναι, πάντα');
  ok('«Έγινε. Μπήκε στους «Οι κανόνες μου».» και κανόνας σαν ετικέτα', await lastBot(p) === 'Έγινε. Μπήκε στους «Οι κανόνες μου».'
    && /Λεκάνη: Αλλαγή παλιάς · Κρεμαστή · Γυψοσανίδα/.test(await p.textContent('#anMyRules')));
  await say(p, 'Κλείσε');
  ok('«Κλείσε» κλείνει το πάνελ· ετικέτα «επιλογή σου»', !(await p.isVisible('#botDialog[open]')) && /επιλογή σου/.test(await p.textContent(`${W} .an-case`)));

  // 2. «Πολύ τεχνικό» → απλά λόγια σε όλη την εργασία → Μόνο εδώ
  await openTaskBot(p);
  await say(p, 'Πολύ τεχνικό');
  ok('«Το γράφω σε πιο απλά λόγια…» με ένα σημείο για παράδειγμα', /πιο απλά λόγια/.test(await p.$$eval('#botLog .msg.bot', els => els.at(-1).textContent))
    && await p.$$eval('#botLog .bcard', c => c.at(-1).querySelectorAll('h4').length === 2));
  const firstBefore = (await stepsOf(p, 'prerequisites'))[0];
  await say(p, 'Κράτα το');
  await say(p, 'Μόνο εδώ');
  ok('«Εντάξει, μόνο σε αυτή την προσφορά.» και η εργασία σε απλά λόγια', await lastBot(p) === 'Εντάξει, μόνο σε αυτή την προσφορά.'
    && (await stepsOf(p, 'prerequisites'))[0] !== firstBefore && /απλά λόγια/.test(await p.textContent(`${W} .an-case`)));
  await say(p, 'Κλείσε');
  await openTaskBot(p);
  await say(p, 'Πολύ τεχνικό');
  ok('ήδη σε απλά λόγια: «Είναι ήδη σε αυτή την εκδοχή. Θες κάτι άλλο;»', await lastBot(p) === 'Είναι ήδη σε αυτή την εκδοχή. Θες κάτι άλλο;');

  // 3. «Λάθος σειρά» → ενότητα → ↑ ↓ → Έτοιμο → κάρτα → Κράτα → «Μπήκε. Θες κάτι ακόμα;»
  await say(p, 'Λάθος σειρά');
  await say(p, 'Στάδια τοποθέτησης');
  const steps0 = await stepsOf(p, 'steps');
  await p.locator('#botLog .border-list li').nth(1).locator('button', {hasText: '↑'}).click();
  await say(p, 'Έτοιμο');
  ok('λίστα με ↑ ↓ μέσα στη συζήτηση και κάρτα με τη νέα σειρά', /Νέα σειρά|Πριν · Στάδια τοποθέτησης/.test(await p.$$eval('#botLog .bcard', c => c.at(-1).textContent)));
  await say(p, 'Κράτα το');
  const steps1 = await stepsOf(p, 'steps');
  ok('η σειρά άλλαξε (τα δύο πρώτα στάδια ανάποδα)', steps1[0] === steps0[1] && steps1[1] === steps0[0]);
  ok('«Μπήκε. Θες κάτι ακόμα;» [Όχι, τέλεια] [Κι άλλο…]', await lastBot(p) === 'Μπήκε. Θες κάτι ακόμα;' && (await opts(p)).join('|') === 'Όχι, τέλεια|Κι άλλο…');

  // 4. «Λείπει κάτι» → πρόταση → Κράτα
  await say(p, 'Κι άλλο…');
  await say(p, 'Λείπει κάτι');
  const sug = await opts(p);
  ok('«Μήπως λείπει κάποιο από αυτά;» έως 6 προτάσεις και «Πρόσθεσε δικό μου βήμα»', await lastBot(p) === 'Μήπως λείπει κάποιο από αυτά;'
    && sug.length >= 2 && sug.length <= 7 && sug.at(-1) === 'Πρόσθεσε δικό μου βήμα', sug.length);
  await p.locator('#botLog .bot-opts').last().locator('button').first().click(); await p.waitForTimeout(120);
  ok('κάρτα «Μπαίνει στο «<ενότητα>»: + βήμα»', /^Μπαίνει στο «/.test(await p.$$eval('#botLog .bcard h4', h => h.at(-1).textContent)));
  const countBefore = await p.$$eval(`${W} li`, l => l.length);
  await say(p, 'Κράτα το');
  ok('το βήμα μπήκε', await p.$$eval(`${W} li`, l => l.length) === countBefore + 1);

  // 5. «Κάτι άλλο…» → σημείο → «Βγάλ' το» → Κράτα → Αναίρεση
  await say(p, 'Κι άλλο…');
  await say(p, 'Κάτι άλλο…');
  ok('«Ποιο σημείο θες να αλλάξεις;» με όλα τα σημεία κομμένα', await lastBot(p) === 'Ποιο σημείο θες να αλλάξεις;'
    && (await opts(p)).every(t => t.length <= 45));
  const victim = (await stepsOf(p, 'handover'))[0];
  const idx = (await p.$$eval(`${W} li`, l => l.map(e => e.textContent))).indexOf(victim);
  await p.locator('#botLog .bot-opts').last().locator('button').nth(idx).click(); await p.waitForTimeout(120);
  ok('ροή σημείου: το σημείο επισημασμένο, «Τι θες να κάνω με αυτό;»', await p.$$eval('#botLog .msg.focus', f => f.at(-1).textContent) === victim
    && await lastBot(p) === 'Τι θες να κάνω με αυτό;' && (await opts(p)).includes('Βγάλ’ το'));
  await say(p, 'Βγάλ’ το');
  ok('κάρτα «Βγαίνει από την ανάλυση:» με το σημείο διαγραμμένο', await p.$$eval('#botLog .bcard .was', w => w.at(-1).textContent) === victim);
  await say(p, 'Κράτα το');
  ok('το σημείο βγήκε', !(await stepsOf(p, 'handover')).includes(victim));
  await p.click('#botUndoBtn');
  await p.waitForTimeout(200);
  ok('«Αναίρεση»: το σημείο γύρισε', (await stepsOf(p, 'handover')).includes(victim));

  // Κλείσιμο με αλλαγές: μία ερώτηση για όλες μαζί
  await say(p, 'Όχι, τέλεια');
  ok('στο κλείσιμο: «Να κρατήσω αυτές τις αλλαγές και στις επόμενες προσφορές με τη λεκάνη;»',
    await lastBot(p) === 'Να κρατήσω αυτές τις αλλαγές και στις επόμενες προσφορές με τη λεκάνη;');
  await say(p, 'Ναι, πάντα');
  await say(p, 'Κλείσε');
  ok('κανόνες ως ετικέτες: περίπτωση και αλλαγές', /Λεκάνη: \d αλλαγές|Λεκάνη: 1 αλλαγή/.test(await p.textContent('#anMyRules')));

  // Κλείσιμο με Esc και με κλικ έξω
  await openTaskBot(p); await p.keyboard.press('Escape');
  ok('Esc κλείνει', !(await p.isVisible('#botDialog[open]')));
  await openTaskBot(p); await p.mouse.click(195, 20);
  ok('κλικ έξω κλείνει', !(await p.isVisible('#botDialog[open]')));
  // Πάτημα σε βήμα → «Άλλαξέ το» → ροή σημείου
  await p.locator(`${W} li[data-sel="checks"]`).first().click();
  await p.click('.sel-go'); await p.waitForSelector('#botDialog[open]');
  ok('πάτημα σε βήμα → ροή ενός σημείου', await lastBot(p) === 'Τι θες να κάνω με αυτό;');
  await say(p, 'Γράψ’ το αλλιώς');
  ok('«Γράψ' + "'" + ' το αλλιώς»: πεδίο με το τωρινό κείμενο και μικρόφωνο', await p.isVisible('#botInput') && (await p.inputValue('#botText')).length > 8);
  await p.fill('#botText', 'Γεμίζουμε το καζανάκι και τραβάμε αρκετές φορές με το μεγάλο και το μικρό κουμπί.');
  await p.click('.bot-send'); await p.waitForTimeout(150);
  ok('κάρτα ΠΡΙΝ/ΜΕΤΑ με [Κράτα το] [Ξαναγράψ’ το] [Άκυρο]', (await opts(p)).join('|') === 'Κράτα το|Ξαναγράψ’ το|Άκυρο');
  await say(p, 'Άκυρο');
  await p.click('#botClose');
  ok('×: κλείνει (χωρίς αλλαγές δεν ρωτά)', !(await p.isVisible('#botDialog[open]')));

  // Νέα προσφορά: μπαίνει ο κανόνας περίπτωσης και οι αλλαγές.
  await quoteToAnalysis(p, 'λεκάνη κρεμαστή');
  ok('νέα προσφορά με τον κανόνα: Αλλαγή · Κρεμαστή · Γυψοσανίδα, «από τον κανόνα σου»',
    await titleOf(p) === caseTitle('wc:replace.hung.drywall') && /από τον κανόνα σου/.test(await p.textContent(`${W} .an-case`)));
  // Η νέα προσφορά είναι σε κανονική εκδοχή (τα απλά λόγια ήταν «μόνο εδώ»): σύγκριση με τα κανονικά κείμενα.
  const dry = res.wc.out.cases.find(c => c.id === 'wc:replace.hung.drywall'), n = id => res.wc.out.items[id].n;
  const nowSteps = await stepsOf(p, 'steps');
  ok('…και με τις αλλαγές του κανόνα (η σειρά των σταδίων), σε κανονική εκδοχή',
    nowSteps[0] === n(dry.sections.steps[1]) && nowSteps[1] === n(dry.sections.steps[0]), nowSteps.slice(0, 2).join(' | '));
  ok('μετρήσεις στη συσκευή: μόνο σταθερά κουμπιά και ids, κανένα κείμενο', await p.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ergolav.botMetrics') || '[]');
    return m.length > 10 && m.some(e => e.outcome === 'keep') && m.every(e => !e.choice || e.choice.length < 40) && !JSON.stringify(m).includes('Γεμίζουμε');
  }));
  ok('καμία κλήση σε worker/AI', !p.paths.some(x => !/\.m?js$/.test(x) && /rewrite|anthropic|openai|messages/i.test(x)));
  ok('κανένα σφάλμα σελίδας', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}

// Κινητό 360 σκούρο: το πάνελ χωράει, κουμπιά ≥ 44px, το πεδίο κειμένου ορατό
{
  const ctx = await b.newContext({serviceWorkers: 'block', viewport: {width: 360, height: 740}, colorScheme: 'dark', hasTouch: true});
  const p = await page(ctx);
  await quoteToAnalysis(p, 'λεκάνη κρεμαστή');
  await openTaskBot(p);
  await say(p, 'Κάτι άλλο…');
  await p.locator('#botLog .bot-opts').last().locator('button').first().click(); await p.waitForTimeout(120);
  await say(p, 'Γράψ’ το αλλιώς');
  const small = await p.$$eval('#botDialog button:not([hidden])', bs => bs.filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).map(b => b.textContent));
  const over = await p.evaluate(() => document.getElementById('botLog').scrollWidth - document.getElementById('botLog').clientWidth);
  const inputBox = await p.locator('#botInput').boundingBox();
  ok('360 σκούρο: χωρίς οριζόντια κύλιση, κουμπιά ≥ 44px, πεδίο και «Στείλε» μέσα στην οθόνη',
    over <= 0 && !small.length && inputBox && inputBox.y + inputBox.height <= 740, `μικρά: ${small.join(',')} · overflow ${over}`);
  if(process.env.SHOT_DIR) await p.screenshot({path: `${process.env.SHOT_DIR}/allaxe-bot-360-dark.png`});
  ok('κανένα σφάλμα σελίδας (360)', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}
// Desktop φωτεινό: στιγμιότυπο της κάρτας περίπτωσης
{
  const ctx = await b.newContext({serviceWorkers: 'block', viewport: {width: 1280, height: 900}});
  const p = await page(ctx);
  await quoteToAnalysis(p, 'λεκάνη κρεμαστή');
  await openTaskBot(p);
  await say(p, 'Δεν είναι έτσι η δουλειά'); await say(p, 'Σε νέα θέση'); await say(p, 'Μπροστά στον τοίχο');
  ok('desktop: κάρτα νέας περίπτωσης', (await opts(p)).join('|') === 'Κράτα το|Κι άλλο…|Άκυρο');
  if(process.env.SHOT_DIR) await p.screenshot({path: `${process.env.SHOT_DIR}/allaxe-bot-1280.png`});
  await ctx.close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} πέρασαν`);
process.exit(failed.length ? 1 : 0);
