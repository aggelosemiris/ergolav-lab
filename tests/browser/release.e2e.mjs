// Stress στον browser πριν από διάθεση σε πελάτες: XSS, μεγάλες προσφορές, συνέπεια συνόλων/PDF, στενή οθόνη,
// αποτυχίες δικτύου/αποθήκευσης, γρήγορα πατήματα, πολλές προσφορές στη σειρά. Καμία εξωτερική κλήση.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/release.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://localhost:8080/';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const PROFILE = JSON.stringify({name: 'Δοκιμή Τεχνική', trade: 'Υδραυλικός', phone: ''});

// Νέα σελίδα με καταγραφή σφαλμάτων, CSP και εξωτερικών αιτημάτων· προαιρετικά αποθηκευμένα στοιχεία.
async function page({viewport = {width: 400, height: 860}, profile = true, init} = {}){
  const ctx = await b.newContext({viewport, acceptDownloads: true});
  const p = await ctx.newPage();
  p.errs = []; p.csp = []; p.external = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => { if(/Content Security Policy|Refused to/i.test(m.text())) p.csp.push(m.text().slice(0, 140)); });
  p.on('request', r => { const h = new URL(r.url()).hostname; if(!/^(localhost|127\.0\.0\.1)$/.test(h)) p.external.push(h); });
  p.on('dialog', d => { p.errs.push('dialog: ' + d.message()); d.dismiss(); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  if(profile) await p.addInitScript(s => { try { if(!localStorage.getItem('ergolav.profile')) localStorage.setItem('ergolav.profile', s); } catch {} }, PROFILE);
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
const pdfReady = p => p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Στείλε στον πελάτη', null, {timeout: 90000});
const eurN = t => Number(String(t).replace(/[^\d,]/g, '').replace(',', '.'));
const clean = p => p.errs.length === 0 && p.csp.length === 0 && p.external.every(h => /fonts\.g/.test(h));

// ══ 1. XSS από κάθε πεδίο που γράφει ο χρήστης ══
{
  const X = '<img src=x onerror="window.__pwn=1">';
  const p = await page({profile: false});
  await p.fill('#pfName', X + 'Μάστορας'); await p.fill('#pfTrade', '<script>window.__pwn=2</script>'); await p.click('#pfSave');
  await p.fill('#client', '<svg onload="window.__pwn=3">Πελάτης');
  await dictate(p, `2 τεμάχια ${X}ροπ, λεκάνη, <b onmouseover="window.__pwn=4">πρίζα</b>, 3 μέτρα σωλήνα`);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  const rop = p.locator('.ln:has([data-p="cmat"])').first();
  await rop.locator('[data-p="cmat"]').fill('5'); await rop.locator('.custom [data-a="keep"]').click();
  const wc = p.locator('.ln:has(.ln-name:text-is("Λεκάνη κρεμαστή"))');
  await wc.locator('[data-a="desc-edit"]').click(); await wc.locator('[data-p="desc"]').fill(X + 'Λεκάνη Geberit'); await wc.locator('[data-a="desc-keep"]').click();
  while(await p.locator('#ctaBtn').isDisabled()){                                  // ό,τι μένει να ρωτάει (π.χ. «πρίζα» με HTML): σβήνεται
    const r = p.locator('.ln.flag [data-a="remove-line"], .ln.flag [data-a="remove"]').first();
    if(!await r.count()) break; await r.click();
  }
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on'); await pdfReady(p);
  const injected = await p.evaluate(() => document.querySelectorAll('#app img:not(#shot), #app svg[onload], #app script, #pdf img, #app [onerror], #app [onmouseover], #app [onload]').length);
  ok('XSS: κανένα script δεν έτρεξε (όνομα, ειδικότητα, πελάτης, υλικό, περιγραφή)', await p.evaluate(() => window.__pwn === undefined) && injected === 0, `pwn=${await p.evaluate(() => window.__pwn)} injected=${injected}`);
  ok('XSS: το κείμενο φαίνεται αυτούσιο (escaped) στο PDF', (await p.textContent('#pdf')).includes('<img src=x') && (await p.textContent('#pdf .who')).includes('<svg'));
  ok('XSS: χωρίς σφάλματα/CSP', clean(p), [...p.errs, ...p.csp].join(' | '));
  await p.context().close();
}

// ══ 2. Μεγάλη προσφορά: 300 υλικά ══
{
  const p = await page();
  const W = ['μέτρα σωλήνα', 'λεκάνες', 'πρίζες', 'σποτ', 'μέτρα καλώδιο', 'σιφόνια', 'βρύσες', 'διακόπτες', 'γωνίες', 'ρακόρ', 'ταυ', 'βάνες', 'σπιράλ', 'φλοτέρ', 'πόρτες'];
  // 15 υλικά καταλόγου (το καθένα μία φορά) + 285 διαφορετικά υλικά εκτός καταλόγου, σε χωριστές φράσεις
  const text = Array.from({length: 300}, (_, i) => i < 15 ? `${(i % 9) + 1} ${W[i]}` : `${(i % 9) + 1} ροπ${i}`).join(', ');
  let t0 = Date.now();
  await dictate(p, text);
  const tDictate = Date.now() - t0; t0 = Date.now();
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  const tLines = Date.now() - t0;
  const n = await p.locator('#lines .ln').count();
  ok(`300 φράσεις (${text.length} χαρ.) → 300 γραμμές: 15 καταλόγου + 285 εκτός καταλόγου`, n === 300, `${n} γραμμές`);
  ok(`χρόνος: τσιπάκια ${tDictate} ms, οθόνη ελέγχου ${tLines} ms (< 4 s)`, tLines < 4000);
  // Λύνουμε όλες τις εκκρεμότητες: ίδιο υλικό → σύνολο, εκτός καταλόγου → τιμή
  t0 = Date.now();
  for(let k = 0; k < 400 && await p.locator('#ctaBtn').isDisabled(); k++){
    const dup = p.locator('.ln.flag:has-text("Το είπες") [data-q]').last();
    if(await dup.count()){ await dup.click(); continue; }
    const cm = p.locator('[data-p="cmat"]').first();
    if(await cm.count()){ await cm.fill(String(1 + k % 50)); await p.locator('.custom [data-a="keep"]').first().click(); continue; }
    break;
  }
  const tResolve = Date.now() - t0;
  ok(`όλες οι εκκρεμότητες λύθηκαν (${tResolve} ms)`, await p.locator('#ctaBtn').isEnabled(), await p.textContent('#ctaNote'));
  t0 = Date.now();
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await pdfReady(p).catch(() => {});
  const tPdf = Date.now() - t0;
  const rows = await p.$$eval('#pdf table tr:not(:has(th))', trs => trs.map(tr => tr.lastElementChild.textContent));
  const sumRows = rows.reduce((a, r) => a + eurN(r), 0);
  const mat = eurN(await p.$eval('#pdf .sum', e => [...e.children].find(d => d.firstChild.textContent === 'Υλικά').lastChild.textContent));
  ok(`PDF 300 γραμμών φτιάχτηκε σε ${tPdf} ms (< 60 s)`, await p.textContent('#ctaBtn') === 'Στείλε στον πελάτη' && tPdf < 60000, await p.textContent('#ctaBtn'));
  ok(`PDF: 300 γραμμές, άθροισμα γραμμών = «Υλικά» (${mat.toFixed(2)} €)`, rows.length === 300 && Math.abs(sumRows - mat) < 0.005, `${rows.length} / ${sumRows.toFixed(2)}`);
  ok('μεγάλη προσφορά: χωρίς σφάλματα', clean(p), p.errs.join(' | '));
  await p.context().close();
}

// ══ 3. Συνέπεια συνόλων ↔ PDF με τυχαίες τιμές και ΦΠΑ (20 προσφορές) ══
{
  const p = await page();
  let bad = 0, checked = 0;
  for(let q = 0; q < 20; q++){
    await p.goto(BASE);
    const items = ['3,5 μέτρα σωλήνα', '2 λεκάνες κρεμαστές', '7 πρίζες', '13 σποτ', '12,75 μέτρα καλώδιο', '1 θερμοσίφωνας 100 λίτρα', '4 ροπ', '0,5 μέτρα σωλήνα PPR'];
    await dictate(p, items.slice(0, 3 + q % 6).join(', '));
    await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
    for(let k = 0; k < 20 && await p.locator('#ctaBtn').isDisabled(); k++){
      const cm = p.locator('[data-p="cmat"]').first();
      if(await cm.count()){ await cm.fill(`${q + 1},${String(q * 7 % 100).padStart(2, '0')}`); await p.locator('.custom [data-a="keep"]').first().click(); } else break;
    }
    // τυχαία «Άλλη τιμή» σε μια γραμμή καταλόγου και τυχαία εργασία
    const custom = p.locator('.tier[data-t="custom"]').first();
    await custom.click(); await p.locator('[data-p="cmat"]').first().fill(`${(q * 13) % 97 + 0.33}`.replace('.', ',')); await p.locator('.custom [data-a="keep"]').first().click();
    await p.locator('#laborBox [data-p="labor"]').fill(`${q * 37},${q % 10}5`);
    await p.selectOption('#vatRate', String([24, 17, 13, 9, 6, 4, 0][q % 7]));
    const scr = (await p.textContent('#totals')).replace(/\s+/g, ' ');
    await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on'); await pdfReady(p).catch(() => {});
    const sum = await p.$$eval('#pdf .sum > div', ds => Object.fromEntries(ds.map(d => [d.firstChild.textContent.replace(/ \d+%$/, ''), d.lastChild.textContent])));
    const rows = await p.$$eval('#pdf table tr:not(:has(th))', trs => trs.map(tr => tr.lastElementChild.textContent));
    const rate = Number((await p.textContent('#pdf .sum')).match(/ΦΠΑ (\d+)%/)[1]);
    const [m, l, n, v, t] = ['Υλικά', 'Εργασία', 'Καθαρή αξία', 'ΦΠΑ', 'Σύνολο'].map(k => eurN(sum[k]));
    const lineSum = rows.reduce((a, r) => a + (/στην εργασία/.test(r) ? 0 : eurN(r)), 0);
    checked++;
    const okq = Math.abs(lineSum - m) < 0.005 && Math.abs(m + l - n) < 0.005 && Math.abs(Math.round(n * rate) / 100 - v) < 0.0051 && Math.abs(n + v - t) < 0.005 &&
      scr.includes(sum['Σύνολο'].trim());
    if(!okq){ bad++; console.log('   ασυνέπεια:', JSON.stringify({lineSum, m, l, n, v, t, rate, scr: scr.slice(0, 120)})); }
  }
  ok(`20 προσφορές: γραμμές = Υλικά, Υλικά + Εργασία = Καθαρή, ΦΠΑ = Καθαρή × συντελεστή, Σύνολο ίδιο σε οθόνη και PDF`, bad === 0 && checked === 20, `${bad} ασυνεπείς`);
  const nums = [];
  ok('20 προσφορές στη σειρά: χωρίς σφάλματα', clean(p), p.errs.join(' | '));
  await p.context().close();
}

// ══ 4. Στενή οθόνη 320px: χωρίς οριζόντια κύλιση ══
{
  const p = await page({viewport: {width: 320, height: 640}, profile: false});
  const over = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const o1 = await over();
  await p.fill('#pfName', 'Υδραυλικές Εγκαταστάσεις Παπαδημητρόπουλος & Συνεργάτες Ο.Ε.'); await p.fill('#pfTrade', 'Υδραυλικός · Θερμοϋδραυλικά · Ηλιακά'); await p.click('#pfSave');
  const o2 = await over();
  await dictate(p, '12 μέτρα σωλήνα πολυστρωματικός Φ20, θερμοσίφωνας 90 λίτρα, πλακάκι, 2 υπερμακροσκελέστατοονομαυλικούχωρίςκενά, ντους, καλώδιο');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  const o3 = await over();
  ok(`320px: χωρίς οριζόντια κύλιση (φόρμα ${o1}, αρχική ${o2}, έλεγχος ${o3} px)`, o1 <= 0 && o2 <= 0 && o3 <= 0);
  const small = await p.$$eval('#lines button, #cta button', bs => bs.filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 36 || r.width < 36); }).map(b => b.textContent.trim().slice(0, 20)));
  ok('320px: κουμπιά τουλάχιστον 36×36 px για δάχτυλο', small.length === 0, small.join(' | '));
  while(await p.locator('#ctaBtn').isDisabled()){                                   // λύνουμε ό,τι ρωτάει, για να δούμε και το PDF
    const opt = p.locator('.ln.flag [data-near], .ln.flag .opt, .ln.flag [data-c], .ln.flag [data-a="remove-line"], .ln.flag [data-a="drop"], .ln.flag [data-a="keep"], .ln.flag [data-a="remove"]').first();
    if(!await opt.count()) break; await opt.click();
  }
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  ok(`320px: ούτε η προεπισκόπηση PDF έχει οριζόντια κύλιση (${await over()} px)`, await over() <= 0);
  await p.context().close();
}

