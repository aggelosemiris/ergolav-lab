// Run 45799146099 (26/11): ίδιο προϊόν/τιμή/id με το log, URL 637 χαρακτήρων έναντι ορίου 600.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { offerUrl, OFFER_URL_MAX } from '../tools/prices/offer-url.mjs';
import { createSupabaseStore } from '../tools/prices/stores/supabase.mjs';
import { createMemoryStore } from '../tools/prices/stores/memory.mjs';
import { parseJournal } from '../tools/prices/adapters/shops.mjs';
import { runOnce } from '../tools/prices/engine.mjs';
import { catalogProducts } from '../src/price-rules.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/palousis-sink.json', import.meta.url), 'utf8'));
const encoded = new URL(fixture.url).href;
const at = '2026-11-26T10:37:00Z';
const item = () => parseJournal(`<div class="product-thumb"><div class="name"><a href="${encoded}">${fixture.name}</a></div>` +
  '<span class="price-normal">180,00€</span></div>', 'https://www.palousis.gr')[0];

test('URL: το πραγματικό προϊόν του αποτυχημένου run χωρά ολόκληρο, με ακριβώς τον ίδιο προορισμό', () => {
  assert.equal(encoded.length, 637);
  assert.equal(fixture.url.length, 177);
  const result = offerUrl(encoded);
  assert.equal(result, fixture.url);
  assert.ok([...result].length <= OFFER_URL_MAX);
  assert.equal(new URL(result).href, encoded, 'ίδιο ακριβώς URL όταν ανοίξει ο browser');
  assert.equal(item().regularCents, fixture.regular_cents);
});

test('URL: τα σύντομα μένουν ίδια και το όριο είναι 600 χαρακτήρες PostgreSQL', () => {
  for(const url of ['https://supplier.example/p?size=100%2F50', fixture.url, 'https://x/' + 'a'.repeat(590)])
    assert.equal(offerUrl(url), url);
  const unicode = 'https://x/' + '😀'.repeat(590);
  assert.equal([...unicode].length, 600);
  assert.equal(offerUrl(unicode), unicode);
  assert.throws(() => offerUrl('https://x/' + 'a'.repeat(591)), /601 χαρακτήρες.*600/);
  assert.throws(() => offerUrl('http://supplier.example/p'), /HTTPS/);
  assert.throws(() => offerUrl(null), /HTTPS/);
});

test('URL: διατηρούνται τα κωδικοποιημένα διαχωριστικά και απορρίπτεται η διπλή αποκωδικοποίηση', () => {
  const prefix = 'https://supplier.example/' + 'α'.repeat(100);
  const safe = new URL(prefix + '?size=100%2F50&note=a%26b#part').href;
  assert.ok(safe.length > OFFER_URL_MAX);
  assert.equal(new URL(offerUrl(safe)).href, safe);
  assert.match(offerUrl(safe), /100%2F50.*a%26b/);
  const doubleEncoded = new URL(prefix + '/x%252Fy').href;
  assert.throws(() => offerUrl(doubleEncoded), /χωρίς ασφαλή ισοδύναμη μορφή/);
  const malformed = safe + '%ZZ';
  assert.throws(() => offerUrl(malformed), /χωρίς ασφαλή ισοδύναμη μορφή/);
});

test('Supabase: το REST παίρνει ολόκληρο URL που χωρά, ίδιο id/ποσά, χωρίς αλλαγή των εισερχόμενων δεδομένων', async () => {
  const calls = [];
  const store = createSupabaseStore({url: 'https://db.example', serviceKey: 'fake-service-key', fetchImpl: async (url, init) => {
    const rows = JSON.parse(init.body);
    assert.ok(rows.every(r => [...r.url].length <= 600), 'κανόνας της βάσης');
    calls.push({url, rows});
    return {ok: true, status: 200, text: async () => JSON.stringify(rows)};
  }});
  const rows = [{price_product_id: 44, supplier_id: 'palousis', supplier_product_id: fixture.supplier_product_id,
    url: encoded, regular_cents: 18000, unit_cents: 14516}];
  const before = JSON.stringify(rows);
  const saved = await store.upsertOffers(rows);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /on_conflict=price_product_id,supplier_id,supplier_product_id/);
  assert.equal(saved[0].url, fixture.url);
  assert.equal(saved[0].supplier_product_id, fixture.supplier_product_id);
  assert.equal(saved[0].regular_cents, 18000);
  assert.equal(saved[0].unit_cents, 14516);
  assert.equal(JSON.stringify(rows), before);
  await assert.rejects(store.upsertOffers([...Array.from({length: 501}, () => rows[0]), {url: 'https://x/' + 'a'.repeat(591)}]), /601 χαρακτήρες/);
  assert.equal(calls.length, 1, 'έλεγχος όλων των URL πριν από το πρώτο πακέτο');
});

test('runOnce: το πραγματικό προϊόν περνά αποθήκευση, ιστορικό και τιμή αναφοράς, και ξανατρέχει χωρίς διπλά', async () => {
  const store = createMemoryStore({now: () => new Date(at)});
  const supplier = (id, it) => ({id, name: id, base_url: `https://${id}.example`, method: 'test', vat: 'retail-law',
    items: async function*(){ yield it; }});
  const run = () => runOnce({store, fetcher: {}, catalog: catalogProducts().filter(p => p.ref === 'sink|ΚΩΔ. 25100'),
    now: () => new Date(at), suppliers: [supplier('palousis', item()), supplier('second', {...item(), id: 'other', url: 'https://second.example/sink'})]});
  await run();
  const [offer] = store.db.supplier_offers;
  assert.equal(offer.supplier_product_id, fixture.supplier_product_id);
  assert.equal(offer.url, fixture.url);
  assert.equal(offer.unit_cents, 14516);
  assert.equal(store.db.price_runs[0].status, 'done');
  assert.equal(store.db.supplier_price_history.length, 2);
  assert.equal(store.db.price_products[0].reference_status, 'verified');
  assert.equal(store.db.price_products[0].reference_cents, 14516);
  await run();
  assert.equal(store.db.supplier_offers.length, 2);
  assert.equal(store.db.supplier_price_history.length, 2);
  assert.equal(store.db.price_reference_history.length, 1);
});
