import { test } from 'node:test';
import assert from 'node:assert/strict';

function env(initial = {}){
  const data = {...initial};
  globalThis.localStorage = {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }};
  return data;
}
env();
const { compileAll, appData } = await import('../tools/catalog/case-texts.mjs');
const { createLibraryEngine, MENU, POINT, CARD, ALWAYS, AFTER, FIXED_LABELS, cut } = await import('../src/allaxe-engine.js');
const { applyEdits, mergeOps } = await import('../src/analysis-edits.js');
const { pickAnalysis } = await import('../src/case-pick.js');
const store = await import('../src/allaxe-store.js');
const { ANALYSES } = await import('../src/analyses-data.js');
const { lineFor } = await import('../src/parse.js');

const {map, res} = await compileAll();
const approve = r => ({...r, out: {...r.out,
  cases: r.out.cases.map(c => c.review ? {...c, review: {...c.review, reviewed: true}} : c),
  extras: r.out.extras.map(x => ({...x, review: {...x.review, reviewed: true}})),
  items: Object.fromEntries(Object.entries(r.out.items).map(([id, it]) => [id, {...it, review: {...it.review, reviewed: true}}]))}});
const ALL = appData(map, Object.fromEntries(Object.entries(res).map(([k, r]) => [k, approve(r)])));
// «Τίποτα εγκεκριμένο»: όπως πριν από τον έλεγχο, ανεξάρτητα από το data/cases/reviews.json.
const unapprove = r => ({...r, out: {...r.out,
  cases: r.out.cases.map(c => c.review ? {...c, review: {...c.review, reviewed: false}} : c),
  extras: r.out.extras.map(x => ({...x, review: {...x.review, reviewed: false}})),
  items: Object.fromEntries(Object.entries(r.out.items).map(([id, it]) => [id, {...it, review: {...it.review, reviewed: false}}]))}});
const NONE = appData(map, Object.fromEntries(Object.entries(res).map(([k, r]) => [k, unapprove(r)])));
const wc = (() => { const l = lineFor('wc', 1), o = l.options.find(x => x.label === 'κρεμαστή'); return Object.assign(l, {code: o.code, name: 'Λεκάνη κρεμαστή'}); })();
const TASK = 'plumb-wc-wall-hung', A = ANALYSES[TASK];
const ctx = (extra = {}) => ({task: TASK, lines: [wc], voice: '', rules: {}, chosen: null, ops: [], scope: null, ...extra});

/** Τρέχει μια σειρά απαντήσεων· αριθμός = πάτημα στο κουμπί με αυτή τη θέση. */
function run(engine, c, answers){
  let {state, out} = engine.start(c);
  const outs = [out];
  for(const a of answers){
    const ev = Array.isArray(a) ? {type: 'order', value: a} : typeof a === 'number' ? {type: 'answer', value: out.options[a], index: a}
      : a?.text != null ? {type: 'text', value: a.text} : a === 'close' ? {type: 'close'} : {type: 'answer', value: a, index: out.options.indexOf(a)};
    ({state, out} = engine.next(state, ev));
    outs.push(out);
  }
  return {state, out, outs};
}
const lib = createLibraryEngine({data: ALL, base: ANALYSES});
const shapes = new Set(['ask', 'pick', 'rewrite']);

test('μηχανή: ένα από τα τρία σχήματα σε κάθε βήμα, μενού με τα 6 κουμπιά', () => {
  const {out} = lib.start(ctx());
  assert.equal(out.type, 'ask');
  assert.equal(out.question, 'Τι δεν σου αρέσει εδώ;');
  assert.deepEqual(out.options, Object.values(MENU));
  const r = run(lib, ctx(), [MENU.wrong, 'Αλλαγή παλιάς', 'Γυψοσανίδα', CARD.keep, ALWAYS.yes, AFTER.close]);
  for(const o of r.outs.slice(0, -1)) assert.ok(shapes.has(o.type), JSON.stringify(o));
  assert.equal(r.out, null);
  // Χωρίς εγκεκριμένες εκδοχές: χωρίς «Πολύ τεχνικό» / «Πολύ μεγάλο».
  assert.deepEqual(createLibraryEngine({data: NONE, base: ANALYSES}).start(ctx()).out.options, [MENU.wrong, MENU.order, MENU.missing, MENU.other]);
});

