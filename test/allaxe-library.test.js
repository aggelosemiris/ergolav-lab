import { test } from 'node:test';
import assert from 'node:assert/strict';

function env(initial = {}){
  const data = {...initial};
  globalThis.localStorage = {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }};
  return data;
}
env();
const { compileAll, appData } = await import('../tools/catalog/case-texts.mjs');
const { findSimilar, rankGeneric, stems } = await import('../src/similar.js');
const { guessArticle, withArticle, fillKind } = await import('../src/article.js');
const { createLibraryEngine, ITEM, CARD } = await import('../src/allaxe-engine.js');
const S = await import('../src/allaxe-store.js');
const { mergeEntries, localEntries, syncAll, createSync } = await import('../src/allaxe-sync.js');
const { textProblem } = await import('../src/analysis-schema.js');
const { ANALYSES } = await import('../src/analyses-data.js');
const { CASE_DATA } = await import('../src/cases-data.js');

const {map, res} = await compileAll();
const approve = r => ({...r, out: {...r.out,
  cases: r.out.cases.map(c => c.review ? {...c, review: {...c.review, reviewed: true}} : c),
  extras: r.out.extras.map(x => ({...x, review: {...x.review, reviewed: true}})),
  items: Object.fromEntries(Object.entries(r.out.items).map(([id, it]) => [id, {...it, review: {...it.review, reviewed: true}}]))}});
const ALL = appData(map, Object.fromEntries(Object.entries(res).map(([k, r]) => [k, approve(r)])));
const lib = createLibraryEngine({data: ALL, base: ANALYSES});
function run(name, answers){
  let {state, out} = lib.start({item: {name}});
  const outs = [out];
  for(const a of answers){
    const ev = typeof a === 'number' ? {type: 'answer', value: out.options[a], index: a} : a?.text != null ? {type: 'text', value: a.text}
      : {type: 'answer', value: a, index: out.options.indexOf(a)};
    ({state, out} = lib.next(state, ev));
    outs.push(out);
  }
  return {state, out, outs};
}

test('Μοιάζει με: τόνοι, κεφαλαία, ενικός/πληθυντικός, συνώνυμα, και όχι ψεύτικα ταιριάσματα', () => {
  const m = n => findSimilar(CASE_DATA, n)?.material ?? null;
  assert.equal(m('Βρυσάκι κήπου'), 'tap');
  assert.equal(m('ΒΡΥΣΗ ΚΗΠΟΥ'), 'tap');
  assert.equal(m('μπαταρίες κουζίνας'), 'mixer');
  assert.equal(m('Θερμοσίφωνας ηλιακός'), 'heater');
  assert.equal(m('boiler'), 'heater');
  assert.equal(m('σιφόνι μπανιέρας'), 'siphon');
  assert.equal(m('Σίτες'), null);
  assert.equal(m('βάση τηλεόρασης'), null);          // «βάση» αλλά όχι «βάση ντουζιέρας»
  assert.equal(m('laminate'), null);                 // όχι «πόρτα laminate»
  assert.deepEqual(stems('Σίτες'), stems('σιτα'));
  assert.equal(rankGeneric(CASE_DATA, 'σίτες αλουμινίου')[0].id, 'frame');
  assert.equal(rankGeneric(CASE_DATA, 'καθρέπτης μπάνιου')[0].id, 'wall-fix');
  assert.equal(rankGeneric(CASE_DATA, 'ανεμιστήρας οροφής')[0].id, 'ceiling-fix');
  assert.equal(rankGeneric(CASE_DATA, 'τζάκι').length, CASE_DATA.genericCategories.length);
});

