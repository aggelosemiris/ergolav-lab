// «Πίσω» πάνω αριστερά: σε κάθε οθόνη εκτός από την αρχική, μία οθόνη πίσω — χωρίς να χαθεί τίποτα.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/back-button.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const ctx = await b.newContext({viewport: {width: 390, height: 844}, acceptDownloads: true});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p.addInitScript(() => { window.SpeechRecognition = window.webkitSpeechRecognition = undefined; });
const screen = () => p.evaluate(() => document.querySelector('.screen.on')?.id);
const backShown = () => p.isVisible('#navBack');
const back = async () => { await p.click('#navBack'); await p.waitForTimeout(150); };
const type = t => p.evaluate(t => { const el = document.getElementById('transcript'); el.textContent = t; el.dispatchEvent(new Event('input', {bubbles: true})); }, t);
const qtyOf = name => p.locator('#lines .ln').filter({has: p.locator('.ln-name', {hasText: name})}).locator('[data-a="qty-edit"]').textContent();
const pdfReady = () => p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
let dialogs = 0, answer = false;
p.on('dialog', d => { dialogs++; answer ? d.accept() : d.dismiss(); });

try {
  // ── Πρώτη φορά: φόρμα στοιχείων — δεν υπάρχει πού να γυρίσει
  await p.goto(BASE); await p.waitForSelector('#s-profile.on');
  ok('πρώτη φορά (στοιχεία): χωρίς «Πίσω»', !(await backShown()));
  await p.fill('#pfName', 'Νίκος Παπαδάκης'); await p.click('#pfSave'); await p.waitForSelector('#s-start.on');
  ok('αρχική: χωρίς «Πίσω»', !(await backShown()));

  // ── Κείμενο → αρχική
  await p.click('#mic'); await p.waitForSelector('#s-listen.on');
  ok('κείμενο: «Πίσω» πάνω αριστερά, πριν από το λογότυπο', await backShown() && await p.evaluate(() => {
    const a = document.getElementById('navBack').getBoundingClientRect(), b = document.getElementById('brand').getBoundingClientRect();
    return a.left < 40 && a.top < 40 && a.right <= b.left; }));
  await back();
  ok('άδειο κείμενο → «Πίσω» → αρχική, χωρίς ερώτηση', await screen() === 's-start' && dialogs === 0);
  await p.click('#mic'); await p.waitForSelector('#s-listen.on'); await type('3 πρίζες και 12 μέτρα σωλήνα');
  await back();
  ok('με κείμενο → ρωτά πριν το σβήσει· «Άκυρο» → μένει, το κείμενο ίδιο', dialogs === 1 && await screen() === 's-listen' && (await p.textContent('#transcript')) === '3 πρίζες και 12 μέτρα σωλήνα');

  // ── Έλεγχος ↔ κείμενο: οι αλλαγές μένουν
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.locator('#lines .ln').filter({has: p.locator('.ln-name', {hasText: 'Πρίζα'})}).locator('[data-d="1"]').click();
  ok('έλεγχος: πρίζες 3 → 4', /4 τεμ\./.test(await qtyOf('Πρίζα')));
  await back();
  ok('έλεγχος → «Πίσω» → το κείμενο', await screen() === 's-listen' && (await p.textContent('#transcript')).includes('12 μέτρα σωλήνα'));
  await back();
  ok('κείμενο (ήρθε από τον έλεγχο) → «Πίσω» → η αρχική με το μικρόφωνο, χωρίς ερώτηση (όχι ξανά ο έλεγχος)', await screen() === 's-start' && dialogs === 1);
  await p.click('#mic'); await p.waitForSelector('#s-listen.on'); await type('3 πρίζες και 12 μέτρα σωλήνα');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.locator('#lines .ln').filter({has: p.locator('.ln-name', {hasText: 'Πρίζα'})}).locator('[data-d="1"]').click();

  // ── PDF ↔ έλεγχος: ίδιος αριθμός, ίδιες αλλαγές
  await p.waitForFunction(() => !document.getElementById('ctaBtn').disabled);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on'); await pdfReady();
  const no = (await p.textContent('#pdf .qno')).trim();
  await back();
  ok('PDF → «Πίσω» → ο έλεγχος, με τις αλλαγές', await screen() === 's-lines' && /4 τεμ\./.test(await qtyOf('Πρίζα')));
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on'); await pdfReady();
  ok('ξανά PDF: ίδιος αριθμός προσφοράς, μία εγγραφή στο ιστορικό', (await p.textContent('#pdf .qno')).trim() === no &&
    await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes')).length) === 1);

  // ── Στοιχεία από την κεφαλίδα → «Πίσω» → εκεί που ήταν, χωρίς αποθήκευση
  await p.click('#brand'); await p.waitForSelector('#s-profile.on');
  await p.fill('#pfName', 'Άλλο όνομα');
  await back(); await pdfReady();
  ok('στοιχεία → «Πίσω» → πίσω στο PDF, οι αλλαγές της φόρμας δεν αποθηκεύτηκαν', await screen() === 's-pdf' &&
    JSON.parse(await p.evaluate(() => localStorage.getItem('ergolav.profile'))).name === 'Νίκος Παπαδάκης');

  // ── Ανάλυση εργασιών → «Πίσω» → PDF
  if(await p.isVisible('#anOpen')){
    await p.waitForTimeout(800);   // η εφαρμογή αγνοεί πάτημα < 0,7″ μετά την προεπισκόπηση (διπλό πάτημα)
    await p.click('#anOpen'); await p.waitForSelector('#s-analysis.on');
    await back();
    ok('ανάλυση εργασιών → «Πίσω» → το PDF', await screen() === 's-pdf' && /^Στείλε/.test(await p.textContent('#ctaBtn')));
  }

  // ── Στάλθηκε → «Πίσω» → PDF
  await p.evaluate(() => Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => false}));
  await p.click('#ctaBtn'); await p.waitForSelector('#sheet.on');
  const dl = p.waitForEvent('download'); await p.click('[data-send="download"]'); await dl;
  await p.waitForSelector('#s-done.on');
  await back();
  ok('«Τα PDF κατέβηκαν» → «Πίσω» → το PDF, με «Στείλε…» (και η ανάλυση που είχε μπει)', await screen() === 's-pdf' && (await p.textContent('#pdf .qno')).trim() === no &&
    /^Στείλε (στον πελάτη|και τα δύο PDF)$/.test(await p.textContent('#ctaBtn')) && !(await p.isVisible('#histBack')), `${await screen()} · ${await p.textContent('#ctaBtn')}`);

  // ── Μετά την αποστολή: PDF → έλεγχος → κείμενο → αρχική = ΝΕΑ προσφορά (η σταλμένη δεν πειράζεται)
  await back(); await back();
  ok('PDF → έλεγχος → κείμενο', await screen() === 's-listen');
  await back(); await p.waitForSelector('#s-start.on');
  ok('κείμενο → «Πίσω» → αρχική (νέα προσφορά): άδειος πελάτης, χωρίς ερώτηση', await screen() === 's-start' && await p.inputValue('#client') === '' && dialogs === 1);
  await p.click('#mic'); await p.waitForSelector('#s-listen.on'); await type('δύο λεκάνες');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.waitForFunction(() => !document.getElementById('ctaBtn').disabled);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on'); await pdfReady();
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes')));
  ok('η νέα προσφορά παίρνει νέο αριθμό· η σταλμένη μένει ίδια στο ιστορικό', (await p.textContent('#pdf .qno')).trim() === String(+no + 1) && stored.length === 2 &&
    stored.find(q => q.no === +no).status === 'sent' && stored.find(q => q.no === +no).rows.some(r => /Πρίζα/.test(r.name)), JSON.stringify(stored.map(q => [q.no, q.status])));

  // ── Ημερολόγιο / Προσφορές
  await p.goto(BASE); await p.waitForSelector('#s-start.on');
  await p.click('#historyOpen'); await p.waitForSelector('#s-history.on');
  await back();
  ok('Ημερολόγιο → «Πίσω» → αρχική, με τα δύο κουμπιά', await screen() === 's-start' && await p.isVisible('#quotesOpen') && !(await backShown()));
  await p.click('#quotesOpen'); await p.waitForSelector('#s-history.on');
  await p.locator('#calList .q-open').first().click(); await p.waitForSelector('#s-pdf.on');
  await back();
  ok('PDF από τις Προσφορές → «Πίσω» → οι Προσφορές (λίστα)', await screen() === 's-history' && await p.isVisible('#calList') && await p.textContent('#calH1') === 'Προσφορές');
  await back();
  ok('Προσφορές → «Πίσω» → αρχική', await screen() === 's-start');

  // ── Κείμενο με «OK» στην ερώτηση → αρχική
  await p.click('#mic'); await p.waitForSelector('#s-listen.on'); await type('δύο λεκάνες');
  answer = true; await back();
  ok('«OK» στην ερώτηση → αρχική', await screen() === 's-start');

  // ── Στενή οθόνη
  await p.setViewportSize({width: 320, height: 700});
  await p.click('#historyOpen'); await p.waitForSelector('#s-history.on');
  ok('320px: «Πίσω», λογότυπο και τίτλος χωράνε, χωρίς οριζόντια κύλιση', await backShown() && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok('χωρίς σφάλματα JavaScript', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
