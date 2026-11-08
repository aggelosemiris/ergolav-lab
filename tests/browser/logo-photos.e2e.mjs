// Λογότυπο επιχείρησης (κεφαλίδα, PDF, ιστορικό) και φωτογραφίες εργασίας στο συνοδευτικό PDF της ανάλυσης.
// Η υπηρεσία AI είναι ψεύτικη (καμία πραγματική κλήση)· το PDF φτιάχνεται κανονικά.
// Εκτέλεση: PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node tests/browser/logo-photos.e2e.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createService } from '../../server/app.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fx = n => fs.realpathSync(new URL(`../stress/fixtures/${n}`, import.meta.url));
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const service = createService({stateFile: null, resolveModel: async c => c, probe: async () => { throw new Error('no probe'); },
  analyze: async items => ({items, decisions: items.map(x => ({id: x.id, selected: true, reason: 'Σύνθετη εγκατάσταση'})),
    guides: items.map(x => ({id: x.id, scope: 'Τοποθέτηση', prerequisites: ['Έλεγχος'], tools: ['Εργαλεία'], steps: ['Προεργασία', 'Παράδοση'],
      checks: ['Έλεγχος'], missing: [], specialist: 'Αρμόδιος'})), provider: 'openai', model: 'mock', createdAt: new Date().toISOString()})});
