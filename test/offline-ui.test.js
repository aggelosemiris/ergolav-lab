// src/offline-ui.js: iPhone στο Safari (όχι από την αρχική οθόνη), «Έτοιμο» και οδηγία μία φορά, κουμπί εγκατάστασης.
import test from 'node:test';
import assert from 'node:assert/strict';
import { iosBrowser, mountOfflineUi, READY, IOS_HINT } from '../src/offline-ui.js';
import { _reset } from '../src/net.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const win = (nav, standalone = false) => ({navigator: nav, matchMedia: () => ({matches: standalone})});

test('iosBrowser: iPhone/iPad στο Safari ναι· από την αρχική οθόνη ή Android όχι', () => {
  assert.equal(iosBrowser(win({userAgent: IPHONE, standalone: false})), true);
  assert.equal(iosBrowser(win({userAgent: IPHONE, standalone: true})), false);
  assert.equal(iosBrowser(win({userAgent: IPHONE}, true)), false);
  assert.equal(iosBrowser(win({userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5})), true, 'iPad με «desktop» UA');
  assert.equal(iosBrowser(win({userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130'})), false);
});

function fakeDom(){
  const els = {};
  const el = id => els[id] ||= {id, hidden: true, textContent: '', dataset: {}, onclick: null, listeners: {}, addEventListener(e, f){ this.listeners[e] = f; }};
  ['netBar', 'readyBar', 'storageBar', 'storageText', 'iosBar', 'installApp'].forEach(el);
  return {els, doc: {getElementById: id => els[id] || null, querySelectorAll: () => [], documentElement: {classList: {toggle(){}}}}};
}
function fakeWin(ua){
  const m = new Map(), listeners = {};
  return {navigator: {userAgent: ua, onLine: true}, matchMedia: () => ({matches: false}), setTimeout: () => 0, listeners,
    addEventListener: (e, f) => { listeners[e] = f; },
    localStorage: {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v))}};
}

test('«Έτοιμο» και οδηγία iPhone: μία φορά ανά συσκευή', () => {
  _reset();
  const {els, doc} = fakeDom(), w = fakeWin(IPHONE);
  const ui = mountOfflineUi({win: w, doc});
  assert.equal(ui.ready(), true); assert.equal(els.readyBar.hidden, false);
  assert.equal(ui.ready(), false);
  assert.ok(w.localStorage.getItem(READY));
  assert.equal(ui.iosHint(), true); assert.equal(els.iosBar.hidden, false);
  assert.equal(ui.iosHint(), false);
  assert.ok(w.localStorage.getItem(IOS_HINT));
  ui.full(); assert.equal(els.storageBar.hidden, false); assert.match(els.storageText.textContent, /γέμισε/);
});

test('Android: beforeinstallprompt → κουμπί· πάτημα → prompt()· appinstalled → κρυφό', async () => {
  _reset();
  const {els, doc} = fakeDom(), w = fakeWin('Mozilla/5.0 (Linux; Android 14) Chrome/130');
  const ui = mountOfflineUi({win: w, doc});
  assert.equal(ui.iosHint(), false, 'όχι iPhone: καμία οδηγία');
  let prevented = false, prompted = false;
  w.listeners.beforeinstallprompt({preventDefault: () => { prevented = true; }, prompt: async () => { prompted = true; }, userChoice: Promise.resolve({outcome: 'dismissed'})});
  assert.ok(prevented); assert.equal(els.installApp.hidden, false);
  await els.installApp.onclick();
  assert.ok(prompted); assert.equal(els.installApp.hidden, true);
  w.listeners.appinstalled();
  assert.equal(els.installApp.hidden, true);
});
