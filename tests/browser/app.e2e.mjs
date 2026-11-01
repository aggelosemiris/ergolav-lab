// Έλεγχος της εφαρμογής στον browser (ενεργή CSP): τιμές, key, κάλυψη, ΦΠΑ, PDF, μοντέλο Claude, τρίτοι.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/app.e2e.mjs
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const PHOTO = fs.realpathSync(new URL('../stress/fixtures/01-normal.jpg', import.meta.url));
const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const ctx = await b.newContext({viewport:{width:400,height:860}, acceptDownloads: true});
const p = await ctx.newPage();
const errs = [], csp = [], external = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if(/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 160)); });
p.on('request', r => { const u = new URL(r.url()); if(!/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) external.push(u.hostname); });
let gemBody = null, claudeBody = null;
const NOTES = '2 τεμάχια κλιματιστικά\n999 λεκάνες κρεμαστές\nλεκάνη κρεμαστή';   // ό,τι «διαβάζει» η φωτογραφία
await p.route('https://generativelanguage.googleapis.com/**', async r => {
  gemBody = JSON.parse(r.request().postData());
  await r.fulfill({headers:{'access-control-allow-origin':'*'}, contentType:'application/json',
    body: JSON.stringify({candidates:[{finishReason:'STOP', content:{parts:[{text: NOTES}]}}]})});
});
await p.route('https://api.anthropic.com/**', async r => {
  claudeBody = JSON.parse(r.request().postData());
  await r.fulfill({headers:{'access-control-allow-origin':'*', 'request-id':'x'}, contentType:'application/json',
    body: JSON.stringify({id:'m', type:'message', role:'assistant', model: claudeBody.model, stop_reason:'end_turn', content:[{type:'text', text:'12 μέτρα σωλήνας'}], usage:{input_tokens:1, output_tokens:1}})});
});
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());

// Γράφει κείμενο στο πεδίο (headless: δεν υπάρχει μικρόφωνο → η οθόνη ανοίγει για γράψιμο). Περιμένει να είναι έτοιμη,
// αλλιώς το άκυρο μικρόφωνο «έρχεται» καθυστερημένα και ξαναγράφει την οθόνη (αγώνας χρόνου).
async function dictate(page, text){
  await page.click('#mic');
  await page.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
  await page.evaluate(t => { const el = document.getElementById('transcript'); el.textContent = t; el.dispatchEvent(new Event('input', {bubbles: true})); }, text);
  await page.waitForFunction(() => { const b = document.getElementById('ctaBtn'); return b.textContent === 'Βγάλε τιμές' && !b.disabled; });
}
const results = [];
const ok = (name, cond, detail='') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

await p.goto('http://localhost:8080/');
await p.evaluate(() => localStorage.clear()); await p.reload();

// ── Στοιχεία επιχείρησης: μία φορά, πριν από το μικρόφωνο ──
ok('#P πρώτο άνοιγμα: «Τα στοιχεία σου» πριν από το μικρόφωνο', await p.isVisible('#s-profile.on') && !(await p.isVisible('#mic')) && await p.textContent('#step') === 'Τα στοιχεία σου');
await p.click('#pfSave');
ok('#P άδειο όνομα δεν αποθηκεύεται (μήνυμα, μένει η φόρμα)', await p.isVisible('#s-profile.on') && /όνομα/.test(await p.textContent('#pfError')) &&
  await p.evaluate(() => localStorage.getItem('ergolav.profile')) === null);
ok('#P η φόρμα δεν ζητάει ΑΦΜ', await p.locator('#pfAfm').count() === 0 && !/ΑΦΜ/.test(await p.textContent('#s-profile')));
await p.fill('#pfName', 'Νίκος Παπαδάκης'); await p.fill('#pfTrade', 'Υδραυλικός'); await p.fill('#pfPhone', '12345');
await p.click('#pfSave');
ok('#P τηλέφωνο που δεν στέκει δεν αποθηκεύεται', await p.isVisible('#s-profile.on') && /τηλέφωνο/i.test(await p.textContent('#pfError')));
await p.fill('#pfPhone', '6912345678');
await p.click('#pfSave');
ok('#P μετά την αποθήκευση: αρχική οθόνη, κεφαλίδα με το όνομα, ειδικότητα, αρχικά «ΝΠ»', await p.isVisible('#s-start.on') && await p.textContent('#brandName') === 'Νίκος Παπαδάκης' &&
  await p.textContent('#brandTrade') === 'Υδραυλικός' && await p.textContent('#brandLogo') === 'ΝΠ');
await p.reload();
ok('#P μετά από reload ΔΕΝ ξαναδείχνει φόρμα· η κεφαλίδα κρατά το όνομα', await p.isVisible('#s-start.on') && !(await p.isVisible('#s-profile.on')) && await p.textContent('#brandName') === 'Νίκος Παπαδάκης');
ok('#P πεδίο «Πελάτης» άδειο, με placeholder', await p.inputValue('#client') === '' && await p.getAttribute('#client', 'placeholder') === 'Όνομα πελάτη, περιοχή');
ok('#P τίτλος και κάτω κείμενο', await p.title() === 'ergolav — προσφορά επί τόπου' && /Ενδεικτικές τιμές\. Έλεγξέ τες πριν στείλεις\./.test(await p.textContent('.disclaimer')) && !/φανταστικά/.test(await p.textContent('body')));
// Παλιά αποθήκευση (πριν βγει το ΑΦΜ): το ΑΦΜ πρέπει να αγνοηθεί και να σβηστεί.
const PROFILE_SEED = JSON.stringify({name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678', afm: '123456789'});

// Φωτογραφία: κλειστή στο πιλοτικό (PHOTO_ENABLED = false στο src/app.js). Οι έλεγχοί της τρέχουν όταν ξανανοίξει.
const PHOTO_ON = await p.isVisible('#photo');
if(PHOTO_ON){
  // #1 key: κρυφό, εμφάνιση, όχι αποθήκευση εξ ορισμού
  await p.click('#photo');
  ok('#1 πεδίο key κρυφό (password)', await p.getAttribute('#keyInput', 'type') === 'password');
  await p.fill('#keyInput', 'AIza' + 'B'.repeat(35));
  await p.click('#keyShow');
  ok('#1 κουμπί εμφάνισης', await p.getAttribute('#keyInput', 'type') === 'text');
  ok('#1 «θυμήσου» εξ ορισμού ΟΧΙ', !(await p.isChecked('#keyRemember')));
  ok('#2 κείμενο: Anthropic όχι δωρεάν', /Όχι δωρεάν/.test(await p.textContent('#keySheet')));
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#keySave')]);
  ok('#1 key ΔΕΝ γράφτηκε στο localStorage', await p.evaluate(() => Object.keys(localStorage).filter(k => /key/i.test(k)).length === 0));

  // #3 οθόνη «Πριν σταλεί» με κάλυψη
  await ch.setFiles(PHOTO);
  await p.waitForSelector('#s-redact.on');
  ok('#3 οθόνη «Πριν σταλεί» πριν από την αποστολή', gemBody === null, 'καμία κλήση ακόμα');
  ok('#3 σημείωση απορρήτου για Google', /Google.*δωρεάν.*άνθρωποι/s.test(await p.textContent('#privacyNote')));
  const box = await p.locator('#redactCanvas').boundingBox();
  await p.mouse.move(box.x + 20, box.y + 20); await p.mouse.down(); await p.mouse.move(box.x + box.width - 20, box.y + 120, {steps: 5}); await p.mouse.up();
  // Δείγμα στη μέση της συρμένης περιοχής (CSS y = 70), μετατρεμμένο σε pixels του canvas.
  const black = await p.evaluate(cssY => { const c = document.getElementById('redactCanvas'); const y = Math.floor(cssY * c.height / c.getBoundingClientRect().height); const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), y, 1, 1).data; return d[0] + d[1] + d[2]; }, 70);
  ok('#3 η κάλυψη ζωγραφίζεται πάνω στην εικόνα', black === 0);
  await p.click('#ctaBtn');
  await p.waitForSelector('#s-lines.on');
  ok('#3 στάλθηκε η καλυμμένη εικόνα', !!gemBody && gemBody.contents[0].parts[0].inline_data.data.length > 1000);
} else {
  ok('πιλοτικό: το κουμπί φωτογραφίας ΔΕΝ φαίνεται', !(await p.isVisible('#photo')));
  const chooser = p.waitForEvent('filechooser', {timeout: 1000}).then(() => true, () => false);
  await p.evaluate(() => document.getElementById('photo').click());
  ok('πιλοτικό: ούτε με click από κώδικα ανοίγει κάμερα ή παράθυρο key', !(await chooser) && !(await p.isVisible('#keySheet.on')));
  await p.setInputFiles('#photoInput', PHOTO);
  await p.waitForTimeout(500);
  ok('πιλοτικό: αρχείο στο κρυφό input δεν ανοίγει την οθόνη κάλυψης', await p.isVisible('#s-start.on') && !(await p.isVisible('#s-redact.on')));
  await p.evaluate(() => localStorage.setItem('ergolav.apiKey', 'AIza' + 'B'.repeat(35))); await p.reload();
  ok('πιλοτικό: με αποθηκευμένο key δεν φαίνεται ο σύνδεσμος «Κλειδί ανάγνωσης»', !(await p.isVisible('#keySettings')));
  await p.evaluate(seed => { localStorage.clear(); localStorage.setItem('ergolav.profile', seed); }, PROFILE_SEED); await p.reload();
  // Οι υπόλοιποι έλεγχοι (τιμές, εργασία, ΦΠΑ, PDF) με το ίδιο κείμενο, γραμμένο αντί για φωτογραφημένο.
  await dictate(p, NOTES);
  await p.click('#ctaBtn');
  await p.waitForSelector('#s-lines.on');
}

