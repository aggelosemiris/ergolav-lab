import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Ψεύτικο localStorage ανά test (όπως στο analysis-store.test.js).
function env(initial = {}){
  const data = {...initial};
  globalThis.localStorage = {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }};
  return data;
}
env();
const { compileAll, appData, appDataSource } = await import('../tools/catalog/case-texts.mjs');
const { pickAnalysis, pickTag, voiceAnswers, voiceFor, lineKeys, materialFor, withVariant, hasVariant } = await import('../src/case-pick.js');
const store = await import('../src/allaxe-store.js');
const { ANALYSES } = await import('../src/analyses-data.js');
const { CASE_DATA } = await import('../src/cases-data.js');
const { lineFor } = await import('../src/parse.js');
const { quoteTasks } = await import('../src/tasks.js');
const { ALLAXE_BOT_ENABLED } = await import('../src/config.js');

const {map, res} = await compileAll();
// Δύο κόσμοι: «τίποτα εγκεκριμένο» (όπως σήμερα) και «όλα εγκεκριμένα» (σαν να πέρασαν όλα τον έλεγχο).
const NONE = appData(map, res);
const approveAll = r => ({...r, out: {...r.out,
  cases: r.out.cases.map(c => c.review ? {...c, review: {...c.review, reviewed: true}} : c),
  extras: r.out.extras.map(x => ({...x, review: {...x.review, reviewed: true}})),
  items: Object.fromEntries(Object.entries(r.out.items).map(([id, it]) => [id, {...it, review: {...it.review, reviewed: true}}]))}});
const ALL = appData(map, Object.fromEntries(Object.entries(res).map(([k, r]) => [k, approveAll(r)])));

const line = (id, label) => { const l = lineFor(id, 1); if(label){ const o = l.options.find(x => x.label === label); Object.assign(l, {code: o.code, name: `${l.base} ${o.label}`}); } return l; };
const wcHung = line('wc', 'κρεμαστή'), wcFloor = line('wc', 'δαπέδου');
const pick = (data, extra = {}) => pickAnalysis({data, base: ANALYSES, task: 'plumb-wc-wall-hung', lines: [wcHung], ...extra});

test('το flag είναι κλειστό και τα δεδομένα της εφαρμογής έχουν μόνο ό,τι έχει εγκριθεί (σήμερα: τίποτα)', () => {
  assert.equal(ALLAXE_BOT_ENABLED, false);
  assert.equal(fs.readFileSync(new URL('../src/cases-data.js', import.meta.url), 'utf8'), appDataSource(NONE), 'τρέξε: node tools/catalog/case-texts.mjs');
  assert.deepEqual([Object.keys(CASE_DATA.cases).length, Object.keys(CASE_DATA.items).length, Object.keys(CASE_DATA.generic).length], [0, 0, 0]);
  assert.equal(CASE_DATA.materials.length, map.materials.length);
  // Με όλα εγκεκριμένα: κάθε μη βασική περίπτωση μπαίνει, με τα κείμενα όλων των σημείων της.
  const fresh = Object.values(res).flatMap(r => r.out.cases).filter(c => c.source !== 'base' && !c.id.startsWith('generic:'));
  assert.equal(Object.keys(ALL.cases).length, fresh.length);
  for(const c of Object.values(ALL.cases)) for(const id of Object.values(c.sections).flat()) assert.ok(ALL.items[id]?.n, id);
});

test('βασική: χωρίς φωνή, κανόνα ή επιλογή μπαίνει ακριβώς η σημερινή ανάλυση', () => {
  for(const data of [NONE, ALL]){
    const p = pick(data);
    assert.equal(p.source, 'base');
    assert.deepEqual(p.analysis, ANALYSES['plumb-wc-wall-hung']);
    assert.equal(p.variant, 'n');
    assert.equal(pickTag(p, data), 'Λεκάνη: Αλλαγή παλιάς · Κρεμαστή · Τούβλο ή μπετό · βασική περίπτωση');
  }
});

test('φωνή: η περίπτωση που δείχνουν οι λέξεις, ΜΟΝΟ αν είναι εγκεκριμένη', () => {
  const voice = 'Αλλαγή λεκάνης κρεμαστής σε γυψοσανίδα';
  assert.deepEqual(voiceAnswers(map.materials[0], voice), {job: 'replace', type: 'hung', wall: 'drywall'});
  const p = pick(ALL, {voice});
  assert.deepEqual([p.source, p.caseId], ['voice', 'wc:replace.hung.drywall']);
  assert.equal(p.analysis.title, res.wc.out.cases.find(c => c.id === 'wc:replace.hung.drywall').title);
  assert.equal(pickTag(p, ALL), 'Λεκάνη: Αλλαγή παλιάς · Κρεμαστή · Γυψοσανίδα · από όσα είπες');
  assert.equal(pick(NONE, {voice}).source, 'base');                       // δεν έχει εγκριθεί → βασική
  // Δύο απαντήσεις της ίδιας ερώτησης = δεν ξέρουμε· η ερώτηση μένει στη βασική.
  assert.deepEqual(voiceAnswers(map.materials[0], 'τούβλο ή γυψοσανίδα'), {});
  // Φωνή που καταλήγει στη βασική λέγεται «βασική».
  assert.equal(pick(ALL, {voice: 'αλλαγή λεκάνης σε τούβλο'}).source, 'base');
});