await new Promise(r => service.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${service.address().port}/`;
const status = async () => (await fetch(BASE + 'api/service/status')).json();
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const p = await b.newPage({viewport: {width: 390, height: 844}, acceptDownloads: true});
const errs = [], sentBodies = [];
p.on('pageerror', e => errs.push(e.message));
p.on('request', r => { if(r.url().includes('/api/')) sentBodies.push(r.postData() || ''); });
// Η «Ανάλυση εργασιών με AI» είναι κρυφή στην εφαρμογή· εδώ ανοίγει για να ελεγχθεί η λειτουργία που κρατάμε.
await p.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; localStorage.setItem('ergolav.aiAnalysis', '1'); });
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());

async function makeQuote(text){
  await p.goto(BASE);
  await p.click('#mic'); await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await p.locator('#transcript').fill(text);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
}
const headLogo = () => p.evaluate(() => document.querySelector('#pdf .pdf-head .logo img')?.getAttribute('src') || document.querySelector('#pdf .pdf-head .logo').textContent);

try {
  // ══ Λογότυπο ══
  await p.goto(BASE);
  ok('φόρμα: χωρίς λογότυπο φαίνονται τα αρχικά', await p.isVisible('#s-profile.on') && !(await p.isVisible('#pfLogoRemove')));
  await p.fill('#pfName', 'Νίκος Παπαδάκης');
  await p.setInputFiles('#pfLogoInput', fx('01-normal.jpg'));
  await p.waitForSelector('#pfLogoPreview img');
  const preview = await p.getAttribute('#pfLogoPreview img', 'src');
  ok('επιλογή εικόνας → προεπισκόπηση, μικραίνει (≤ 320px) και ξαναγράφεται ως JPEG',
    preview.startsWith('data:image/jpeg;base64,') && await p.evaluate(async s => { const i = new Image(); i.src = s; await i.decode(); return Math.max(i.width, i.height) <= 320; }, preview) && await p.isVisible('#pfLogoRemove'));
  await p.click('#pfSave');
  const stored = await p.evaluate(() => ({profile: JSON.parse(localStorage.getItem('ergolav.profile')), logos: JSON.parse(localStorage.getItem('ergolav.logos') || '{}')}));
  ok('αποθήκευση: η εικόνα μία φορά στα λογότυπα, στα στοιχεία μόνο id', /^[0-9a-f]{8}$/.test(stored.profile.logo) && stored.logos[stored.profile.logo]?.url === preview && !JSON.stringify(stored.profile).includes('base64'));
  ok('κεφαλίδα: το λογότυπο αντί για τα αρχικά', await p.getAttribute('#brandLogo img', 'src') === preview);
  await p.reload();
  ok('μετά από reload η κεφαλίδα κρατά το λογότυπο', await p.getAttribute('#brandLogo img', 'src') === preview);
  await makeQuote('3 πρίζες');
  ok('PDF: το λογότυπο στην κεφαλίδα της προσφοράς', await headLogo() === preview);
  // αλλαγή λογοτύπου ΑΦΟΥ κλείσει η προσφορά (από την αρχική) → η παλιά προσφορά ξανανοίγει με το παλιό
  // (αν αλλάξει ενώ είναι ανοιχτό το PDF της, εκείνο ξαναφτιάχνεται με τα νέα στοιχεία — βλ. history.e2e)
  await p.goto(BASE);
  await p.click('#brand'); await p.setInputFiles('#pfLogoInput', fx('03-invoice.jpg'));
  await p.waitForFunction(old => document.querySelector('#pfLogoPreview img')?.getAttribute('src') !== old, preview);
  const preview2 = await p.getAttribute('#pfLogoPreview img', 'src');
  await p.click('#pfSave'); await p.waitForSelector('#s-start.on');
  await p.goto(BASE); await p.click('#historyOpen'); await p.locator('.q-open[data-no="1"]').click();
  await p.waitForFunction(() => /^Στείλε/.test(document.getElementById('ctaBtn').textContent), null, {timeout: 60000});
  ok('ιστορικό: η παλιά προσφορά ξανανοίγει με το λογότυπο που είχε τότε', await headLogo() === preview && preview2 !== preview);
  await makeQuote('2 σιφόνια');
  ok('νέα προσφορά: το νέο λογότυπο', await headLogo() === preview2);
  await p.click('#brand'); await p.click('#pfLogoRemove'); await p.click('#pfSave');
  await p.waitForSelector('#s-pdf.on');
  ok('αφαίρεση λογοτύπου → ξανά τα αρχικά «ΝΠ»', await p.textContent('#brandLogo') === 'ΝΠ');

  // ══ Φωτογραφίες στην ανάλυση εργασιών ══
  await makeQuote('ένας θερμοσίφωνας 100 λίτρα');
  await p.click('#installOpen');
  await p.locator('#installSetupKey').fill('sk-test-123456789');
  await p.click('#installGenerate');
  await p.locator('#installPreview:not([hidden])').waitFor();
  ok('μετά την ανάλυση: «📷 Πρόσθεσε φωτογραφίες», με σημείωση ότι δεν στέλνονται στο AI', await p.isVisible('#installPhotoAdd') && /Δεν στέλνονται στο AI/.test(await p.textContent('.install-photos')));
  const before = sentBodies.length;
  await p.setInputFiles('#installPhotoInput', [fx('01-normal.jpg'), fx('08-large.jpg')]);
  await p.waitForFunction(() => document.querySelectorAll('#installPhotoList .photo-item').length === 2);
  ok('δύο φωτογραφίες → δύο μικρογραφίες και ενότητα «Φωτογραφίες εργασίας» στο PDF', await p.locator('#installReport .report-photos figure').count() === 2);
  const srcs = await p.$$eval('#installReport .report-photos img', is => is.map(i => i.getAttribute('src')));
  const sizes = await p.evaluate(async ss => Promise.all(ss.map(async s => { const i = new Image(); i.src = s; await i.decode(); return Math.max(i.width, i.height); })), srcs);
  ok('φωτογραφίες: JPEG ≤ 1280px, χωρίς EXIF', srcs.every(s => s.startsWith('data:image/jpeg;base64,') && !Buffer.from(s.split(',')[1], 'base64').includes('Exif')) && sizes.every(x => x <= 1280), sizes.join(','));
  ok('καμία φωτογραφία δεν στάλθηκε στην υπηρεσία', sentBodies.slice(before).every(b => !b.includes('data:image')) && sentBodies.every(b => !b.includes('/9j/')));
  await p.locator('#installPhotoList input').first().fill('Πριν την αποξήλωση');
  ok('λεζάντα → στο PDF κάτω από τη φωτογραφία', (await p.locator('#installReport .report-photos figcaption').first().textContent()) === 'Πριν την αποξήλωση');
  await p.check('#installReviewed'); await p.click('#installPrepareBoth');
  await p.locator('#installShareBoth').waitFor();
  ok('PDF ανάλυσης με φωτογραφίες: έτοιμο, χρεώθηκε 1 μονάδα', (await status()).balance === 4);
  const dl = p.waitForEvent('download'); await p.click('#installDownload'); const d = await dl;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ergolav-photos-')), 'a.pdf'); await d.saveAs(out);
  ok(`PDF ανάλυσης με τις φωτογραφίες (${Math.round(fs.statSync(out).size / 1024)} KB)`, fs.statSync(out).size > 50000);
  await p.locator('#installPhotoList .linkbtn').first().click();
  ok('αφαίρεση φωτογραφίας μετά το PDF → το PDF ξαναφτιάχνεται (ξανά «Ετοίμασε»)', await p.isVisible('#installPrepareBoth') && !(await p.isVisible('#installShareBoth')) && await p.locator('#installReport .report-photos figure').count() === 1);
  await p.click('#installPrepareBoth'); await p.locator('#installShareBoth').waitFor();
  ok('ξανά PDF: καμία δεύτερη χρέωση (ίδια ανάλυση)', (await status()).balance === 4);
  // όριο και άκυρα αρχεία
  const txt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ergolav-txt-')), 'notes.txt'); fs.writeFileSync(txt, 'όχι εικόνα');
  await p.setInputFiles('#installPhotoInput', [txt]);
  await p.waitForFunction(() => /δεν ήταν εικόνες/.test(document.getElementById('installPhotoStatus').textContent));
  ok('αρχείο που δεν είναι εικόνα → μήνυμα, δεν μπαίνει', await p.locator('#installPhotoList .photo-item').count() === 1);
  const many = Array.from({length: 13}, (_, i) => fx(['01-normal.jpg', '02-noise.jpg', '03-invoice.jpg'][i % 3]));
  await p.setInputFiles('#installPhotoInput', many);
  await p.waitForFunction(() => document.querySelectorAll('#installPhotoList .photo-item').length === 12, null, {timeout: 60000});
  ok('όριο 12: «δεν μπήκαν» για τις υπόλοιπες, κουμπί κλειδωμένο', /Έως 12 φωτογραφίες — δεν μπήκαν 2/.test(await p.textContent('#installPhotoStatus')) && await p.isDisabled('#installPhotoAdd'), await p.textContent('#installPhotoStatus'));
  ok('στενή οθόνη: χωρίς οριζόντια κύλιση με 12 φωτογραφίες', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.click('#installClose');
  await p.click('#installOpen');
  ok('κλείσιμο του παραθύρου → οι φωτογραφίες καθαρίζουν', await p.locator('#installPhotoList .photo-item').count() === 0);
  ok('χωρίς σφάλματα JavaScript', errs.length === 0, errs.join(' | '));
} finally {
  await b.close(); service.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
