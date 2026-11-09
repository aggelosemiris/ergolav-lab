// Ημερολόγιο προσφορών: «Πότε πας;» στη νέα προσφορά → η προσφορά στη σωστή μέρα, «Χωρίς ημερομηνία», αλλαγή
// ημερομηνίας και κατάστασης, μήνας/λίστα, πολυήμερες, παλιές προσφορές (ημ. δημιουργίας), κενή κατάσταση, 360px,
// 500 προσφορές, χωρίς σύνδεση, σκούρο θέμα, και η ροή μέχρι το Viber όπως πριν.
// Το «σήμερα» του browser είναι σταθερό (Κυριακή 8/11/2026, ώρα Ελλάδας), ώστε το τεστ να περνά όποια μέρα κι αν τρέξει.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/calendar.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const NOW = new Date('2026-11-08T10:00:00Z');      // Κυριακή 8 Νοεμβρίου 2026, 12:00 στην Ελλάδα
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const PROFILE = {name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'};

// Προσφορά όπως την αποθηκεύει η εφαρμογή (για γέμισμα του ιστορικού).
const mk = (no, client, sched, extra = {}) => ({no, at: Date.parse('2026-11-01T10:00:00Z') + no * 60e3, title: 'ανακαίνιση μπάνιου', client,
  rows: [{name: 'Λεκάνη κρεμαστή', qty: 1, unit: 'τεμ.', mat: 10000}], sum: {mat: 10000, lab: 5000, net: 15000, vat: 3600, total: 18600 + no},
  vatRate: 24, profile: PROFILE, ...sched, ...extra});
const S = (scheduled_date, scheduled_time = null, duration_days = 1, status = 'sent') => ({scheduled_date, scheduled_time, duration_days, status});

async function page({quotes = null, width = 390, height = 844, scheme = 'light', at = NOW, mobile = false} = {}){
  const ctx = await b.newContext({viewport: {width, height}, colorScheme: scheme, acceptDownloads: true, ...(mobile && {isMobile: true, hasTouch: true})});
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.clock.setFixedTime(at);
  // Χωρίς αναγνώριση φωνής: το μικρόφωνο ανοίγει κατευθείαν το κείμενο για γράψιμο. Το showPicker() μετριέται
  // (window.picks) αντί να ανοίγει τον επιλογέα του browser.
  await p.addInitScript(({profile, quotes}) => {
    window.SpeechRecognition = window.webkitSpeechRecognition = undefined;
    window.picks = [];
    HTMLInputElement.prototype.showPicker = function(){ window.picks.push(this.type); };
    if(sessionStorage.seeded) return;
    sessionStorage.seeded = '1';
    localStorage.clear();
    localStorage.setItem('ergolav.profile', JSON.stringify(profile));
    if(quotes){ localStorage.setItem('ergolav.quotes', JSON.stringify(quotes)); localStorage.setItem('ergolav.quoteNo', String(Math.max(0, ...quotes.map(q => q.no)))); }
  }, {profile: PROFILE, quotes});
  await p.goto(BASE);
  await p.waitForSelector('#s-start.on');
  return p;
}
// Νέα προσφορά μέχρι την προεπισκόπηση PDF· pick(): ό,τι κάνει στο «Πότε πας;» πριν μιλήσει.
async function makeQuote(p, {client = '', text, pick, nav = true, afterMic} = {}){
  if(nav){ await p.goto(BASE); await p.waitForSelector('#s-start.on'); }
  if(client) await p.fill('#client', client);
  if(pick) await pick();
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  if(afterMic) await afterMic();
  await p.evaluate(t => { const el = document.getElementById('transcript'); el.textContent = t; el.dispatchEvent(new Event('input', {bubbles: true})); }, text);
  await p.waitForFunction(() => { const b = document.getElementById('ctaBtn'); return b.textContent === 'Βγάλε τιμές' && !b.disabled; });
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.waitForFunction(() => !document.getElementById('ctaBtn').disabled);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
}
// «Άλλη μέρα»: ο επιλογέας του κινητού δεν ανοίγει σε headless browser — η ημερομηνία μπαίνει στο πεδίο όπως θα την
// έβαζε εκείνος (το πάτημα πάνω στο κουμπί ελέγχεται χωριστά, στην ενότητα «Άλλη μέρα με το δάχτυλο»).
async function otherDay(p, scope, date){
  await p.evaluate(([scope, date]) => { const i = document.querySelector(`${scope} [data-p="date"]`); i.value = date; i.dispatchEvent(new Event('change', {bubbles: true})); }, [scope, date]);
}
const stored = p => p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes') || '[]'));
const byNo = async (p, no) => (await stored(p)).find(q => q.no === no);
const openCal = async p => { await p.goto(BASE); await p.click('#historyOpen'); await p.waitForSelector('#s-history.on'); };
const dayNos = p => p.$$eval('#calDay .q-open', els => els.map(e => +e.dataset.no));
const dots = (p, day) => p.$$eval(`[data-day="${day}"] .dot`, els => els.map(e => e.className.replace('dot ', '')));
const shareMock = (p, can) => p.evaluate(can => {
  window.shared = null;
  Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => can});
  Object.defineProperty(navigator, 'share', {configurable: true, value: async d => { window.shared = d.files.map(f => f.name); }});
}, can);