test('κανόνας > φωνή, επιλογή της προσφοράς > κανόνας· ο κανόνας δεν αλλάζει ό,τι λέει η γραμμή', () => {
  const voice = 'λεκάνη κρεμαστή σε γυψοσανίδα';
  const rules = {cases: {wc: {answers: {job: 'new', type: 'hung', wall: 'front'}}}};
  assert.deepEqual([pick(ALL, {voice, rules}).source, pick(ALL, {voice, rules}).caseId], ['rule', 'wc:new.hung.front']);
  const chosen = {answers: {job: 'renovation', type: 'hung', wall: 'masonry'}};
  assert.deepEqual([pick(ALL, {voice, rules, chosen}).source, pick(ALL, {voice, rules, chosen}).caseId], ['chosen', 'wc:renovation.hung.masonry']);
  // Κανόνας για δαπέδου, αλλά η γραμμή λέει κρεμαστή: ο κανόνας δεν ισχύει εδώ → φωνή.
  const floorRule = {cases: {wc: {answers: {job: 'replace', type: 'floor', outlet: 'wall', cistern: 'close'}}}};
  assert.equal(pick(ALL, {voice, rules: floorRule}).source, 'voice');
  // Και στη λεκάνη δαπέδου ισχύει.
  const f = pickAnalysis({data: ALL, base: ANALYSES, task: 'plumb-wc-floor', lines: [wcFloor], rules: floorRule});
  assert.equal(f.source, 'rule');
  // Κανόνας για περίπτωση που δεν έχει εγκριθεί: προχωρά στην επόμενη πηγή.
  assert.equal(pick(NONE, {voice, rules}).source, 'base');
});

test('περίπτωση που έχει βγει έξω από τον χάρτη δεν μπαίνει ποτέ (π.χ. ελεύθερη μπανιέρα σε αλλαγή)', () => {
  const tub = lineFor('bathtub', 1);
  const [t] = quoteTasks([tub], () => true).tasks;
  const p = pickAnalysis({data: ALL, base: ANALYSES, task: t.id, lines: [tub], voice: 'αλλαγή μπανιέρας με ελεύθερη'});
  assert.equal(p.source, 'base');
});

test('εκδοχή λόγου: από επιλογή > κανόνα· κάθε σημείο παίρνει την εγκεκριμένη, αλλιώς μένει η κανονική', () => {
  const s = pick(ALL, {rules: {variant: 's'}});
  assert.deepEqual([s.variant, s.variantFrom], ['s', 'rule']);
  const first = ANALYSES['plumb-wc-wall-hung'].sections[0].items[0];
  assert.equal(s.analysis.sections[0].items[0].text, ALL.items[first.id].s);
  assert.equal(s.analysis.sections[0].items[0].id, first.id);
  assert.match(pickTag(s, ALL), /· απλά λόγια$/);
  const c = pick(ALL, {rules: {variant: 's'}, chosen: {variant: 'c'}});
  assert.deepEqual([c.variant, c.variantFrom], ['c', 'chosen']);
  // Χωρίς εγκεκριμένες εκδοχές: κανονική, χωρίς ετικέτα εκδοχής.
  const n = pick(NONE, {rules: {variant: 's'}});
  assert.deepEqual([n.variant, n.analysis], ['n', ANALYSES['plumb-wc-wall-hung']]);
  assert.equal(hasVariant(ANALYSES['plumb-wc-wall-hung'], 's', NONE), false);
  assert.equal(hasVariant(ANALYSES['plumb-wc-wall-hung'], 's', ALL), true);
  // Μισή κάλυψη: όσα έχουν εκδοχή αλλάζουν, τα άλλα μένουν.
  const one = {...NONE, items: {[first.id]: {s: 'Απλά.'}}};
  const v = withVariant(ANALYSES['plumb-wc-wall-hung'], 's', one).analysis;
  assert.equal(v.sections[0].items[0].text, 'Απλά.');
  assert.equal(v.sections[0].items[1].text, ANALYSES['plumb-wc-wall-hung'].sections[0].items[1].text);
});

