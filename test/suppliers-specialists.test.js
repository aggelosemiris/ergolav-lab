// Εξειδικευμένοι προμηθευτές (Βήμα 0): όλοι απενεργοποιημένοι, εκτός εβδομαδιαίας εκτέλεσης, με τη μέτρησή τους.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SUPPLIERS, ALTERNATES, SPECIALISTS, SPECIALISTS_REJECTED, SPECIALISTS_UNCHECKED } from '../tools/prices/suppliers.mjs';
import { readLists } from '../tools/materials/build.mjs';

test('όλοι απενεργοποιημένοι, με μέτρηση (ημερομηνία, robots.txt, ροή, όροι) και ειδικότητες που υπάρχουν', () => {
  const trades = new Set(readLists().trades.map(t => t.id));
  for(const s of SPECIALISTS){
    assert.equal(s.enabled, false, s.id);
    assert.match(s.measured.checked, /^\d{4}-\d\d-\d\d$/);
    for(const k of ['robots', 'feed', 'terms']) assert.ok(s.measured[k], `${s.id}: ${k}`);
    assert.ok(s.trades.length && s.trades.every(t => trades.has(t)), s.id);
    assert.ok(s.method === 'html' || typeof s.items === 'function', s.id);
  }
  for(const s of [...SPECIALISTS_REJECTED, ...SPECIALISTS_UNCHECKED]) assert.match(s.base_url, /^https:\/\//);
});

test('δεν μπαίνουν στην εβδομαδιαία εκτέλεση και δεν συγκρούονται με τους υπάρχοντες', () => {
  const ids = new Set([...SUPPLIERS, ...ALTERNATES].map(s => s.id));
  for(const s of SPECIALISTS) assert.ok(!ids.has(s.id), s.id);
  assert.ok(!fs.readFileSync(new URL('../tools/prices/run.mjs', import.meta.url), 'utf8').includes('SPECIALISTS'));
});

test('απόφαση 23/11: όσοι δεν έχουν σελίδα όρων μένουν εκτός, χωριστά, μέχρι τον έλεγχο με το χέρι', async () => {
  const { SPECIALISTS_PENDING_TERMS } = await import('../tools/prices/suppliers.mjs');
  assert.deepEqual(SPECIALISTS_PENDING_TERMS.map(s => s.id).sort(), ['balamoti', 'homeville', 'jerotech', 'portes-koufomata', 'pylarinos']);
  for(const s of SPECIALISTS_PENDING_TERMS) assert.equal(s.enabled, false);
  const active = new Set(SPECIALISTS.map(s => s.id));
  for(const s of SPECIALISTS_PENDING_TERMS) assert.ok(!active.has(s.id), s.id);
  // όσοι κλείνουν το bot ή τα AI bots: απορρίπτονται
  for(const id of ['zalonis', 'e-metallon', 'fotovoltaika', 'eshops', 'panpower', 'thermogroup', 'paintcity', 'dedegkikas']) assert.ok(SPECIALISTS_REJECTED.some(s => s.id === id), id);
});
