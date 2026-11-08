// Ιστορικό προσφορών (πλέον «Ημερολόγιο»): ο τεχνίτης βλέπει τις προσφορές που έφτιαξε, ανοίγει το ίδιο PDF και το ξαναστέλνει.
// Το ημερολόγιο (μήνας, λίστα, ημερομηνίες, καταστάσεις) το ελέγχει το calendar.e2e.mjs.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/history.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const PROFILE = JSON.stringify({name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'});

async function page({viewport = {width: 400, height: 860}, init} = {}){
  const ctx = await b.newContext({viewport});
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.addInitScript(s => { try { if(!localStorage.getItem('ergolav.profile')) localStorage.setItem('ergolav.profile', s); } catch {} }, PROFILE);
  if(init) await p.addInitScript(init);
  await p.goto(BASE);
  return p;
}
async function dictate(p, text){
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await p.evaluate(t => { const el = document.getElementById('transcript'); el.textContent = t; el.dispatchEvent(new Event('input', {bubbles: true})); }, text);
  await p.waitForFunction(() => { const b = document.getElementById('ctaBtn'); return b.textContent === 'Βγάλε τιμές' && !b.disabled; });
}
const pdfReady = p => p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
// Νέα προσφορά μέχρι το PDF· επιστρέφει το κείμενο της προεπισκόπησης.
async function makeQuote(p, {client = '', text, vat}){
  await p.goto(BASE);
  if(client) await p.fill('#client', client);
  await dictate(p, text);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  if(vat) await p.selectOption('#vatRate', String(vat));
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on'); await pdfReady(p);
  return p.textContent('#pdf');
}