test('ποιο υλικό και ποια λόγια: τα κλειδιά της γραμμής και μόνο οι φράσεις που την αφορούν', () => {
  assert.deepEqual(lineKeys(wcHung), ['wc', 'wc:κρεμαστή']);
  assert.equal(materialFor(ALL, 'plumb-wc-wall-hung', [wcHung]).id, 'wc');
  const said = 'Αλλαγή λεκάνης κρεμαστής σε γυψοσανίδα, και μια μπαταρία νιπτήρα καινούργια';
  assert.equal(voiceFor(said, [wcHung]), 'Αλλαγή λεκάνης κρεμαστής σε γυψοσανίδα');
  assert.equal(voiceFor(said, [line('mixer', 'νιπτήρα αναμεικτική')]), 'μια μπαταρία νιπτήρα καινούργια');
  // Είδος εκτός καταλόγου: ούτε υλικό ούτε ανάλυση (όπως σήμερα, «χωρίς ανάλυση»).
  assert.equal(pickAnalysis({data: ALL, base: ANALYSES, task: 'xyz', lines: [{id: 'unknown', name: 'Σίτες'}]}), null);
});

test('κανόνες στη συσκευή: ένας ανά υλικό (ο νέος αντικαθιστά), ένας λόγου, αφαίρεση', () => {
  env();
  assert.deepEqual(store.pickRules(), {cases: {}, variant: null, edits: {}});
  assert.equal(store.setCaseRule('wc', {job: 'replace', type: 'hung', wall: 'drywall'}, 'Αλλαγή παλιάς · Κρεμαστή · Γυψοσανίδα'), true);
  store.setCaseRule('wc', {job: 'new', type: 'hung', wall: 'front'}, 'Σε νέα θέση · Κρεμαστή · Μπροστά');
  assert.deepEqual(Object.keys(store.caseRules()), ['wc']);
  assert.equal(store.caseRules().wc.answers.job, 'new');
  assert.equal(store.setCaseRule('wc', 'όχι απαντήσεις'), false);
  store.setSpeechRule('s'); store.setSpeechRule('c');
  assert.equal(store.speechRule(), 'c');
  assert.equal(store.setSpeechRule('x'), false);
  // Νέα προσφορά με τον κανόνα.
  const p = pick(ALL, {rules: store.pickRules()});
  assert.deepEqual([p.source, p.caseId, p.variant], ['rule', 'wc:new.hung.front', 'c']);
  store.removeCaseRule('wc'); store.removeSpeechRule();
  assert.deepEqual(store.pickRules(), {cases: {}, variant: null, edits: {}});
  // Χαλασμένα δεδομένα αγνοούνται.
  env({[store.CASE_RULES]: '{"wc":{"answers":[1]}}', [store.SPEECH_RULE]: '"z"'});
  assert.deepEqual(store.pickRules(), {cases: {}, variant: null, edits: {}});
});

test('προσφορά: επιλογή «μόνο εδώ» και στιγμιότυπο που δεν αλλάζει ό,τι κι αν αλλάξει μετά', () => {
  env();
  store.setQuotePick(7, 'plumb-wc-wall-hung', {variant: 's'});
  assert.deepEqual(store.quotePicks(7), {'plumb-wc-wall-hung': {variant: 's'}});
  assert.deepEqual(store.quotePicks(8), {});
  const docs = [{id: 'plumb-wc-wall-hung', lines: [wcHung], analysis: ANALYSES['plumb-wc-wall-hung'], pick: {source: 'base'}}];
  store.saveQuoteSnapshot(7, 'sig', docs);
  // Μετά την αποστολή μπαίνει κανόνας· το στιγμιότυπο μένει ίδιο.
  store.setCaseRule('wc', {job: 'new', type: 'hung', wall: 'front'}, '');
  assert.deepEqual(store.quoteSnapshot(7), {sig: 'sig', docs: JSON.parse(JSON.stringify(docs))});
  assert.deepEqual(store.quotePicks(7), {'plumb-wc-wall-hung': {variant: 's'}});
  store.setQuotePick(7, 'plumb-wc-wall-hung', null);
  assert.deepEqual(store.quotePicks(7), {});
  // Έως 100 προσφορές· οι παλαιότερες φεύγουν πρώτες.
  for(let i = 1; i <= store.MAX_QUOTE_ANALYSES + 5; i++) store.setQuotePick(1000 + i, 't', {variant: 'c'});
  const kept = Object.keys(JSON.parse(globalThis.localStorage.getItem(store.QUOTE_ANALYSES)));
  assert.equal(kept.length, store.MAX_QUOTE_ANALYSES);
  assert.ok(kept.includes('1105') && !kept.includes('1001'));
});

test('οι σημερινές αναλύσεις δεν αλλάζουν από την επιλογή (καμία μετάλλαξη)', () => {
  const before = JSON.stringify(ANALYSES);
  pick(ALL, {voice: 'αλλαγή κρεμαστής σε γυψοσανίδα', rules: {variant: 's'}});
  pick(ALL, {rules: {variant: 'c'}});
  assert.equal(JSON.stringify(ANALYSES), before);
});
