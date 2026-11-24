// «Τιμές από τεχνικούς» στην εφαρμογή (src/tech-prices.js): κλειστό εξ ορισμού, συγκατάθεση πριν από οτιδήποτε, στέλνονται ΜΟΝΟ
// παραλλαγή + μονάδα + τιμή, ανάκληση = σβήσιμο, αποτελέσματα μόνο με ≥ 5 τεχνικούς (από τον server) και μόνο συνδεδεμένοι.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TECH_PRICES_ENABLED } from '../src/config.js';
import * as tp from '../src/tech-prices.js';
import { keys, appKeys } from '../tools/tech-prices/keys-sql.mjs';
import { EXCLUDE } from '../tools/sw-manifest.mjs';

let data;
beforeEach(() => {
  data = {};
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, writable: true, value: {
    getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }}});
});
const KEYS = JSON.parse(fs.readFileSync(new URL('../src/material-keys.json', import.meta.url), 'utf8'));
const MATERIALS = JSON.parse(fs.readFileSync(new URL('../data/materials.json', import.meta.url), 'utf8'));

test('κλειστό εξ ορισμού· τίποτα δεν φορτώνεται στατικά· τα αρχεία έξω από το precache και ενημερωμένα', () => {
  assert.equal(TECH_PRICES_ENABLED, false);
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /^import[^\n]*tech-prices/m);
  assert.match(app, /if\(CONFIG\.TECH_PRICES_ENABLED\)\{\n\s*Promise\.all\(\[import\('\.\/tech-prices\.js'\), fetch\('src\/material-keys\.json'\)/);
  assert.ok(EXCLUDE.has('src/material-keys.json'));
  assert.deepEqual(KEYS, appKeys(MATERIALS), 'τρέξε node tools/tech-prices/keys-sql.mjs');
  const seed = fs.readFileSync(new URL('../supabase/seed/tech-price-keys.sql', import.meta.url), 'utf8');
  const ks = keys(MATERIALS);
  assert.equal(new Set(ks.map(k => k.key)).size, ks.length, 'μοναδικά κλειδιά');
  for(const k of ks.slice(0, 50)) assert.ok(seed.includes(`('${k.key.replace(/'/g, "''")}', '${k.unit}')`), k.key);
  assert.match(seed, new RegExp(`αναμένονται ${ks.length}`));
});

test('αντιστοίχιση γραμμής → παραλλαγή: μόνο με βεβαιότητα και ίδια μονάδα', () => {
  const k = tp.matchVariant(KEYS, 'Θερμοσίφωνας ηλεκτρικός 80 λ.', 'τεμ.');
  assert.match(k, /^water-heater-electric\|80/);
  assert.equal(tp.matchVariant(KEYS, 'Θερμοσίφωνας ηλεκτρικός 80 λ.', 'μ.'), null, 'άλλη μονάδα');
  assert.equal(tp.matchVariant(KEYS, 'Θερμοσίφωνας ηλεκτρικός', 'τεμ.'), null, 'χωρίς μέγεθος → καμία');
  assert.equal(tp.matchVariant(KEYS, 'κλιματιστικό καλό', 'τεμ.'), null);
});

function fakeClient({consent = null, stats = [], submit = 'ok'} = {}){
  const calls = [];
  return {calls, client: {
    rpc: async (fn, args) => { calls.push([fn, args]); return {data: fn === 'submit_tech_price' ? submit : 0, error: null}; },
    from: table => ({select: () => {
      const q = {maybeSingle: async () => ({data: consent, error: null}), limit: async () => ({data: stats, error: null})};
      calls.push(['select', table]); return q;
    }}),
  }};
}

test('συγκατάθεση πριν από οτιδήποτε· ερώτηση τη 2η φορά, «Όχι τώρα» για 90 ημέρες', () => {
  assert.equal(tp.enqueue('water-heater-electric|80', 'τεμ.', 13000), false, 'χωρίς συγκατάθεση δεν μπαίνει ούτε σε ουρά');
  assert.equal(tp.shouldAsk(tp.load()), false);
  tp.noteKeep(); assert.equal(tp.shouldAsk(tp.load()), false);
  tp.noteKeep(); assert.equal(tp.shouldAsk(tp.load()), true);
  const now = Date.now();
  tp.decline(now);
  assert.equal(tp.shouldAsk(tp.load(), now + 89 * 86400e3), false);
  assert.equal(tp.shouldAsk(tp.load(), now + 91 * 86400e3), true);
});

test('στέλνονται ΜΟΝΟ παραλλαγή, μονάδα, τιμή· ανάκληση = σβήσιμο στον server + άδεια ουρά', async () => {
  const {calls, client} = fakeClient();
  await tp.setConsent({client}, true, 'GR-I');
  assert.deepEqual(calls[0], ['set_tech_prices_consent', {p_consent: true, p_version: tp.CONSENT_VERSION, p_region: 'GR-I'}]);
  assert.equal(tp.enqueue('water-heater-electric|80', 'τεμ.', 13000), true);
  assert.equal(tp.enqueue('water-heater-electric|80', 'τεμ.', 13500), true, 'η νεότερη αντικαθιστά');
  assert.equal(tp.enqueue('x|', 'τεμ.', 0), false, 'τιμή 0 δεν στέλνεται');
  assert.equal(await tp.flush({client}), 1);
  const sent = calls.filter(c => c[0] === 'submit_tech_price');
  assert.deepEqual(sent, [['submit_tech_price', {p_key: 'water-heater-electric|80', p_unit: 'τεμ.', p_price_cents: 13500}]]);
  assert.deepEqual(Object.keys(sent[0][1]).sort(), ['p_key', 'p_price_cents', 'p_unit'], 'κανένα άλλο πεδίο (πελάτης, όνομα, προσφορά, user id)');
  assert.doesNotMatch(data[tp.STORE], /client|πελάτ|quote|user_id|email/i);
  tp.enqueue('water-heater-electric|80', 'τεμ.', 14000);
  await tp.setConsent({client}, false);
  assert.deepEqual(calls.at(-1), ['set_tech_prices_consent', {p_consent: false, p_version: tp.CONSENT_VERSION, p_region: null}]);
  assert.deepEqual(tp.load().queue, []);
  assert.equal(tp.enqueue('water-heater-electric|80', 'τεμ.', 14000), false);
});

test('ο server λέει «no-consent» (π.χ. ανακλήθηκε σε άλλη συσκευή): η ουρά αδειάζει', async () => {
  const {client} = fakeClient({submit: 'no-consent'});
  await tp.setConsent({client}, true);
  tp.enqueue('water-heater-electric|80', 'τεμ.', 13000);
  await tp.flush({client});
  assert.deepEqual([tp.load().consent, tp.load().queue], [null, []]);
});

test('αποτελέσματα: της περιφέρειας αν υπάρχει (≥ 5 εκεί), αλλιώς πανελλαδικά· φεύγουν στην αποσύνδεση', async () => {
  const stats = [{variant_key: 'k|', region: 'GR', median_cents: 1000, band: '10-19', period_to: '2026-11-01'},
    {variant_key: 'k|', region: 'GR-I', median_cents: 1100, band: '5-9', period_to: '2026-11-01'},
    {variant_key: 'm|', region: 'GR', median_cents: 500, band: '20+', period_to: '2026-11-01'}];
  const {client} = fakeClient({consent: {version: 1, region: 'GR-I'}, stats});
  await tp.pullConsent({client});
  assert.equal(await tp.pullStats({client}), 3);
  assert.deepEqual(tp.statFor('k|'), {cents: 1100, band: '5-9', at: Date.parse('2026-11-01'), region: 'GR-I'});
  assert.deepEqual(tp.statFor('m|'), {cents: 500, band: '20+', at: Date.parse('2026-11-01'), region: null});
  assert.equal(tp.statFor('zzz|'), null);
  tp.forgetStats();
  assert.equal(tp.statFor('k|'), null);
});
