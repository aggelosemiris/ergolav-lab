import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripPersonal, personalFrom, rewriteRequest, applyRewrite, ruleFrom, rewriteSection, MESSAGES, LIMITS } from '../src/rewrite-client.js';
import { ANALYSES } from '../src/analyses-data.js';

const quote = {client: 'Γιώργος Αντωνίου, Χαλάνδρι', profile: {name: 'Νίκος Παπαδάκης Υδραυλικές Εργασίες', phone: '6912345678'}};
const known = personalFrom(quote);
const wc = ANALYSES['plumb-wc-wall-hung'];

// ── Προσωπικά δεδομένα πριν το AI
test('ονόματα του πελάτη και της επιχείρησης, και σε άλλη πτώση, φεύγουν', () => {
  assert.equal(stripPersonal('Ο Γιώργος θέλει να το δει ο κ. Αντωνίου στο Χαλάνδρι', known), 'Ο [όνομα] θέλει να το δει ο κ. [όνομα] στο [όνομα]');
  assert.equal(stripPersonal('του Γιώργου, για τον Νίκο Παπαδάκη', known), 'του [όνομα], για τον [όνομα]');
});

test('λέξεις της επωνυμίας που δεν είναι ονόματα μένουν («εργασίες», «υδραυλικός»)', () => {
  assert.equal(stripPersonal('Οι εργασίες του υδραυλικού γράφονται απλά', known), 'Οι εργασίες του υδραυλικού γράφονται απλά');
});

test('τηλέφωνα (κινητά, σταθερά, +30, με κενά), email και «κυρία Όνομα» που δεν ξέρει η εφαρμογή', () => {
  assert.equal(stripPersonal('πάρε 697 123 4567 ή +30 210 123 4567 ή 6912345678', known), 'πάρε [τηλέφωνο] ή [τηλέφωνο] ή [τηλέφωνο]');
  assert.equal(stripPersonal('γράψε στο giorgos@example.gr', {}), 'γράψε στο [email]');
  assert.equal(stripPersonal('η κυρία Ελένη Μαρκάκη θέλει', {}), 'η κυρία [όνομα] θέλει');
  assert.equal(stripPersonal('Ο Κ. Λαμπράκης', {}), 'Ο Κ. [όνομα]');
});

test('τεχνικά νούμερα και λέξεις μένουν όπως είναι', () => {
  const t = 'Σωλήνας Φ110, καλώδιο 2,5 τ.χ., 10–15 λεπτά, διακόπτης 3/4", κονίαμα 1:3, το 2024, και Γιάννης';
  assert.equal(stripPersonal(t, known), t);
});

test('το αίτημα δεν έχει κανένα όνομα ή τηλέφωνο του πελάτη, ούτε στους κανόνες', () => {
  const req = rewriteRequest({analysis: wc, section: 'steps', index: 2, dislike: 'Ο Γιώργος Αντωνίου δεν θα το καταλάβει',
    want: 'πιο απλά, πάρε με στο 6912345678', rules: [{text: 'Για τον κ. Αντωνίου πάντα απλά'}]}, known);
  const text = JSON.stringify(req);
  for(const s of ['Γιώργ', 'Αντων', 'Χαλάνδρ', 'Παπαδάκ', '6912345678']) assert.ok(!text.includes(s), `έμεινε «${s}»`);
  assert.equal(req.dislike, 'Ο [όνομα] δεν θα το καταλάβει');
});

// ── Το αίτημα
test('στοιχείο: μόνο αυτό αλλάζει· «Λάθος σειρά» ή «Λείπει βήμα» → όλη η ενότητα, με εστίαση', () => {
  const item = rewriteRequest({analysis: wc, section: 'steps', index: 2, quick: ['Πιο σύντομο']}, known);
  assert.deepEqual(item.target, {scope: 'item', section: 'steps', item_id: 'plumb-wc-wall-hung.steps.3'});
  assert.deepEqual(item.selected, [wc.sections[2].items[2].text]);
  const order = rewriteRequest({analysis: wc, section: 'steps', index: 2, quick: ['Λάθος σειρά']}, known);
  assert.deepEqual(order.target, {scope: 'section', section: 'steps', item_id: 'plumb-wc-wall-hung.steps.3'});
  const section = rewriteRequest({analysis: wc, section: 'checks', want: 'λιγότερα'}, known);
  assert.deepEqual(section.target, {scope: 'section', section: 'checks', item_id: null});
  assert.equal(section.selected.length, wc.sections[3].items.length);
});

