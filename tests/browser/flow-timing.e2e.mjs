// Χρόνος και πατήματα της συνηθισμένης ροής νέας προσφοράς, χωρίς να αγγίξεις την ημερομηνία:
// πελάτης → μικρόφωνο → «Τέλος» → «Βγάλε τιμές» → «Έλεγξα» → «Στείλε στον πελάτη». Η φωνή είναι ψεύτικη (λέει μία
// φράση αμέσως) και η αποστολή ψεύτικο navigator.share, ώστε να μετρά μόνο η εφαρμογή. Τρέχει και σε παλιότερη
// έκδοση (APP_URL) για σύγκριση πριν/μετά. Κανόνας: η ημερομηνία δεν προσθέτει κανένα πάτημα (5 πατήματα).
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/flow-timing.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const RUNS = +(process.env.RUNS || 7), TAPS = 5;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const PROFILE = JSON.stringify({name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'});
const times = [], errs = []; let taps = 0, saved = null;
for(let i = 0; i < RUNS; i++){
  const ctx = await b.newContext({viewport: {width: 390, height: 844}});
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.addInitScript(s => {
    localStorage.setItem('ergolav.profile', s);
    class SR { start(){ setTimeout(() => { this.onstart?.();
      const r = [{transcript: 'τρεις πρίζες και δώδεκα μέτρα σωλήνα', confidence: 1}]; r.isFinal = true;
      this.onresult?.({resultIndex: 0, results: [r]}); }, 10); }
      stop(){ setTimeout(() => this.onend?.(), 10); } abort(){ this.stop(); } }
    window.SpeechRecognition = window.webkitSpeechRecognition = SR;
    if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error('χωρίς ήχο στο τεστ'); };
    Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => true});
    Object.defineProperty(navigator, 'share', {configurable: true, value: async () => {}});
  }, PROFILE);
  await p.goto(BASE); await p.waitForSelector('#s-start.on');
  let t = 0; const tap = async sel => { t++; await p.click(sel); };
  const t0 = Date.now();
  await p.fill('#client', 'Γιώργος Αντωνίου, Χαλάνδρι');
  await tap('#mic');
  await p.waitForFunction(() => /τρεις πρίζες/.test(document.getElementById('transcript').textContent));
  await tap('#ctaBtn');                                                        // «Τέλος»
  await p.waitForFunction(() => { const b = document.getElementById('ctaBtn'); return b.textContent === 'Βγάλε τιμές' && !b.disabled; });
  await tap('#ctaBtn'); await p.waitForSelector('#s-lines.on');                // «Βγάλε τιμές»
  await p.waitForFunction(() => !document.getElementById('ctaBtn').disabled);
  await tap('#ctaBtn'); await p.waitForSelector('#s-pdf.on');                  // «Έλεγξα, φτιάξε την προσφορά»
  await p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Στείλε στον πελάτη', null, {timeout: 60000});
  await tap('#ctaBtn'); await p.waitForSelector('#s-done.on');                 // «Στείλε στον πελάτη»
  times.push(Date.now() - t0); taps = t;
  saved ??= await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes'))[0]);
  await ctx.close();
}
await b.close();
times.sort((a, b) => a - b);
const median = times[RUNS >> 1];
console.log(JSON.stringify({url: BASE, runs: RUNS, taps, median_ms: median, min_ms: times[0], max_ms: times.at(-1),
  saved: saved && {scheduled_date: saved.scheduled_date, status: saved.status}}));
const pass = taps === TAPS && errs.length === 0;
console.log(`${pass ? '✓' : '✗'} συνηθισμένη ροή: ${taps} πατήματα (όριο ${TAPS}), διάμεσος ${median} ms${errs.length ? ' — σφάλματα: ' + errs.join(' | ') : ''}`);
console.log(`\n${pass ? 1 : 0}/1 passed`);
process.exit(pass ? 0 : 1);