test('δέντρο ερωτήσεων: ό,τι λέει η γραμμή δεν ξαναρωτιέται, η υπο-ερώτηση μόνο όταν ισχύει', () => {
  const r = run(lib, ctx(), [MENU.wrong]);
  assert.match(r.out.say, /Κρεμαστή/);
  assert.equal(r.out.question, 'Αλλάζει παλιά λεκάνη ή μπαίνει καινούργια;');
  const r2 = run(lib, ctx(), [MENU.wrong, 'Αλλαγή παλιάς']);
  assert.equal(r2.out.question, 'Σε τι τοίχο θα μπει το καζανάκι;');
  // Δαπέδου: ρωτά αποχέτευση και καζανάκι, όχι τοίχο.
  const floor = (() => { const l = lineFor('wc', 1), o = l.options.find(x => x.label === 'δαπέδου'); return Object.assign(l, {code: o.code, name: 'Λεκάνη δαπέδου'}); })();
  const r3 = run(lib, ctx({task: 'plumb-wc-floor', lines: [floor]}), [MENU.wrong, 'Αλλαγή παλιάς']);
  assert.equal(r3.out.question, 'Η αποχέτευση βγαίνει από το πάτωμα ή από τον τοίχο;');
});

test('περίπτωση: κάρτα ΠΡΙΝ/ΜΕΤΑ, «ήδη», «δεν την έχω έτοιμη», κανόνας «Ναι, πάντα»', () => {
  const r = run(lib, ctx(), [MENU.wrong, 'Αλλαγή παλιάς', 'Γυψοσανίδα']);
  assert.deepEqual([r.out.type, r.out.analysisId, r.out.say], ['pick', 'wc:replace.hung.drywall', 'Βρήκα την ανάλογη ανάλυση:']);
  assert.equal(r.out.card.before.struck, true);
  assert.equal(r.out.card.after.analysis.sections.length, 5);
  assert.deepEqual(r.out.options, [CARD.keep, CARD.more, CARD.cancel]);
  const same = run(lib, ctx(), [MENU.wrong, 'Αλλαγή παλιάς', 'Τούβλο ή μπετό']);
  assert.equal(same.out.question, 'Αυτή είναι ήδη η περίπτωση που έχει η ανάλυση. Θες να αλλάξεις κάτι άλλο;');
  const notReady = run(createLibraryEngine({data: NONE, base: ANALYSES}), ctx(), [MENU.wrong, 'Αλλαγή παλιάς', 'Γυψοσανίδα']);
  assert.equal(notReady.out.question, 'Αυτή την περίπτωση δεν την έχω ακόμα έτοιμη. Πες μου τι θες να αλλάξει.');
  const yes = run(lib, ctx(), [MENU.wrong, 'Αλλαγή παλιάς', 'Γυψοσανίδα', CARD.keep, ALWAYS.yes]);
  assert.deepEqual(yes.out.effects, [{kind: 'caseRule', material: 'wc', answers: {job: 'replace', type: 'hung', wall: 'drywall'}, label: 'Λεκάνη: Αλλαγή παλιάς · Κρεμαστή · Γυψοσανίδα'}]);
  const here = run(lib, ctx(), [MENU.wrong, 'Αλλαγή παλιάς', 'Γυψοσανίδα', CARD.keep, ALWAYS.here]);
  assert.equal(here.out.question, 'Εντάξει, μόνο σε αυτή την προσφορά.');
  assert.equal(here.out.effects, undefined);
  // «Άκυρο»: τίποτα δεν αλλάζει, πίσω στο μενού. «Κι άλλο…»: «Τι άλλο δεν σου αρέσει;».
  assert.equal(run(lib, ctx(), [MENU.wrong, 'Αλλαγή παλιάς', 'Γυψοσανίδα', CARD.cancel]).state.ctx.chosen, null);
  assert.equal(run(lib, ctx(), [MENU.wrong, 'Αλλαγή παλιάς', 'Γυψοσανίδα', CARD.more]).out.question, 'Τι άλλο δεν σου αρέσει;');
});