// Είδος εκτός καταλόγου = κανονική γραμμή προϊόντος ΧΩΡΙΣ τιμή (ποτέ σιωπηλά χαμένο· πριν, b825383, σβηνόταν εντελώς).
const unk = p.locator('.ln:has(.ln-name:text-is("Κλιματιστικά"))');
ok('#C είδος εκτός καταλόγου → γραμμή «Κλιματιστικά» 2 τεμ., «Δεν είναι στον κατάλογο — βάλε τιμή ή σβήσ\' το», πεδίο τιμής ανοιχτό',
  await unk.count() === 1 && /2 τεμ\./.test(await unk.locator('[data-a="qty-edit"]').textContent()) && /Δεν είναι στον κατάλογο — βάλε τιμή ή σβήσ' το/.test(await unk.textContent()) &&
  await unk.locator('[data-p="cmat"]').isVisible(), (await p.textContent('#lines')).slice(0, 80));
ok('#C χωρίς τιμή κλειδώνει το κουμπί (2 γραμμές: κλιματιστικά + 999)', /2 γραμμές/.test(await p.textContent('#ctaNote')) && await p.locator('#ctaBtn').isDisabled(), await p.textContent('#ctaNote'));
ok('#C στα σύνολα δεν μπαίνει χωρίς τιμή', !/Κλιματιστικ/.test(await p.textContent('#totals')));
await unk.locator('[data-a="remove-line"]').click();
ok('#C «Σβήσε» → φεύγει, με «Αναίρεση»', await unk.count() === 0 && await p.locator('#toast [data-a="undo"]').isVisible());
// «999 λεκάνες κρεμαστές» + «λεκάνη κρεμαστή» = το ίδιο υλικό δύο φορές → ρωτάει, δεν αθροίζει σιωπηλά
const dup = p.locator('.ln:has-text("Το είπες δύο φορές")');
ok('#3 ίδιο υλικό δύο φορές → «Το είπες δύο φορές: 1 ή 999 ή 1.000;»', await dup.count() === 1 && /1 ή 999 ή 1\.000;/.test(await dup.textContent()), await p.textContent('#lines'));
await dup.locator('[data-q]', {hasText: '1.000'}).click();
ok('#C μένει μόνο η ποσότητα 999 να επιβεβαιωθεί', /1 γραμμή/.test(await p.textContent('#ctaNote')), await p.textContent('#ctaNote'));
const qc = p.locator('.ln:has([data-p="qty"])').first();
const pre = await qc.locator('[data-p="qty"]').inputValue();
ok('#0 ποσότητα 1000 προσυμπληρώνεται χωρίς «1.000»', pre === '1000', pre);
await qc.locator('[data-a="ok"]').click();
ok('#C μετά την επιβεβαίωση το κουμπί ξεκλειδώνει', await p.locator('#ctaBtn').isEnabled());
const totals = (await p.textContent('#totals')).replace(/\s+/g, ' ');
ok('#C στα σύνολα μπαίνει μόνο ο κατάλογος: υλικά = 1000 × 185 = 185.000,00 €', /Υλικά\s*185\.000,00 €/.test(totals), totals.slice(0, 80));

// ── Α. Τιμές υλικού: τρεις προτάσεις + «Άλλη τιμή» με μνήμη ──
const lek = p.locator('.ln:has(.tiers):has-text("Λεκάνη")').first();
const lekSum = async () => (await lek.locator('.ln-sum').textContent()).trim();
const tierTxt = async t => (await lek.locator(`.tier[data-t="${t}"]`).textContent()).replace(/\s+/g, ' ');
ok('#A οι τρεις προτάσεις + Άλλη τιμή (κανονική = κατάλογος 185,00 €, οικονομική 111,00 €, ακριβή 351,50 €)',
  (await tierTxt('normal')).includes('185,00') && (await tierTxt('eco')).includes('111,00') && (await tierTxt('premium')).includes('351,50') && await lek.locator('.tier[data-t="custom"]').count() === 1,
  [await tierTxt('eco'), await tierTxt('normal'), await tierTxt('premium')].join(' | '));
ok('#A προεπιλογή: κανονική, η προσφορά βγαίνει όπως πριν (185.000,00 €)', await lek.locator('.tier[data-t="normal"]').getAttribute('aria-pressed') === 'true' && (await lekSum()).includes('185.000,00'), await lekSum());
ok('#A χωρίς «Άλλη τιμή» δεν υπάρχει πεδίο ούτε λίστα', await lek.locator('[data-p="cmat"], .hist').count() === 0);
await lek.locator('.tier[data-t="eco"]').click();
ok('#A οικονομική → υλικό 111,00 €/τεμ. (111.000,00 €)', (await lekSum()).includes('111.000,00'), await lekSum());
ok('#A οι προτάσεις δεν μετακινούνται όταν αλλάζει η επιλογή', (await tierTxt('normal')).includes('185,00') && (await tierTxt('premium')).includes('351,50'));
await lek.locator('.tier[data-t="premium"]').click();
ok('#A ακριβή → 351,50 €/τεμ. (351.500,00 €)', (await lekSum()).includes('351.500,00'), await lekSum());
await lek.locator('.tier[data-t="normal"]').click();
// Άλλη τιμή: πρώτη φορά, δεν υπάρχει ιστορικό
await lek.locator('.tier[data-t="custom"]').click();
ok('#A «Άλλη τιμή» ανοίγει πεδίο', await lek.locator('[data-p="cmat"]').isVisible());
ok('#A όσο είναι ανοιχτό το πεδίο το κουμπί κλειδώνει', await p.locator('#ctaBtn').isDisabled());
ok('#A χωρίς ιστορικό δεν εμφανίζεται λίστα', !(await lek.locator('.hist').isVisible()));
await lek.locator('[data-p="cmat"]').fill('1.500');
ok('#A «1.500» → μήνυμα ασάφειας (αυστηρή ανάγνωση)', /ασαφές/.test(await lek.locator('[data-o="cmat"]').textContent()));
await lek.locator('[data-a="keep"]').click();
ok('#A με ασαφή τιμή δεν εφαρμόζεται τίποτα', (await lekSum()).includes('185.000,00') && await lek.locator('[data-p="cmat"]').isVisible());
await lek.locator('[data-p="cmat"]').fill('195');
ok('#A «195» → προεπισκόπηση', (await lek.locator('[data-o="cmat"]').textContent()).includes('195,00 €'));
await lek.locator('[data-a="keep"]').click();
ok('#A «Κράτα την» εφαρμόζει 195 € (195.000,00 €) και ξεκλειδώνει', (await lekSum()).includes('195.000,00') && await p.locator('#ctaBtn').isEnabled(), await lekSum());
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('ergolav.prices') || '{}'));
ok('#A η τιμή θυμήθηκε ανά είδος+τύπο, με ημερομηνία', Object.entries(stored).some(([k, v]) => /^wc\|/.test(k) && v[0].c === 19500 && Math.abs(v[0].at - Date.now()) < 60000), JSON.stringify(stored).slice(0, 120));
// δεύτερη τιμή + «παλιά» τιμή (200 ημέρες) για τον ίδιο τύπο
const key = Object.keys(stored).find(k => /^wc\|/.test(k));
await p.evaluate(([k]) => { const d = JSON.parse(localStorage.getItem('ergolav.prices')); d[k].push({c: 17800, at: Date.now() - 200 * 86400000}); localStorage.setItem('ergolav.prices', JSON.stringify(d)); }, [key]);
await lek.locator('.tier[data-t="custom"]').click();
ok('#A οι αποθηκευμένες τιμές φαίνονται μόνο όταν πατηθεί «Άλλη τιμή»', await lek.locator('.hist').isVisible());
const hist = (await lek.locator('.hi').allTextContents()).map(t => t.replace(/\s+/g, ' '));
ok('#A νεότερη πρώτη, με ημερομηνία: «195,00 € σήμερα», μετά «178,00 €»', hist.length === 2 && /195,00 €\s*σήμερα/.test(hist[0]) && /178,00 €/.test(hist[1]), hist.join(' | '));
ok('#A τιμή πάνω από 6 μήνες: «έλεγξε αν άλλαξε»', /έλεγξε αν άλλαξε/.test(hist[1]) && !/έλεγξε/.test(hist[0]), hist.join(' | '));
ok('#A ΔΕΝ μπαίνει αυτόματα από το ιστορικό (το πεδίο είναι άδειο)', await lek.locator('[data-p="cmat"]').inputValue() === '');
await lek.locator('[data-p="cmat"]').pressSequentially('1');
ok('#A στην πρώτη πληκτρολόγηση η λίστα κρύβεται', !(await lek.locator('.hist').isVisible()));
await lek.locator('[data-p="cmat"]').fill('');
ok('#A αν αδειάσει το πεδίο, η λίστα ξαναφαίνεται', await lek.locator('.hist').isVisible());
await lek.locator('.hi').nth(1).click();
ok('#A πάτημα σε τιμή γεμίζει το πεδίο (δεν την εφαρμόζει)', await lek.locator('[data-p="cmat"]').inputValue() === '178' && (await lekSum()).includes('195.000,00'));
await lek.locator('[data-a="cancel"]').click();
ok('#A «Άκυρο» κλείνει χωρίς αλλαγή και ξεκλειδώνει', (await lekSum()).includes('195.000,00') && await p.locator('#ctaBtn').isEnabled());
await lek.locator('.tier[data-t="normal"]').click();   // πίσω στην κανονική για τα υπόλοιπα

