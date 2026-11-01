import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tiers, priceKey, history, remember, loadAll, ageLabel, isStale, STORE, STALE_DAYS } from '../src/prices.js';

const DAY = 86400000, NOW = Date.UTC(2026, 9, 1);
let data;
beforeEach(() => {
  data = {};
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, writable: true, value: {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
  }});
});

test('προτάσεις: κανονική = τιμή καταλόγου· οικονομική/ακριβή ×0,6 / ×1,9 στα 10 λεπτά, ελάχιστο 10', () => {
  assert.deepEqual(tiers(29000), {eco: 17400, normal: 29000, premium: 55100});
  assert.deepEqual(tiers(450), {eco: 270, normal: 450, premium: 860});     // 855 → 860
  assert.deepEqual(tiers(15), {eco: 10, normal: 15, premium: 30});         // ελάχιστο 10 λεπτά
  assert.equal(tiers(0), null, 'χωρίς υλικό (μόνο εργασία) δεν υπάρχουν προτάσεις');
  assert.equal(tiers(undefined), null);
});

test('οι προτάσεις βγαίνουν από την ίδια βάση — δεν «μετακινούνται» όταν αλλάζει η επιλογή', () => {
  const base = 18500;
  const a = tiers(base);
  assert.deepEqual(tiers(base), a);
  assert.notDeepEqual(tiers(a.eco), a, 'αν γινόταν βάση η οικονομική, θα έφευγαν οι προτάσεις (γι’ αυτό υπάρχει matBase)');
});

test('κλειδί: είδος + κωδικός τύπου — κρεμαστή λεκάνη ≠ λεκάνη δαπέδου', () => {
  assert.notEqual(priceKey({id: 'wc', code: 'ΚΩΔ. 22051', name: 'Λεκάνη κρεμαστή'}), priceKey({id: 'wc', code: 'ΚΩΔ. 22010', name: 'Λεκάνη δαπέδου'}));
  assert.equal(priceKey({id: 'x', code: '', name: 'Ονομα'}), 'x|Ονομα', 'χωρίς κωδικό: το όνομα');
});

test('ιστορικό: νεότερο πρώτο, με ημερομηνία', () => {
  assert.ok(remember('wc|A', 19500, NOW - 10 * DAY));
  assert.ok(remember('wc|A', 17800, NOW));
  assert.deepEqual(history('wc|A'), [{c: 17800, at: NOW}, {c: 19500, at: NOW - 10 * DAY}]);
  assert.deepEqual(history('wc|άλλο'), []);
});

test('ίδια τιμή: ανανεώνει μόνο την ημερομηνία, δεν διπλογράφεται', () => {
  remember('k', 19500, NOW - 30 * DAY);
  remember('k', 17800, NOW - 20 * DAY);
  remember('k', 19500, NOW);
  assert.deepEqual(history('k'), [{c: 19500, at: NOW}, {c: 17800, at: NOW - 20 * DAY}]);
});

test('έως τρεις τιμές ανά προϊόν — η παλαιότερη πέφτει', () => {
  [100, 200, 300, 400].forEach((c, i) => remember('k', c, NOW - (10 - i) * DAY));
  assert.deepEqual(history('k').map(e => e.c), [400, 300, 200]);
});

test('παλιό σχήμα (σκέτο αντικείμενο ανά κλειδί) διαβάζεται ως λίστα ενός στοιχείου', () => {
  data[STORE] = JSON.stringify({'wc|A': {c: 19500, at: NOW - DAY}, 'pipe|B': [{c: 300, at: NOW}]});
  assert.deepEqual(history('wc|A'), [{c: 19500, at: NOW - DAY}]);
  assert.deepEqual(history('pipe|B'), [{c: 300, at: NOW}]);
});

test('άκυρες εγγραφές αγνοούνται μία-μία, οι έγκυρες μένουν', () => {
  data[STORE] = JSON.stringify({k: [{c: 500, at: NOW}, {c: '500', at: NOW}, {c: -5, at: NOW}, {c: 12.5, at: NOW}, {c: 700}, {c: 800, at: 'χθες'}, null, 7, {c: 600, at: NOW - DAY}]});
  assert.deepEqual(history('k'), [{c: 500, at: NOW}, {c: 600, at: NOW - DAY}]);
});

test('χαλασμένα δεδομένα: ό,τι δεν διαβάζεται αγνοείται εντελώς, χωρίς εξαίρεση', () => {
  for(const bad of ['{όχι json', 'null', '[]', '42', '"κείμενο"', '{"k": "x"}', '{"k": []}']){
    data[STORE] = bad;
    assert.deepEqual(history('k'), [], `«${bad}»`);
    assert.ok(remember('k', 100, NOW), 'και μετά η αποθήκευση δουλεύει');
    assert.deepEqual(history('k'), [{c: 100, at: NOW}]);
  }
});

test('«__proto__» ως κλειδί δεν πειράζει το αντικείμενο', () => {
  data[STORE] = '{"__proto__": [{"c": 100, "at": 1}], "k": [{"c": 5, "at": 2}]}';
  const all = loadAll();
  assert.deepEqual(all.k, [{c: 5, at: 2}]);
  assert.equal(({}).c, undefined);
});

test('δεν γράφονται άκυρες τιμές', () => {
  for(const c of [0, -1, 1.5, NaN, '300', null, undefined, 1e12]) assert.equal(remember('k', c, NOW), false, String(c));
  assert.deepEqual(history('k'), []);
});

test('χωρίς storage ή με storage που πετάει εξαιρέσεις (ιδιωτική περιήγηση) δεν σπάει τίποτα', () => {
  delete globalThis.localStorage;
  assert.deepEqual(history('k'), []);
  assert.equal(remember('k', 100, NOW), false);
  globalThis.localStorage = {getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('quota'); }};
  assert.deepEqual(history('k'), []);
  assert.equal(remember('k', 100, NOW), false);
  Object.defineProperty(globalThis, 'localStorage', {get(){ throw new Error('denied'); }, configurable: true});
  assert.deepEqual(history('k'), []);
  assert.equal(remember('k', 100, NOW), false);
});

test('παλαιότητα: πάνω από 180 ημέρες → «έλεγξε αν άλλαξε»', () => {
  assert.equal(STALE_DAYS, 180);
  assert.equal(isStale(NOW - 180 * DAY, NOW), false);
  assert.equal(isStale(NOW - 181 * DAY, NOW), true);
  assert.equal(isStale(NOW + DAY, NOW), false, 'ρολόι μπροστά → όχι παλιά');
});

test('σχετική ημερομηνία σε απλά ελληνικά', () => {
  const L = d => ageLabel(NOW - d * DAY, NOW);
  assert.equal(L(0), 'σήμερα');
  assert.equal(L(1), 'χθες');
  assert.equal(L(3), 'πριν από 3 ημέρες');
  assert.equal(L(14), 'πριν από 2 εβδομάδες');
  assert.equal(L(45), 'πριν από 6 εβδομάδες');
  assert.equal(L(90), 'πριν από 3 μήνες');
  assert.equal(L(400), 'πριν από 1 χρόνο');
  assert.equal(L(800), 'πριν από 2 χρόνια');
  assert.equal(ageLabel(NOW + 5 * DAY, NOW), 'σήμερα');
});
