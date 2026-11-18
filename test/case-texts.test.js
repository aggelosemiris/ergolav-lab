import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileAll, compileMaterial, written, hash, loadRecipes } from '../tools/catalog/case-texts.mjs';
import { applyDecisions } from '../tools/catalog/apply-reviews.mjs';
import { ANALYSES } from '../src/analyses-data.js';

const {map, res} = await compileAll();
const all = written();
// Αντίγραφο της συνταγής, για να αλλάξει ένα κείμενο στο τεστ χωρίς να πειραχτεί το αρχείο.
const RECIPES = await loadRecipes();
const recipe = id => ({...RECIPES[id]});

test('όλα τα κείμενα που γράφτηκαν περνούν τους κανόνες, σε κανονική, απλή και σύντομη εκδοχή', () => {
  assert.ok(Object.keys(res).length >= 10);
  for(const [id, r] of Object.entries(res)) assert.deepEqual(r.err, [], id);
});

test('οι σημερινές αναλύσεις μένουν άθικτες: κάθε σημερινό σημείο κρατά ακριβώς το κείμενό του', () => {
  for(const r of Object.values(res)) for(const [id, it] of Object.entries(r.out.items)) if(it.source === 'current'){
    const [task, section] = id.split('.');
    assert.equal(it.n, all[task].sections.find(s => s.key === section).items.find(i => i.id === id).text, id);
  }
  // Η βασική περίπτωση είναι ακριβώς η σημερινή ανάλυση της εφαρμογής.
  for(const r of Object.values(res)) for(const c of r.out.cases.filter(c => c.source === 'base')){
    const a = ANALYSES[c.task];
    assert.deepEqual(c.sections, Object.fromEntries(a.sections.map(s => [s.key, s.items.map(i => i.id)])), c.id);
    assert.equal(c.title, a.title);
  }
});

test('ίδιο βήμα σε πολλές περιπτώσεις = ίδιο id, και κάθε νέα περίπτωση έχει έγκριση false μέχρι να ελεγχθεί', () => {
  const wc = res.wc.out;
  const uses = id => wc.cases.filter(c => Object.values(c.sections).flat().includes(id)).length;
  assert.ok(uses('plumb-wc-wall-hung.steps.4') > 5);
  assert.ok(uses('wc.steps.frame-drywall') >= 2);
  for(const r of Object.values(res)){
    for(const c of r.out.cases) if(c.source !== 'base') assert.equal(typeof c.review.reviewed, 'boolean');
    for(const it of Object.values(r.out.items)) assert.ok('reviewer' in it.review && 'reviewed_at' in it.review);
  }
});

test('έγκριση ισχύει μόνο για το κείμενο που εγκρίθηκε· αλλαγή κειμένου = ξανά έλεγχος', () => {
  const m = map.materials.find(x => x.id === 'socket');
  const before = res.socket.out.items['socket.checks.wet-cover'].review;
  const ok = {[before.key]: {reviewed: true, reviewer: 'Τεστ', reviewed_at: '2026-11-18T10:00:00.000Z', hash: before.hash}};
  const approved = compileMaterial(m, {...recipe('socket')}, all, ok).out.items['socket.checks.wet-cover'].review;
  assert.deepEqual([approved.reviewed, approved.reviewer], [true, 'Τεστ']);
  const changed = recipe('socket');
  changed.items = {...changed.items, 'socket.checks.wet-cover': ['checks', 'Το καπάκι κλείνει μόνο του και εφαρμόζει παντού γύρω-γύρω.', changed.items['socket.checks.wet-cover'][2], changed.items['socket.checks.wet-cover'][3]]};
  assert.equal(compileMaterial(m, changed, all, ok).out.items['socket.checks.wet-cover'].review.reviewed, false);
});

test('γενικές κατηγορίες: μία ανάλυση για κάθε κατηγορία του χάρτη, με τη θέση {είδος} και έγκριση false μέχρι να ελεγχθεί', () => {
  const g = res.generic.out;
  assert.deepEqual(g.cases.map(c => c.id).sort(), map.generic.map(x => `generic:${x.id}`).sort());
  for(const c of g.cases){
    const ids = Object.values(c.sections).flat();
    assert.ok(ids.some(id => g.items[id].n.includes('{είδος}')), c.id);
    assert.ok(!c.title.includes('{'), c.id);
    assert.equal(c.review.reviewed, false);
  }
  // Οι θέσεις που υπάρχουν: μόνο {είδος} και {ποσότητα}.
  for(const it of Object.values(g.items)) for(const t of [it.n, it.s, it.c]) for(const [, p] of t.matchAll(/\{([^}]*)\}/g)) assert.ok(['είδος', 'ποσότητα'].includes(p), t);
  // Με σημείο ασφάλειας στον χάρτη, η κατηγορία το κουβαλά στη σελίδα ελέγχου.
  assert.ok(g.cases.find(c => c.id === 'generic:roof').safety);
});

test('αρχείο αποφάσεων: εγκρίνει, κρατά τα σχόλια, αγνοεί ό,τι άλλαξε από τότε', () => {
  const current = {'sc:a': hash({n: 1}), 'case:b': hash({n: 2}), 'sc:c': hash({n: 3})};
  const r = applyDecisions({format: 'ergolav-reviews', reviewer: 'Άγγελος', exported_at: '2026-11-18T09:00:00Z', decisions: [
    {key: 'sc:a', hash: current['sc:a'], verdict: 'ok'},
    {key: 'case:b', hash: current['case:b'], verdict: 'fix', comment: 'Λείπει η σιλικόνη'},
    {key: 'sc:c', hash: 'παλιό', verdict: 'ok'},
    {key: 'sc:x', hash: 'x', verdict: 'ok'}]}, current, {});
  assert.deepEqual(r.reviews['sc:a'], {reviewed: true, reviewer: 'Άγγελος', reviewed_at: '2026-11-18T09:00:00.000Z', hash: current['sc:a']});
  assert.equal(r.reviews['case:b'].reviewed, false);
  assert.deepEqual(r.fixes, [{key: 'case:b', comment: 'Λείπει η σιλικόνη'}]);
  assert.deepEqual([r.applied, r.stale, r.unknown], [2, ['sc:c'], ['sc:x']]);
  assert.throws(() => applyDecisions({format: 'άλλο'}, current, {}));
  assert.throws(() => applyDecisions({format: 'ergolav-reviews', decisions: []}, current, {}), /ελεγκτή/);
});
