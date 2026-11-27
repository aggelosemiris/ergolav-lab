import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildProductCatalog} from '../tools/catalog/product-catalog.mjs';
import {catalogCoverage} from '../tools/prices/catalog-coverage.mjs';
import {refreshCatalog} from '../tools/prices/catalog-refresh.mjs';
import {createMemoryStore} from '../tools/prices/stores/memory.mjs';
import {runOnce} from '../tools/prices/engine.mjs';
import {wooItems} from '../tools/prices/adapters/woo.mjs';
import {Blocked} from '../tools/prices/fetch.mjs';

const startedAt = '2026-11-27T00:00:00.000Z';
const previous = '2026-11-20T00:00:00.000Z';
const now = () => new Date(startedAt);
const raw = (site, slug, name, details = {}) =>
  ({site, url: `https://${site}.example/${slug}`, name, brand: 'ACME', ...details});

function seed(rows){
  const {search: searchCatalog, supply: catalog} = buildProductCatalog(rows);
  return {catalog, searchCatalog};
}

test('έγκυρη σελίδα πριν από 403 αποθηκεύεται, η μη επισκέψιμη εγγραφή διατηρεί προηγούμενη τιμή', async () => {
  const first = raw('shop', 'first', 'Θερμοσίφωνας ACME XY123 80 L');
  const missing = raw('shop', 'skipped', 'Βάνα ACME AB321 10 mm');
  const {catalog, searchCatalog} = seed([first, missing]);
  const store = createMemoryStore({now});
  const missed = searchCatalog.products.find(row => row[1] === missing.name)[0];
  await store.publishCatalogPrices([{product_id: missed, supplier_id: 'shop', cents: 2200, price_kind: 'regular', verified_at: previous}]);
  const supplier = {id: 'shop', base_url: 'https://shop.example', items: opts => wooItems({base: 'https://shop.example', perPage: 1, ...opts})};
  const independent = {id: 'independent', base_url: 'https://independent.example', async *items(){ yield {id: 'x', name: 'Υλικό'}; }};
  const fetcher = {get: async url => {
    if(new URL(url).searchParams.get('page') === '2') throw new Blocked('shop.example', 'HTTP 403');
    return {status: 200, wpTotalPages: '2', date: startedAt, fromCache: false,
      body: JSON.stringify([{id: 1, permalink: first.url, name: first.name, prices: {regular_price: '1500'}}])};
  }};
  let coverage;
  const {stats} = await runOnce({store, suppliers: [supplier, independent], fetcher, now, catalog: [],
    refreshProductCatalog: ({results, at, startedAt}) => refreshCatalog({catalog, searchCatalog, results, at, startedAt, store, fetcher,
      onCoverage: data => { coverage = catalogCoverage(data); }})});
  assert.equal(stats.suppliers.independent.status, 'available');
  assert.equal(stats.suppliers.shop.status, 'partial');
  assert.equal(stats.productCatalog.suppliers.shop.status, 'partial');
  assert.equal(store.db.price_runs.at(-1).status, 'partial');
  assert.equal(stats.productCatalog.verified, 1);
  assert.deepEqual([coverage.groups.shop.fresh, coverage.groups.shop.cached, coverage.groups.shop.rejected, coverage.groups.shop.notFound], [1,0,0,1]);
  assert.equal(coverage.previousOnly, 1);
  assert.equal(coverage.groups.shop.previousOnly, 1);
  assert.equal(coverage.products.find(p => p.id === missed).previousPrice.storedAt, previous);
  assert.equal(coverage.products.find(p => p.state === 'fresh').previousPrice, null);
  assert.equal(coverage.products.find(p => p.state === 'fresh').matches[0].observationSource, 'network');
  assert.equal(coverage.suppliers.shop.status, 'partial');
  assert.equal(store.db.product_catalog_prices.find(p => p.product_id === missed).verified_at, previous);
  assert.equal(store.db.product_catalog_prices.length, 2);
});

test('cache, απόρριψη και μη εύρεση μετρούν χωριστά και η cache κρατά την παλιά ημερομηνία', async () => {
  const rows = ['fresh', 'cached', 'no-price', 'absent'].map((slug, i) => raw('shop', slug, `Προϊόν ${i}`));
  const seeded = seed(rows);
  const store = createMemoryStore({now});
  const items = rows.slice(0, 3).map((r, i) => ({url: r.url, name: r.name, verification: i === 2 ? 'unverified' : 'verified',
    regularCents: i === 2 ? null : 1200, reason: i === 2 ? 'variable-prices' : null,
    observedAt: i === 1 ? previous : startedAt, fromCache: i === 1}));
  const results = [{s: {id: 'shop'}, status: 'available', items}];
  let coverage;
  const run = () => refreshCatalog({...seeded, results, at: startedAt, startedAt, store, fetcher: {},
    onCoverage: data => { coverage = catalogCoverage(data); }});
  const summary = await run();
  assert.deepEqual([summary.total, summary.verified, summary.verifiedFromCache, summary.rejected, summary.notFound], [4,1,1,1,1]);
  assert.equal(coverage.products.find(r => r.state === 'rejected').rejections[0].reason, 'variable-prices');
  assert.equal(coverage.products.find(r => r.state === 'cached').matches[0].observedAt, previous);
  assert.equal(coverage.products.find(r => r.state === 'cached').matches[0].observationSource, 'cache');
  assert.equal(store.db.product_catalog_prices.filter(p => p.verified_at === previous).length, 1);
  assert.equal((await run()).newOffers, 0);
});