test('άρθρο στο {είδος}: από την κατάληξη, «τη»/«την», «τον» χωρίς -ς, και αλλαγή από τον μάστορα', () => {
  const cases = {'Σίτες': 'τις σίτες', 'ράφι': 'το ράφι', 'Ράφια': 'τα ράφια', 'κουρτίνα': 'την κουρτίνα', 'λεκάνη': 'τη λεκάνη',
    'θερμοστάτης': 'τον θερμοστάτη', 'Θερμοσίφωνας ηλιακός': 'τον θερμοσίφωνα ηλιακό', 'τοίχος της αυλής': 'τον τοίχο της αυλής',
    'σωλήνες': 'τους σωλήνες', 'στρώμα': 'το στρώμα', 'στρώματα': 'τα στρώματα', 'μπαταρία': 'την μπαταρία', 'κάγκελα': 'τα κάγκελα',
    'laminate': 'το laminate', 'προβολείς': 'τους προβολείς', 'ΑΠΟΡΡΟΦΗΤΗΡΑΣ': 'τον ΑΠΟΡΡΟΦΗΤΗΡΑ'};
  for(const [n, want] of Object.entries(cases)) assert.equal(withArticle(n), want, n);
  assert.equal(withArticle('σίτες', 'τους'), 'τους σίτες');
  assert.equal(guessArticle('οδός'), 'την');
  assert.equal(fillKind('Στερεώνουμε {είδος} στον τοίχο.', 'Σίτες'), 'Στερεώνουμε τις σίτες στον τοίχο.');
});

test('είδος εκτός καταλόγου → Μοιάζει με → ερωτήσεις → κάρτα → βιβλιοθήκη και λίστα ομάδας', () => {
  const r = run('Βρυσάκι κήπου', [ITEM.yes, 'Κήπου ή μπαλκονιού', 'Όχι, φέρνουμε σωλήνα']);
  assert.equal(r.outs[0].question, 'Μοιάζει με: Βρύση. Να βάλω αυτή την ανάλυση;');
  assert.deepEqual([r.out.type, r.out.analysisId], ['pick', 'tap:garden.new']);
  const k = run('Βρυσάκι κήπου', [ITEM.yes, 'Κήπου ή μπαλκονιού', 'Όχι, φέρνουμε σωλήνα', CARD.keep]);
  assert.equal(k.out.question, 'Το «Βρυσάκι κήπου» μπήκε στη λίστα της ομάδας, χωρίς στοιχεία πελάτη, για να γραφτεί κανονική ανάλυση για όλους.');
  assert.deepEqual(k.out.effects.map(e => e.kind), ['library', 'missing']);
  assert.equal(k.out.effects[0].entry.kind, 'case');
  // Βασική περίπτωση (υπάρχει πάντα) και «Όχι» → είδος δουλειάς.
  assert.equal(run('Βρυσάκι κήπου', [ITEM.yes, 'Κήπου ή μπαλκονιού', 'Ναι, αλλάζει η παλιά']).out.analysisId, 'tap:garden.replace');
  assert.equal(run('Βρυσάκι κήπου', [ITEM.no]).out.question, 'Τι δουλειά είναι, για να βάλω την ανάλογη;');
});

test('είδος δουλειάς: 6 πιο πιθανές, «Άλλο είδος», γενική ανάλυση με το είδος μέσα, «Άλλο άρθρο»', () => {
  const r = run('Σίτες', []);
  assert.equal(r.out.say, 'Έψαξα στον κατάλογο για κάτι παρόμοιο. Δεν βρέθηκε.');
  assert.equal(r.out.options[0], 'Σε κούφωμα (πόρτα ή παράθυρο)');
  assert.deepEqual(r.out.options.slice(-2), [ITEM.other, ITEM.mine]);
  assert.equal(r.out.options.length, 8);
  assert.equal(run('Σίτες', [ITEM.other]).out.options.length, CASE_DATA.genericCategories.length + 1);
  const c = run('Σίτες', [0]);
  assert.equal(c.out.say, 'Αυτή είναι η γενική ανάλυση για «Σε κούφωμα (πόρτα ή παράθυρο)», με τις σίτες μέσα:');
  const texts = c.out.card.after.analysis.sections.flatMap(s => s.items.map(i => i.text));
  assert.ok(texts.some(t => t.includes('τις σίτες')) && !texts.some(t => t.includes('{')));
  assert.deepEqual(c.out.options, [CARD.keep, ITEM.article, ITEM.other, ITEM.mine]);
  const a = run('Σίτες', [0, ITEM.article]);
  assert.equal(a.out.question, 'Πώς το λες;');
  const fixed = run('Σίτες', [0, ITEM.article, a.out.options.indexOf('τα σίτες')]);
  assert.match(fixed.out.say, /με τα σίτες μέσα/);
  const kept = run('Σίτες', [0, CARD.keep]);
  assert.deepEqual([kept.out.effects[0].entry.kind, kept.out.effects[0].entry.category, kept.out.effects[1].category], ['generic', 'frame', 'frame']);
  // Χωρίς εγκεκριμένες γενικές: κατευθείαν «Θα το πω εγώ».
  const none = createLibraryEngine({data: appData(map, res), base: ANALYSES}).start({item: {name: 'Σίτες'}}).out;
  assert.equal(none.question, 'Πες μου με δικά σου λόγια. Τι κάνεις πρώτα;');
});