// ── Β. Εργασία: ένα πεδίο για όλη τη δουλειά ──
const labIn = p.locator('#laborBox [data-p="labor"]');
ok('#B καμία κάρτα δεν έχει πεδίο εργασίας', await p.locator('#lines [data-p="lab"]').count() === 0);
ok('#B ένα πεδίο, προσυμπληρωμένο με την πρόταση του καταλόγου (1000 × 90 € = 90000)', await p.locator('#laborBox [data-p="labor"]').count() === 1 && await labIn.inputValue() === '90000', await labIn.inputValue());
await labIn.fill('1.500');
ok('#B «1.500» → μήνυμα ασάφειας', /ασαφές/.test(await p.locator('#laborBox [data-o="labor"]').textContent()));
ok('#B άκυρη εργασία → το κουμπί κλειδώνει με σαφές μήνυμα', await p.locator('#ctaBtn').isDisabled() && /εργασία/.test(await p.textContent('#ctaNote')), await p.textContent('#ctaNote'));
await labIn.fill('300,50');
ok('#B «300,50» → προεπισκόπηση και ξεκλειδώνει', (await p.locator('#laborBox [data-o="labor"]').textContent()).includes('300,50 €') && await p.locator('#ctaBtn').isEnabled());
const tot = (await p.textContent('#totals')).replace(/\s+/g, ' ');
ok('#B τα σύνολα ενημερώνονται (Εργασία 300,50 €)', /Εργασία\s*300,50 €/.test(tot), tot.slice(0, 90));
ok('#B μετά το δικό του νούμερο φαίνεται η πρόταση για σύγκριση', /Πρόταση καταλόγου: 90\.000,00 €/.test(await p.textContent('#laborBox')));
await p.locator('.ln:has-text("Λεκάνη") [data-d="1"]').click();
ok('#B ό,τι έγραψε μένει όταν αλλάξουν ποσότητες (η πρόταση ακολουθεί: 90.090,00 €)', await labIn.inputValue() === '300,50' && /Πρόταση καταλόγου: 90\.090,00 €/.test(await p.textContent('#laborBox')), await labIn.inputValue());
await p.locator('#laborBox [data-a="auto"]').click();
ok('#B «Χρησιμοποίησέ την» επιστρέφει στην αυτόματη πρόταση (90090)', await labIn.inputValue() === '90090');
await labIn.fill('0');
ok('#B το 0 επιτρέπεται (χωρίς εργασία)', await p.locator('#ctaBtn').isEnabled() && /Εργασία\s*0,00 €/.test(await p.textContent('#totals')));
await labIn.fill('300,50');

// #4 ΦΠΑ
await p.selectOption('#vatRate', '17');
const t17 = (await p.textContent('#totals')).replace(/\s+/g, ' ');
ok('#4 ΦΠΑ 17%', /ΦΠΑ 17%/.test(t17), t17.match(/ΦΠΑ 17%[^Σ]*/)?.[0]);
await p.click('#ctaBtn');
await p.waitForSelector('#s-pdf.on');
ok('#4 ΦΠΑ 17% και στο PDF', /ΦΠΑ 17%/.test(await p.textContent('#pdf')));
// Όσο φτιάχνεται το PDF, το html2pdf κρατά προσωρινό αντίγραφο του #pdf στη σελίδα: διαβάζουμε αφού τελειώσει.
await p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Στείλε στον πελάτη', null, {timeout: 30000});
const pdfHead = async () => (await p.textContent('#pdf .pdf-head')).replace(/\s+/g, ' ');
ok('#P PDF: τα δικά του στοιχεία (όνομα, ειδικότητα, τηλέφωνο, αρχικά), χωρίς ΑΦΜ', /ΝΠ\s*Νίκος Παπαδάκης\s*Υδραυλικός\s*Τηλ\. 6912345678/.test(await pdfHead()) && !/ΑΦΜ|123456789/.test(await p.textContent('#pdf')), await pdfHead());
ok('#P κανένα ΑΦΜ στη συσκευή (ούτε από παλιά αποθήκευση)', !/afm|123456789/.test(await p.evaluate(() => localStorage.getItem('ergolav.profile'))));
ok('#P PDF: κανένα σταθερό στοιχείο («Αντωνίου», «0142», «ΚΑ»)', !/Αντωνίου|0142|Κατασκευές|\bΚΑ\b/.test(await p.textContent('#pdf')));
const qno = async (pg = p) => (await pg.textContent('#pdf .qno')).trim();
ok('#P PDF: πρώτη προσφορά της συσκευής = Αρ. 1', await qno() === '1', await qno());
ok('#P PDF: άδειος πελάτης → «Προς: —»', (await p.textContent('#pdf .who')).trim() === 'Προς: —');
// PDF: υλικά ανά γραμμή, η εργασία ΜΙΑ φορά στα σύνολα.
const eurN = t => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
const rows = await p.$$eval('#pdf table tr:not(:has(th))', trs => trs.map(tr => [...tr.children].map(td => td.textContent)));
const sumRow = async name => eurN(await p.$eval('#pdf .sum', (e, n) => [...e.children].find(d => d.firstChild.textContent.startsWith(n))?.lastChild.textContent ?? '0', name));
ok('#B PDF: στήλες μόνο Περιγραφή + Υλικό (η εργασία δεν είναι στήλη)', rows.length > 0 && rows.every(r => r.length === 2) && (await p.$$eval('#pdf th', t => t.map(x => x.textContent))).join() === 'Περιγραφή,Υλικό');
const matLines = rows.reduce((a, r) => a + eurN(r[1]), 0);
ok('#B PDF: άθροισμα υλικών γραμμών = «Υλικά»', Math.abs(matLines - await sumRow('Υλικά')) < 0.005, `${matLines} vs ${await sumRow('Υλικά')}`);
ok('#B PDF: η εργασία εμφανίζεται μία φορά, 300,50 €', (await p.textContent('#pdf')).match(/Εργασία/g).length === 1 && await sumRow('Εργασία') === 300.5);
ok('#B PDF: υλικά + εργασία = καθαρή αξία', Math.abs(await sumRow('Υλικά') + await sumRow('Εργασία') - await sumRow('Καθαρή')) < 0.005);
ok('#C το είδος εκτός καταλόγου ΔΕΝ υπάρχει στο PDF', !/Κλιματιστικ/.test(await p.textContent('#pdf')));
if(process.env.SHOT_DIR) await p.locator('#pdf').screenshot({path: process.env.SHOT_DIR + '/pdf.png'});
await p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Στείλε στον πελάτη', null, {timeout: 30000}).catch(() => {});
ok('#5 PDF φτιάχνεται με ενεργή CSP', await p.textContent('#ctaBtn') === 'Στείλε στον πελάτη', await p.textContent('#ctaBtn'));