{
  const p = await page();
  await p.evaluate(() => { localStorage.removeItem('ergolav.quotes'); localStorage.removeItem('ergolav.quoteNo'); }); await p.reload();
  ok('χωρίς προσφορές: το κουμπί «Ημερολόγιο» δεν φαίνεται', !(await p.isVisible('#historyOpen')));
  const pdf1 = await makeQuote(p, {client: 'Γιώργος Αντωνίου, Χαλάνδρι', text: 'τρεις πρίζες και 12 μέτρα σωλήνα'});
  ok('η νέα προσφορά δεν δείχνει «← Όλες οι προσφορές» και κρατά την «Ανάλυση εργασιών με AI»', !(await p.isVisible('#histBack')) && await p.isVisible('#installOpen'));
  const pdf2 = await makeQuote(p, {text: 'λεκάνη κρεμαστή', vat: 13});
  await p.goto(BASE);
  ok('μετά από δύο προσφορές: «📅 Ημερολόγιο (2)» στην αρχική', await p.textContent('#historyOpen') === '📅 Ημερολόγιο (2)');
  await p.click('#historyOpen');
  const items = await p.$$eval('#calDay .q-open', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok('ημερολόγιο: σήμερα και οι δύο, με πελάτη, περιοχή, αριθμό, κατάσταση και σύνολο',
    items.length === 2 && /^Γιώργος Αντωνίου Χαλάνδρι · Αρ\. 1 Πρόχειρη [\d.]+,\d\d €$/.test(items[0]) && /^Χωρίς όνομα πελάτη Αρ\. 2 Πρόχειρη [\d.]+,\d\d €$/.test(items[1]), items.join(' | '));
  // Άνοιγμα της πρώτης: ίδιο PDF, ίδιος αριθμός, χωρίς νέο αριθμό προσφοράς
  await p.locator('.q-open[data-no="1"]').click();
  await p.waitForSelector('#s-pdf.on'); await pdfReady(p);
  ok('άνοιγμα από το ιστορικό: ακριβώς το ίδιο PDF που πήρε ο πελάτης (Αρ. 1)', await p.textContent('#pdf') === pdf1 && (await p.textContent('#pdf .qno')).trim() === '1');
  ok('«Στείλε ξανά στον πελάτη», «← Ημερολόγιο», χωρίς «Ανάλυση εργασιών με AI»',
    await p.textContent('#ctaBtn') === 'Στείλε ξανά στον πελάτη' && await p.isVisible('#histBack') && !(await p.isVisible('#installOpen')) && await p.textContent('#pdfTitle') === 'Προσφορά Αρ. 1');
  ok('το άνοιγμα δεν «τρώει» αριθμό προσφοράς', await p.evaluate(() => localStorage.getItem('ergolav.quoteNo')) === '2');
  // Ξαναστέλνεται το σωστό αρχείο (κοινοποίηση σε ψεύτικο share: δεν φεύγει τίποτα)
  await p.evaluate(() => { window.sent = null; Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => true});
    Object.defineProperty(navigator, 'share', {configurable: true, value: async d => { window.sent = {title: d.title, text: d.text, files: d.files.map(f => f.name)}; }}); });
  await p.click('#ctaBtn');
  await p.waitForSelector('#s-done.on');
  const sent = await p.evaluate(() => window.sent);
  ok('ξαναστέλνεται το PDF της προσφοράς 1, με σωστό τίτλο και κείμενο', sent?.files?.[0]?.startsWith('Prosfora-1-Giorgos') && sent.title === 'Προσφορά 1 — Γιώργος Αντωνίου' && /Σύνολο .*€ με ΦΠΑ/.test(sent.text), JSON.stringify(sent));
  // Η δεύτερη: ΦΠΑ 13% όπως ήταν, ακόμα κι αν τώρα η συσκευή έχει άλλον
  await p.goto(BASE); await p.click('#historyOpen'); await p.locator('.q-open[data-no="2"]').click(); await pdfReady(p);
  ok('η προσφορά 2 ανοίγει όπως φτιάχτηκε (ΦΠΑ 13%, «Προς: —»)', await p.textContent('#pdf') === pdf2 && /ΦΠΑ 13%/.test(pdf2) && /Προς: —/.test(pdf2));
  // Αλλαγή στοιχείων από την κεφαλίδα ενώ βλέπει παλιά προσφορά → γυρίζει στην ΙΔΙΑ, όχι σε νέα
  await p.click('#brand'); await p.fill('#pfTrade', 'Υδραυλικός · Θερμοϋδραυλικά'); await p.click('#pfSave');
  await p.waitForSelector('#s-pdf.on'); await pdfReady(p);
  ok('αλλαγή στοιχείων ενώ βλέπει παλιά προσφορά: μένει η ίδια (Αρ. 2, όπως στάλθηκε), χωρίς νέα εγγραφή',
    (await p.textContent('#pdf .qno')).trim() === '2' && await p.textContent('#pdf') === pdf2 && await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes')).length) === 2);
  // Πίσω στη λίστα και σβήσιμο σε δύο πατήματα
  await p.click('#histBack');
  await p.waitForSelector('#s-history.on');
  const del = p.locator('.q-item:has(.q-open[data-no="2"]) [data-a="del"]');
  await del.click();
  ok('σβήσιμο: το πρώτο πάτημα ρωτάει «Σίγουρα;», δεν σβήνει', await del.textContent() === 'Σίγουρα;' && await p.locator('.q-item').count() === 2);
  await del.click();
  ok('σβήσιμο: το δεύτερο σβήνει μόνο αυτή', (await p.$$eval('.q-open', e => e.map(x => x.dataset.no))).join() === '1');
  // Ξανά PDF της ίδιας προσφοράς (αλλαγή στοιχείων πάνω στη νέα) → ενημέρωση, όχι διπλή εγγραφή
  await makeQuote(p, {client: 'Ελένη', text: '2 σιφόνια'});
  await p.click('#brand'); await p.click('#pfSave'); await p.waitForSelector('#s-pdf.on'); await pdfReady(p);
  const nos = await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes')).map(q => q.no));
  ok('ξαναφτιαγμένο PDF της ίδιας προσφοράς: μία εγγραφή, ίδιος αριθμός', nos.join() === '3,1', nos.join());
  // Στενή οθόνη και μεγάλα ονόματα
  await p.setViewportSize({width: 320, height: 640});
  await makeQuote(p, {client: 'Υδραυλικέςεγκαταστάσειςπαπαδημητρόπουλοςκαισυνεργάτεςχωρίςκενά', text: 'μία λεκάνη'});
  await p.goto(BASE); await p.click('#historyOpen');
  ok('320px: η λίστα χωρίς οριζόντια κύλιση', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok('χωρίς σφάλματα JavaScript', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}
{
  // Χαλασμένο ιστορικό: η εφαρμογή ανοίγει, οι καλές εγγραφές φαίνονται
  const p = await page({init: () => { try { localStorage.setItem('ergolav.quotes', '[{"no":1},"σκουπίδια",{"no":"x"}]'); } catch {} }});
  ok('χαλασμένο ιστορικό: καμία εξαίρεση, κανένα κουμπί', p.errs.length === 0 && !(await p.isVisible('#historyOpen')), p.errs.join(' | '));
  await p.context().close();
}
{
  // Η συσκευή δεν αποθηκεύει: το PDF βγαίνει κανονικά και λέει ότι δεν μπήκε στο ιστορικό
  const p = await page({init: () => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v){ if(k === 'ergolav.quotes') throw new DOMException('QuotaExceededError', 'QuotaExceededError'); return set.call(this, k, v); }; }});
  await makeQuote(p, {text: '3 πρίζες'});
  ok('γεμάτη μνήμη: το PDF βγαίνει, με σημείωση «Δεν αποθηκεύτηκε στο ιστορικό»', await p.textContent('#ctaBtn') === 'Στείλε στον πελάτη' && /Δεν αποθηκεύτηκε στο ιστορικό/.test(await p.textContent('#ctaNote')) && p.errs.length === 0);
  await p.context().close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
