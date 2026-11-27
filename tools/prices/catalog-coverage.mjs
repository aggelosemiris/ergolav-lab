import {attributes, clean, codesIn, gtin, modelCode} from '../../src/price-match.js';

const RULES_VERSION = 1;
const COVERAGE_VERSION = 2;

// Μία γραμμή ανά σταθερό id. Σε προϊόν με πολλαπλές αρχικές πηγές, μία κύρια ομάδα
// για άθροιση χωρίς διπλομέτρηση. Οι υπόλοιπες αρχικές πηγές διατηρούνται ως τεκμήρια.
export function catalogCoverage({stats, catalog, searchCatalog, offers, rejections, seen, fresh, verified, prior, startedAt, at}){
  const sourceRows = new Map(catalog.products);
  const previous = new Map();
  const priorAvailable = Array.isArray(prior);
  for(const row of prior ?? []){
    const last = previous.get(row.product_id);
    if(!last || Date.parse(last.verified_at) < Date.parse(row.verified_at)) previous.set(row.product_id, row);
  }
  let previousOnlyCount = priorAvailable ? 0 : null;
  const titles = new Map();
  for(const [, title] of searchCatalog.products){
    const key = clean(title);
    titles.set(key, (titles.get(key) ?? 0) + 1);
  }
  const groups = {};
  const products = searchCatalog.products.map(([id, title, brand, unit, names, archived]) => {
    const originals = (sourceRows.get(id) ?? []).map(([supplier, url, cents, date]) => ({supplier, url: `https://${url}`, cents, date}));
    const originalSuppliers = [...new Set(originals.map(row => row.supplier))].sort();
    const primary = originalSuppliers[0] ?? 'unknown';
    const state = fresh.has(id) ? 'fresh' : verified.has(id) ? 'cached' : seen.has(id) ? 'rejected' : 'notFound';
    const previousPrice = previous.get(id);
    const previousOnly = priorAvailable ? Boolean(previousPrice && !verified.has(id)) : null;
    const modelCandidates = [...new Set([title, ...names].flatMap(codesIn))];
    const spec = attributes(title, true);
    const repeatedTitle = titles.get(clean(title)) > 1;
    const group = groups[primary] ??= {total: 0, fresh: 0, cached: 0, previousOnly: priorAvailable ? 0 : null, rejected: 0, notFound: 0,
      archived: 0, noArchived: 0, modelInTitle: 0, observedIdentifiers: 0, brand: 0, specs: 0, repeatedTitle: 0};
    const matches = (offers.get(id) ?? []).map(({site, price, method}) => ({
      supplier: site, url: price.url, title: price.item.name ?? null, brand: price.item.brand ?? null,
      sku: price.item.sku ?? null, mpn: modelCode(price.item.mpn), gtin: gtin(price.item.gtin),
      specification: attributes(price.item.name, true), unit: price.item.unit ?? null, market: price.item.market ?? null,
      currency: price.item.currency ?? null, cents: price.cents, priceKind: price.kind, observedAt: price.observedAt,
      observationSource: price.fresh ? 'network' : 'cache', method, rulesVersion: RULES_VERSION,
    }));
    const rejected = rejections.get(id) ?? [];
    const attempts = originalSuppliers.map(supplier => {
      const source = stats.suppliers[supplier];
      const match = matches.find(m => m.supplier === supplier && m.method === 'supplier-url');
      const rejection = rejected.find(row => row.supplier === supplier);
      return {supplier, status: source?.status ?? 'unavailable', reason: source?.reason ?? null,
        outcome: match ? 'matched' : rejection ? 'rejected' : 'not-seen',
        detail: rejection?.reason ?? (!match && source?.status === 'available' ? 'not-in-read-snapshot' : null)};
    });
    group.total++;
    group[state]++;
    if(previousOnly){ group.previousOnly++; previousOnlyCount++; }
    group[archived ? 'archived' : 'noArchived']++;
    group.modelInTitle += Number(Boolean(modelCandidates.length));
    group.observedIdentifiers += Number(matches.some(m => m.sku || m.mpn || m.gtin));
    group.brand += Number(Boolean(brand));
    group.specs += Number(Boolean(Object.keys(spec).length));
    group.repeatedTitle += Number(repeatedTitle);
    return {id, title, brand: brand || null, unit: unit || null, spec, modelCandidates, originals, primary, attempts,
      archived: archived ? {cents: archived[0], date: archived[1], supplier: archived[2]} : null,
      previousPrice: previousPrice ? {supplier: previousPrice.supplier_id, cents: previousPrice.cents,
        priceKind: previousPrice.price_kind, storedAt: previousPrice.verified_at} : null,
      previousOnly, repeatedTitle, state, matches, rejections: rejected};
  });
  return {coverageVersion: COVERAGE_VERSION, rulesVersion: RULES_VERSION, checkedAt: at, startedAt,
    priorAvailable, previousOnly: previousOnlyCount, groups, products, suppliers: stats.suppliers};
}
