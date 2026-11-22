// src/offline.js: πότε γίνεται η εγγραφή, πρόχειρο πριν από την ανανέωση, κανένα reload χωρίς πάτημα.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canRegister, cleanDraft, saveDraft, takeDraft, registerSW, DRAFT, REGISTER_DELAY_MS } from '../src/offline.js';

const store = () => { const m = new Map(); return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m}; };

test('εγγραφή μόνο σε https ή localhost, και μόνο αν υπάρχει serviceWorker', () => {
  const w = (protocol, hostname, sw = {}) => ({location: {protocol, hostname}, navigator: {serviceWorker: sw}});
  assert.equal(canRegister(w('https:', 'aggelosemiris.github.io')), true);
  assert.equal(canRegister(w('http:', 'localhost')), true);
  assert.equal(canRegister(w('http:', '127.0.0.1')), true);
  assert.equal(canRegister(w('http:', '192.168.1.5')), false);
  assert.equal(canRegister(w('https:', 'x.y', null)), false);
});

test('πρόχειρο: καθαρίζεται (μη αξιόπιστο), διαβάζεται μία φορά', () => {
  assert.equal(cleanDraft(null), null);
  assert.equal(cleanDraft({text: '   '}), null);
  assert.deepEqual(cleanDraft({text: 'x'.repeat(30000), client: 5, screen: 's-pdf'}), {text: 'x'.repeat(20000), client: '', screen: 's-listen'});
  const win = {sessionStorage: store()};
  assert.equal(saveDraft({text: 'δύο λεκάνες', client: 'Νίκος, Πάτρα', screen: 's-lines'}, win), true);
  assert.deepEqual(takeDraft(win), {text: 'δύο λεκάνες', client: 'Νίκος, Πάτρα', screen: 's-lines'});
  assert.equal(takeDraft(win), null, 'μία φορά');
  win.sessionStorage.setItem(DRAFT, '{χαλασμένο');
  assert.equal(takeDraft(win), null);
  assert.equal(saveDraft(null, win), false, 'τίποτα να σωθεί');
  assert.equal(takeDraft({get sessionStorage(){ throw new Error('blocked'); }}), null, 'μπλοκαρισμένη αποθήκευση: τίποτα, χωρίς σφάλμα');
});

function fakeWin(){
  const listeners = {}, regListeners = {}, docListeners = {};
  let reloads = 0;
  const posted = [], later = [];
  const waiting = {state: 'installed', postMessage: m => posted.push(m)};
  const reg = {waiting, addEventListener: (e, f) => { regListeners[e] = f; }, update: async () => {}};
  const sw = {controller: {}, addEventListener: (e, f) => { listeners[e] = f; }, register: async (url, opts) => { reg.args = [url, opts]; return reg; }};
  const btn = {onclick: null}, bar = {hidden: true, querySelector: () => btn};
  const win = {location: {protocol: 'https:', hostname: 'a.b', reload: () => { reloads++; }}, navigator: {serviceWorker: sw},
    document: {readyState: 'complete', visibilityState: 'visible', addEventListener: (e, f) => { docListeners[e] = f; }},
    sessionStorage: store(), setTimeout: (f, ms) => { ms === REGISTER_DELAY_MS ? f() : later.push(f); return 0; }};
  return {win, sw, reg, bar, btn, listeners, posted, reloads: () => reloads};
}

test('νέα έκδοση: μπάρα· reload ΜΟΝΟ με πάτημα, αφού σωθεί το πρόχειρο', async () => {
  const f = fakeWin();
  await registerSW({win: f.win, bar: f.bar, draft: () => ({text: 'μπαταρία νιπτήρα', client: '', screen: 's-listen'})});
  assert.deepEqual(f.reg.args, ['./sw.js', {scope: './', updateViaCache: 'none'}]);
  assert.equal(f.bar.hidden, false, 'φαίνεται η μπάρα');
  assert.equal(f.reloads(), 0, 'κανένα αυτόματο reload');
  f.btn.onclick();
  assert.deepEqual(f.posted, ['skipWaiting']);
  assert.ok(f.win.sessionStorage.getItem(DRAFT), 'το πρόχειρο σώθηκε πριν από το reload');
  assert.equal(f.reloads(), 0, 'περιμένει το controllerchange');
  f.listeners.controllerchange();
  assert.equal(f.reloads(), 1);
});

test('controllerchange χωρίς πάτημα (πρώτη εγκατάσταση ή άλλη καρτέλα): κανένα reload', async () => {
  const f = fakeWin();
  f.reg.waiting = null;
  f.sw.controller = null;           // πρώτη φορά: η σελίδα δεν είχε service worker
  await registerSW({win: f.win, bar: f.bar});
  f.listeners.controllerchange();
  assert.equal(f.reloads(), 0);
  assert.equal(f.bar.hidden, true, 'πρώτη εγκατάσταση: καμία μπάρα');
  f.listeners.controllerchange();   // αργότερα, νέα έκδοση από άλλη καρτέλα
  assert.equal(f.reloads(), 0);
  assert.equal(f.bar.hidden, false, 'μόνο η μπάρα');
});

test('χωρίς https: καμία εγγραφή', async () => {
  const f = fakeWin();
  f.win.location.protocol = 'http:';
  assert.equal(await registerSW({win: f.win}), null);
  assert.equal(f.reg.args, undefined);
});

test('πρώτη εγκατάσταση → onReady (μία φορά)· νέα έκδοση από άλλη καρτέλα → όχι', async () => {
  const f = fakeWin();
  f.reg.waiting = null; f.sw.controller = null;
  let ready = 0;
  await registerSW({win: f.win, bar: f.bar, onReady: () => ready++});
  f.listeners.controllerchange();
  f.listeners.controllerchange();
  assert.equal(ready, 1);
});

test('canLeave() = false (προσφορά που δεν χώρεσε και δεν στάλθηκε): η «Ανανέωση» δεν κάνει τίποτα', async () => {
  const f = fakeWin();
  let leave = false;
  await registerSW({win: f.win, bar: f.bar, canLeave: () => leave});
  f.btn.onclick();
  assert.deepEqual(f.posted, [], 'καμία νέα έκδοση');
  assert.equal(f.reloads(), 0);
  leave = true;
  f.btn.onclick();
  assert.deepEqual(f.posted, ['skipWaiting']);
});
