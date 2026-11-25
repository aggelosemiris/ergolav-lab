// Run 45624096806 (25/11): το upsert στο supplier_offers απέτυχε με Postgres 21000 («ON CONFLICT DO UPDATE command cannot
// affect row a second time»). Αιτία: τα ids του palousis είναι ελληνικά URL-encoded URL και το κόψιμο στους 120 χαρακτήρες
// έκανε δύο διαφορετικά προϊόντα ίδιο κλειδί. Εδώ: σταθερό αναγνωριστικό (offerProductId) και δίχτυ ασφαλείας (dedupeOffers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runOnce, offersFor, indexItems, buildInventory, offerProductId, dedupeOffers, OFFER_ID_MAX } from '../tools/prices/engine.mjs';
import { createMemoryStore } from '../tools/prices/stores/memory.mjs';
import { parseJournal } from '../tools/prices/adapters/shops.mjs';
import { catalogProducts } from '../src/price-rules.js';

const heaterRef = 'heater|ΚΩΔ. 30080';
const heaterCatalog = () => catalogProducts().filter(p => p.ref === heaterRef);
const sup = (id, items) => ({id, name: id, base_url: `https://${id}.example`, method: 'test', vat: 'retail-law', items: async function*(){ yield* items; }});
const card = (href, name, price) => `<div class="product-thumb"><div class="caption"><div class="name"><a href="${href}">${name}</a></div>` +
  `<div class="price"><div><span class="price-normal">${price}</span></div></div></div></div>`;
// Δύο διαφορετικά προϊόντα του palousis χωρίς product_id: ίδιο μακρύ πρόθεμα, αλλάζει μόνο το τέλος.
const PREFIX = '/θερμοσίφωνες-boiler/θερμοσίφωνας-ηλεκτρικός-επιτοίχιος-κάθετος-80-λίτρα';
const palousis = () => parseJournal(card(`${PREFIX}-δεξιός`, 'Θερμοσίφωνας 80 λίτρα δεξιός', '310,00€') +
  card(`${PREFIX}-αριστερός`, 'Θερμοσίφωνας 80 λίτρα αριστερός', '320,00€'), 'https://www.palousis.gr/');

/** Memory store που, όπως η Postgres, απορρίπτει πακέτο με δύο γραμμές στο ίδιο κλειδί, και κρατά ό,τι του στάλθηκε. */
function strictStore(){
  const store = createMemoryStore({now: () => new Date('2026-11-25T03:00:00Z')}), sent = [];
  const upsert = store.upsertOffers.bind(store);
  store.upsertOffers = async rows => {
    const keys = rows.map(r => `${r.price_product_id}|${r.supplier_id}|${r.supplier_product_id}`);
    if(new Set(keys).size !== keys.length) throw new Error('Supabase POST /supplier_offers: HTTP 500 code 21000');
    sent.push(rows);
    return upsert(rows);
  };
  return {store, sent};
}

test('ids: δύο διαφορετικά ελληνικά URL > 120 χαρακτήρων με κοινό πρόθεμα δίνουν διαφορετικό supplier_product_id', () => {
  const items = palousis();
  assert.equal(items.length, 2);
  assert.ok(items.every(i => i.id.length > OFFER_ID_MAX && i.id.startsWith('https://www.palousis.gr/%CE')), 'id = URL-encoded URL');
  assert.equal(items[0].id.slice(0, OFFER_ID_MAX), items[1].id.slice(0, OFFER_ID_MAX), 'με το παλιό κόψιμο θα συνέπιπταν');
  const [a, b] = items.map(i => offerProductId(i.id));
  assert.notEqual(a, b);
  assert.match(a, /^h:[0-9a-f]{40}$/);
  assert.equal(a, `h:${createHash('sha1').update(items[0].id).digest('hex')}`);
  assert.equal(offerProductId(items[0].id), a, 'σταθερό από run σε run');

  const [entry] = buildInventory({catalog: heaterCatalog()});
  const offers = offersFor(entry, {...sup('palousis', []), vatIncluded: true}, items, indexItems(items));
  assert.equal(offers.length, 2);
  assert.deepEqual(offers.map(o => o.supplier_product_id).sort(), [a, b].sort());
  assert.ok(offers.every(o => o.supplier_product_id.length <= OFFER_ID_MAX));
});