test('Θα το πω εγώ: τρεις ερωτήσεις, «Και κάτι ακόμα», έλεγχος κανόνων, κάρτα «Έτσι θα φαίνεται»', () => {
  const steps = [ITEM.mine, {text: 'Ελέγχουμε τον τοίχο και την πρίζα.'}, ITEM.more, {text: 'Σημαδεύουμε τα σημεία στήριξης.'},
    {text: 'Στερεώνουμε τη βάση και κρεμάμε το τζάκι.'}, {text: 'Το ανάβουμε και ελέγχουμε όλες τις λειτουργίες.'}];
  const r = run('Τζάκι ηλεκτρικό', steps);
  assert.deepEqual([r.out.type, r.out.say], ['pick', 'Έτσι θα φαίνεται στον πελάτη:']);
  const a = r.out.card.after.analysis;
  assert.deepEqual(a.sections.map(s => s.items.length), [0, 2, 1, 1, 0]);
  assert.equal(a.title, 'Τζάκι ηλεκτρικό');
  assert.deepEqual(r.out.options, [CARD.keep, ITEM.more, CARD.cancel]);
  const bad = run('Τζάκι ηλεκτρικό', [ITEM.mine, {text: 'Σας δίνουμε εγγύηση για πάντα.'}]);
  assert.equal(bad.out.say, 'Δεν αναφέρουμε εγγύηση.');
  assert.equal(textProblem('λίγο'), 'Θέλει από 8 έως 320 χαρακτήρες.');
  assert.equal(run('Τζάκι ηλεκτρικό', [...steps, CARD.keep]).out.effects[0].entry.kind, 'own');
  assert.equal(run('Τζάκι ηλεκτρικό', [...steps, CARD.cancel]).out.question, 'Εντάξει, δεν κράτησα τίποτα.');
});

test('βιβλιοθήκη του μάστορα: κλειδί κανονικοποιημένο, ξαναβρίσκεται, σβήνεται', () => {
  env();
  const analysis = {title: 'Σίτες', sections: []};
  assert.equal(S.saveLibrary('Σίτες!', {kind: 'own', analysis}), true);
  assert.equal(S.libraryEntry('σίτες').kind, 'own');
  assert.equal(S.libraryEntry('ΣΙΤΕΣ').name, 'Σίτες!');
  assert.equal(S.libKey('  Σίτες   αλουμινίου '), 'σιτεσ αλουμινιου');
  assert.equal(S.saveLibrary('x', {kind: 'own'}), false);
  S.removeLibrary('σιτεσ');
  assert.equal(S.libraryEntry('σίτες'), null);
  assert.ok(S.deletedAt()['analysis:σιτεσ'] > 0);
});

test('λίστα ομάδας: χωρίς ονόματα, τηλέφωνα, αριθμούς ή «για ποιον» — ουρά στη συσκευή', () => {
  env();
  const personal = {names: ['Γιώργος', 'Αντωνίου'], phones: ['6912345678']};
  assert.equal(S.missingName('Σίτες για τον Γιώργο Αντωνίου 6912345678', personal), 'σιτεσ');
  assert.equal(S.missingName('Γιώργος Αντωνίου', personal), null);
  assert.equal(S.missingName('3 ράφια στον κ. Παπαδόπουλο'), 'ραφια');
  assert.equal(S.missingName('x@y.gr 2101234567'), null);
  S.queueMissing('Σίτες αλουμινίου', 'frame', personal);
  S.queueMissing('Τζάκι', 'DROP TABLE', personal);
  assert.deepEqual(S.missingQueue(), [{name: 'σιτεσ αλουμινιου', category: 'frame'}, {name: 'τζακι', category: null}]);
  S.dropMissing(1);
  assert.equal(S.missingQueue().length, 1);
});