test('εκδοχές λόγου: όλη η εργασία με παράδειγμα, «ήδη σε αυτή», κανόνας «Πάντα απλά λόγια»', () => {
  const r = run(lib, ctx(), [MENU.tech]);
  assert.deepEqual([r.out.type, r.out.variant], ['pick', 's']);
  assert.match(r.out.say, /πιο απλά λόγια/);
  assert.notEqual(r.out.card.example.before, r.out.card.example.after);
  assert.equal(run(lib, ctx({chosen: {variant: 's'}}), [MENU.tech]).out.question, 'Είναι ήδη σε αυτή την εκδοχή. Θες κάτι άλλο;');
  assert.deepEqual(run(lib, ctx(), [MENU.long, CARD.keep, ALWAYS.yes]).out.effects, [{kind: 'speechRule', variant: 'c', label: 'Πάντα σύντομα'}]);
});

test('σειρά: ενότητα → νέα σειρά → κάρτα → «Μπήκε. Θες κάτι ακόμα;»· ίδια σειρά = τίποτα', () => {
  const ids = A.sections[2].items.map(i => i.id);
  const order = [ids[1], ids[0], ...ids.slice(2)];
  const r = run(lib, ctx(), [MENU.order, 'Στάδια τοποθέτησης']);
  assert.deepEqual(r.out.order.items.map(i => i.id), ids);
  const c = run(lib, ctx(), [MENU.order, 'Στάδια τοποθέτησης', order]);
  assert.deepEqual([c.out.type, c.out.edit], ['rewrite', {op: 'order', section: 'steps', order}]);
  assert.equal(run(lib, ctx(), [MENU.order, 'Στάδια τοποθέτησης', order, CARD.keep]).out.question, 'Μπήκε. Θες κάτι ακόμα;');
  assert.equal(run(lib, ctx(), [MENU.order, 'Στάδια τοποθέτησης', ids]).out.question, 'Η σειρά έμεινε ίδια. Θες κάτι άλλο;');
  const after = applyEdits(A, [c.out.edit]).analysis;
  assert.deepEqual(after.sections[2].items.map(i => i.id), order);
});

test('επιπλέον βήματα: έως 6 προτάσεις, πρώτα τα επιπλέον του υλικού, και «Πρόσθεσε δικό μου βήμα»', () => {
  const r = run(lib, ctx(), [MENU.missing]);
  assert.equal(r.out.question, 'Μήπως λείπει κάποιο από αυτά;');
  assert.ok(r.out.options.length <= 7 && r.out.options.at(-1) === AFTER.own);
  const extras = ALL.extras.wc.filter(x => !x.when || x.when.job?.includes('replace')).map(x => x.id);
  assert.ok(extras.includes(r.state.list[0].id), r.state.list[0].id);
  const add = run(lib, ctx(), [MENU.missing, 0]);
  assert.equal(add.out.edit.op, 'add');
  assert.match(add.out.summary, /^Μπαίνει στο «/);
  // Όσα έχουν μπει δεν ξαναπροτείνονται.
  const after = run(lib, ctx({ops: [add.out.edit]}), [MENU.missing]);
  assert.ok(!after.state.list.some(x => x.id === add.out.edit.item.id));
  // Δικό μου βήμα: ενότητα → κείμενο → κάρτα.
  const own = run(lib, ctx(), [MENU.missing, AFTER.own, 'Έλεγχοι πριν την παράδοση', {text: 'Δείχνουμε στον πελάτη πώς κλείνει ο γωνιακός διακόπτης.'}]);
  assert.deepEqual([own.out.type, own.out.edit.op, own.out.edit.section], ['rewrite', 'add', 'checks']);
  assert.match(own.out.edit.item.id, /^own\.checks\./);
  // Πολύ μικρό κείμενο: ξαναρωτά.
  assert.equal(run(lib, ctx(), [MENU.missing, AFTER.own, 'Έλεγχοι πριν την παράδοση', {text: 'λίγο'}]).out.input != null, true);
  // Εγγύηση: δεν γράφεται (ίδιοι κανόνες με τις αναλύσεις).
  const bad = run(lib, ctx(), [MENU.missing, AFTER.own, 'Έλεγχοι πριν την παράδοση', {text: 'Σας δίνουμε εγγύηση πέντε χρόνια για τη λεκάνη.'}]);
  assert.match(bad.out.question, /^Δεν μπορώ να το γράψω έτσι/);
});

