// Ίδιος κατάλογος με την αναζήτηση. Μαζική ανάγνωση, ποτέ ένα αίτημα για κάθε προϊόν.
import {supplierListingKey} from '../catalog/product-catalog.mjs';
import {clean, codesIn} from '../../src/price-match.js';
import {SITES} from '../catalog/sites.mjs';
import {wooItems} from './adapters/woo.mjs';
import {magentoItems, vrontinosItems} from './adapters/html.mjs';
import {praktikerItems} from './adapters/praktiker.mjs';
import {journalItems, prestaItems, wooHtmlItems} from './adapters/shops.mjs';
import {SPECIALISTS_PENDING_TERMS, SPECIALISTS_REJECTED} from './suppliers.mjs';

// Τα προϊόντα μένουν στον κατάλογο. Για αυτές τις πηγές αναζητούμε τιμή σε ενεργούς προμηθευτές.
const alternateOnly = new Set(['homeville', 'youbath', 'mafou', 'epipla1']);
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

// Ίδιος πλήρης τίτλος με κωδικό μοντέλου. Διατηρούμε αριθμούς, μέγεθος και περιγραφή
// συσκευασίας. Αν ο τίτλος δείχνει σε δύο προϊόντα ή δύο URL του ίδιου προμηθευτή, παραλείπεται.
function modelTitle(name){
  if(!codesIn(name).some(code => /[A-Z]{2,}/.test(code) && /[0-9]{3,}/.test(code))) return null;
  return clean(name);
}

function alternateOffers(searchCatalog, sources, offersBySupplier, verified, at){
  const catalogByTitle = new Map();
  for(const [id, title, brand, , names] of searchCatalog?.products ?? []){
    for(const name of [title, ...names]){
      const key = modelTitle(name);
      if(!key) continue;
      const previous = catalogByTitle.get(key);
      catalogByTitle.set(key, previous === undefined || previous?.id === id ? {id, brand: clean(brand)} : null);
    }
  }

  const rows = [];
  for(const {site, items, priceByUrl} of sources){
    const knownUrls = new Set((offersBySupplier.get(site) ?? []).map(({url}) => supplierListingKey(site, `https://${url}`)));
    const urlsByTitle = new Map();
    for(const item of items){
      if(!item.name) continue;
      const key = modelTitle(item.name);
      if(!key || !catalogByTitle.get(key)) continue;
      const url = supplierListingKey(site, item.url);
      if(!url) continue;
      const previous = urlsByTitle.get(key);
      urlsByTitle.set(key, previous === undefined || previous?.url === url ? {url, brand: clean(item.brand)} : null);
    }
    const matches = new Map();
    for(const [key, listing] of urlsByTitle){
      const product = catalogByTitle.get(key);
      if(!listing || verified.has(product.id) || knownUrls.has(listing.url)) continue;
      if(product.brand && listing.brand && product.brand !== listing.brand) continue;
      const price = priceByUrl.get(listing.url);
      if(!price || price.conflict) continue;
      const previous = matches.get(product.id);
      matches.set(product.id, previous === undefined || previous?.url === listing.url ? {url: listing.url, price} : null);
    }
    for(const [product_id, match] of matches){
      if(!match) continue;
      const {cents, kind: price_kind} = match.price;
      rows.push({product_id, supplier_id: site, cents, price_kind, verified_at: at});
    }
  }
  return rows;
}

export async function refreshCatalog({catalog, searchCatalog, results, fetcher, store, at, only, log = () => {}}){
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

  const freshSources = [];
  const activeSites = new Set([...offersBySupplier.keys(), ...results.filter(r => r.items?.length)
    .map(r => Object.keys(aliases).find(site => aliases[site] === r.s.id) ?? r.s.id)]);
  const updates = await Promise.all([...activeSites].map(async site => {
    const offers = offersBySupplier.get(site) ?? [];
    const id = aliases[site] || site;
    const result = bySupplier.get(id);
    const rows = [];
    const coverage = suppliers[site] = {listings: offers.length, seen: 0, verified: 0, reason: null};
    for(const offer of offers) checked.add(offer.productId);
    if(alternateOnly.has(site)){
      coverage.reason = 'αναζήτηση τιμής σε εναλλακτικούς προμηθευτές';
      return rows;
    }
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
    if(items.length) freshSources.push({site, items, priceByUrl});
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
  const alternatives = alternateOffers(searchCatalog, freshSources, offersBySupplier, verified, at);
  const fromAlternateSource = new Set();
  for(const row of alternatives){
    fromAlternateSource.add(row.product_id);
    verified.add(row.product_id);
    seen.add(row.product_id);
  }
  updates.push(alternatives);
  for(const rows of updates){
    if(!rows.length) continue;
    const result = await store.publishCatalogPrices(rows);
    newOffers += result.new;
    offersChanged += result.changed.length;
    for(const id of result.changed) changed.add(id);
  }
  return {total: catalog.products.length, checked: checked.size, seen: seen.size, verified: verified.size,
    withoutVerified: checked.size - verified.size, fromAlternateSource: fromAlternateSource.size, offersChanged, newOffers, changed: changed.size, suppliers};
}