test('συγχρονισμός: η πιο πρόσφατη αλλαγή κερδίζει, και στα σβησίματα', () => {
  const {toLocal, toRemote} = mergeEntries(
    {a: {value: 1, updated: 10}, b: {value: 2, updated: 5}, c: {value: null, updated: 9}, d: {value: 4, updated: 3}},
    {a: {value: 9, updated: 8}, b: {value: 7, updated: 6}, c: {value: 3, updated: 4}, e: {value: 5, updated: 1}});
  assert.deepEqual(toRemote.map(x => x[0]).sort(), ['a', 'c', 'd']);
  assert.deepEqual(toLocal.map(x => x[0]).sort(), ['b', 'e']);
});

test('συγχρονισμός με ψεύτικο Supabase: κανόνες/βιβλιοθήκη πάνε-έρχονται, λίστα ομάδας και μετρήσεις φεύγουν', async () => {
  env();
  S.setCaseRule('wc', {job: 'replace', type: 'hung', wall: 'drywall'}, 'Λεκάνη', 2000);
  S.saveLibrary('Σίτες', {kind: 'own', analysis: {title: 'Σίτες', sections: []}}, 3000);
  S.removeEditRule('wc', 4000);
  S.queueMissing('Σίτες', 'frame');
  S.track({ev: 'open', step: 'item'});
  const db = {user_rules: [{key: 'speech', value: 's', updated_at: new Date(5000).toISOString()},
    {key: 'case:wc', value: {answers: {job: 'new', type: 'hung', wall: 'front'}, label: 'παλιό'}, updated_at: new Date(1000).toISOString()}],
    user_analyses: [{key: 'ραφια', value: {name: 'Ράφια', kind: 'own', analysis: {title: 'Ράφια', sections: []}, updated: 6000}, updated_at: new Date(6000).toISOString()}]};
  const calls = {upsert: {}, rpc: [], metrics: []};
  const client = {
    from: table => ({
      select: async () => ({data: db[table], error: null}),
      upsert: async rows => { calls.upsert[table] = rows; return {error: null}; },
      insert: async rows => { calls.metrics.push(...rows); return {error: null}; },
    }),
    rpc: async (name, args) => { calls.rpc.push([name, args]); return {error: null}; },
  };
  const r = await syncAll({client, userId: 'u1'});
  assert.deepEqual([r.pulled, r.missing, r.metrics], [2, 1, 1]);
  assert.equal(S.speechRule(), 's');                                         // ήρθε από τον λογαριασμό
  assert.equal(S.caseRules().wc.answers.wall, 'drywall');                    // η συσκευή είχε νεότερο
  assert.equal(S.libraryEntry('ράφια').name, 'Ράφια');
  const rules = Object.fromEntries(calls.upsert.user_rules.map(x => [x.key, x]));
  assert.deepEqual([rules['case:wc'].value.answers.wall, rules['edit:wc'].value, rules['case:wc'].user_id], ['drywall', null, 'u1']);
  assert.equal(calls.upsert.user_analyses[0].key, 'σιτεσ');
  assert.deepEqual(calls.rpc, [['bump_missing_item', {p_name: 'σιτεσ', p_category: 'frame'}]]);
  assert.deepEqual(Object.keys(calls.metrics[0].event).sort(), ['ev', 'step', 't']);
  assert.equal(S.missingQueue().length, 0);
  // Δεύτερος γύρος: τίποτα καινούργιο για μετρήσεις και λίστα.
  calls.metrics.length = 0;
  db.user_rules = calls.upsert.user_rules.map(x => ({...x})); db.user_analyses = calls.upsert.user_analyses.map(x => ({...x}));
  const again = await syncAll({client, userId: 'u1'});
  assert.deepEqual([again.metrics, again.missing], [0, 0]);
  // Χωρίς λογαριασμό: τίποτα.
  assert.equal(await createSync(() => null)(true), null);
});

test('τα τοπικά για συγχρονισμό: σβησμένα ως value null', () => {
  env();
  S.setEditRule('wc', [{op: 'remove', item: 'x'}], 'Λεκάνη: 1 αλλαγή', 100);
  S.removeEditRule('wc', 200);
  S.setSpeechRule('c', 300);
  const l = localEntries();
  assert.deepEqual(l.user_rules['edit:wc'], {value: null, updated: 200});
  assert.deepEqual(l.user_rules.speech, {value: 'c', updated: 300});
});