test('ids: ids ως 120 χαρακτήρες μένουν ίδια (δεν αλλάζουν τα υπάρχοντα κλειδιά των άλλων προμηθευτών)', () => {
  for(const id of ['26791', 'h80', 'https://www.oikeiaoikia.gr/product/p2/', 'x'.repeat(OFFER_ID_MAX)]) assert.equal(offerProductId(id), id);
  assert.equal(offerProductId(12345), '12345', 'αριθμός → κείμενο, όπως πριν');
  assert.match(offerProductId('x'.repeat(OFFER_ID_MAX + 1)), /^h:[0-9a-f]{40}$/);
});

test('runOnce: τα δύο προϊόντα του palousis γράφονται χωριστά, χωρίς σφάλμα 21000', async () => {
  const {store, sent} = strictStore();
  const {stats} = await runOnce({store, suppliers: [sup('palousis', palousis())], fetcher: {}, catalog: heaterCatalog(), now: () => new Date('2026-11-25T03:00:00Z')});
  assert.equal(sent.length, 1);
  assert.equal(store.db.supplier_offers.filter(o => o.supplier_id === 'palousis').length, 2);
  assert.equal(stats.offers.duplicatesDropped, 0);
});

test('runOnce: διπλή προσφορά στο ίδιο πακέτο → γράφεται μία γραμμή, κρατιέται η verified, duplicatesDropped = 1', async () => {
  const {store, sent} = strictStore();
  // Ο ίδιος κωδικός προϊόντος εμφανίζεται δύο φορές (π.χ. σε δύο κατηγορίες): πρώτα χωρίς τιμή, μετά με τιμή.
  const base = {id: 'dup-1', sku: null, gtin: null, name: 'Θερμοσίφωνας 80 λίτρα', brand: null, url: 'https://palousis.example/dup-1', unit: null, promo: false};
  const items = [{...base, regularCents: null, currentCents: null, verification: 'unverified', reason: 'no-price'},
    {...base, regularCents: 31000, currentCents: 31000, verification: 'verified', reason: null}];
  const logs = [];
  const {stats} = await runOnce({store, suppliers: [sup('palousis', items)], fetcher: {}, catalog: heaterCatalog(),
    now: () => new Date('2026-11-25T03:00:00Z'), log: m => logs.push(m)});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 1, 'στάλθηκε μία γραμμή');
  const rows = store.db.supplier_offers.filter(o => o.supplier_product_id === 'dup-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verification, 'verified');
  assert.equal(rows[0].regular_cents, 31000);
  assert.equal(stats.offers.duplicatesDropped, 1);
  assert.ok(logs.some(m => /πετάχτηκαν 1 διπλές/.test(m)), 'γράφεται στο log');
  const [p] = store.db.price_runs.slice(-1);
  assert.equal(p.stats.offers.duplicatesDropped, 1, 'μένει στα stats του run (prices-report.md)');
});

test('dedupeOffers: verified > unit-mismatch > unverified· μετά το τρέχον run· μετά η μικρότερη unit_cents', () => {
  const k = {price_product_id: 1, supplier_id: 's'};
  const row = (id, verification, seen_run, unit_cents, tag) => ({...k, supplier_product_id: id, verification, seen_run, unit_cents, tag});
  const {rows, dropped} = dedupeOffers([
    row('a', 'unverified', 7, null, 'a1'), row('a', 'unit-mismatch', 7, null, 'a2'), row('a', 'verified', 6, 900, 'a3'), row('a', 'verified', 7, 1000, 'a4'),
    row('b', 'unverified', 6, null, 'b1'), row('b', 'unverified', 7, null, 'b2'),
    row('c', 'verified', 7, 1200, 'c1'), row('c', 'verified', 7, 1100, 'c2'), row('c', 'verified', 7, 1100, 'c3'),
    row('d', 'unverified', 7, null, 'd1'), row('a', 'unit-mismatch', 7, null, 'a5'),
    {...row('a', 'verified', 7, 500, 'other-product'), price_product_id: 2}], 7);
  assert.equal(dropped, 7, '12 γραμμές, 5 κλειδιά');
  assert.deepEqual(rows.map(r => r.tag), ['a4', 'b2', 'c2', 'd1', 'other-product'], 'μία ανά κλειδί, στη σειρά της πρώτης εμφάνισης');
});
