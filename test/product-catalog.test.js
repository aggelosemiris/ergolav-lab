import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {buildProductCatalog, loadSupplyCatalog} from '../tools/catalog/product-catalog.mjs';
import {refreshCatalog} from '../tools/prices/catalog-refresh.mjs';
import {createMemoryStore} from '../tools/prices/stores/memory.mjs';
import {displayedCatalogPrice, indexProductCatalog, searchProductCatalog, groupCatalogMatches} from '../src/product-catalog-ui.js';

const old = '2026-11-07';
const make = (site, slug, name, extra = {}) => ({site, url: `https://${site}.example/${slug}`, name,
  price_eur: 9.95, price_date: old, ...extra});

test('ενώνει το ίδιο προϊόν, κρατά τις παραλλαγές και βρίσκει εναλλακτικές ονομασίες', () => {
  const big = 'Μπόιλερ ACME XT123 80 L';
  const alias = 'ACME XT123 80 L μπόιλερ';
  const rows = [
    make('shop-a', 'one', big, {brand: 'ACME'}),
    make('shop-a', 'one/?utm_campaign=x', alias, {brand: 'ACME'}),
    make('shop-b', 'one', alias, {brand: 'ACME'}),
    make('shop-b', 'two', 'Μπόιλερ ACME XT123 160 L', {brand: 'ACME'}),
    make('shop-a', 'third?pack=1', 'Ανώνυμη Βάνα'),
    make('shop-a', 'third?pack=2', 'Ανώνυμη Βάνα'),
  ];
  const {search, supply} = buildProductCatalog(rows);
  assert.equal(search.entries, 6);
  assert.equal(search.products.length, 4);
  assert.deepEqual(supply.products.map(([, offers]) => offers.length).sort(), [1, 1, 1, 2]);
  const index = indexProductCatalog(search);
  const match = searchProductCatalog(index, 'ΜΠΟΪΛΕΡ xt123 80');
  assert.equal(match.length, 1);
  assert.equal(match[0].row[5][0], 995);
  const variants = groupCatalogMatches(searchProductCatalog(index, 'ανώνυμη βάνα'));
  assert.equal(variants.length, 1);
  assert.equal(variants[0].length, 2);
});

test('ο κατάλογος του browser και της ανανέωσης έχουν τα ίδια προϊόντα και καλύπτουν όλη τη συλλογή', () => {
  const search = JSON.parse(gunzipSync(readFileSync(new URL('../src/product-catalog.json.gz', import.meta.url))));
  const supply = loadSupplyCatalog();
  assert.equal(search.entries, 109076);
  assert.deepEqual(search.products.map(([id]) => id), supply.products.map(([id]) => id));
  assert.equal(new Set(supply.products.map(([id]) => id)).size, supply.products.length);
  assert.ok(supply.products.reduce((total, [, offers]) => total + offers.length, 0) <= search.entries);
});

test('ανανέωση κατά URL, διατήρηση προηγούμενης τιμής, αλλαγές μόνο όταν αλλάξει ποσό', async () => {
  const a = make('shop-a', 'one', 'Αντλία ACME 80 L', {brand: 'ACME'});
  const b = make('shop-b', 'two', 'Αντλία ACME 160 L', {brand: 'ACME'});
  const {supply, search} = buildProductCatalog([a, b]);
  const store = createMemoryStore();
  const feed = (offer, cents) => ({s: {id: offer.site}, status: 'available', items: [
    {url: offer.url + '?utm_source=test', regularCents: cents, verification: 'verified'},
    {url: offer.url + '?variation_id=123', regularCents: 1, verification: 'verified'},
  ]});
  const run = (day, results) => refreshCatalog({catalog: supply, at: `2026-11-${String(day).padStart(2, '0')}T00:00:00.000Z`, results, store, fetcher: {}});
  const first = await run(10, [feed(a, 1250), feed(b, 1490)]);
  assert.deepEqual([first.total, first.checked, first.seen, first.verified, first.newOffers, first.changed], [2, 2, 2, 2, 2, 0]);
  const second = await run(17, [feed(a, 1100), {s: {id: b.site}, status: 'unavailable', reason: 'HTTP 403'}]);
  assert.deepEqual([second.total, second.checked, second.seen, second.verified, second.newOffers, second.changed], [2, 2, 1, 1, 0, 1]);
  const still = store.db.product_catalog_prices.find(p => p.supplier_id === b.site);
  assert.equal(still.cents, 1490);
  assert.equal(still.verified_at, '2026-11-10T00:00:00.000Z');
  assert.equal((await run(17, [feed(a, 1100)])).changed, 0);
  assert.equal((await run(9, [feed(a, 1500)])).changed, 0);
  assert.equal(displayedCatalogPrice(search.products.find(([id]) => still.product_id === id), [still]).cents, 1490);
});

test('τιμή άλλου προμηθευτή μόνο για σαφή πλήρη ταυτότητα μοντέλου', async () => {
  const same = 'Μπόιλερ ACME XT123 80 L';
  const variant = 'Μπόιλερ ACME XT123 160 L';
  const ambiguous = 'Βάνα ACME AB456 3/4';
  const {supply: catalog, search: searchCatalog} = buildProductCatalog([
    make('closed', 'one', same, {brand: 'ACME'}),
    make('closed', 'two', variant, {brand: 'ACME'}),
    make('closed', 'three', ambiguous, {brand: 'ACME'}),
  ]);
  const store = createMemoryStore();
  const item = (slug, name) => ({name, url: `https://new.example/${slug}`, verification: 'verified', regularCents: 1599});
  const results = [{s: {id: 'new'}, status: 'available', items: [
    item('one', same),
    item('two', 'Μπόιλερ ACME XT123 160 L συσκευασία 2 τεμ.'),
    item('three', ambiguous),
    item('four', ambiguous),
  ]}];
  const run = await refreshCatalog({catalog, searchCatalog, results, store, fetcher: {}, at: '2026-11-27T00:00:00Z'});
  assert.equal(run.fromAlternateSource, 1);
  assert.equal(run.verified, 1);
  assert.equal(run.withoutVerified, 2);
  const [price] = store.db.product_catalog_prices;
  assert.equal(price.supplier_id, 'new');
  assert.equal(price.product_id, searchCatalog.products.find(row => row[1] === same)[0]);
});
