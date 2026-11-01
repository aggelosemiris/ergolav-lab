// HOLDOUT — ανεξάρτητο oracle από την αξιολόγηση QA (όχι από αυτόν που έγραψε τον κώδικα).
// Μην αλλάζεις τις προσδοκίες για να περάσει ο κώδικας. Αλλαγή πολιτικής (π.χ. «1.500» → 1500)
// = καταγεγραμμένη απόφαση + ενημέρωση αυτού του αρχείου ΠΡΙΝ τρέξει το test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../src/number.js';

const BLOCK = Symbol('BLOCK');
const ORACLE = {
  A: ['1.234,50', 1234.50],
  B: ['1.500', BLOCK],          // αμφίσημο: 1500 ή 1,5
  C: ['1,5', 1.50],
  D: ['1.5', BLOCK],
  E: ['12,345', BLOCK],         // > 2 δεκαδικά
  F: [' 7 ', 7],                // trim ASCII
  G: ['1 234', BLOCK],          // κενό ως διαχωριστικό
  H: ['-3', BLOCK],
  I: ['0,00', 0],               // για τιμή ισχύει ο κανόνας mat<=0 && lab<=0 στην οθόνη
  J: ['1.234.567,8', 1234567.80],
};

for(const [id, [input, expected]] of Object.entries(ORACLE)){
  test(`holdout ${id}: ${JSON.stringify(input)} → ${expected === BLOCK ? 'ΜΠΛΟΚ' : expected}`, () => {
    const r = parseAmount(input, {maxDecimals: 2, allowZero: true});
    if(expected === BLOCK){
      assert.equal(r.value, undefined, `έπρεπε ΜΠΛΟΚ, πήρε ${r.value}`);
      assert.equal(typeof r.error, 'string');
    } else {
      assert.equal(r.error, undefined, r.error);
      assert.equal(r.value, expected);
    }
  });
}

test('holdout B: το μήνυμα προτείνει «1500 ή 1,5»', () => {
  assert.match(parseAmount('1.500').error, /1500 ή 1,5\b/);
});

// K — προσθήκη της QA (2ος γύρος): «1.234.56» → ΜΠΛΟΚ, και ό,τι προτείνει το μήνυμα περνά το ίδιο από τον parser.
test('holdout K: "1.234.56" → ΜΠΛΟΚ, με πρόταση που περνά από τον parser', () => {
  const r = parseAmount('1.234.56', {maxDecimals: 2, allowZero: true});
  assert.equal(r.value, undefined, `έπρεπε ΜΠΛΟΚ, πήρε ${r.value}`);
  const suggested = [...r.error.matchAll(/γράψε (?:π\.χ\. )?([\d.,]+?)(?=[ .]*(?:ή|$))/g)].map(m => m[1]);
  assert.ok(suggested.length, `το μήνυμα δεν προτείνει αριθμό: ${r.error}`);
  for(const x of suggested) assert.equal(parseAmount(x).error, undefined, `η πρόταση «${x}» μπλοκάρεται: ${r.error}`);
});