// ══ 5. Αποτυχίες: εργαλείο PDF δεν φορτώνει · localStorage γεμάτο/μπλοκαρισμένο ══
{
  const p = await page();
  await p.route('**/vendor/html2pdf.bundle.min.js', r => r.abort());
  await dictate(p, '3 πρίζες');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Δοκίμασε ξανά', null, {timeout: 15000}).catch(() => {});
  ok('PDF δεν φορτώνει (εκτός δικτύου): «Δοκίμασε ξανά» με μήνυμα, όχι πάγωμα', await p.textContent('#ctaBtn') === 'Δοκίμασε ξανά' && /σύνδεση/.test(await p.textContent('#ctaNote')), `${await p.textContent('#ctaBtn')} / ${await p.textContent('#ctaNote')}`);
  await p.unroute('**/vendor/html2pdf.bundle.min.js');
  await p.click('#ctaBtn'); await pdfReady(p).catch(() => {});
  ok('μετά την επαναφορά του δικτύου το «Δοκίμασε ξανά» φτιάχνει το PDF', await p.textContent('#ctaBtn') === 'Στείλε στον πελάτη');
  await p.context().close();
}
{
  const p = await page({profile: false, init: () => { Storage.prototype.setItem = function(){ throw new DOMException('QuotaExceededError', 'QuotaExceededError'); }; }});
  await p.fill('#pfName', 'Χωρίς Αποθήκευση'); await p.click('#pfSave');
  ok('localStorage που απορρίπτει κάθε εγγραφή: η φόρμα δέχεται τα στοιχεία και λέει ότι δεν αποθηκεύτηκαν', await p.isVisible('#s-start.on') && /δεν αποθηκεύτηκαν/.test(await p.textContent('#micNote')));
  await dictate(p, '2 ροπ, λεκάνη');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.locator('[data-p="cmat"]').first().fill('7'); await p.locator('.custom [data-a="keep"]').first().click();
  await p.selectOption('#vatRate', '13');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on'); await pdfReady(p).catch(() => {});
  ok('…και ολόκληρη η ροή μέχρι το PDF δουλεύει (Αρ. 1, ΦΠΑ 13%)', (await p.textContent('#pdf .qno')).trim() === '1' && /ΦΠΑ 13%/.test(await p.textContent('#pdf')) && p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
}

// ══ 6. Γρήγορα διπλά πατήματα, «0 λεκάνες», reload στη μέση ══
{
  const p = await page();
  await dictate(p, '0 λεκάνες, 2 πρίζες');
  await p.dblclick('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  ok('«0 λεκάνες» → «Ποσότητα 0», κουμπί κλειδωμένο', /Ποσότητα 0/.test(await p.textContent('#lines')) && await p.locator('#ctaBtn').isDisabled());
  await p.locator('.ln:has-text("Ποσότητα 0") [data-a="remove"]').click();
  await p.locator('#ctaBtn').dblclick();
  await p.waitForSelector('#s-pdf.on'); await pdfReady(p).catch(() => {});
  ok('η «Αναίρεση» δεν μένει στην οθόνη του PDF (θα έβαζε γραμμή που δεν είναι στο PDF)', !(await p.isVisible('#toast')));
  ok('διπλό πάτημα στο «Έλεγξα»: ένας αριθμός προσφοράς, καμία γραμμή 0 στο PDF', (await p.textContent('#pdf .qno')).trim() === '1' &&
    await p.evaluate(() => localStorage.getItem('ergolav.quoteNo')) === '1' && !/Λεκάνη/.test(await p.textContent('#pdf table')));
  await p.click('#ctaBtn').catch(() => {});                           // «Στείλε»: headless χωρίς share → φύλλο αποστολής
  await p.reload();
  ok('reload στη μέση: ξανά στην αρχή, χωρίς σφάλμα, ο αριθμός μένει 1', await p.isVisible('#s-start.on') && p.errs.length === 0 && await p.evaluate(() => localStorage.getItem('ergolav.quoteNo')) === '1', p.errs.join(' | '));
  await p.context().close();
}

// ══ 7. 30 προσφορές στη σειρά: αριθμοί 1…30 χωρίς κενά/διπλά, μνήμη τιμών με όριο ══
{
  const p = await page();
  const seen = [];
  for(let q = 1; q <= 30; q++){
    await p.goto(BASE);
    await dictate(p, `${q} πρίζες, ${q} ροπ${q % 5}`);
    await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
    await p.locator('[data-p="cmat"]').first().fill(String(q)); await p.locator('.custom [data-a="keep"]').first().click();
    await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
    seen.push(Number((await p.textContent('#pdf .qno')).trim()));
  }
  ok('30 προσφορές: αριθμοί 1…30 χωρίς κενά/διπλά', seen.join() === Array.from({length: 30}, (_, i) => i + 1).join(), seen.join(','));
  const mem = await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.prices') || '{}'));
  ok('μνήμη τιμών: έως 3 τιμές ανά προϊόν, μικρό μέγεθος', Object.values(mem).every(v => v.length <= 3) && JSON.stringify(mem).length < 20000, `${Object.keys(mem).length} προϊόντα, ${JSON.stringify(mem).length} bytes`);
  ok('30 προσφορές: χωρίς σφάλματα/CSP/τρίτους', clean(p), [...p.errs, ...p.csp, ...p.external].join(' | '));
  await p.context().close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
