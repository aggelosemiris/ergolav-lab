// Αριθμοί με λέξεις, διορθώσεις («όχι δέκα, δώδεκα»), αριθμός χωρίς μονάδα, πίνακας/ασφάλειες,
// και εργασία ανά μονάδα σε είδος εκτός καταλόγου — όπως τα βλέπει ο τεχνίτης στην οθόνη «Έλεγξε και διόρθωσε».
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/parse-fixes.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const PROFILE = JSON.stringify({name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'});

const ctx = await b.newContext({viewport: {width: 400, height: 860}});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p.addInitScript(s => { try { if(!localStorage.getItem('ergolav.profile')) localStorage.setItem('ergolav.profile', s); } catch {} }, PROFILE);

async function lines(text){
  await p.goto(BASE);
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await p.evaluate(t => { const el = document.getElementById('transcript'); el.textContent = t; el.dispatchEvent(new Event('input', {bubbles: true})); }, text);
  await p.waitForFunction(() => { const b = document.getElementById('ctaBtn'); return b.textContent === 'Βγάλε τιμές' && !b.disabled; });
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
}
const names = () => p.$$eval('#lines .ln-name', els => els.map(e => e.textContent));
const card = name => p.locator('#lines .ln').filter({has: p.locator('.ln-name', {hasText: name})});
const laborVal = () => p.locator('#laborBox [data-p="labor"]').inputValue();
const PIPE = 'Σωλήνας πολυστρωματικός';

try {
  // ── 1. Αριθμοί με λέξεις ──
  await lines('εικοσιπέντε μέτρα σωλήνα');
  ok('«εικοσιπέντε μέτρα σωλήνα» → 25 μ.', /25 μ\./.test(await card(PIPE).textContent()), await card(PIPE).textContent());
  await lines('δύο χιλιάδες μέτρα καλώδιο');
  ok('«δύο χιλιάδες μέτρα καλώδιο» → 2000 μ. και ζητά έλεγχο (πολύ μεγάλο)', /2\.?000 μ\./.test(await p.textContent('#lines')), await p.textContent('#lines'));
  await lines('τριανταχ μέτρα σωλήνα');
  const unread = card(PIPE);
  ok('ποσότητα που δεν διαβάστηκε → κάρτα ελέγχου «Δεν κατάλαβα την ποσότητα («τριανταχ»)», πεδίο άδειο',
    /Δεν κατάλαβα την ποσότητα \(«τριανταχ»\)/.test(await unread.locator('.ask').textContent()) && await unread.locator('[data-p="qty"]').inputValue() === '');
  ok('…και το κουμπί κλειδώνει μέχρι να γραφτεί', await p.locator('#ctaBtn').isDisabled());
  await unread.locator('[data-p="qty"]').fill('30'); await unread.locator('[data-a="ok"]').click();
  ok('γράφει 30 → Εντάξει → 30 μ., ξεκλειδώνει', /30 μ\./.test(await card(PIPE).textContent()) && await p.locator('#ctaBtn').isEnabled());

  // ── 3. Διορθώσεις και αριθμός χωρίς μονάδα ──
  for(const t of ['όχι δέκα, δώδεκα μέτρα σωλήνα', 'δέκα μέτρα σωλήνα, όχι, δώδεκα', 'δέκα μέτρα σωλήνα, συγγνώμη δώδεκα', 'δέκα μέτρα σωλήνα, θέλω να πω δώδεκα']){
    await lines(t);
    const n = await names();
    ok(`«${t}» → μία γραμμή, 12 μ., χωρίς «Όχι»`, n.length === 1 && n[0].startsWith(PIPE) && /12 μ\./.test(await card(PIPE).textContent()) && !/Όχι/.test(await p.textContent('#lines')), n.join(' | '));
  }
  await lines('12 μέτρα σωλήνα, όχι 15 τεμάχια');
  ok('«12 μέτρα σωλήνα, όχι 15 τεμάχια» (άλλη μονάδα) → ρωτά, δεν αλλάζει σιωπηλά',
    /Είπες «όχι 15 τεμάχια»/.test(await card(PIPE).locator('.ask').textContent()) && await card(PIPE).locator('[data-p="qty"]').inputValue() === '12' && await p.locator('#ctaBtn').isDisabled());
  await lines('τρία καλώδια');
  const cab = p.locator('#lines .ln').first();
  ok('«τρία καλώδια» → κάρτα «Είπες 3 χωρίς μονάδα — είναι 3 μ.;», κουμπί κλειδωμένο',
    /Είπες 3 χωρίς μονάδα — είναι 3 μ\.;/.test(await cab.locator('.ask').textContent()) && await p.locator('#ctaBtn').isDisabled(), await cab.locator('.ask').textContent());
  await cab.locator('[data-a="ok"]').click();
  ok('Εντάξει → 3 μ., ξεκλειδώνει', /3 μ\./.test(await p.locator('#lines .ln').first().textContent()) && await p.locator('#ctaBtn').isEnabled());
  await lines('δυο λεκάνες και μια λεκάνη ακόμα');
  ok('«δυο λεκάνες και μια λεκάνη ακόμα» → 3 τεμ., χωρίς ερώτηση', (await names()).length === 1 && /3 τεμ\./.test(await p.textContent('#lines')) && !(await p.locator('#lines .ask').count()));

  // ── 2α. Πίνακας και ασφάλειες ──
  await lines('ένας πίνακας 24 θέσεων και έξι ασφάλειες 16Α');
  const n2 = await names();
  ok('πίνακας 24 θέσεων + 6 ασφάλειες 16A → γραμμές καταλόγου με τιμή', n2.length === 2 && n2.some(x => x.startsWith('Ηλεκτρολογικός πίνακας')) && n2.some(x => x.startsWith('Ασφάλεια')) &&
    /24 θέσεων/.test(await card('Ηλεκτρολογικός πίνακας').textContent()) && /16A/.test(await card('Ασφάλεια').textContent()) &&
    /6 τεμ\./.test(await card('Ασφάλεια').textContent()) && /ΚΩΔ\. 64016/.test(await card('Ασφάλεια').textContent()), n2.join(' | '));

  // ── 2β. Εργασία ανά μονάδα σε είδος εκτός καταλόγου ──
  await lines('3 σίτες');
  const site = card('Σίτες');
  ok('εκτός καταλόγου: δίπλα στην τιμή υλικού το προαιρετικό «Εργασία € ανά τεμ.»', await site.locator('[data-p="clab"]').isVisible() && /Εργασία € ανά τεμ\. \(προαιρετικό\)/.test(await site.locator('.custom').textContent()));
  await site.locator('[data-p="cmat"]').fill('25');
  await site.locator('.custom [data-a="keep"]').click();
  ok('χωρίς εργασία → όπως πριν (εργασία 0)', /^0(,00)?$/.test(await laborVal()) && await p.locator('#ctaBtn').isEnabled(), await laborVal());
  await site.locator('.tier[data-t="custom"]').click();
  await site.locator('[data-p="clab"]').fill('10,5');
  await site.locator('.custom [data-a="keep"]').click();
  ok('εργασία 10,50 €/τεμ. × 3 → 31,50 € στην «Εργασία για όλη τη δουλειά»', /^31,50?$/.test(await laborVal()) && /Εργασία\s*31,50 €/.test(await p.textContent('#totals')) &&
    /3 × 10,50 € = 31,50 €/.test(await site.textContent()), await laborVal());
  ok('το υλικό μένει 3 × 25 = 75,00 €', /75,00 €/.test(await site.locator('.ln-sum').textContent()) && /Υλικά\s*75,00 €/.test(await p.textContent('#totals')));
  await site.locator('[data-d="1"]').click();
  ok('ποσότητα 4 → εργασία 42,00 €', /^42(,00)?$/.test(await laborVal()), await laborVal());
  // δικό του ποσό εργασίας: δεν το πατάει η πρόταση
  await p.locator('#laborBox [data-p="labor"]').fill('200');
  await site.locator('.tier[data-t="custom"]').click();
  await site.locator('[data-p="clab"]').fill('20');
  await site.locator('.custom [data-a="keep"]').click();
  ok('χειροκίνητη εργασία 200 € δεν αλλάζει· φαίνεται η πρόταση 80,00 €', /^200(,00)?$/.test(await laborVal()) && /Εργασία\s*200,00 €/.test(await p.textContent('#totals')) &&
    /Πρόταση καταλόγου: 80,00 €/.test(await p.textContent('#laborBox')), await p.textContent('#laborBox'));
  await p.locator('#laborBox [data-a="auto"]').click();
  ok('«Χρησιμοποίησέ την» → 80,00 €', /^80(,00)?$/.test(await laborVal()));
  // PDF + ιστορικό: τα ίδια σύνολα
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
  const pdf = await p.textContent('#pdf');
  ok('PDF: υλικά 100,00 € + εργασία 80,00 €', /100,00 €/.test(pdf) && /80,00 €/.test(pdf) && /223,20 €/.test(pdf), pdf.replace(/\s+/g, ' ').slice(0, 300));
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.quotes'))[0]);
  ok('ιστορικό: αποθηκεύτηκαν τα ίδια σύνολα', saved.sum.mat === 10000 && saved.sum.lab === 8000 && saved.sum.total === 22320, JSON.stringify(saved.sum));
  await p.goto(BASE); await p.click('#historyOpen'); await p.locator(`.q-open[data-no="${saved.no}"]`).click();
  await p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
  ok('άνοιγμα από το ιστορικό: ίδιο PDF', (await p.textContent('#pdf')) === pdf);
  ok('χωρίς σφάλματα JavaScript', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