test('κανόνες ύφους: μπαίνουν σε κάθε αίτημα, έως 20, κομμένοι στους 200 χαρακτήρες· άγνωστες γρήγορες επιλογές φεύγουν', () => {
  const rules = Array.from({length: 25}, (_, i) => ({text: `Κανόνας ${i + 1} ${'α'.repeat(250)}`}));
  const req = rewriteRequest({analysis: wc, section: 'steps', index: 0, want: 'x'.repeat(900), quick: ['Πιο τεχνικό', 'Κάτι άλλο'], rules}, known);
  assert.equal(req.style_rules.length, LIMITS.rules);
  assert.ok(req.style_rules.every(r => r.length <= LIMITS.rule));
  assert.ok(req.style_rules[0].startsWith('Κανόνας 1 '));
  assert.equal(req.want.length, LIMITS.answer);
  assert.deepEqual(req.quick, ['Πιο τεχνικό']);
  assert.ok(!('previous' in req));
  assert.deepEqual(rewriteRequest({analysis: wc, section: 'steps', index: 0, want: 'x', previous: ['παλιό']}, known).previous, ['παλιό']);
});

test('κανόνας από τις απαντήσεις: χωρίς κομμάτια με όνομα ή τηλέφωνο, χωρίς «Λάθος σειρά»', () => {
  assert.equal(ruleFrom({quick: ['Πιο απλά λόγια', 'Λάθος σειρά'], want: 'χωρίς τεχνικούς όρους, για τον [όνομα]'}), 'Πιο απλά λόγια, χωρίς τεχνικούς όρους');
  assert.equal(ruleFrom({dislike: 'πολλά αγγλικά'}), 'Απόφυγε: πολλά αγγλικά');
  assert.equal(ruleFrom({want: 'τηλέφωνο [τηλέφωνο]'}), '');
});

// ── Η απάντηση
test('νέα εκδοχή ενός στοιχείου: αλλάζει μόνο αυτό, τα ids μένουν ίδια', () => {
  const t = {scope: 'item', section: 'steps', item_id: 'plumb-wc-wall-hung.steps.3'};
  const r = applyRewrite(wc, t, ['Συνδέουμε το νερό στο καζανάκι και τη λεκάνη στην αποχέτευση.']);
  assert.deepEqual(r.errors, []);
  assert.equal(r.analysis.sections[2].items[2].text, 'Συνδέουμε το νερό στο καζανάκι και τη λεκάνη στην αποχέτευση.');
  assert.deepEqual(r.analysis.sections[2].items.map(i => i.id), wc.sections[2].items.map(i => i.id));
  const others = s => s.sections.filter(x => x.key !== 'steps');
  assert.deepEqual(others(r.analysis), others(wc));
  assert.equal(wc.sections[2].items[2].text.startsWith('Συνδέουμε την παροχή'), true);   // η αρχική δεν πειράζεται
});

test('δύο κείμενα στη θέση ενός και αλλαγή σειράς ενότητας: ids ξαναμετριούνται', () => {
  const r = applyRewrite(wc, {scope: 'item', section: 'prerequisites', item_id: 'plumb-wc-wall-hung.prerequisites.1'},
    ['Να έχει επιλεγεί η λεκάνη που θέλετε.', 'Να έχει επιλεγεί και το σύστημα εντοιχισμού που της ταιριάζει.']);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.analysis.sections[0].items.map(i => i.id), [1, 2, 3, 4].map(n => `plumb-wc-wall-hung.prerequisites.${n}`));
  const rev = wc.sections[3].items.map(i => i.text).reverse();
  assert.deepEqual(applyRewrite(wc, {scope: 'section', section: 'checks', item_id: null}, rev).analysis.sections[3].items.map(i => i.text), rev);
});

