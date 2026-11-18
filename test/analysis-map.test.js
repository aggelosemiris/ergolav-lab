import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMap, loadMap, summary } from '../tools/catalog/analysis-map.mjs';
import { nextQuestion, prune, cases, enumerate, lineAnswers, caseLabel, covers } from '../src/case-map.js';
import { CATALOG } from '../src/catalog.js';
import { CATALOG_TASKS } from '../src/catalog-tasks.js';

const map = loadMap();
const mat = id => map.materials.find(m => m.id === id);

test('ο χάρτης είναι συνεπής: κάθε είδος του καταλόγου σε υλικό ή αναλώσιμο μέσα σε υλικό, βασικές που υπάρχουν', () => {
  assert.deepEqual(checkMap(map), []);
});

test('κάθε υλικό με ανάλυση σήμερα έχει τη σημερινή ως βασική περίπτωση, χωρίς επικάλυψη με άλλη πηγή', () => {
  const tasks = new Set(Object.values(CATALOG_TASKS).flatMap(t => [t.task, ...Object.values(t.options || {}), ...Object.values(t.qualifiers || {})]).filter(Boolean));
  const bases = new Set(map.materials.flatMap(m => m.base.map(b => b.task)));
  for(const t of tasks) assert.ok(bases.has(t), `η εργασία ${t} δεν είναι βασική σε κανένα υλικό`);
  for(const m of map.materials) for(const c of cases(m)){
    const n = [...m.base, ...(m.existing || [])].filter(s => covers(s.answers, c.answers)).length;
    assert.ok(n <= 1, `${c.id}: την καλύπτουν ${n} κείμενα`);
  }
});

test('δέντρο: υπο-ερωτήσεις μόνο όταν ισχύουν (ο «τοίχος» μόνο για κρεμαστή)', () => {
  const wc = mat('wc');
  assert.equal(nextQuestion(wc, {}).id, 'job');
  assert.equal(nextQuestion(wc, {job: 'replace'}).id, 'type');
  assert.equal(nextQuestion(wc, {job: 'replace', type: 'hung'}).id, 'wall');
  assert.equal(nextQuestion(wc, {job: 'replace', type: 'floor'}).id, 'outlet');
  assert.equal(nextQuestion(wc, {job: 'replace', type: 'floor', outlet: 'wall'}).id, 'cistern');
  assert.equal(nextQuestion(wc, {job: 'replace', type: 'hung', wall: 'drywall'}), null);
  // Η κρεμαστή γίνεται δαπέδου: ο τοίχος του καζανακιού δεν ισχύει πια.
  assert.deepEqual(prune(wc, {job: 'new', type: 'floor', wall: 'drywall'}), {job: 'new', type: 'floor'});
  // Ίδια ερώτηση, άλλη εκδοχή ανά χρήση: η μπαταρία μπανιέρας έχει και «χείλος».
  const mixer = mat('mixer');
  assert.deepEqual(nextQuestion(mixer, {use: 'bath', job: 'replace'}).answers.map(a => a.id), ['exposed', 'concealed', 'rim']);
  assert.deepEqual(nextQuestion(mixer, {use: 'kitchen', job: 'replace'}).answers.map(a => a.id), ['deck', 'wall']);
});

test('περιπτώσεις: όλοι οι συνδυασμοί, χωρίς τους εξαιρεμένους· ετικέτα στα λόγια του μάστορα', () => {
  const wc = mat('wc');
  assert.equal(enumerate(wc).length, 27);
  const shower = mat('shower');
  const ex = enumerate(shower).filter(c => c.excluded);
  assert.ok(ex.length === 3 && ex.every(c => c.answers.job === 'replace'));
  assert.equal(cases(shower).length, enumerate(shower).length - 3);
  assert.equal(caseLabel(wc, {job: 'replace', type: 'hung', wall: 'drywall'}), 'Αλλαγή παλιάς · Κρεμαστή · Γυψοσανίδα');
  const base = cases(wc).find(c => c.source === 'base' && c.task === 'plumb-wc-wall-hung');
  assert.deepEqual(base.answers, {job: 'replace', type: 'hung', wall: 'masonry'});
});

test('η γραμμή της προσφοράς απαντά ήδη: τύπος λεκάνης, χρήση μπαταρίας, μέγεθος πλακακιού', () => {
  assert.deepEqual(lineAnswers(mat('wc'), ['wc:δαπέδου']), {type: 'floor'});
  assert.deepEqual(lineAnswers(mat('wc'), ['tank:εντοιχισμού']), {type: 'hung'});
  assert.deepEqual(lineAnswers(mat('mixer'), ['mixer:μπανιέρας με τηλέφωνο']), {use: 'bath'});
  assert.deepEqual(lineAnswers(mat('tile'), ['tile:Πλακάκι τοίχου', 'tile:60×120 μάρμαρο look']), {surface: 'wall', size: 'large'});
});

test('σύνολα: κάθε υλικό έχει 2–4 απαντήσεις ανά ερώτηση και τουλάχιστον μία περίπτωση εκτός της βασικής', () => {
  const rows = summary(map);
  assert.equal(rows.length, map.materials.length);
  for(const r of rows){
    for(const q of r.m.questions) assert.ok(q.answers.length >= 2 && q.answers.length <= 4, `${r.m.id}.${q.id}`);
    assert.ok(r.cases > r.base, `${r.m.id}: μόνο η βασική`);
  }
  // Όλα τα είδη του καταλόγου που χρειάζονται ανάλυση (όχι αναλώσιμα) είναι σε ακριβώς ένα υλικό.
  const own = new Map();
  for(const m of map.materials) for(const k of m.catalog) own.set(k, m.id);
  for(const c of CATALOG) if(!CATALOG_TASKS[c.id]?.consumable)
    assert.ok(own.has(c.id) || (c.options || []).every(o => own.has(`${c.id}:${o.label}`)), c.id);
});