if(PHOTO_ON){
  // #1 «θυμήσου» + «ξέχασε»
  await p.goto('http://localhost:8080/');
  await p.click('#photo');
  await p.fill('#keyInput', 'sk-ant-' + 'x'.repeat(40));
  await p.check('#keyRemember');
  const [ch2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#keySave')]);
  ok('#1 με «θυμήσου» αποθηκεύεται', await p.evaluate(() => !!localStorage.getItem('ergolav.apiKey')));
  // #2 Claude: μοντέλο + SDK τοπικά
  await ch2.setFiles(PHOTO);
  await p.waitForSelector('#s-redact.on');
  ok('#3 σημείωση απορρήτου για Anthropic', /Anthropic/.test(await p.textContent('#privacyNote')));
  await p.click('#ctaBtn');
  await p.waitForSelector('#s-lines.on', {timeout: 20000}).catch(() => {});
  ok('#2 Claude μοντέλο claude-sonnet-5-5', claudeBody?.model === 'claude-sonnet-5-5', claudeBody?.model);
  ok('#2 fallbacks/effort στο αίτημα', claudeBody?.fallbacks === 'default' && claudeBody?.output_config?.effort === 'low');
  await p.goto('http://localhost:8080/');
  ok('#1 σύνδεσμος «Κλειδί ανάγνωσης» στην αρχική', await p.isVisible('#keySettings'));
  await p.click('#keySettings');
  ok('#1 «Ξέχασε το key» εμφανίζεται', await p.isVisible('#keyForget'));
  await p.click('#keyForget');
  ok('#1 «Ξέχασε» σβήνει το key', await p.evaluate(() => !localStorage.getItem('ergolav.apiKey')));
  ok('#1 μετά το «Ξέχασε» ζητάει ξανά key', (await p.click('#photo'), await p.isVisible('#keySheet.on')));
  await p.goto('http://localhost:8080/');
  ok('#1 μετά από reload δεν υπάρχει key', !(await p.isVisible('#keySettings')));
}

// ── Β. γραμμή μόνο εργασίας + νέα ανάλυση μηδενίζει την εργασία ──
await p.goto('http://localhost:8080/');
await dictate(p, 'αποξήλωση παλιών ειδών και δύο μπαταρίες νιπτήρα');
await p.click('#ctaBtn');
await p.waitForSelector('#s-lines.on');
const dem = p.locator('.ln:has-text("Αποξήλωση")');
ok('#B γραμμή μόνο εργασίας: «στην εργασία», χωρίς επιλογή τιμής', (await dem.locator('.ln-sum').textContent()).includes('στην εργασία') && await dem.locator('.tier').count() === 0);
ok('#B η πρόταση περιέχει την εργασία της αποξήλωσης (250 + 2 × 35 = 320)', await p.locator('#laborBox [data-p="labor"]').inputValue() === '320', await p.locator('#laborBox [data-p="labor"]').inputValue());
await p.click('#ctaBtn');
await p.waitForSelector('#s-pdf.on');
const rows2 = await p.$$eval('#pdf table tr:not(:has(th))', trs => trs.map(tr => [...tr.children].map(td => td.textContent)));
ok('#P δεύτερη προσφορά = Αρ. 2', await qno() === '2', await qno());
// αλλαγή από την κεφαλίδα: ίδια φόρμα, συμπληρωμένη· μετά πίσω στο PDF, με τα νέα στοιχεία και τον ΙΔΙΟ αριθμό
await p.click('#brand');
ok('#P πάτημα στην κεφαλίδα → ίδια φόρμα, με τα στοιχεία του', await p.isVisible('#s-profile.on') && await p.inputValue('#pfName') === 'Νίκος Παπαδάκης' && await p.inputValue('#pfPhone') === '6912345678');
await p.fill('#pfTrade', 'Υδραυλικός · Θερμοϋδραυλικά');
await p.click('#pfSave');
await p.waitForSelector('#s-pdf.on');
ok('#P μετά την αλλαγή: πίσω στο PDF με τη νέα ειδικότητα, ίδιος αριθμός (Αρ. 2)', /Θερμοϋδραυλικά/.test(await pdfHead()) && await qno() === '2' && await p.textContent('#brandTrade') === 'Υδραυλικός · Θερμοϋδραυλικά', await pdfHead());
await p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Στείλε στον πελάτη', null, {timeout: 30000}).catch(() => {});
ok('#B PDF: γραμμή μόνο εργασίας γράφει «στην εργασία»', rows2.some(r => /Αποξήλωση/.test(r[0]) && r[1].trim() === 'στην εργασία'), JSON.stringify(rows2));
// νέα ανάλυση: η εργασία ξαναρχίζει από την πρόταση
await p.goto('http://localhost:8080/');
await dictate(p, 'τρεις πρίζες');
await p.click('#ctaBtn');
await p.waitForSelector('#s-lines.on');
ok('#B νέα προσφορά: η εργασία ξαναρχίζει από την πρόταση (3 × 12 = 36)', await p.locator('#laborBox [data-p="labor"]').inputValue() === '36', await p.locator('#laborBox [data-p="labor"]').inputValue());
ok('#A οι τιμές που έγραψε μένουν και στην επόμενη προσφορά (μνήμη ανά συσκευή)', await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ergolav.prices') || '{}')).length > 0));

// μόνο εκτός καταλόγου, με ποσότητα → κάρτες για απόφαση (πριν: σβήνονταν και έμενες στο κείμενο)
await p.goto('http://localhost:8080/');
await dictate(p, 'ένα κλιματιστικό και δύο ρίζες');
await p.click('#ctaBtn');
await p.waitForSelector('#s-lines.on');
ok('#C μόνο εκτός καταλόγου: δύο γραμμές χωρίς τιμή, κουμπί κλειδωμένο', await p.locator('.ln:has-text("Δεν είναι στον κατάλογο")').count() === 2 && await p.locator('#ctaBtn').isDisabled());
// τίποτα που να είναι υλικό (τηλέφωνο, όνομα) → μήνυμα, μένεις στο κείμενο
await p.goto('http://localhost:8080/');
await dictate(p, 'μπάνιο για τον κύριο Παπαδόπουλο στο 6912345678');
await p.click('#ctaBtn');
ok('#C τηλέφωνο / όνομα πελάτη δεν γίνονται κάρτες: μήνυμα, και μένεις στο κείμενο', await p.isVisible('#s-listen.on') && !(await p.isVisible('#s-lines.on')) && /κανένα υλικό/.test(await p.textContent('#notice')), await p.textContent('#notice'));

// ── Μέγεθος: ό,τι υπάρχει στον κατάλογο μπαίνει· ό,τι δεν υπάρχει ρωτάει και κλειδώνει το κουμπί ──
const lnSum = async loc => eurN(await loc.locator('.ln-sum').textContent());
await p.goto('http://localhost:8080/');
await dictate(p, 'θερμοσίφωνας 100 λίτρα και θερμοσίφωνας και θερμοσίφωνας 90 λίτρα');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
const h100 = p.locator('.ln:has(.ln-name:text-is("Θερμοσίφωνας 100 λ."))');
ok('#S «θερμοσίφωνας 100 λίτρα» → 100 λ. χωρίς ερώτηση, 300,00 €', await h100.count() === 1 && !(await h100.getAttribute('class')).includes('flag') && await lnSum(h100) === 300);
ok('#S «θερμοσίφωνας» → 80 λ. χωρίς ερώτηση', await p.locator('.ln:not(.flag):has(.ln-name:text-is("Θερμοσίφωνας 80 λ."))').count() === 1);
const big = p.locator('.ln.flag:has-text("Είπες 90 λ.")');
ok('#S «90 λίτρα» → «Είπες 90 λ. — ο κατάλογος έχει 80 λ. ή 100 λ.» με κουμπιά 80/100/Άλλο',
  await big.count() === 1 && /Είπες 90 λ\. — ο κατάλογος έχει 80 λ\. ή 100 λ\. Διάλεξε/.test(await big.textContent()) &&
  (await big.locator('[data-near]').allTextContents()).join('|') === '80 λ.|100 λ.' && await big.locator('[data-a="size-other"]').count() === 1,
  (await big.textContent()).replace(/\s+/g, ' ').slice(0, 120));
ok('#S το κουμπί μένει κλειδωμένο', await p.locator('#ctaBtn').isDisabled() && /1 γραμμή/.test(await p.textContent('#ctaNote')), await p.textContent('#ctaNote'));
await big.locator('[data-near]', {hasText: '100 λ.'}).click();
ok('#S επιλογή «100 λ.» → γίνεται 100 λ. και ξεκλειδώνει', await p.locator('.ln.flag').count() === 0 && await p.locator('.ln:has(.ln-name:text-is("Θερμοσίφωνας 100 λ."))').count() === 2 && await p.locator('#ctaBtn').isEnabled());
await p.goto('http://localhost:8080/');
await dictate(p, 'έπιπλο 70 εκατοστά');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#S «έπιπλο 70» → ερώτηση 60/80', (await p.locator('[data-near]').allTextContents()).join('|') === '60 εκ.|80 εκ.');
await p.locator('[data-a="size-other"]').click();
ok('#S «Άλλο μέγεθος» → όνομα 70 εκ., τιμή με το χέρι (κουμπί κλειδωμένο)', /Έπιπλο μπάνιου με νιπτήρα 70 εκ\./.test(await p.textContent('#lines')) && await p.locator('[data-p="cmat"]').isVisible() && await p.locator('#ctaBtn').isDisabled());
ok('#S μετά το «Άλλο μέγεθος» δεν προτείνονται τιμές του καταλόγου (είναι για άλλο μέγεθος)', await p.locator('.tier[data-t="normal"], .tier[data-t="eco"], .tier[data-t="premium"]').count() === 0);
await p.locator('.custom [data-a="cancel"]').click();
ok('#S «Άκυρο» χωρίς τιμή → πίσω στην ερώτηση: όνομα 80 εκ., ξανά οι επιλογές, κουμπί κλειδωμένο',
  await p.locator('.ln.flag:has-text("Είπες 70 εκ.")').count() === 1 && !/70 εκ\./.test(await p.textContent('.ln-name')) &&
  await p.locator('[data-near]').count() === 2 && await p.locator('[data-a="size-other"]').isVisible() && await p.locator('#ctaBtn').isDisabled(),
  await p.textContent('#lines'));
await p.locator('[data-a="size-other"]').click();
await p.locator('[data-p="cmat"]').fill('250');
await p.locator('.custom [data-a="keep"]').click();
ok('#S με τη δική του τιμή ξεκλειδώνει', await p.locator('#ctaBtn').isEnabled() && /250,00/.test(await p.textContent('#lines')));
await p.locator('.tier[data-t="custom"]').click();
await p.locator('.custom [data-a="cancel"]').click();
ok('#S αφού έχει δική του τιμή, «Άκυρο» την κρατά (70 εκ., 250,00 €)', await p.locator('#ctaBtn').isEnabled() && /70 εκ\./.test(await p.textContent('.ln-name')) && /250,00/.test(await p.textContent('#lines')));

// ── Τύπος από την κάρτα: αλλάζει όνομα, κωδικό, προτάσεις τιμής, σύνολα και PDF ──
await p.goto('http://localhost:8080/');
await dictate(p, 'θερμοσίφωνας');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
const hc = p.locator('.ln').first();
ok('#T η σειρά τύπων φαίνεται πάντα, με το τωρινό επιλεγμένο (80 λ.)', (await hc.locator('.tp').allTextContents()).join('|') === '60 λ.|80 λ.|100 λ.|120 λ.|160 λ.' && await hc.locator('.tp.on').textContent() === '80 λ.');
await hc.locator('.tp', {hasText: '120 λ.'}).click();
ok('#T «120 λ.» → όνομα, κωδικός και τιμή (340,00 €)', await hc.locator('.ln-name').textContent() === 'Θερμοσίφωνας 120 λ.' && /ΚΩΔ\. 30120/.test(await hc.locator('.ln-meta').textContent()) && await lnSum(hc) === 340);
ok('#T οι τρεις προτάσεις ακολουθούν τον νέο τύπο (κανονική 340,00 €)', (await hc.locator('.tier[data-t="normal"]').textContent()).includes('340,00'));
ok('#T τα σύνολα ενημερώνονται (Υλικά 340,00 €)', /Υλικά\s*340,00 €/.test(await p.textContent('#totals')));
// δική του τιμή για τον 120 λ. → φαίνεται στη λίστα μόνο για αυτόν τον κωδικό
await hc.locator('.tier[data-t="custom"]').click();
await hc.locator('[data-p="cmat"]').fill('355');
await hc.locator('.custom [data-a="keep"]').click();
await hc.locator('.tp', {hasText: '100 λ.'}).click();
ok('#T άλλος τύπος → κανονική τιμή του τύπου (300,00 €), όχι η δική του του 120 λ.', await lnSum(hc) === 300 && await hc.locator('.tier.on[data-t="normal"]').count() === 1);
await hc.locator('.tier[data-t="custom"]').click();
ok('#T στον 100 λ. δεν εμφανίζεται η τιμή του 120 λ.', await hc.locator('.hi').count() === 0);
await hc.locator('.custom [data-a="cancel"]').click();
await hc.locator('.tp', {hasText: '120 λ.'}).click();
await hc.locator('.tier[data-t="custom"]').click();
ok('#T στον 120 λ. η αποθηκευμένη τιμή εμφανίζεται για επιλογή (όχι αυτόματα)', /355,00/.test(await hc.locator('.hist').textContent()) && await hc.locator('[data-p="cmat"]').inputValue() === '' && await lnSum(hc) === 340);
await hc.locator('.custom [data-a="cancel"]').click();

// ── Περιγραφή: μόνο κείμενο στο PDF ──
await hc.locator('[data-a="desc-edit"]').click();
ok('#D όσο είναι ανοιχτή η περιγραφή, το κουμπί κλειδώνει', await p.locator('#ctaBtn').isDisabled());
await hc.locator('[data-p="desc"]').fill('Θερμοσίφωνας Nobel 120 λ.');
await hc.locator('[data-a="desc-keep"]').click();
ok('#D η κάρτα δείχνει την περιγραφή, τιμή και κωδικός ίδια', await hc.locator('.ln-name').textContent() === 'Θερμοσίφωνας Nobel 120 λ.' && /ΚΩΔ\. 30120/.test(await hc.locator('.ln-meta').textContent()) && await lnSum(hc) === 340);

// ── Ποσότητα με γράψιμο ──
await hc.locator('[data-a="qty-edit"]').click();
await hc.locator('[data-p="eqty"]').fill('1.500');
ok('#Q «1.500» ως ποσότητα → ασαφές, κουμπί κλειδωμένο', /ασαφές/.test(await hc.locator('[data-o="eqty"]').textContent()) && await p.locator('#ctaBtn').isDisabled());
await hc.locator('[data-a="qty-keep"]').click();
ok('#Q με ασαφή ποσότητα δεν εφαρμόζεται τίποτα', await hc.locator('[data-p="eqty"]').isVisible() && await lnSum(hc) === 340);
await hc.locator('[data-p="eqty"]').fill('2');
await hc.locator('[data-a="qty-keep"]').click();
ok('#Q «2» → 2 τεμ., 680,00 €, ξεκλειδώνει', /2 τεμ\./.test(await hc.locator('[data-a="qty-edit"]').textContent()) && await lnSum(hc) === 680 && await p.locator('#ctaBtn').isEnabled());
await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
const pdfRows = await p.$$eval('#pdf table tr:not(:has(th))', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ')));
ok('#T #D #Q το PDF: δική του περιγραφή, 2 τεμ., 680,00 €', pdfRows.length === 1 && /Θερμοσίφωνας Nobel 120 λ\./.test(pdfRows[0]) && /2 τεμ\./.test(pdfRows[0]) && /680,00/.test(pdfRows[0]), pdfRows.join(' | '));

// ── Κατανάλωση: κόλλα / αρμόστοκος ──
await p.goto('http://localhost:8080/');
await dictate(p, '15 τετραγωνικά πλακάκι μάρμαρο');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
const gl = p.locator('.ln:has-text("Κόλλα πλακιδίων")'), gr = p.locator('.ln:has-text("Αρμόστοκος")');
ok('#K κόλλα 60×120: «15 τ.μ. × 7 kg/τ.μ. + 10% φύρα = 5 σακιά»', /15 τ\.μ\. × 7 kg\/τ\.μ\. \+ 10% φύρα = 5 σακιά/.test(await gl.textContent()), (await gl.textContent()).replace(/\s+/g, ' '));
ok('#K προτείνεται και αρμόστοκος', await gr.count() === 1);
await gl.locator('[data-a="keep"]').click(); await gr.locator('[data-a="keep"]').click();
await gl.locator('[data-p="rate"]').fill('5');
ok('#K kg/τ.μ. 5 → 4 σακιά, αμέσως', /= 4 σακιά/.test(await gl.locator('[data-calc]').textContent()) && /4 σακί/.test(await gl.locator('[data-a="qty-edit"]').textContent()));
await gl.locator('[data-p="waste"]').fill('1.500');
ok('#K άκυρη φύρα → μήνυμα, κουμπί κλειδωμένο', !!(await gl.locator('[data-o="waste"]').textContent()) && await p.locator('#ctaBtn').isDisabled());
await gl.locator('[data-p="waste"]').fill('10');
ok('#K έγκυρη φύρα ξεκλειδώνει', await p.locator('#ctaBtn').isEnabled());
const tile = p.locator('.ln:has(.ln-name:has-text("Πλακάκι"))');
await tile.locator('[data-a="qty-edit"]').click(); await tile.locator('[data-p="eqty"]').fill('30'); await tile.locator('[data-a="qty-keep"]').click();
ok('#K η κόλλα ακολουθεί τα τ.μ. (30 τ.μ. → 7 σακιά)', /30 τ\.μ\. × 5 kg\/τ\.μ\. \+ 10% φύρα = 7 σακιά/.test(await gl.locator('[data-calc]').textContent()), await gl.locator('[data-calc]').textContent());
await gl.locator('[data-a="qty-edit"]').click(); await gl.locator('[data-p="eqty"]').fill('9'); await gl.locator('[data-a="qty-keep"]').click();
ok('#K δική του ποσότητα: «δική σου ποσότητα» + επαναφορά', /9 σακί/.test(await gl.locator('[data-a="qty-edit"]').textContent()) && /Δική σου ποσότητα/.test(await gl.textContent()) && await gl.locator('[data-a="calc-reset"]').count() === 1);
await tile.locator('[data-d="1"]').click();
ok('#K χειροκίνητη ποσότητα κόλλας ΔΕΝ αλλάζει όταν αλλάξουν τα τ.μ.', /9 σακί/.test(await gl.locator('[data-a="qty-edit"]').textContent()));
await gl.locator('[data-a="calc-reset"]').click();
ok('#K «επαναφορά στον υπολογισμό» → 31 τ.μ. → 7 σακιά', /7 σακί/.test(await gl.locator('[data-a="qty-edit"]').textContent()) && !/Δική σου ποσότητα/.test(await gl.textContent()));
ok('#K τα σύνολα περιλαμβάνουν την κόλλα (7 × 9,80 € = 68,60 €)', await lnSum(gl) === 68.6 && /Υλικά/.test(await p.textContent('#totals')));

// ════ Δοκιμή ~450 χαρακτήρων, 18 υλικά: κανένα χαμένο, καμία διπλή γραμμή, εργασία από τη φωνή, ΦΠΑ μόνο από λίστα ════
const LONG = 'Ανακαίνιση μπάνιου στον δεύτερο όροφο για τον κύριο Παπαδόπουλο, τηλέφωνο 6912345678. 12 μέτρα σωλήνα πολυστρωματικό Φ20, 2 βάνες, 6 γωνίες, ' +
  '10 ρακόρ, 4 ταυ, λεκάνη κρεμαστή με καζανάκι εντοιχισμού, μηχανισμός καζανακιού, σετ ντους με μπάρα, έπιπλο μπάνιου 80 εκατοστά, ' +
  'μπαταρία νιπτήρα, θερμοσίφωνας 100 λίτρα, 15 τετραγωνικά πλακάκι τοίχου λευκό, 6 τετραγωνικά στεγάνωση, 4 σποτ, 2 πρίζες, ' +
  '20 μέτρα καλώδιο 2,5, 3 σίτες. Εργασία 1.200 ευρώ.';
const EXPECT = ['Σωλήνας πολυστρωματικός Φ20', 'Βάνα σφαιρική 1/2"', 'Γωνία πολυστρωματική Φ20', 'Ρακόρ / σύνδεσμος Φ20', 'Ταυ πολυστρωματικό Φ20',
  'Λεκάνη κρεμαστή', 'Καζανάκι εντοιχισμού', 'Μηχανισμός καζανακιού', 'Σετ ντους απλό με μπάρα', 'Έπιπλο μπάνιου με νιπτήρα 80 εκ.',
  'Μπαταρία νιπτήρα αναμεικτική', 'Θερμοσίφωνας 100 λ.', 'Πλακάκι τοίχου 30×60 λευκό ματ', 'Στεγάνωση δαπέδου μπάνιου',
  'Φωτιστικό σποτ LED χωνευτό', 'Πρίζα σούκο χωνευτή', 'Καλώδιο ΝΥΜ 3×2,5'];   // + «3 σίτες» εκτός καταλόγου = 18
await p.goto('http://localhost:8080/');
await dictate(p, LONG);
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
const names = await p.$$eval('#lines .ln-name', els => els.map(e => e.textContent));
const siteLn = p.locator('.ln:has(.ln-name:text-is("Σίτες"))');
ok(`#L κείμενο ${LONG.length} χαρακτήρων: και τα 18 υλικά υπάρχουν (17 του καταλόγου + «Σίτες» χωρίς τιμή)`,
  LONG.length >= 430 && EXPECT.every(n => names.includes(n)) && await siteLn.count() === 1, EXPECT.filter(n => !names.includes(n)).join(' | ') || names.length);
ok('#L καμία διπλή γραμμή (κάθε όνομα μία φορά)', names.length === new Set(names).size, names.join(' | '));
ok('#L μόνο ένα καζανάκι και ένας μηχανισμός', names.filter(n => /Καζανάκι/.test(n)).length === 1 && names.filter(n => /Μηχανισμός/.test(n)).length === 1);
ok('#L «σετ ντους» δεν έγινε ντουζιέρα', !names.some(n => /Ντουζιέρα/.test(n)));
ok('#L τηλέφωνο / όνομα πελάτη δεν έγιναν κάρτες', !/6912345678|Παπαδόπουλο/.test(await p.textContent('#lines')));
ok('#L «Εργασία 1.200 ευρώ» → εργασία 1.200,00 € (όχι 1.200 τεμάχια, όχι η πρόταση)',
  await p.locator('#laborBox [data-p="labor"]').inputValue() === '1200' && /από τη φωνή — έλεγξε/.test(await p.textContent('#laborBox')) && /Εργασία\s*1\.200,00 €/.test(await p.textContent('#totals')) &&
  !/Εργασία ευρώ/.test(await p.textContent('#lines')), await p.textContent('#laborBox'));
// προτάσεις κόλλας/αρμόστοκου + η κάρτα «σίτες» → πρόσθεσέ το με δική του τιμή
await p.locator('.ln:has-text("Κόλλα πλακιδίων") [data-a="keep"]').click();
await p.locator('.ln:has-text("Αρμόστοκος") [data-a="keep"]').click();
ok('#L «Σίτες» χωρίς τιμή κλειδώνει το κουμπί', await p.locator('#ctaBtn').isDisabled() && /1 γραμμή/.test(await p.textContent('#ctaNote')), await p.textContent('#ctaNote'));
ok('#L «Σίτες»: όνομα και ποσότητα από τη φράση, τιμή υποχρεωτικά δική του (χωρίς προτάσεις καταλόγου)',
  /3 τεμ\./.test(await siteLn.locator('[data-a="qty-edit"]').textContent()) && await siteLn.locator('[data-p="cmat"]').isVisible() &&
  await siteLn.locator('.tier[data-t="normal"]').count() === 0);
await siteLn.locator('.custom [data-a="cancel"]').click();
ok('#L «Άκυρο» χωρίς τιμή → μένει γραμμή χωρίς τιμή, κουμπί κλειδωμένο', await siteLn.count() === 1 && /βάλε τιμή/.test(await siteLn.textContent()) && await p.locator('#ctaBtn').isDisabled());
await siteLn.locator('.tier[data-t="custom"]').click();
await siteLn.locator('[data-p="cmat"]').fill('25');
await siteLn.locator('.custom [data-a="keep"]').click();
ok('#L με δική του τιμή: 3 × 25 = 75,00 € και ξεκλειδώνει', await lnSum(siteLn) === 75 && await p.locator('#ctaBtn').isEnabled());
// ΦΠΑ: μόνο από τη λίστα — πειραγμένη επιλογή 7,25% αγνοείται
await p.selectOption('#vatRate', '24');
await p.evaluate(() => { const s = document.getElementById('vatRate'); s.add(new Option('7,25%', '7.25')); s.value = '7.25'; s.dispatchEvent(new Event('change')); });
ok('#V ΦΠΑ 7,25% (εκτός λίστας) δεν γίνεται δεκτός· μένει 24%', /ΦΠΑ 24%/.test(await p.textContent('#totals')) && !/7[,.]25/.test(await p.textContent('#totals')) &&
  (await p.$$eval('#vatRate option', o => o.map(x => x.value))).join() === '24,17,13,9,6,4,0');
await p.selectOption('#vatRate', '13');
ok('#V ΦΠΑ από τη λίστα (13%) δουλεύει', /ΦΠΑ 13%/.test(await p.textContent('#totals')));
await p.selectOption('#vatRate', '24');
// Αφαίρεση στο ελάχιστο + αναίρεση
const mech = p.locator('.ln:has(.ln-name:text-is("Μηχανισμός καζανακιού"))');
ok('#Z στο ελάχιστο (1 τεμ.) το − γίνεται «Αφαίρεση»', await mech.locator('[data-a="remove"]').count() === 1 && await mech.locator('[data-d="-1"]').count() === 0);
await mech.locator('[data-a="remove"]').click();
ok('#Z «Αφαίρεση» → η γραμμή φεύγει, με «Αναίρεση»', await mech.count() === 0 && await p.locator('#toast').isVisible());
await p.locator('#toast [data-a="undo"]').click();
ok('#Z «Αναίρεση» → η γραμμή γυρίζει στη θέση της', await mech.count() === 1 && (await p.$$eval('#lines .ln-name', e => e.map(x => x.textContent))).indexOf('Μηχανισμός καζανακιού') === 7);
const sock = p.locator('.ln:has(.ln-name:text-is("Πρίζα σούκο χωνευτή"))');
await sock.locator('[data-d="-1"]').click();
ok('#Z από 2 σε 1 με το −, μετά «Αφαίρεση» (ποτέ 0)', /1 τεμ\./.test(await sock.locator('[data-a="qty-edit"]').textContent()) && await sock.locator('[data-a="remove"]').count() === 1);
await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
const longRows = await p.$$eval('#pdf table tr:not(:has(th))', trs => trs.map(tr => tr.querySelector('.q').textContent));
ok('#L PDF: 18 υλικά + κόλλα + αρμόστοκος = 20 γραμμές, καμία με ποσότητα 0', longRows.length === 20 && longRows.every(q => !/^0\s/.test(q)), longRows.join(' | '));
ok('#L PDF: εργασία 1.200,00 €, ΦΠΑ 24%', /Εργασία\s*1\.200,00 €/.test(await p.textContent('#pdf')) && /ΦΠΑ 24%/.test(await p.textContent('#pdf')));

// ── «ντους» σκέτο → ρωτάει· επιλογή γίνεται το υλικό ──
await p.goto('http://localhost:8080/');
await dictate(p, 'ένα ντους');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#N σκέτο «ντους» → «Ντουζιέρα ή σετ ντους;», κουμπί κλειδωμένο', /Ντουζιέρα ή σετ ντους;/.test(await p.textContent('#lines')) && await p.locator('#ctaBtn').isDisabled());
await p.locator('[data-c]', {hasText: 'Σετ ντους'}).click();
ok('#N επιλογή «Σετ ντους» → γραμμή σετ ντους με τύπους', await p.locator('.ln-name:text-is("Σετ ντους απλό με μπάρα")').count() === 1 && await p.locator('.tp').count() === 2 && await p.locator('#ctaBtn').isEnabled());

// ── Εργασία: ασαφές ποσό από τη φωνή → δεν μπαίνει, ρωτάει ──
await p.goto('http://localhost:8080/');
await dictate(p, 'τρεις πρίζες, εργασία 1.5 ευρώ');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#E «εργασία 1.5 ευρώ» → δεν μπαίνει, «Γράψε το ποσό», κουμπί κλειδωμένο',
  await p.locator('#laborBox [data-p="labor"]').inputValue() === '' && /1\.5 ευρώ/.test(await p.textContent('#laborBox')) && await p.locator('#ctaBtn').isDisabled() && /εργασίας/.test(await p.textContent('#ctaNote')));
await p.locator('#laborBox [data-p="labor"]').fill('150');
ok('#E με γραμμένο ποσό ξεκλειδώνει (Εργασία 150,00 €)', await p.locator('#ctaBtn').isEnabled() && /Εργασία\s*150,00 €/.test(await p.textContent('#totals')));

// ── Ποσότητα 0: δεν μπαίνει στο PDF, κλειδώνει ──
await p.goto('http://localhost:8080/');
await dictate(p, 'πλακάκι λευκό');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
await p.locator('.ln:has-text("Κόλλα πλακιδίων") [data-a="keep"]').click();
await p.locator('.ln:has-text("Αρμόστοκος") [data-a="keep"]').click();
await p.locator('.ln:has-text("Δεν είπες ποσότητα") [data-a="drop"]').click();
ok('#Z γραμμή με 0 (κόλλα χωρίς πλακάκια) → «Ποσότητα 0», κουμπί κλειδωμένο', /Ποσότητα 0/.test(await p.textContent('#lines')) && await p.locator('#ctaBtn').isDisabled());
await p.locator('.ln:has-text("Κόλλα") [data-a="remove"]').click();
await p.locator('.ln:has-text("Αρμόστοκος") [data-a="remove"]').click();
ok('#Z μετά την αφαίρεση δεν μένει καμία γραμμή 0', !/Ποσότητα 0/.test(await p.textContent('#lines')));

// ════ Κάθε άγνωστο υλικό = γραμμή προϊόντος χωρίς τιμή (ποτέ σιωπηλά χαμένο) ════
const ROP = 'ανακαίνιση μπάνιου 12 μέτρα σωλήνα, μία μπανιέρα, μία μπαταρία νιπτήρα, ροπ';
await p.goto('http://localhost:8080/');
await dictate(p, ROP);
ok('#U ακρόαση: τσιπάκι «1 τεμ. Ροπ ?» με το χρώμα «θέλει έλεγχο»', (await p.locator('#chips .chip.q').allTextContents()).includes('1 τεμ. Ροπ ?'), (await p.locator('#chips .chip').allTextContents()).join(' | '));
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
const rop = p.locator('.ln:has(.ln-name:text-is("Ροπ"))');
ok('#U 4 γραμμές: σωλήνας 12 μ., μπανιέρα, μπαταρία νιπτήρα, «Ροπ» 1 τεμ.',
  (await p.$$eval('#lines .ln-name', e => e.map(x => x.textContent))).join(' | ') === 'Σωλήνας πολυστρωματικός Φ16 | Μπανιέρα ακρυλική 170×70 | Μπαταρία νιπτήρα αναμεικτική | Ροπ' &&
  /12 μ\./.test(await p.locator('.ln').first().locator('[data-a="qty-edit"]').textContent()) && /1 τεμ\./.test(await rop.locator('[data-a="qty-edit"]').textContent()));
ok('#U «Ροπ»: χωρίς τιμή, «Άλλη τιμή» ανοιχτό, ένδειξη, «Άλλαξε περιγραφή», «Σβήσε», επιλογή μονάδας',
  await rop.locator('[data-p="cmat"]').inputValue() === '' && /Δεν είναι στον κατάλογο — βάλε τιμή ή σβήσ' το/.test(await rop.textContent()) &&
  await rop.locator('[data-a="desc-edit"]').count() === 1 && await rop.locator('[data-a="remove-line"]').count() === 1 && await rop.locator('select[data-p="unit"]').inputValue() === 'τεμ.');
ok('#U CTA κλειδωμένο, «Ροπ» εκτός συνόλων', await p.locator('#ctaBtn').isDisabled() && /1 γραμμή/.test(await p.textContent('#ctaNote')) && /Υλικά\s*\d/.test(await p.textContent('#totals')));
await rop.locator('[data-p="cmat"]').fill('15');
await rop.locator('.custom [data-a="keep"]').click();
ok('#U με τιμή 15 → ξεκλειδώνει, 15,00 €', await p.locator('#ctaBtn').isEnabled() && await lnSum(rop) === 15);
await rop.locator('select[data-p="unit"]').selectOption('μ.');
ok('#U αλλαγή μονάδας → «1 μ.»', /1 μ\./.test(await rop.locator('[data-a="qty-edit"]').textContent()));
await rop.locator('select[data-p="unit"]').selectOption('τεμ.');
await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
await p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Στείλε στον πελάτη', null, {timeout: 30000});
const ropRows = await p.$$eval('#pdf table tr:not(:has(th))', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ')));
ok('#U το «Ροπ» βγαίνει στο PDF (1 τεμ., 15,00 €)', ropRows.some(r => /Ροπ/.test(r) && /1 τεμ\./.test(r) && /15,00/.test(r)), ropRows.join(' | '));
// δεύτερη προσφορά: η τιμή που έγραψε για το «Ροπ» προτείνεται (δεν μπαίνει μόνη της)· «Σβήσε» → φεύγει και ξεκλειδώνει
await p.goto('http://localhost:8080/');
await dictate(p, ROP);
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#U δεύτερη προσφορά: το autofill δείχνει 15,00 € για το «Ροπ» (όχι αυτόματα)', /15,00/.test(await rop.locator('.hist').textContent()) && await rop.locator('[data-p="cmat"]').inputValue() === '' && await p.locator('#ctaBtn').isDisabled());
await rop.locator('[data-a="remove-line"]').click();
ok('#U «Σβήσε» → φεύγει (με «Αναίρεση») και ξεκλειδώνει', await rop.count() === 0 && await p.locator('#toast [data-a="undo"]').isVisible() && await p.locator('#ctaBtn').isEnabled());
await p.locator('#toast [data-a="undo"]').click();
ok('#U «Αναίρεση» → γυρίζει, ξανά κλειδωμένο', await rop.count() === 1 && await p.locator('#ctaBtn').isDisabled());
// τιμή 0 μόνο ρητά → «στην εργασία»
await rop.locator('[data-p="cmat"]').fill('0');
await rop.locator('.custom [data-a="keep"]').click();
ok('#U τιμή 0 γραμμένη ρητά → «στην εργασία», ξεκλειδώνει', (await rop.locator('.ln-sum').textContent()).includes('στην εργασία') && await p.locator('#ctaBtn').isEnabled());
// «3 μέτρα ροπ»
await p.goto('http://localhost:8080/');
await dictate(p, '3 μέτρα ροπ');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#U «3 μέτρα ροπ» → Ροπ 3 μ.', /3 μ\./.test(await rop.locator('[data-a="qty-edit"]').textContent()) && await rop.locator('select[data-p="unit"]').inputValue() === 'μ.');
// προσωπικά στοιχεία: μόνο λεκάνη, τίποτα στο PDF
await p.goto('http://localhost:8080/');
await dictate(p, 'μπάνιο για τον κύριο Παπαδόπουλο στο 6912345678 στο Χαλάνδρι, λεκάνη');
ok('#U ακρόαση: κανένα τσιπάκι για όνομα/τηλέφωνο/περιοχή', (await p.locator('#chips .chip').allTextContents()).join('|') === '1 τεμ. Λεκάνη κρεμαστή', (await p.locator('#chips .chip').allTextContents()).join(' | '));
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#U ΜΟΝΟ λεκάνη ως προϊόν', (await p.$$eval('#lines .ln-name', e => e.map(x => x.textContent))).join('|') === 'Λεκάνη κρεμαστή');
await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
ok('#U στο PDF κανένα όνομα/τηλέφωνο/περιοχή (τίτλος «μπάνιο»)', !/Παπαδόπουλ|6912345678|Χαλάνδρι|κύριο/.test(await p.textContent('#pdf .pdf-head + h2, #pdf h2')) && !/Παπαδόπουλ|Χαλάνδρι/.test(await p.textContent('#pdf')) &&
  /Προσφορά: μπάνιο/.test(await p.textContent('#pdf h2')), await p.textContent('#pdf h2'));
await p.waitForFunction(() => document.getElementById('ctaBtn').textContent === 'Στείλε στον πελάτη', null, {timeout: 30000}).catch(() => {});
// γεμίσματα
await p.goto('http://localhost:8080/');
await dictate(p, 'θέλω λεκάνη και επίσης σιφόνι');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#U «θέλω λεκάνη και επίσης σιφόνι» → 2 γραμμές', (await p.$$eval('#lines .ln-name', e => e.map(x => x.textContent))).join('|') === 'Λεκάνη κρεμαστή|Σιφόνι');

// ── Πληκτρολόγιο: γράφω / διορθώνω το κείμενο ──
await p.goto('http://localhost:8080/');
await p.click('#mic');                                            // χωρίς φωνή (headless) → ανοίγει κατευθείαν για γράψιμο
await p.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
await p.click('#transcript');
await p.keyboard.type('τρεις πρίζες');
ok('#K με το πληκτρολόγιο: τα υλικά βγαίνουν ζωντανά ως τσιπάκια', /πρίζ/i.test(await p.textContent('#chips')), await p.textContent('#chips'));
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#K τα υλικά πέρασαν στον έλεγχο', await p.locator('.ln:has-text("Πρίζα")').count() === 1);
await p.click('#editText');
ok('#K «Διόρθωσε το κείμενο» γυρίζει στο κείμενο, όπως ήταν', await p.isVisible('#s-listen.on') && (await p.textContent('#transcript')).trim() === 'τρεις πρίζες', await p.textContent('#transcript'));
ok('#K το πληκτρολόγιο είναι έτοιμο (focus στο κείμενο)', await p.evaluate(() => document.activeElement?.id === 'transcript'));
await p.keyboard.type(' και πέντε σποτ');
await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
ok('#K μετά τη διόρθωση μπαίνουν και τα δύο υλικά', await p.locator('.ln:has-text("Πρίζα")').count() === 1 && await p.locator('.ln:has-text("σποτ")').count() === 1);

// ── Άγγιγμα στο κείμενο ΟΣΟ ΑΚΟΥΕΙ → σταματά το μικρόφωνο και ανοίγει για γράψιμο (ψεύτικο SpeechRecognition) ──
const p2 = await ctx.newPage();
await p2.addInitScript(() => {
  const Fake = class {
    start(){ setTimeout(() => this.onresult?.({results: [Object.assign([{transcript: 'δύο πρίζες'}], {isFinal: true})]}), 80); }
    stop(){ setTimeout(() => this.onend?.(), 10); }
  };
  window.SpeechRecognition = window.webkitSpeechRecognition = Fake;      // ο Chromium έχει και τα δύο ονόματα
});
await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p2.goto('http://localhost:8080/');
await p2.click('#mic');
await p2.waitForFunction(() => /πρίζ/i.test(document.getElementById('chips').textContent));
ok('#K ακούει: το κείμενο έχει γίνει επεξεργάσιμο ΜΟΝΟ μετά το άγγιγμα', await p2.getAttribute('#transcript', 'contenteditable') === 'false');
await p2.click('#transcript');
await p2.waitForFunction(() => document.getElementById('transcript').contentEditable === 'true');
ok('#K άγγιγμα στο κείμενο = σταματά το μικρόφωνο και δίνει πληκτρολόγιο (focus)', await p2.evaluate(() => document.activeElement?.id === 'transcript') && await p2.isVisible('#resume'));
await p2.keyboard.type(' και τρία σποτ');
ok('#K ό,τι είχε ακουστεί μένει και προστίθεται ό,τι γράφει', /δύο πρίζες/.test(await p2.textContent('#transcript')) && /τρία σποτ/.test(await p2.textContent('#transcript')), await p2.textContent('#transcript'));
await p2.click('#ctaBtn'); await p2.waitForSelector('#s-lines.on');
ok('#K και τα δύο υλικά μπήκαν', await p2.locator('.ln:has-text("Πρίζα")').count() === 1 && await p2.locator('.ln:has-text("σποτ")').count() === 1);
await p2.close();

// ── Χαλασμένο localStorage: η εφαρμογή ανοίγει, δείχνει τη φόρμα, ο αριθμός ξεκινά από 1 ──
const p3 = await ctx.newPage();
const errs3 = [];
p3.on('pageerror', e => errs3.push(e.message));
await p3.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p3.goto('http://localhost:8080/');
await p3.evaluate(() => { localStorage.setItem('ergolav.profile', '{χαλασμένο'); localStorage.setItem('ergolav.quoteNo', 'abc'); });
await p3.reload();
ok('#P χαλασμένο localStorage: καμία εξαίρεση, ανοίγει η φόρμα', errs3.length === 0 && await p3.isVisible('#s-profile.on'), errs3.join(' | '));
await p3.fill('#pfName', 'Δοκιμή'); await p3.click('#pfSave');
await dictate(p3, 'τρεις πρίζες');
await p3.click('#ctaBtn'); await p3.waitForSelector('#s-lines.on');
await p3.click('#ctaBtn'); await p3.waitForSelector('#s-pdf.on');
ok('#P χαλασμένος αριθμός → ξεκινά από Αρ. 1, χωρίς τηλέφωνο αν δεν δόθηκε', await qno(p3) === '1' && !/ΑΦΜ|Τηλ\./.test(await p3.textContent('#pdf .pdf-head')) && errs3.length === 0);
await p3.close();

ok('#5 κανένα αίτημα σε API τρίτου όσο η φωτογραφία είναι κλειστή', PHOTO_ON || (gemBody === null && claudeBody === null));
ok('#5 κανένα script/αίτημα σε τρίτο domain εκτός API', external.every(h => /generativelanguage|api\.anthropic|fonts\.g/.test(h)), [...new Set(external)].join(', '));
ok('#5 καμία παραβίαση CSP', csp.length === 0, csp.join(' | '));
ok('καμία JS εξαίρεση', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