test('η νέα εκδοχή περνά τους κανόνες της Φάσης 4: εγγύηση, αρίθμηση, όρια πλήθους απορρίπτονται', () => {
  const t = {scope: 'item', section: 'steps', item_id: 'plumb-wc-wall-hung.steps.3'};
  assert.ok(applyRewrite(wc, t, ['Συνδέουμε τα πάντα, με εγγύηση δύο ετών για τη στεγανότητα.']).errors.some(e => /εγγύηση/.test(e)));
  assert.ok(applyRewrite(wc, t, ['3. Συνδέουμε το νερό και την αποχέτευση στο δίκτυο.']).errors.some(e => /αρίθμηση/.test(e)));
  assert.ok(applyRewrite(wc, t, ['Ένα.', 'Δύο.', 'Τρία.', 'Τέσσερα.']).errors.length);
  assert.ok(applyRewrite(wc, {scope: 'section', section: 'checks', item_id: null}, ['Μόνο ένας έλεγχος με νερό.']).errors.length);
  assert.deepEqual(applyRewrite(wc, t, []).errors, ['Η απάντηση δεν είχε κείμενο.']);
  assert.deepEqual(applyRewrite(wc, {...t, item_id: 'άλλο'}, ['κείμενο αρκετά μεγάλο']).errors, ['Δεν βρέθηκε το σημείο που διάλεξες.']);
});

// ── Η κλήση στην υπηρεσία (ψεύτικο fetch)
const ok = items => async () => ({ok: true, status: 200, json: async () => ({items})});
test('επιτυχία: POST με JSON και X-Device-Id, χωρίς cookies', async () => {
  let seen;
  const r = await rewriteSection({a: 1}, {url: 'https://w.test/rewrite-section', deviceId: 'dev-1',
    fetchImpl: async (url, init) => { seen = {url, init}; return ok(['νέο κείμενο εδώ'])(); }});
  assert.deepEqual(r, {items: ['νέο κείμενο εδώ']});
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.headers['X-Device-Id'], 'dev-1');
  assert.equal(seen.init.body, '{"a":1}');
});

test('λάθη στα ελληνικά: χωρίς ρύθμιση, χωρίς σήμα, όριο, άκυρη απάντηση, δίκτυο, χρονικό όριο', async () => {
  const fail = async (opts, code) => {
    await assert.rejects(rewriteSection({}, {url: 'https://w.test/x', ...opts}), e => { assert.equal(e.code, code); assert.match(e.message, /[α-ω]/); return true; });
  };
  await fail({url: ''}, 'config');
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {value: {onLine: false}, configurable: true});
  try { await assert.rejects(rewriteSection({}, {url: 'https://w.test/x'}), {message: MESSAGES.offline}); }
  finally { nav ? Object.defineProperty(globalThis, 'navigator', nav) : delete globalThis.navigator; }
  await assert.rejects(rewriteSection({}, {url: 'https://w.test/x', fetchImpl: async () => ({ok: false, status: 429, json: async () => ({error: 'Έκανες πολλές αλλαγές σε λίγη ώρα. Δοκίμασε ξανά σε 12 λεπτά.'})})}),
    {message: 'Έκανες πολλές αλλαγές σε λίγη ώρα. Δοκίμασε ξανά σε 12 λεπτά.'});
  await assert.rejects(rewriteSection({}, {url: 'https://w.test/x', fetchImpl: async () => ({ok: false, status: 504, json: async () => { throw new Error(); }})}), {message: MESSAGES.timeout});
  await fail({fetchImpl: ok('όχι λίστα')}, 'bad');
  await fail({fetchImpl: ok([])}, 'bad');
  await fail({fetchImpl: async () => { throw new TypeError('Failed to fetch'); }}, 'network');
  await fail({timeoutMs: 20, fetchImpl: (u, {signal}) => new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('aborted'))))}, 'timeout');
});

test('«Διακοπή» από τον τεχνίτη: ακύρωση, όχι λάθος χρόνου', async () => {
  const ctrl = new AbortController();
  const p = rewriteSection({}, {url: 'https://w.test/x', signal: ctrl.signal, fetchImpl: (u, {signal}) => new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('aborted'))))});
  ctrl.abort();
  await assert.rejects(p, {code: 'aborted'});
});