test('ένα σημείο: Πολύ τεχνικό / Γράψ’ το αλλιώς / Βγάλ’ το, και το ελάχιστο κάθε ενότητας', () => {
  const item = A.sections[3].items[0];
  const scoped = ctx({scope: {section: 'checks', id: item.id}});
  const {out} = lib.start(scoped);
  assert.deepEqual([out.question, out.focus.text], ['Τι θες να κάνω με αυτό;', item.text]);
  assert.deepEqual(out.options, [POINT.tech, POINT.long, POINT.rewrite, POINT.remove]);
  const tech = run(lib, scoped, [POINT.tech]);
  assert.deepEqual([tech.out.edit.op, tech.out.edit.variant], ['variant', 's']);
  const re = run(lib, scoped, [POINT.rewrite]);
  assert.equal(re.out.input.value, item.text);
  const card = run(lib, scoped, [POINT.rewrite, {text: 'Γεμίζουμε και αδειάζουμε το καζανάκι αρκετές φορές.'}]);
  assert.deepEqual([card.out.edit.op, card.out.options], ['replace', [CARD.keep, CARD.again, CARD.cancel]]);
  assert.equal(run(lib, scoped, [POINT.rewrite, {text: 'Γεμίζουμε και αδειάζουμε το καζανάκι αρκετές φορές.'}, CARD.again]).out.input.value, 'Γεμίζουμε και αδειάζουμε το καζανάκι αρκετές φορές.');
  const rm = run(lib, scoped, [POINT.remove]);
  assert.deepEqual([rm.out.edit, rm.out.summary], [{op: 'remove', item: item.id}, 'Βγαίνει από την ανάλυση:']);
  // Ενότητα στο ελάχιστο (2 στο «Τι χρειάζεται»): δεν βγαίνει, ρωτά αν θες να το γράψεις αλλιώς.
  const pre = A.sections[0].items;
  const ops = pre.slice(2).map(i => ({op: 'remove', item: i.id}));
  const min = run(lib, ctx({ops, scope: {section: 'prerequisites', id: pre[0].id}}), [POINT.remove]);
  assert.match(min.out.question, /θέλει τουλάχιστον 2 σημεία/);
  // «Κάτι άλλο…»: όλα τα σημεία κομμένα στους ~45 χαρακτήρες → ροή σημείου.
  const other = run(lib, ctx(), [MENU.other]);
  assert.ok(other.out.options.every(o => o.length <= 45));
  assert.equal(run(lib, ctx(), [MENU.other, 3]).out.question, 'Τι θες να κάνω με αυτό;');
  assert.equal(cut('α'.repeat(60)).length, 45);
});

test('κλείσιμο: μετά από αλλαγές σημείων ρωτά ΜΙΑ φορά για όλες μαζί, μετά κλείνει', () => {
  const ids = A.sections[2].items.map(i => i.id);
  const flow = [MENU.order, 'Στάδια τοποθέτησης', [ids[1], ids[0], ...ids.slice(2)], CARD.keep, AFTER.more, MENU.missing, 0, CARD.keep];
  const r = run(lib, ctx(), [...flow, AFTER.done]);
  assert.equal(r.out.question, 'Να κρατήσω αυτές τις αλλαγές και στις επόμενες προσφορές με τη λεκάνη;');
  const yes = run(lib, ctx(), [...flow, AFTER.done, ALWAYS.yes]);
  assert.equal(yes.out.effects[0].kind, 'editRule');
  assert.equal(yes.out.effects[0].ops.length, 2);
  assert.equal(yes.out.effects[0].label, 'Λεκάνη: 2 αλλαγές');
  // Με × στη μέση: ίδια ερώτηση· δεύτερο × κλείνει.
  const x = run(lib, ctx(), [...flow, 'close']);
  assert.match(x.out.question, /Να κρατήσω αυτές τις αλλαγές/);
  assert.equal(run(lib, ctx(), [...flow, 'close', 'close']).out, null);
  // Χωρίς αλλαγές, το × κλείνει αμέσως.
  assert.equal(run(lib, ctx(), ['close']).out, null);
});

