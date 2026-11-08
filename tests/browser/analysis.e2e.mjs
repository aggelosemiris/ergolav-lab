// Ανάλυση εργασιών: προσφορά → ανάλυση → «Άλλαξέ το» με φωνή → «Κράτα το νέο» → PDF → αποστολή, με το AI ως mock.
// Η φωνή είναι ψεύτικο SpeechRecognition (λέει ό,τι μπει στο window.__say)· η υπηρεσία «Άλλαξέ το» απαντά από το τεστ.
// Εκτέλεση: npm start &  και  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/analysis.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8087/';
const b = await chromium.launch({...(process.env.CHROMIUM_PATH && {executablePath: process.env.CHROMIUM_PATH}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
const results = [];
const ok = (name, cond, detail = '') => { results.push({name, pass: !!cond}); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const PROFILE = JSON.stringify({name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'});
const CLIENT = 'Γιώργος Αντωνίου, Χαλάνδρι';
const MOCK = '/__mock__/rewrite-section';   // ίδιο origin: περνά την CSP χωρίς αλλαγή

// Κάθε σελίδα: προφίλ, ψεύτικη φωνή, η υπηρεσία «Άλλαξέ το» ρυθμισμένη στο mock.
async function page(ctx){
  const p = await ctx.newPage();
  p.errs = []; p.requests = []; p.hosts = new Set();
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('request', r => p.hosts.add(new URL(r.url()).host));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route('**/src/config.js', r => r.fulfill({contentType: 'text/javascript', body: `export const REWRITE_URL = '${MOCK}';`}));
  await p.route(`**${MOCK}`, async r => {
    const body = JSON.parse(r.request().postData());
    p.requests.push({body, device: r.request().headers()['x-device-id']});
    await new Promise(res => setTimeout(res, p.delay ?? 300));
    const items = p.reply ? p.reply(body) : body.target.scope === 'item'
      ? ['Συνδέουμε το νερό στο καζανάκι και τη λεκάνη στην αποχέτευση.'] : [...body.selected].reverse();
    r.fulfill({contentType: 'application/json', body: JSON.stringify({items})});
  });
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
const cta = p => p.textContent('#ctaBtn');
const waitCta = (p, re) => p.waitForFunction(r => new RegExp(r).test(document.getElementById('ctaBtn').textContent) && !document.getElementById('ctaBtn').disabled, re.source, {timeout: 60000});
// Νέα προσφορά με φωνή μέχρι την προεπισκόπηση του PDF.
async function makeQuote(p, say, client = CLIENT, onPdf = async () => {}){
  await p.goto(BASE);
  if(client) await p.fill('#client', client);
  await p.evaluate(t => window.__say.push(t), say);
  await p.click('#mic');
  await p.waitForFunction(() => document.getElementById('transcript').textContent.length > 10);
  await p.click('#ctaBtn');                      // «Τέλος»
  await waitCta(p, /^Βγάλε τιμές$/);
  await p.click('#ctaBtn'); await p.waitForSelector('#s-lines.on');
  for(let i = 0; i < 8 && await p.isDisabled('#ctaBtn'); i++){   // τύπος πλακακιού, «Ναι» σε κόλλα/αρμόστοκο
    const b = await p.$('.ln .opt') || await p.$('.ln button:has-text("Ναι, πρόσθεσέ το")');
    if(!b) break; await b.click(); await p.waitForTimeout(100);
  }
  await p.click('#ctaBtn'); await p.waitForSelector('#s-pdf.on');
  await onPdf();
  await waitCta(p, /^Στείλε/);
  await p.waitForTimeout(800);   // όπως ένας άνθρωπος: τα κουμπιά της κάρτας αγνοούν το «δεύτερο» πάτημα ενός διπλού
}
const SAY = 'λεκάνη κρεμαστή, καζανάκι εντοιχισμού, μια μπαταρία νιπτήρα, δέκα τετραγωνικά πλακάκι τοίχου και δύο σπιράλ';

{
  const ctx = await b.newContext({viewport: {width: 400, height: 860}, acceptDownloads: true});
  const p = await page(ctx);
  let ghostOpened = null;
  // Αμέσως μόλις φανεί η προεπισκόπηση, όπως το 2ο πάτημα ενός διπλού στο «Έλεγξα»: δεν ανοίγει την ανάλυση.
  await makeQuote(p, SAY, CLIENT, async () => { await p.evaluate(() => document.getElementById('anOpen').click()); ghostOpened = await p.isVisible('#s-analysis.on'); });
  ok('προεπισκόπηση: κουμπί «Φτιάξε και ανάλυση εργασιών» για τις 3 εργασίες',
    await p.textContent('#anOpen') === 'Φτιάξε και ανάλυση εργασιών' && /των 3 εργασιών/.test(await p.textContent('#anEntryText')));
  ok('η παλιά «Ανάλυση εργασιών με AI» μένει διαθέσιμη', await p.isVisible('#installOpen'));
  ok('διπλό πάτημα στο «Έλεγξα» δεν ανοίγει την ανάλυση', ghostOpened === false);

  await p.click('#anOpen'); await p.waitForSelector('#s-analysis.on');
  await waitCta(p, /^Στείλε και τα δύο PDF$/);
  const head = await p.textContent('#apdf .pdf-head');
  ok('PDF ανάλυσης στο ίδιο στυλ: λογότυπο/αρχικά, όνομα, τηλέφωνο, αριθμός, ημερομηνία, τίτλος',
    /ΝΠ/.test(head) && /Νίκος Παπαδάκης/.test(head) && /Τηλ\. 6912345678/.test(head) && /Αρ\.\s*1/.test(head) && /\d+\/\d+\/\d{4}/.test(head)
    && await p.textContent('#apdf h2') === 'Ανάλυση εργασιών', head.replace(/\s+/g, ' '));
  const tasks = await p.$$eval('#apdf h3', els => els.map(e => e.textContent));
  ok('μία ενότητα ανά εργασία, με τη σειρά της προσφοράς· λεκάνη + καζανάκι μαζί, σπιράλ και κόλλα στην εργασία τους',
    tasks.join(' | ') === '1. Τοποθέτηση κρεμαστής λεκάνης με καζανάκι εντοιχισμού | 2. Τοποθέτηση μπαταρίας νιπτήρα | 3. Επικόλληση πλακιδίων τοίχου'
    && /Σπιράλ/.test(await p.textContent('#apdf [data-task="plumb-mixer-basin"] .an-for')), tasks.join(' | '));
  ok('γραμμές χωρίς ανάλυση: καμία εδώ (η λίστα κρυφή)', !(await p.isVisible('#anWithout')));

  // «Άλλαξέ το» με φωνή: πάτημα σε βήμα → κουμπί → γρήγορη επιλογή → μικρόφωνο → Ξαναγράψ' το → Κράτα το νέο
  const step = p.locator('#apdf [data-task="plumb-wc-wall-hung"] li[data-sel="steps"]').nth(2);
  const before = (await step.textContent()).trim();
  const t0 = Date.now();
  await step.click();
  ok('πάτημα σε βήμα: τονίζεται και εμφανίζει «Άλλαξέ το»', await step.evaluate(e => e.classList.contains('sel')) && await p.isVisible('.sel-go'));
  await p.click('.sel-go'); await p.waitForSelector('#rwDialog[open]');
  ok('η μικρή οθόνη: το κείμενο τονισμένο, δύο πεδία με μικρόφωνο, οι 5 γρήγορες επιλογές',
    await p.textContent('#rwSel mark') === before && await p.isVisible('[data-mic="rwDislike"]') && await p.isVisible('[data-mic="rwWant"]')
    && (await p.$$eval('#rwQuick button', els => els.map(e => e.textContent))).join('|') === 'Πιο σύντομο|Πιο απλά λόγια|Πιο τεχνικό|Λάθος σειρά|Λείπει βήμα');
  await p.click('#rwQuick button:has-text("Πιο απλά λόγια")');
  await p.evaluate(() => window.__say.push('πιο απλά για τον Γιώργο, τηλέφωνο 6977123456'));
  await p.click('[data-mic="rwWant"]');
  await p.waitForFunction(() => document.getElementById('rwWant').value.length > 5);
  ok('φωνή στο «Πώς το θέλεις;»', /πιο απλά για τον Γιώργο/.test(await p.inputValue('#rwWant')));
  await p.click('#rwGo');                        // σταματά το μικρόφωνο και στέλνει
  await p.waitForSelector('#rw-result:not([hidden])');
  const sent = p.requests.at(-1);
  const text = JSON.stringify(sent.body);
  ok('στο AI φεύγουν το κείμενο, όλη η ανάλυση, οι απαντήσεις· μόνο το επιλεγμένο σημείο',
    sent.body.target.scope === 'item' && sent.body.target.item_id === 'plumb-wc-wall-hung.steps.3' && sent.body.selected[0] === before
    && sent.body.analysis.sections.length === 5 && sent.body.quick.join() === 'Πιο απλά λόγια' && /^[0-9a-f-]{36}$/.test(sent.device));
  ok('κανένα όνομα ή τηλέφωνο πελάτη ή επιχείρησης δεν φεύγει προς το AI',
    !/Γιώργ|Αντων|Χαλάνδρ|Παπαδάκ|6977123456|6912345678/.test(text) && sent.body.want === 'πιο απλά για τον [όνομα], τηλέφωνο [τηλέφωνο]', sent.body.want);
  ok('πριν και μετά δίπλα δίπλα, με «Κράτα το νέο», «Ξαναδοκίμασε», «Άκυρο»',
    (await p.textContent('#rwBefore')).trim() === before && /Συνδέουμε το νερό στο καζανάκι/.test(await p.textContent('#rwAfter'))
    && await p.isVisible('#rwKeep') && await p.isVisible('#rwRetry') && await p.isVisible('#rwAbort'));
  // «Ξαναδοκίμασε»: νέα πρόταση, το AI μαθαίνει ποια δεν άρεσε
  p.reply = () => ['Ενώνουμε το νερό με το καζανάκι και τη λεκάνη με την αποχέτευση.'];
  await p.click('#rwRetry'); await p.waitForSelector('#rw-result:not([hidden])');
  await p.waitForFunction(() => /Ενώνουμε/.test(document.getElementById('rwAfter').textContent));
  ok('«Ξαναδοκίμασε»: νέα εκδοχή, με την προηγούμενη ως απορριφθείσα', p.requests.length === 2 && /Συνδέουμε το νερό/.test(p.requests[1].body.previous?.[0]));
  await p.check('#rwRemember');
  ok('«Θυμήσου το»: προτείνει κανόνα χωρίς το όνομα και το τηλέφωνο', await p.inputValue('#rwRule') === 'Πιο απλά λόγια', await p.inputValue('#rwRule'));
  await p.click('#rwKeep');
  await waitCta(p, /^Στείλε και τα δύο PDF$/);
  const secs = (Date.now() - t0) / 1000;
  ok('«Κράτα το νέο»: το βήμα άλλαξε στο PDF και φαίνεται ως δική σου εκδοχή', (await step.textContent()).trim() === 'Ενώνουμε το νερό με το καζανάκι και τη λεκάνη με την αποχέτευση.'
    && /Τοποθέτηση κρεμαστής λεκάνης/.test(await p.textContent('#anMine')));
  ok(`αλλαγή βήματος με φωνή σε λιγότερο από 30 δευτ. (εδώ ${secs.toFixed(1)} δευτ. με απάντηση AI 0,3 δευτ. ανά κλήση)`, secs < 30);
  ok('ο κανόνας κρατήθηκε', await p.textContent('#anRules') === 'Οι κανόνες μου (1)');

  // Ολόκληρη ενότητα, «Λάθος σειρά», και ο κανόνας μπαίνει στο επόμενο αίτημα
  p.reply = null;
  await p.click('#apdf [data-task="plumb-mixer-basin"] h4[data-sel="checks"]');
  await p.click('.sel-go'); await p.waitForSelector('#rwDialog[open]');
  ok('πάτημα σε ενότητα: όλα τα στοιχεία της τονισμένα', (await p.$$('#rwSel mark')).length === 4);
  await p.click('#rwQuick button:has-text("Λάθος σειρά")');
  await p.click('#rwGo'); await p.waitForSelector('#rw-result:not([hidden])');
  ok('ο κανόνας ύφους μπαίνει σε κάθε επόμενο αίτημα', p.requests.at(-1).body.style_rules.join() === 'Πιο απλά λόγια' && p.requests.at(-1).body.target.scope === 'section');
  await p.click('#rwAbort');
  ok('«Άκυρο»: τίποτα δεν αλλάζει', !(await p.isVisible('#rwDialog[open]')) && /Ανοίγουμε σιγά/.test(await p.textContent('#apdf [data-task="plumb-mixer-basin"] li[data-sel="checks"]')));

  // Αποστολή: φύλλο με κατέβασμα / WhatsApp / Viber / Email, και τα δύο PDF
  await p.click('#ctaBtn');
  await p.waitForSelector('#sheet.on');
  ok('αποστολή όπως η προσφορά: Κατέβασμα, WhatsApp, Viber, Email για δύο PDF', await p.textContent('#shareSheetTitle') === 'Αποστολή δύο PDF στον πελάτη'
    && (await p.$$eval('#sheet [data-send]', els => els.map(e => e.dataset.send))).join() === 'download,whatsapp,viber,email');
  const files = [];
  p.on('download', d => files.push(d.suggestedFilename()));
  await p.click('[data-send="download"]');
  await p.waitForSelector('#s-done.on'); await p.waitForTimeout(800);
  ok('κατέβηκαν η προσφορά και η ανάλυση', files.sort().join() === 'Analysi-Ergasion-1-Giorgos-Antoniou.pdf,Prosfora-1-Giorgos-Antoniou.pdf', files.join());

  // Επόμενη προσφορά με την ίδια εργασία: η εκδοχή του τεχνίτη· «Επαναφορά» → η αρχική
  await makeQuote(p, 'λεκάνη κρεμαστή και καζανάκι εντοιχισμού', 'Μαρία Κ.');
  await p.click('#anOpen'); await waitCta(p, /^Στείλε και τα δύο PDF$/);
  const step2 = p.locator('#apdf li[data-sel="steps"]').nth(2);
  ok('νέα προσφορά: χρησιμοποιείται η εκδοχή του τεχνίτη', /^Ενώνουμε το νερό/.test(await step2.textContent()));
  await p.click('#anMine [data-reset]'); await p.click('#anMine [data-reset]');
  await waitCta(p, /^Στείλε και τα δύο PDF$/);
  ok('«Επαναφορά»: γυρνά η αρχική ανάλυση', (await step2.textContent()).trim() === before && !(await p.isVisible('#anMine')));

  // Πίσω στην προσφορά: η ανάλυση μένει συνημμένη, αφαιρείται με ένα κουμπί
  await p.click('#anBack'); await p.waitForSelector('#s-pdf.on');
  ok('πίσω στην προσφορά: «Στείλε και τα δύο PDF» και «Αφαίρεσέ την»', await cta(p) === 'Στείλε και τα δύο PDF' && await p.isVisible('#anRemove'));
  await p.waitForTimeout(800);
  await p.click('#anRemove');
  ok('αφαίρεση: «Στείλε στον πελάτη» μόνο με την προσφορά', await cta(p) === 'Στείλε στον πελάτη' && await p.textContent('#anOpen') === 'Φτιάξε και ανάλυση εργασιών');

  // Οι κανόνες μου: από τα στοιχεία (ρυθμίσεις) — προβολή, αλλαγή, σβήσιμο
  await p.click('#brand'); await p.waitForSelector('#s-profile.on');
  await p.click('#pfRules'); await p.waitForSelector('#s-rules.on');
  ok('«Οι κανόνες μου» από τις ρυθμίσεις: ο κανόνας φαίνεται', (await p.$$eval('#rulesList .rule-text', els => els.map(e => e.textContent))).join() === 'Πιο απλά λόγια');
  await p.click('#rulesList [data-a="edit"]');
  await p.fill('#rulesList textarea', 'Πιο απλά λόγια, χωρίς αγγλικούς όρους');
  await p.click('#rulesList [data-a="save"]');
  ok('αλλαγή κανόνα', await p.textContent('#rulesList .rule-text') === 'Πιο απλά λόγια, χωρίς αγγλικούς όρους');
  await p.click('#rulesList [data-a="del"]'); await p.click('#rulesList [data-a="del"]');
  ok('σβήσιμο κανόνα (σε δύο πατήματα)', (await p.$$('#rulesList .rule')).length === 0 && await p.isVisible('#rulesEmpty'));
  await p.click('#rulesBack');
  ok('πίσω στα στοιχεία', await p.isVisible('#s-profile.on'));
  const stored = await p.evaluate(() => JSON.stringify({...localStorage}));
  ok('κανένα κλειδί στον browser: τίποτα σαν API key στο localStorage', !/sk-ant-|AIza|api[_-]?key|anthropic/i.test(stored));
  const hosts = [...p.hosts].filter(h => !/fonts\.(googleapis|gstatic)\.com$/.test(h));
  ok('η σελίδα μίλησε μόνο με τον δικό της server (καμία κλήση σε api.anthropic.com)', hosts.length === 1 && hosts[0] === new URL(BASE).host, hosts.join());
  ok('χωρίς σφάλματα στη σελίδα', p.errs.length === 0, p.errs.join(' | '));
  await ctx.close();
}

{
  // Χωρίς σήμα: το PDF της ανάλυσης βγαίνει· το «Άλλαξέ το» λέει «Χρειάζεται σύνδεση»
  const ctx = await b.newContext({viewport: {width: 400, height: 860}});
  const p = await page(ctx);
  await makeQuote(p, 'μια μπαταρία νιπτήρα', '');
  await ctx.setOffline(true);
  await p.click('#anOpen');
  await waitCta(p, /^Στείλε και τα δύο PDF$/);
  ok('offline: το PDF με τις υπάρχουσες αναλύσεις βγαίνει', /Τοποθέτηση μπαταρίας νιπτήρα/.test(await p.textContent('#apdf h3')));
  await p.click('#apdf li[data-sel="steps"]'); await p.click('.sel-go');
  await p.click('#rwQuick button:has-text("Πιο σύντομο")'); await p.click('#rwGo');
  await p.waitForSelector('#rwError:not([hidden])');
  ok('offline: «Χρειάζεται σύνδεση», χωρίς αίτημα', /^Χρειάζεται σύνδεση/.test(await p.textContent('#rwError')) && p.requests.length === 0, await p.textContent('#rwError'));
  await ctx.setOffline(false);
  // Η υπηρεσία λέει «όριο» και η απάντηση δεν περνά τον έλεγχο: μηνύματα στα ελληνικά, η ανάλυση δεν αλλάζει
  await p.unroute(`**${MOCK}`);
  await p.route(`**${MOCK}`, r => r.fulfill({status: 429, contentType: 'application/json', body: JSON.stringify({error: 'Έκανες πολλές αλλαγές σε λίγη ώρα. Δοκίμασε ξανά σε 12 λεπτά.'})}));
  await p.click('#rwGo'); await p.waitForFunction(() => /12 λεπτά/.test(document.getElementById('rwError').textContent));
  ok('όριο της υπηρεσίας: το μήνυμά της στα ελληνικά', true);
  await p.unroute(`**${MOCK}`);
  await p.route(`**${MOCK}`, r => r.fulfill({contentType: 'application/json', body: JSON.stringify({items: ['Με εγγύηση πέντε ετών για όλα.']})}));
  await p.click('#rwGo'); await p.waitForFunction(() => /δεν πέρασε τον έλεγχο/.test(document.getElementById('rwError').textContent));
  ok('απάντηση με εγγύηση: απορρίπτεται στη συσκευή', await p.isVisible('#rw-ask'));
  ok('χωρίς σφάλματα στη σελίδα', p.errs.length === 0, p.errs.join(' | '));
  await ctx.close();
}

{
  // Από το ιστορικό δεν βγαίνει ανάλυση (κρατά μόνο το PDF)· χωρίς ρύθμιση υπηρεσίας: το λέει
  const ctx = await b.newContext({viewport: {width: 400, height: 860}});
  const p = await page(ctx);
  await makeQuote(p, 'μια μπαταρία νιπτήρα', '');
  await p.goto(BASE); await p.click('#historyOpen'); await p.locator('.q-open[data-no="1"]').click();
  await p.waitForSelector('#s-pdf.on'); await waitCta(p, /^Στείλε ξανά/);
  ok('ιστορικό: χωρίς κουμπί ανάλυσης', !(await p.isVisible('#anEntry')));
  await p.unroute('**/src/config.js');
  await p.route('**/src/config.js', r => r.fulfill({contentType: 'text/javascript', body: "export const REWRITE_URL = '';"}));
  await makeQuote(p, 'μια μπαταρία νιπτήρα', '');
  await p.click('#anOpen'); await waitCta(p, /^Στείλε και τα δύο PDF$/);
  await p.click('#apdf li[data-sel="steps"]'); await p.click('.sel-go');
  await p.click('#rwQuick button:has-text("Πιο σύντομο")'); await p.click('#rwGo');
  await p.waitForSelector('#rwError:not([hidden])');
  ok('χωρίς REWRITE_URL: «δεν έχει ρυθμιστεί ακόμα»', /δεν έχει ρυθμιστεί/.test(await p.textContent('#rwError')));
  ok('χωρίς σφάλματα στη σελίδα', p.errs.length === 0, p.errs.join(' | '));
  await ctx.close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
