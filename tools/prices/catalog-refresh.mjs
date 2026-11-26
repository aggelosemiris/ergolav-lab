// Ίδιος κατάλογος με την αναζήτηση. Μαζική ανάγνωση, ποτέ ένα αίτημα για κάθε προϊόν.
import {supplierListingKey} from '../catalog/product-catalog.mjs';
import {SITES} from '../catalog/sites.mjs';
import {wooItems} from './adapters/woo.mjs';
import {magentoItems, vrontinosItems} from './adapters/html.mjs';
import {praktikerItems} from './adapters/praktiker.mjs';
import {journalItems, prestaItems, wooHtmlItems} from './adapters/shops.mjs';
import {SPECIALISTS_PENDING_TERMS, SPECIALISTS_REJECTED} from './suppliers.mjs';

const aliases = {kaxiris: 'kaxirismonotika', mylonas: 'mylonasergaleia', papasideris: 'e-papasideris', billis: 'marmara-billis'};
const host = value => new URL(value).hostname.replace(/^www\./, '');
const sourceById = new Map(SITES.map(site => [site.id, site]));
const inactive = new Map([...SPECIALISTS_PENDING_TERMS, ...SPECIALISTS_REJECTED].map(s => [host(s.base_url), s.reason || 'εκκρεμεί έλεγχος όρων']));

// Ξεχωριστή ανάγνωση μόνο όπου το εβδομαδιαίο feed καλύπτει μικρό μέρος των παλιών κατηγοριών
// ή για πηγές που υπήρχαν στην εγκεκριμένη συλλογή και έχουν διαθέσιμο adapter.
function supplemental(id, source, alreadyFetched){
  const site = sourceById.get(id);
  if(!site || !source || host(source.origin) !== host(site.url)) return {};
  if(inactive.has(host(site.url))) return {reason: inactive.get(host(site.url))};
  const base = site.url;
  const categories = source.categories.filter(u => {
    try { return new URL(u).protocol === 'https:' && host(u) === host(base); } catch { return false; }
  });
  if(id === 'praktiker')
    return {items: opts => praktikerItems({...opts, seeds: ['ergaleia-eidi-kigkalerias']})};
  if(id === 'meidanis') return {items: opts => magentoItems({...opts, categories})};
  if(id === 'vrontinos'){
    const ids = [...new Set(categories.map(u => u.match(/\/ProductCategory\/([\da-f]{8})\.aspx/i)?.[1]).filter(Boolean))];
    return {items: opts => vrontinosItems({...opts, categories: ids, labelCheck: true})};
  }
  if(id === 'kaxiris') return {items: opts => prestaItems({...opts, base, categories})};
  if(alreadyFetched) return {};
  if(source.method?.startsWith('WooCommerce Store API') && id !== 'dapeda')
    return {items: opts => wooItems({...opts, base: new URL(base).origin})};
  if(source.method?.includes('(woocommerce)')) return {items: opts => wooHtmlItems({...opts, base, categories})};
  if(source.method?.includes('(opencart)')) return {items: opts => journalItems({...opts, base, categories})};
  if(source.method?.includes('(prestashop)')) return {items: opts => prestaItems({...opts, base, categories})};
  if(categories.length) return {async *items(opts){
    const {structuredPriceItems} = await import('../catalog/structured-prices.mjs');
    yield* structuredPriceItems({...opts, categories});
  }};
  return {};
}

function observations(site, items){
  const seen = new Map();
  const valid = cents => Number.isInteger(cents) && cents > 0 && cents <= 2147483647;
  for(const item of items){
    const url = supplierListingKey(site, item.url);
    if(!url) continue;
    const regular = item.verification === 'verified' && valid(item.regularCents);
    const candidate = regular ? {cents: item.regularCents, kind: 'regular'}
      : valid(item.listedCents) ? {cents: item.listedCents, kind: 'listed'} : null;
    const previous = seen.get(url);
    if(!previous || (candidate?.kind === 'regular' && previous.kind === 'listed')) seen.set(url, candidate);
    else if(candidate?.kind === previous.kind && candidate.cents !== previous.cents)
      seen.set(url, {...previous, conflict: true});
  }
  return seen;
}

export async function refreshCatalog({catalog, results, fetcher, store, at, only, log = () => {}}){
  const offersBySupplier = new Map();
  for(const [productId, offers] of catalog.products){
    for(const [site, url] of offers){
      if(!offersBySupplier.has(site)) offersBySupplier.set(site, []);
      offersBySupplier.get(site).push({productId, url});
    }
  }
  const suppliers = {};
  const checked = new Set(), seen = new Set(), verified = new Set(), changed = new Set();
  let offersChanged = 0, newOffers = 0;
  const bySupplier = new Map(results.map(r => [r.s.id, r]));
  // Η συμπληρωματική ανάγνωση είναι περιορισμένη στον χρόνο του job και στον ρυθμό του κοινού fetcher.
  const enhancedFetcher = {
    ...fetcher,
    get(url, options){
      if(!budget.has(host(url))) budget.set(host(url), 0);
      const key = host(url), used = budget.get(key);
      if(used >= 1200) throw new Error('όριο σελίδων προμηθευτή για την εκτέλεση');
      budget.set(key, used + 1);
      return fetcher.get(url, options);
    },
  };
  const budget = new Map();

  const updates = await Promise.all([...offersBySupplier].map(async ([site, offers]) => {
    const id = aliases[site] || site;
    const result = bySupplier.get(id);
    const rows = [];
    const coverage = suppliers[site] = {listings: offers.length, seen: 0, verified: 0, reason: null};
    for(const offer of offers) checked.add(offer.productId);
    if(only && !only.includes(id) && !only.includes(site)){
      coverage.reason = 'εκτός φίλτρου εκτέλεσης';
      return rows;
    }
    const items = [...(result?.items || [])];
    const source = catalog.sources[site];
    const extra = result?.status === 'unavailable' ? {} : supplemental(site, source, Boolean(result));
    if(extra.items){
      try {
        for await (const item of extra.items({fetcher: enhancedFetcher, log})) items.push(item);
      } catch(e){ coverage.reason = e.message; }
    }
    const priceByUrl = observations(site, items);
    const byProduct = new Map();
    for(const {productId, url} of offers){
      const key = supplierListingKey(site, `https://${url}`);
      if(!priceByUrl.has(key)) continue;
      coverage.seen++;
      seen.add(productId);
      const price = priceByUrl.get(key);
      if(!price || price.conflict) continue;
      coverage.verified++;
      verified.add(productId);
      const previous = byProduct.get(productId);
      if(!previous || (price.kind === 'regular' && previous.kind !== 'regular')
        || (price.kind === previous.kind && price.cents < previous.cents)) byProduct.set(productId, price);
    }
    for(const [product_id, {cents, kind: price_kind}] of byProduct)
      rows.push({product_id, supplier_id: site, cents, price_kind, verified_at: at});
    coverage.reason ??= result?.reason || extra.reason || (!items.length ? 'δεν υπάρχει διαθέσιμη ροή τιμών για την πηγή' : null);
    return rows;
  }));
  for(const rows of updates){
    if(!rows.length) continue;
    const result = await store.publishCatalogPrices(rows);
    newOffers += result.new;
    offersChanged += result.changed.length;
    for(const id of result.changed) changed.add(id);
  }
  return {total: catalog.products.length, checked: checked.size, seen: seen.size, verified: verified.size,
    withoutVerified: checked.size - verified.size, offersChanged, newOffers, changed: changed.size, suppliers};
}