test('αλλαγές: ασφαλείς να ξαναμπούν, αγνοούνται όταν δεν ταιριάζουν, η αρχική δεν πειράζεται', () => {
  const before = JSON.stringify(A);
  const id = A.sections[4].items[0].id;
  const ops = [{op: 'add', section: 'handover', item: {id: 'own.handover.x', text: 'Σας αφήνουμε τα κουτιά.'}},
    {op: 'replace', item: id, text: 'Καθαρίζουμε τον χώρο.'}, {op: 'remove', item: 'δεν-υπάρχει'}];
  const once = applyEdits(A, ops).analysis, twice = applyEdits(once, ops).analysis;
  assert.deepEqual(once, twice);
  assert.equal(JSON.stringify(A), before);
  assert.equal(once.sections[4].items.at(-1).id, 'own.handover.x');
  // Ενότητα γεμάτη: η προσθήκη δεν μπαίνει.
  const full = Array.from({length: 6}, (_, n) => ({op: 'add', section: 'prerequisites', item: {id: `own.p.${n}`, text: `Προϋπόθεση νούμερο ${n}.`}}));
  assert.equal(applyEdits(A, full).analysis.sections[0].items.length, 4);
  // mergeOps: ίδια αλλαγή μία φορά (η τελευταία), «Βγάλ’ το» σβήνει το «Γράψ’ το αλλιώς» του ίδιου σημείου.
  assert.deepEqual(mergeOps([{op: 'replace', item: id, text: 'α'}], [{op: 'replace', item: id, text: 'β'}]), [{op: 'replace', item: id, text: 'β'}]);
  assert.deepEqual(mergeOps([{op: 'replace', item: id, text: 'α'}], [{op: 'remove', item: id}]), [{op: 'remove', item: id}]);
});

test('κανόνες αλλαγών και αλλαγές ανά προσφορά στη συσκευή· «Αναίρεση» γυρνά τα πάντα πίσω', () => {
  env();
  const undo = store.snapshotAll();
  const op = {op: 'remove', item: A.sections[4].items[0].id};
  store.setQuoteEdits(5, TASK, [op]);
  store.setEditRule('wc', [op], 'Λεκάνη: 1 αλλαγή');
  store.setCaseRule('wc', {job: 'new', type: 'hung', wall: 'front'}, 'x');
  assert.deepEqual(store.quoteEdits(5), {[TASK]: [op]});
  assert.deepEqual(store.editRules().wc.ops, [op]);
  store.restoreAll(undo);
  assert.deepEqual([store.quoteEdits(5), store.editRules(), store.caseRules()], [{}, {}, {}]);
  assert.equal(store.setEditRule('wc', []), false);
  store.setEditRule('wc', [op], ''); store.removeEditRule('wc');
  assert.deepEqual(store.editRules(), {});
});

test('μετρήσεις: μόνο ανώνυμα πεδία, ποτέ κείμενα ή στοιχεία, έως 1000', () => {
  env();
  store.track({ev: 'button', step: 'menu', choice: MENU.tech, material: 'wc', analysis: 'wc:replace.hung.drywall', text: 'Γιώργος 6912345678', client: 'x'});
  const [m] = store.metrics();
  assert.deepEqual(Object.keys(m).sort(), ['analysis', 'choice', 'ev', 'material', 'step', 't']);
  assert.ok(FIXED_LABELS.has(MENU.tech) && !FIXED_LABELS.has('Γιώργος'));
  for(let i = 0; i < 1005; i++) store.track({ev: 'open'});
  assert.equal(store.metrics().length, store.MAX_METRICS);
});

test('η επιλογή με αλλαγές κανόνα: νέα προσφορά παίρνει την περίπτωση και τις αλλαγές, οι σημερινές μένουν άθικτες', () => {
  const before = JSON.stringify(ANALYSES);
  const ids = A.sections[2].items.map(i => i.id);
  const rules = {cases: {wc: {answers: {job: 'replace', type: 'hung', wall: 'masonry'}}}, edits: {wc: {ops: [{op: 'order', section: 'steps', order: [ids[1], ids[0]]}]}}};
  const p = pickAnalysis({data: ALL, base: ANALYSES, task: TASK, lines: [wc], rules});
  const shown = applyEdits(p.analysis, rules.edits.wc.ops, ALL).analysis;
  assert.deepEqual(shown.sections[2].items.slice(0, 2).map(i => i.id), [ids[1], ids[0]]);
  assert.equal(JSON.stringify(ANALYSES), before);
});