test('cache χωρίς χρονοσήμανση απορρίπτεται και η μη διαθέσιμη απογραφή βάσης δεν μετρά ως μηδέν', async () => {
  const source = raw('shop', 'cached', 'Βάνα ACME XT123');
  const entries = seed([source]);
  const store = createMemoryStore({now});
  store.loadCatalogPrices = async () => null;
  const results = [{s: {id: 'shop'}, status: 'available', items: [
    {url: source.url, name: source.name, fromCache: true, verification: 'verified', regularCents: 1200},
  ]}];
  let coverage;
  const stats = await refreshCatalog({...entries, results, store, fetcher: {}, at: startedAt,
    onCoverage: data => { coverage = catalogCoverage(data); }});
  assert.equal(stats.verified, 0);
  assert.equal(stats.verifiedFromCache, 0);
  assert.equal(coverage.products[0].rejections[0].reason, 'invalid-observation-time');
  assert.equal(store.db.product_catalog_prices.length, 0);
  assert.equal(coverage.priorAvailable, false);
  assert.equal(coverage.groups.shop.previousOnly, null);
});

test('ταίριασμα τίτλου με μάρκα και μοντέλο περνά μόνο με συμβατή μονάδα, χώρα και προδιαγραφές', async () => {
  const base = 'Αντλία ACME XT123 80 L μαύρη 2 τεμ.';
  const entries = seed([raw('original', 'product', base, {unit: 'm'})]);
  const item = {url: 'https://new.example/product', name: base, brand: 'ACME', mpn: 'XT123', sku: 'merchant-private',
    unit: 'm', market: 'GR', currency: 'EUR', verification: 'verified', regularCents: 2800};
  const run = async override => {
    const store = createMemoryStore({now});
    const results = [{s: {id: 'new'}, status: 'available', items: [{...item, ...override}]}];
    return refreshCatalog({...entries, results, at: startedAt, store, fetcher: {}});
  };
  assert.equal((await run({})).verified, 1);
  for(const other of [
    {unit: 'm2'}, {market: 'CY'}, {currency: 'GBP'}, {brand: 'OTHER', sku: 'XT123'}, {mpn: 'XT124'},
    {name: base.replace('μαύρη', 'άσπρη')}, {name: base.replace('80', '160')}, {name: base.replace('2 τεμ.', '1 τεμ.')},
    {name: 'Αντλία ACME 120x100cm', sku: 'XT123'},
  ]) assert.equal((await run(other)).verified, 0, JSON.stringify(other));
});

test('παλιά αρχική παρατήρηση επιτρέπει νέα επαλήθευση από ταυτοποιημένο εναλλακτικό προμηθευτή', async () => {
  const original = raw('original', 'product', 'Βάνα ACME XT123 10 mm', {unit: 'piece'});
  const entries = seed([original]);
  const store = createMemoryStore({now});
  const item = {name: original.name, brand: original.brand, unit: 'piece', verification: 'verified', regularCents: 2800};
  const results = [
    {s: {id: 'original'}, status: 'available', items: [{...item, url: original.url, observedAt: previous, fromCache: true}]},
    {s: {id: 'replacement'}, status: 'available', items: [{...item, url: 'https://replacement.example/product', observedAt: startedAt}]},
  ];
  const summary = await refreshCatalog({...entries, results, at: startedAt, store, fetcher: {}});
  assert.equal(summary.verified, 1);
  assert.equal(summary.verifiedFromCache, 0);
  assert.equal(summary.fromAlternateSource, 1);
  assert.deepEqual(store.db.product_catalog_prices.map(p => p.verified_at), [previous, startedAt]);
});

test('η ανακοινωμένη σελιδοποίηση συνεχίζεται και αναφέρεται όταν σταματήσει πρόωρα', async () => {
  const visited = [], issues = [];
  const fetcher = {get: async url => {
    visited.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    return {status: 200, wpTotalPages: '3', body: page === 1 ? '[{"id":1,"name":"ok"}]' : '[]'};
  }};
  const products = [];
  for await(const row of wooItems({base: 'https://shop.example', fetcher, partial: x => issues.push(x)})) products.push(row);
  assert.equal(products.length, 1);
  assert.equal(visited.length, 2);
  assert.match(issues[0], /κενή σελίδα 2 από 3/);
});
