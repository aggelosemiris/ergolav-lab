// Λίστες υλικών ανά ειδικότητα (data/materials/*.txt): έγκυρες, πλήρεις και συγχρονισμένες με το data/materials.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readLists, stats, UNITS } from '../tools/materials/build.mjs';

const TRADES = ['ydravlika', 'thermansi', 'ilektrologika', 'klimatismos', 'plakakia', 'vafes', 'gypsosanida', 'monoseis', 'dapeda',
  'sovades', 'xylourgika', 'marmara', 'koufomata', 'sidirourgika', 'oikodomika', 'kipos-ardeusi', 'iliaka-fv'];

test('οι 17 ειδικότητες, χωρίς λάθη μορφής (μονάδα, id, τύπος taxonomy, συνώνυμα)', () => {
  const data = readLists();
  assert.deepEqual(data.errors, []);
  assert.deepEqual(data.trades.map(t => t.id), TRADES);
  for(const t of data.trades){
    const items = t.groups.flatMap(g => g.items);
    assert.ok(items.length >= 10, `${t.id}: ${items.length} είδη`);
    for(const i of items) assert.ok(UNITS.includes(i.unit) && i.synonyms.length, i.id);
  }
});

test('κάθε τύπος του taxonomy (εκτός από τον γενικό «mixer-other») έχει τουλάχιστον ένα είδος', () => {
  const s = stats(readLists());
  assert.deepEqual(s.unusedTax.filter(x => !x.startsWith('mixer-other')), []);
});

test('το data/materials.json είναι ενημερωμένο (node tools/materials/build.mjs)', () => {
  const json = JSON.parse(fs.readFileSync(new URL('../data/materials.json', import.meta.url), 'utf8'));
  const live = readLists().trades.map(({file, ...t}) => t);
  assert.deepEqual(json.trades, live);
});
