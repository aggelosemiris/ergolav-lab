import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { RULES, summary } from './quantity.cases.js';

for(const {rule, cases} of RULES){
  for(const [input, expected] of cases){
    test(`${rule}: «${input}»`, () => {
      assert.deepEqual(summary(parse(input)), expected);
    });
  }
}

test('κάθε κανόνας έχει τουλάχιστον 5 διαφορετικά υλικά, από τον κατάλογο και εκτός', () => {
  for(const {rule, cases} of RULES){
    const mats = new Set(cases.flatMap(([, exp]) => exp.map(([, , m]) => m.replace(/"/g, '').toLowerCase().slice(0, 6))));
    assert.ok(mats.size >= 5, `${rule}: ${mats.size} υλικά`);
  }
  const all = RULES.flatMap(r => r.cases.flatMap(([, exp]) => exp.map(([, , m]) => m)));
  assert.ok(all.some(m => m.startsWith('"')) && all.some(m => !m.startsWith('"')));
});

test('οι ποσότητες δεν αλλάζουν ποτέ σιωπηλά: ό,τι ειπώθηκε με άλλη μονάδα από του καταλόγου δεν παίρνει τιμή του καταλόγου', () => {
  for(const t of ['3 κιλά κόλλα', '2 τεμάχια πλακάκι', '12,75 μέτρα σοβατεπί', '1,5 κιλό στόκος']){
    const l = parse(t).lines.filter(l => !l.suggest);
    assert.equal(l.length, 1, t);
    assert.equal(l[0].unknown, true, t);
    assert.equal(l[0].keep, true, t);
    assert.equal(l[0].mat, 0, t);
  }
});

test('αριθμός χωρίς μονάδα σε υλικό του καταλόγου που μετριέται σε μ./τ.μ.: ο αριθμός μένει, η γραμμή ρωτάει', () => {
  for(const t of ['τρία καλώδια', '5 πλακάκια']){
    const [l] = parse(t).lines;
    assert.equal(l.qtyWhy, 'unit', t);
    assert.equal(l.qtyCheck, true, t);
  }
});

test('«καλώδιο 2,5 τετραγωνικά»: διατομή, όχι 2,5 μέτρα', () => {
  const [l] = parse('καλώδιο 2,5 τετραγωνικά 20 μέτρα').lines;
  assert.match(l.name, /3×2,5/);
  const [m] = parse('καλώδιο 2,5 τετραγωνικά').lines;
  assert.match(m.name, /3×2,5/);
  assert.equal(m.qtyMissing, true);
});
