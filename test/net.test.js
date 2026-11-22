// src/net.js: «χωρίς σήμα» από τον browser Ή από αίτημα που απέτυχε· μικρός έλεγχος για να ξαναβρεί σήμα.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { online, onNet, markOffline, markOnline, probe, watchNet, _reset, NO_NET } from '../src/net.js';

let nav;
beforeEach(() => { _reset(); nav = {onLine: true}; Object.defineProperty(globalThis, 'navigator', {value: nav, configurable: true}); });

test('online(): navigator.onLine ΚΑΙ κανένα αίτημα που απέτυχε', () => {
  assert.equal(online(), true);
  markOffline(); assert.equal(online(), false);
  markOnline(); assert.equal(online(), true);
  nav.onLine = false; assert.equal(online(), false);
  assert.equal(NO_NET, 'Χρειάζεται σύνδεση στο internet');
});

test('onNet: ειδοποίηση μόνο όταν αλλάζει', () => {
  const seen = []; onNet(v => seen.push(v));
  markOffline(); markOffline(); markOnline(); markOnline();
  assert.deepEqual(seen, [false, true]);
});

test('probe: απάντηση → σήμα· σφάλμα → χωρίς σήμα· HEAD χωρίς cache στο sw.js', async () => {
  const calls = [];
  const win = {navigator: nav, setTimeout, clearTimeout};
  markOffline();
  assert.equal(await probe({win, fetchImpl: async (u, o) => { calls.push([u, o.method, o.cache]); return {status: 200}; }}), true);
  assert.equal(online(), true);
  assert.deepEqual(calls, [['./sw.js', 'HEAD', 'no-store']]);
  assert.equal(await probe({win, fetchImpl: async () => { throw new TypeError('Failed to fetch'); }}), false);
  assert.equal(online(), false);
  nav.onLine = false;
  assert.equal(await probe({win, fetchImpl: async () => { throw new Error('δεν πρέπει να κληθεί'); }}), false, 'ο browser ξέρει ήδη: κανένα αίτημα');
});

test('watchNet: σφάλμα δικτύου σε fetch → χωρίς σήμα· απάντηση από άλλο origin → σήμα· τα δικά μας αρχεία δεν μετρούν', async () => {
  const listeners = {};
  let next = 'ok';
  const win = {location: {href: 'https://a.github.io/ergolav/', origin: 'https://a.github.io'}, navigator: nav,
    fetch: async () => { if(next === 'net') throw new TypeError('Failed to fetch'); if(next === 'abort'){ const e = new Error('x'); e.name = 'AbortError'; throw e; } return {ok: true}; },
    addEventListener: (e, f) => { listeners[e] = f; }, setInterval: () => 0, setTimeout: () => 0};
  watchNet({win});
  next = 'net';
  await assert.rejects(win.fetch('https://x.supabase.co/rest/v1/a'));
  assert.equal(online(), false);
  next = 'ok';
  await win.fetch('src/app.js');
  assert.equal(online(), false, 'αρχείο της εφαρμογής (μπορεί να ήρθε από την cache): δεν αποδεικνύει σήμα');
  await win.fetch('https://x.supabase.co/rest/v1/a');
  assert.equal(online(), true);
  next = 'abort';
  await assert.rejects(win.fetch('https://x.supabase.co/rest/v1/a'));
  assert.equal(online(), true, 'ακύρωση (π.χ. «Ακύρωση» του τεχνίτη) δεν σημαίνει «χωρίς σήμα»');
  assert.ok(listeners.online && listeners.offline);
  watchNet({win});                                  // δεύτερη φορά: τίποτα (όχι διπλό τύλιγμα)
});
