import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ψεύτικο localStorage ανά test (όπως στο profile.test.js)· broken: κάθε κλήση πετάει.
function env(initial = {}, {broken = false} = {}){
  const data = {...initial};
  const fail = () => { throw new Error('QuotaExceededError'); };
  globalThis.localStorage = broken ? {getItem: fail, setItem: fail, removeItem: fail}
    : {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }};
  return data;
}
const h = await import('../src/history.js');
const quote = (no, extra = {}) => ({no, at: Date.UTC(2026, 10, no), title: 'ανακαίνιση μπάνιου', client: `Πελάτης ${no}`, vatRate: 24,
  sum: {mat: 10000, lab: 5000, net: 15000, vat: 3600, total: 18600},
  rows: [{name: 'Λεκάνη κρεμαστή', qty: 1, unit: 'τεμ.', mat: 10000}, {name: 'Αποξήλωση', qty: 1, unit: 'κατ.', mat: 0}],
  profile: {name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'}, ...extra});

test('άδειο ιστορικό', () => {
  env();
  assert.deepEqual(h.listQuotes(), []);
  assert.equal(h.getQuote(1), null);
});

test('αποθήκευση, η νεότερη πρώτη, ανάκτηση ακριβώς όπως ήταν', () => {
  env();
  for(const n of [1, 3, 2]) assert.equal(h.saveQuote(quote(n)), true);
  assert.deepEqual(h.listQuotes().map(q => q.no), [3, 2, 1]);
  assert.deepEqual(h.getQuote(2), quote(2));
});

test('ίδιος αριθμός ξανά (ξαναφτιάχτηκε το PDF) → ενημέρωση, όχι διπλή εγγραφή', () => {
  env();
  h.saveQuote(quote(5));
  h.saveQuote(quote(5, {client: 'Άλλος πελάτης'}));
  assert.equal(h.listQuotes().length, 1);
  assert.equal(h.getQuote(5).client, 'Άλλος πελάτης');
});

test('σβήσιμο μίας προσφοράς', () => {
  env();
  [1, 2, 3].forEach(n => h.saveQuote(quote(n)));
  h.deleteQuote(2);
  assert.deepEqual(h.listQuotes().map(q => q.no), [3, 1]);
});

test('όριο: κρατιούνται οι νεότερες', () => {
  env();
  for(let n = 1; n <= h.MAX_QUOTES + 5; n++) h.saveQuote(quote(n));
  const list = h.listQuotes();
  assert.equal(list.length, h.MAX_QUOTES);
  assert.equal(list.at(-1).no, 6);
});

test('μισή ή χαλασμένη προσφορά δεν μπαίνει ποτέ (ούτε από το localStorage)', () => {
  env();
  for(const bad of [null, {}, quote(0), quote(1, {sum: {mat: 1}}), quote(1, {rows: [{name: 'x', qty: NaN, unit: '', mat: 0}]}),
    quote(1, {rows: [{name: 'x', qty: 1, unit: '', mat: -5}]}), quote(1, {at: 'χθες'}), quote(1, {vatRate: 'x'})]){
    assert.equal(h.saveQuote(bad), false, JSON.stringify(bad)?.slice(0, 60));
  }
  assert.deepEqual(h.listQuotes(), []);
  env({[h.STORE]: JSON.stringify([quote(1), {no: 2}, 'σκουπίδια', quote(3)])});
  assert.deepEqual(h.listQuotes().map(q => q.no), [3, 1], 'οι άκυρες αγνοούνται μία-μία');
  for(const raw of ['{χαλασμένο', '{"a":1}', 'null', '42']){ env({[h.STORE]: raw}); assert.deepEqual(h.listQuotes(), [], raw); }
});

test('μπλοκαρισμένο / γεμάτο localStorage: τίποτα δεν σπάει, η αποθήκευση λέει false', () => {
  env({}, {broken: true});
  assert.equal(h.saveQuote(quote(1)), false);
  assert.deepEqual(h.listQuotes(), []);
  assert.equal(h.deleteQuote(1), false);
  delete globalThis.localStorage;
  assert.deepEqual(h.listQuotes(), []);
});
