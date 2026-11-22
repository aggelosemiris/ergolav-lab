// src/storage-guard.js: γεμάτη μνήμη → μήνυμα (ποτέ σιωπηλά), μέτρηση χώρου, persist() μία φορά.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardStorage, isQuota, usage, askPersist, PERSIST_ASKED, FULL_MSG } from '../src/storage-guard.js';

class FakeStorage {
  constructor(limit = Infinity){ this.m = new Map(); this.limit = limit; }
  get length(){ return this.m.size; }
  key(i){ return [...this.m.keys()][i] ?? null; }
  getItem(k){ return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v){
    const used = [...this.m].reduce((n, [a, b]) => n + (a === k ? 0 : a.length + b.length), 0);
    if(used + k.length + String(v).length > this.limit){ const e = new Error('full'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
    this.m.set(k, String(v));
  }
  removeItem(k){ this.m.delete(k); }
}

test('isQuota: Chrome/Safari (22, QuotaExceededError) και Firefox (1014, NS_ERROR_DOM_QUOTA_REACHED)', () => {
  assert.ok(isQuota({name: 'QuotaExceededError'}));
  assert.ok(isQuota({code: 22}));
  assert.ok(isQuota({name: 'NS_ERROR_DOM_QUOTA_REACHED', code: 1014}));
  assert.ok(!isQuota(new TypeError('x')));
  assert.ok(!isQuota(null));
});

test('guardStorage: κάθε αποθήκευση που δεν χωράει → onFull, και το σφάλμα μένει (τα modules συνεχίζουν όπως πριν)', () => {
  class S extends FakeStorage {}
  const win = {Storage: S};
  const full = [];
  assert.equal(guardStorage({win, onFull: k => full.push(k)}), true);
  assert.equal(guardStorage({win, onFull: () => {}}), false, 'μία φορά');
  const s = new S(20);
  s.setItem('a', '1234');
  assert.throws(() => s.setItem('ergolav.quotes', 'x'.repeat(50)), e => isQuota(e));
  assert.deepEqual(full, ['ergolav.quotes']);
  assert.equal(s.getItem('a'), '1234', 'ό,τι υπήρχε μένει');
  assert.equal(s.getItem('ergolav.quotes'), null);
  assert.match(FULL_MSG, /γέμισε/);
});

test('usage: προσφορές, αντίγραφα, λογότυπα, συνεδρία, άλλα repos (χαρακτήρες)', () => {
  const s = new FakeStorage();
  s.setItem('ergolav.quotes', 'q'.repeat(100));
  s.setItem('ergolav.quotes.backup.2026-11-01', 'b'.repeat(50));
  s.setItem('ergolav.logos', 'l'.repeat(300));
  s.setItem('ergolav.profile.backup.1', 'p'.repeat(10));
  s.setItem('sb-abc-auth-token', 't'.repeat(20));
  s.setItem('ergolav.prices', 'x');
  s.setItem('allo-repo', 'o'.repeat(5));
  const u = usage(s);
  assert.equal(u.quotes, 'ergolav.quotes'.length + 100);
  assert.equal(u.logos, 'ergolav.logos'.length + 300);
  assert.equal(u.quoteBackups, 'ergolav.quotes.backup.2026-11-01'.length + 50);
  assert.equal(u.session, 'sb-abc-auth-token'.length + 20);
  assert.equal(u.other, 'allo-repo'.length + 5);
  assert.equal(u.total, Object.entries(u).filter(([k]) => k !== 'total').reduce((n, [, v]) => n + v, 0));
});

test('askPersist: μία φορά ανά συσκευή· χωρίς υποστήριξη τίποτα', async () => {
  let asked = 0;
  const win = {localStorage: new FakeStorage(), navigator: {storage: {persist: async () => { asked++; return true; }}}};
  assert.equal(await askPersist({win}), true);
  assert.equal(await askPersist({win}), null);
  assert.equal(asked, 1);
  assert.ok(win.localStorage.getItem(PERSIST_ASKED));
  assert.equal(await askPersist({win: {localStorage: new FakeStorage(), navigator: {}}}), null);
});