// ── 0. «Σήμερα» στην οθόνη γύρω από τα μεσάνυχτα και την αλλαγή ώρας (τελευταία Κυριακή Οκτωβρίου 2026) ──
{
  const p = await page({at: new Date('2026-10-24T20:59:30Z')});          // Σάββατο 23:59:30 Ελλάδας (θερινή ώρα, UTC+3)
  const label = () => p.textContent('#when [data-o="date"]');
  const wake = () => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  ok('Σάββατο 23:59: «Σήμερα» = Σάββατο 24 Οκτωβρίου, ήδη επιλεγμένο', await label() === 'Σάββατο 24 Οκτωβρίου' && await p.getAttribute('#when [data-w="today"]', 'aria-pressed') === 'true');
  await p.clock.setFixedTime(new Date('2026-10-24T21:00:30Z')); await wake();   // Κυριακή 00:00:30
  ok('μετά τα μεσάνυχτα (χωρίς ανανέωση σελίδας): Κυριακή 25 Οκτωβρίου', await label() === 'Κυριακή 25 Οκτωβρίου', await label());
  await p.click('#when [data-w="tomorrow"]');
  const tomorrow = await label();
  await p.click('#when [data-w="after"]');
  ok('την Κυριακή της αλλαγής ώρας: Αύριο = Δευτέρα 26, Μεθαύριο = Τρίτη 27', tomorrow === 'Δευτέρα 26 Οκτωβρίου' && await label() === 'Τρίτη 27 Οκτωβρίου');
  await p.click('#when [data-w="today"]');
  // Μόλις φύγει από την αρχική, η μέρα «παγώνει»: αποθηκεύεται αυτή που είδε, ακόμα κι αν περάσουν άλλα μεσάνυχτα.
  await makeQuote(p, {nav: false, text: 'λεκάνη κρεμαστή', afterMic: async () => { await p.clock.setFixedTime(new Date('2026-10-25T22:30:00Z')); await wake(); }});
  ok('αποθηκεύεται η μέρα που έδειχνε η οθόνη (25/10), όχι η επόμενη', (await byNo(p, 1)).scheduled_date === '2026-10-25');
  ok('χωρίς σφάλματα JavaScript', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}

// ── 0β. «Άλλη μέρα» με το δάχτυλο (κινητό) και με ποντίκι (υπολογιστής) ──
// Στο κινητό το πάτημα πρέπει να πέφτει ΠΑΝΩ στο πεδίο ημερομηνίας (ο επιλογέας του iPhone/Android ανοίγει από το ίδιο
// το πάτημα· το showPicker() στο iPhone δεν κάνει τίποτα). Στον υπολογιστή, κλικ → showPicker().
const hitAt = (p, chip) => p.evaluate(sel => { const c = document.querySelector(sel); c.scrollIntoView({block: 'center'}); const r = c.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el?.matches('input[type="date"]') ? (el.dataset.p || 'pick:' + el.dataset.pick) : el?.outerHTML.slice(0, 60); }, chip);
{
  const p = await page({mobile: true, quotes: [mk(1, 'Χωρίς μέρα, Ψυχικό', S(null)), mk(2, 'Με μέρα', S('2026-11-08'))]});
  ok('κινητό: το «Άλλη μέρα» της νέας προσφοράς είναι το ίδιο το πεδίο ημερομηνίας', await hitAt(p, '#when .wchip-wrap') === 'date');
  await p.tap('#when [data-p="date"]');
  ok('κινητό: το πάτημα ενεργοποιεί το πεδίο (ανοίγει ο επιλογέας του κινητού)', await p.evaluate(() => document.activeElement?.dataset.p) === 'date');
  await p.evaluate(() => { const i = document.querySelector('#when [data-p="date"]'); i.value = '2026-11-19'; i.dispatchEvent(new Event('input', {bubbles: true})); });
  ok('κινητό: η μέρα που διάλεξε φαίνεται ολογράφως και το «Άλλη μέρα» μένει επιλεγμένο', await p.textContent('#when [data-o="date"]') === 'Πέμπτη 19 Νοεμβρίου' &&
    await p.getAttribute('#when [data-w="other"]', 'aria-pressed') === 'true');
  await p.tap('#when [data-a="time"]');
  ok('κινητό: «+ ώρα» → το πεδίο ώρας φαίνεται και ενεργοποιείται', await p.isVisible('#when [data-p="time"]') && await p.evaluate(() => document.activeElement?.dataset.p) === 'time');
  await p.tap('#historyOpen');
  ok('κινητό: το «Άλλη μέρα» στο «Χωρίς ημερομηνία» είναι το πεδίο ημερομηνίας', await hitAt(p, '#calUndated .wchip-wrap') === 'pick:1');
  await p.tap('#calUndated [data-pick="1"]');
  await p.evaluate(() => { const i = document.querySelector('#calUndated [data-pick="1"]'); i.value = '2026-11-12'; i.dispatchEvent(new Event('change', {bubbles: true})); });
  ok('κινητό: η μέρα μπαίνει και η προσφορά πάει στο ημερολόγιο (12/11)', (await byNo(p, 1)).scheduled_date === '2026-11-12' && await p.getAttribute('.cal-d.sel', 'data-day') === '2026-11-12');
  await p.tap('[data-day="2026-11-08"]'); await p.tap('.q-item:has(.q-open[data-no="2"]) [data-a="date"]'); await p.waitForSelector('#calSheet.on'); await p.waitForTimeout(300);
  ok('κινητό: και στο «Άλλαξε ημερομηνία»', await hitAt(p, '#calSheet .wchip-wrap') === 'date');
  ok('χωρίς σφάλματα JavaScript', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}
{
  const p = await page();
  await p.click('#when [data-p="date"]');
  ok('υπολογιστής: κλικ στο «Άλλη μέρα» ανοίγει τον επιλογέα (showPicker)', (await p.evaluate(() => window.picks)).join() === 'date');
  await p.click('#when [data-a="time"]');
  ok('υπολογιστής: «+ ώρα» ανοίγει τον επιλογέα ώρας', (await p.evaluate(() => window.picks)).join() === 'date,time');
  await p.context().close();
}

// ── 1. Νέες προσφορές από την αρχή ──
{
  const p = await page();
  // Χωρίς να αγγίξει την ημερομηνία
  await makeQuote(p, {client: 'Γιώργος Αντωνίου, Χαλάνδρι', text: 'τρεις πρίζες και 12 μέτρα σωλήνα'});
  let q = await byNo(p, 1);
  ok('νέα προσφορά χωρίς άγγιγμα: σήμερα (2026-11-08), χωρίς ώρα, 1 μέρα, «Πρόχειρη»', q.scheduled_date === '2026-11-08' && q.scheduled_time === null && q.duration_days === 1 && q.status === 'draft', JSON.stringify(q).slice(-110));
  // Η ροή μέχρι το Viber, όπως πριν (browser χωρίς κοινοποίηση αρχείων → φύλλο αποστολής)
  await shareMock(p, false);
  await p.click('#ctaBtn'); await p.waitForSelector('#sheet.on');
  const dl = p.waitForEvent('download');
  await p.click('[data-send="viber"]');
  const file = await dl;
  await p.waitForSelector('#s-done.on');
  ok('Viber: το PDF κατεβαίνει, «Το PDF κατέβηκε», ίδια ροή με πριν', /^Prosfora-1-Giorgos/.test(file.suggestedFilename()) && await p.textContent('#doneTitle') === 'Το PDF κατέβηκε', file.suggestedFilename());
  ok('μετά την αποστολή: «Στάλθηκε»', (await byNo(p, 1)).status === 'sent');
  await openCal(p);
  ok('«📅 Ημερολόγιο (1)» → ανοίγει στον Νοέμβριο, σήμερα τονισμένη και επιλεγμένη', await p.textContent('#calTitle') === 'Νοέμβριος 2026' &&
    await p.getAttribute('.cal-d.today', 'data-day') === '2026-11-08' && await p.getAttribute('.cal-d.sel', 'data-day') === '2026-11-08');
  ok('η προσφορά εμφανίζεται σήμερα: κουκκίδα «Στάλθηκε» και στη λίστα της ημέρας', (await dots(p, '2026-11-08')).join() === 'st-sent' && (await dayNos(p)).join() === '1' &&
    /Γιώργος Αντωνίου/.test(await p.textContent('#calDay')) && /Χαλάνδρι/.test(await p.textContent('#calDay')));

  // «Άλλη μέρα» με ώρα και διάρκεια
  await makeQuote(p, {client: 'Μαρία, Κηφισιά', text: 'λεκάνη κρεμαστή', pick: async () => {
    await otherDay(p, '#when', '2026-11-20');
    await p.click('#when [data-a="time"]'); await p.fill('#when [data-p="time"]', '08:30');
    await p.click('#when [data-a="days"]'); await p.click('#when [data-d="2"]');
  }});
  q = await byNo(p, 2);
  ok('«Άλλη μέρα» 20/11, 08:30, 2 μέρες → αποθηκεύεται ακριβώς', q.scheduled_date === '2026-11-20' && q.scheduled_time === '08:30' && q.duration_days === 2);
  await openCal(p);
  await p.click('[data-day="2026-11-20"]');
  ok('εμφανίζεται στη σωστή μέρα (και στη 2η μέρα της), όχι σήμερα', (await dayNos(p)).join() === '2' && (await dots(p, '2026-11-21')).length === 1 &&
    !(await dots(p, '2026-11-08')).includes('st-draft') && /08:30/.test(await p.textContent('#calDay')) && /μέρα 1 από 2/.test(await p.textContent('#calDay')));
  await p.click('[data-day="2026-11-21"]');
  ok('2η μέρα: «μέρα 2 από 2», χωρίς την ώρα της πρώτης', /μέρα 2 από 2/.test(await p.textContent('#calDay')) && !/08:30/.test(await p.textContent('#calDay')));

  // «Δεν ξέρω ακόμα» → «Χωρίς ημερομηνία» → ορίζεται με ένα πάτημα → μετακινείται στο ημερολόγιο
  await makeQuote(p, {client: 'Κώστας', text: '2 σιφόνια', pick: () => p.click('#when [data-w="none"]')});
  ok('«Δεν ξέρω ακόμα» → scheduled_date null', (await byNo(p, 3)).scheduled_date === null);
  await openCal(p);
  ok('εμφανίζεται στο «Χωρίς ημερομηνία (1)», σε καμία μέρα', /Χωρίς ημερομηνία \(1\)/.test(await p.textContent('#calUndated')) &&
    await p.locator('#calUndated .q-open[data-no="3"]').count() === 1 && await p.locator('#calGrid .dot').count() === 3);
  await p.click('#calUndated [data-quick="1"][data-no="3"]');
  ok('«Αύριο» με ένα πάτημα: φεύγει από το «Χωρίς ημερομηνία», μπαίνει Δευτέρα 9/11 και φαίνεται εκεί',
    await p.isHidden('#calUndated') && (await byNo(p, 3)).scheduled_date === '2026-11-09' && await p.getAttribute('.cal-d.sel', 'data-day') === '2026-11-09' &&
    (await dayNos(p)).join() === '3' && /Μπήκε Δευτέρα 9 Νοεμβρίου/.test(await p.textContent('#calMsg')));

  // Αλλαγή ημερομηνίας από το ημερολόγιο (ίδια φόρμα με τη νέα προσφορά): σε άλλον μήνα, 3 μέρες
  await p.click('.q-item:has(.q-open[data-no="3"]) [data-a="date"]');
  await p.waitForSelector('#calSheet.on');
  ok('«Άλλαξε ημερομηνία»: ίδια chips με τη νέα προσφορά, με επιλεγμένο το «Αύριο»', await p.getAttribute('#calSheet [data-w="tomorrow"]', 'aria-pressed') === 'true' &&
    (await p.$$eval('#calSheet [data-w]', e => e.map(x => x.textContent))).join() === 'Σήμερα,Αύριο,Μεθαύριο,Άλλη μέρα,Δεν ξέρω ακόμα');
  await otherDay(p, '#calSheet', '2026-11-30');
  await p.click('#calSheet [data-a="days"]'); await p.click('#calSheet [data-d="3"]');
  await p.click('#calSheet [data-a="save"]');
  q = await byNo(p, 3);
  ok('αποθηκεύεται (30/11, 3 μέρες) και το ημερολόγιο πάει εκεί', q.scheduled_date === '2026-11-30' && q.duration_days === 3 && !(await p.isVisible('#calSheet.on')) &&
    await p.getAttribute('.cal-d.sel', 'data-day') === '2026-11-30');
  ok('πολυήμερη που περνά σε επόμενο μήνα: κουκκίδες 30/11, 1/12, 2/12 στο πλέγμα του Νοεμβρίου',
    (await dots(p, '2026-11-30')).length === 1 && (await dots(p, '2026-12-01')).length === 1 && (await dots(p, '2026-12-02')).length === 1 && (await dots(p, '2026-12-03')).length === 0);
  await p.click('[data-a="next"]');
  ok('και στον Δεκέμβριο (1/12, 2/12)', await p.textContent('#calTitle') === 'Δεκέμβριος 2026' && (await dots(p, '2026-12-01')).length === 1 && (await dots(p, '2026-12-02')).length === 1);
  await p.click('[data-day="2026-12-02"]');
  ok('2/12: «μέρα 3 από 3»', /μέρα 3 από 3/.test(await p.textContent('#calDay')));

  // Αλλαγή κατάστασης
  await p.click('.q-item:has(.q-open[data-no="3"]) [data-a="status"]');
  await p.waitForSelector('#calSheet.on');
  ok('«Άλλαξε κατάσταση»: Στάλθηκε / Κλείστηκε / Χάθηκε', (await p.$$eval('#calSheet [data-set]', e => e.map(x => x.textContent.trim()))).join() === 'Στάλθηκε,Κλείστηκε,Χάθηκε');
  await p.click('#calSheet [data-set="won"]');
  ok('«Κλείστηκε» → αποθηκεύεται, πράσινη κουκκίδα σε όλες τις μέρες της', (await byNo(p, 3)).status === 'won' && (await dots(p, '2026-12-01')).join() === 'st-won' && (await dots(p, '2026-12-02')).join() === 'st-won');

  // Άνοιγμα του ίδιου PDF από το ημερολόγιο, «Στείλε ξανά», πίσω εκεί που ήταν
  await p.click('#calDay .q-open[data-no="3"]');
  await p.waitForSelector('#s-pdf.on');
  await p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Στείλε ξανά στον πελάτη', null, {timeout: 60000});
  ok('πάτημα στην προσφορά → το ίδιο PDF, «Στείλε ξανά στον πελάτη», «← Ημερολόγιο»', (await p.textContent('#pdf .qno')).trim() === '3' && await p.isVisible('#histBack') &&
    await p.textContent('#histBack') === '← Ημερολόγιο');
  ok('το PDF δεν γράφει την ημερομηνία της δουλειάς', !/30\/11|Δευτέρα 30|Πότε/.test(await p.textContent('#pdf')));
  await shareMock(p, true);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-done.on');
  ok('ξαναστάλθηκε: η κατάσταση «Κλείστηκε» μένει', (await byNo(p, 3)).status === 'won' && (await p.evaluate(() => window.shared))?.[0]?.startsWith('Prosfora-3-'));
  await p.goto(BASE); await p.click('#historyOpen'); await p.click('[data-a="next"]'); await p.click('[data-day="2026-12-02"]');
  await p.click('#calDay .q-open[data-no="3"]'); await p.waitForSelector('#s-pdf.on');
  await p.click('#histBack'); await p.waitForSelector('#s-history.on');
  ok('«← Ημερολόγιο»: πίσω στον ίδιο μήνα και μέρα', await p.textContent('#calTitle') === 'Δεκέμβριος 2026' && await p.getAttribute('.cal-d.sel', 'data-day') === '2026-12-02');

  // Σβήσιμο σε δύο πατήματα
  const del = p.locator('.q-item:has(.q-open[data-no="3"]) [data-a="del"]');
  await del.click();
  ok('σβήσιμο: το πρώτο πάτημα ρωτάει «Σίγουρα;»', await del.textContent() === 'Σίγουρα;' && (await stored(p)).length === 3);
  await del.click();
  ok('σβήσιμο: το δεύτερο σβήνει μόνο αυτή', (await stored(p)).map(q => q.no).join() === '2,1' && /σβήστηκε/.test(await p.textContent('#calMsg')));
  ok('χωρίς σφάλματα JavaScript', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}

// ── 2. Γεμάτο ιστορικό: πλέγμα, κουκκίδες, παλιές προσφορές, πλοήγηση, λίστα ──
const SEED = [
  mk(1, 'Α1, Χαλάνδρι', S('2026-11-10', '17:30', 1, 'lost')), mk(2, 'Α2', S('2026-11-10', '08:00', 1, 'won')), mk(3, 'Α3', S('2026-11-10')),
  mk(4, 'Α4', S('2026-11-10', null, 1, 'draft')), mk(5, 'Α5', S('2026-11-10')),
  mk(6, 'Πολυήμερη, Κηφισιά', S('2026-11-29', '09:00', 4, 'won')),
  mk(7, 'Παλιά Οκτωβρίου', S('2026-10-02')), mk(8, 'Χωρίς μέρα', S(null)),
  // Παλιά προσφορά από την προηγούμενη έκδοση (χωρίς τα νέα πεδία): μετάπτωση στο άνοιγμα
  (({scheduled_date, scheduled_time, duration_days, status, ...q}) => ({...q, at: Date.parse('2026-11-04T23:30:00Z')}))(mk(9, 'Παλιός πελάτης, Βύρωνας', S(null))),
];
{
  const p = await page({quotes: SEED});
  ok('παλιά προσφορά: μετάπτωση με αντίγραφο στο άνοιγμα', await p.evaluate(() => !!localStorage.getItem('ergolav.quotes.backup.2026-11-08')) && (await byNo(p, 9)).scheduled_from_created === true);
  await p.click('#historyOpen');
  ok('πλέγμα: ξεκινά Δευτέρα (26/10), ελληνικές μέρες, «Νοέμβριος 2026»', await p.getAttribute('.cal-d >> nth=0', 'data-day') === '2026-10-26' &&
    (await p.$$eval('.cal-wd', e => e.map(x => x.textContent))).join() === 'Δευ,Τρί,Τετ,Πέμ,Παρ,Σάβ,Κυρ' && await p.textContent('#calTitle') === 'Νοέμβριος 2026');
  ok('5 προσφορές την ίδια μέρα: 3 κουκκίδες και «+2», με τα χρώματα της κατάστασης', (await dots(p, '2026-11-10')).join() === 'st-won,st-lost,st-sent' &&
    await p.textContent('[data-day="2026-11-10"] small') === '+2');
  await p.click('[data-day="2026-11-10"]');
  ok('λίστα ημέρας: πρώτα με ώρα (08:00, 17:30), μετά οι υπόλοιπες· όλες οι 5', (await dayNos(p)).join() === '2,1,3,4,5' && /Χαλάνδρι/.test(await p.textContent('#calDay')));
  ok('παλιά προσφορά στη μέρα δημιουργίας (ώρα Ελλάδας: 23:30 UTC της 4/11 = 5/11), αχνή, «ημ. δημιουργίας»',
    (await dots(p, '2026-11-05')).join() === 'st-sent faint' && (await dots(p, '2026-11-04')).length === 0 &&
    await (async () => { await p.click('[data-day="2026-11-05"]'); return /ημ\. δημιουργίας/.test(await p.textContent('#calDay')) && await p.locator('#calDay .cal-q.faint').count() === 1; })());
  ok('«Χωρίς ημερομηνία (1)» κάτω από το ημερολόγιο', /Χωρίς ημερομηνία \(1\)/.test(await p.textContent('#calUndated')));
  await p.click('[data-a="prev"]');
  ok('‹: Οκτώβριος 2026, ανοίγει η πρώτη μέρα με προσφορά (2/10)', await p.textContent('#calTitle') === 'Οκτώβριος 2026' && await p.getAttribute('.cal-d.sel', 'data-day') === '2026-10-02');
  // Οριζόντιο swipe στο πλέγμα (δάχτυλο από δεξιά προς τα αριστερά = επόμενος μήνας)
  const swipe = (x0, x1) => p.evaluate(([x0, x1]) => { const g = document.getElementById('calGrid'), y = g.getBoundingClientRect().top + 120;
    g.dispatchEvent(new PointerEvent('pointerdown', {clientX: x0, clientY: y, bubbles: true, pointerType: 'touch'}));
    g.dispatchEvent(new PointerEvent('pointerup', {clientX: x1, clientY: y + 10, bubbles: true, pointerType: 'touch'})); }, [x0, x1]);
  await swipe(320, 80); await swipe(320, 80);
  ok('swipe αριστερά ×2: Δεκέμβριος 2026', await p.textContent('#calTitle') === 'Δεκέμβριος 2026');
  await swipe(80, 320);
  ok('swipe δεξιά: Νοέμβριος 2026', await p.textContent('#calTitle') === 'Νοέμβριος 2026');
  await p.click('[data-a="next"]'); await p.click('[data-a="next"]');
  await p.click('[data-a="today"]');
  ok('«Σήμερα»: πίσω στον Νοέμβριο, επιλεγμένη η 8/11', await p.textContent('#calTitle') === 'Νοέμβριος 2026' && await p.getAttribute('.cal-d.sel', 'data-day') === '2026-11-08');
  // Λίστα
  await p.click('[data-view="list"]');
  const order = await p.$$eval('#calList .q-open', e => e.map(x => +x.dataset.no));
  ok('Λίστα: πρώτα οι επόμενες (10/11 με τη σειρά της μέρας, 29/11), μετά οι προηγούμενες (5/11, 2/10)', order.join() === '2,1,3,4,5,6,9,7', order.join());
  ok('Λίστα: «Επόμενες (6)», «Προηγούμενες (2)», ανά μέρα', /Επόμενες \(6\)/.test(await p.textContent('#calList')) && /Προηγούμενες \(2\)/.test(await p.textContent('#calList')) &&
    (await p.$$eval('.cal-lh', e => e.map(x => x.textContent))).join('|') === 'Τρίτη 10 Νοεμβρίου|Κυριακή 29 Νοεμβρίου|Πέμπτη 5 Νοεμβρίου|Παρασκευή 2 Οκτωβρίου');
  await p.reload(); await p.click('#historyOpen');
  ok('η Λίστα μένει επιλεγμένη και στο επόμενο άνοιγμα', await p.isVisible('#calList') && !(await p.isVisible('#calMonth')));
  await p.click('[data-view="month"]');
  // Χωρίς σύνδεση: όλα τοπικά
  await p.context().setOffline(true);
  await p.click('[data-a="next"]'); await p.click('[data-day="2026-12-01"]');
  await p.click('.q-item:has(.q-open[data-no="6"]) [data-a="status"]'); await p.click('#calSheet [data-set="lost"]');
  ok('χωρίς σύνδεση: πλοήγηση και αλλαγή κατάστασης δουλεύουν', (await byNo(p, 6)).status === 'lost' && (await dots(p, '2026-12-01')).join() === 'st-lost');
  await p.context().setOffline(false);
  ok('χωρίς σφάλματα JavaScript', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}

// ── 3. Κενή κατάσταση ──
{
  const p = await page({quotes: [mk(1, 'Μόνη', S('2026-11-08'))]});
  await p.click('#historyOpen');
  const del = p.locator('[data-a="del"]'); await del.click(); await del.click();
  ok('καμία προσφορά: «Δεν έχεις προσφορές ακόμα» και «Νέα προσφορά»', await p.isVisible('#calEmpty') && /Δεν έχεις προσφορές ακόμα/.test(await p.textContent('#calEmpty')) &&
    !(await p.isVisible('#calMonth')) && !(await p.isVisible('#calViews')));
  await p.click('#calEmpty [data-a="new"]'); await p.waitForSelector('#s-start.on');
  ok('«Νέα προσφορά» → αρχική οθόνη, χωρίς κουμπί ημερολογίου', !(await p.isVisible('#historyOpen')));
  await p.context().close();
}

// ── 4. Κινητό 360px και 320px, στόχοι αφής ──
for(const width of [360, 320]){
  const p = await page({quotes: SEED, width});
  await p.click('#historyOpen'); await p.click('[data-day="2026-11-10"]');
  const m = await p.evaluate(() => ({over: document.documentElement.scrollWidth - innerWidth,
    cellW: Math.min(...[...document.querySelectorAll('.cal-d')].map(e => e.getBoundingClientRect().width)),
    small: [...document.querySelectorAll('#s-history button')].filter(e => e.getClientRects().length && e.getBoundingClientRect().height < 44).map(e => e.textContent.trim().slice(0, 12))}));
  ok(`${width}px: χωρίς οριζόντια κύλιση, κάθε κουμπί ≥ 44px ύψος${width === 360 ? ', κάθε μέρα ≥ 44px πλάτος' : ''}`, m.over <= 0 && !m.small.length && (width === 320 || m.cellW >= 44), JSON.stringify(m));
  await p.context().close();
}

// ── 5. 500 προσφορές: ο μήνας ανοίγει χωρίς ορατή καθυστέρηση ──
{
  const many = Array.from({length: 500}, (_, i) => mk(i + 1, `Πελάτης ${i}, Περιοχή ${i % 30}`,
    S(i % 25 ? `2026-${String(1 + i % 12).padStart(2, '0')}-${String(1 + (i * 7) % 28).padStart(2, '0')}` : null, i % 3 ? '09:00' : null, 1 + i % 4, ['draft', 'sent', 'won', 'lost'][i % 4])));
  const p = await page({quotes: many});
  const open = await p.evaluate(async () => { const t0 = performance.now(); document.getElementById('historyOpen').click(); await new Promise(r => requestAnimationFrame(() => r())); return performance.now() - t0; });
  const next = await p.evaluate(async () => { const t0 = performance.now(); document.querySelector('[data-a="next"]').click(); await new Promise(r => requestAnimationFrame(() => r())); return performance.now() - t0; });
  const list = await p.evaluate(async () => { const t0 = performance.now(); document.querySelector('[data-view="list"]').click(); await new Promise(r => requestAnimationFrame(() => r())); return performance.now() - t0; });
  ok('500 προσφορές: άνοιγμα μήνα, επόμενος μήνας και Λίστα < 150 ms', open < 150 && next < 150 && list < 150, `άνοιγμα ${open.toFixed(0)} ms · επόμενος ${next.toFixed(0)} ms · λίστα ${list.toFixed(0)} ms`);
  ok('500 προσφορές: όλες φαίνονται (Λίστα + «Χωρίς ημερομηνία»)', await p.locator('#calList .q-open').count() + await p.locator('#calUndated .q-open').count() === 500);
  await p.context().close();
}

// ── 6. Σκούρο θέμα: ίδια χρώματα με την υπόλοιπη εφαρμογή ──
{
  const p = await page({quotes: SEED, scheme: 'dark'});
  await p.click('#historyOpen');
  const c = await p.evaluate(() => ({card: getComputedStyle(document.querySelector('.cal-q')).backgroundColor, text: getComputedStyle(document.querySelector('.cal-d:not(.out)')).color,
    field: getComputedStyle(document.querySelector('.seg')).backgroundColor}));
  ok('σκούρο θέμα: κάρτες και κουμπιά με τα σκούρα χρώματα της εφαρμογής', c.card === 'rgb(31, 34, 38)' && c.field === 'rgb(31, 34, 38)' && c.text === 'rgb(237, 238, 234)', JSON.stringify(c));
  await p.context().close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
