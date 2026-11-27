// Ίδιος κατάλογος με την αναζήτηση. Μαζική ανάγνωση, ποτέ ένα αίτημα για κάθε προϊόν.
import {supplierListingKey} from '../catalog/product-catalog.mjs';
import {clean, codesIn, modelCode} from '../../src/price-match.js';
import {SITES} from '../catalog/sites.mjs';
import {readSupplier} from './read-supplier.mjs';
import {wooItems} from './adapters/woo.mjs';
import {magentoItems, vrontinosItems} from './adapters/html.mjs';
import {praktikerItems} from './adapters/praktiker.mjs';
import {journalItems, prestaItems, wooHtmlItems} from './adapters/shops.mjs';
import {SPECIALISTS_PENDING_TERMS, SPECIALISTS_REJECTED} from './suppliers.mjs';

// Τα προϊόντα μένουν στον κατάλογο. Για αυτές τις πηγές αναζητούμε τιμή σε ενεργούς προμηθευτές.
const alternateOnly = new Set(['homeville', 'youbath', 'mafou', 'epipla1']);
// Ίδιο SKU, τεχνικά χαρακτηριστικά και μονάδα (τ.μ.) στις δύο σελίδες του Παράβαλου.
const confirmedListings = [{
  productId: '1343acd2e9a38a22eb0748a6',
  supplier: 'paravalos',
  url: 'https://paravalos.gr/plakaki-granitis-kasa-aivori-60x120cm-mat-rectified-protis-poiotitas/',
  sku: '0260120711',
}];
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

function observations(site, items, at, startedAt){
  const seen = new Map();
  const valid = cents => Number.isInteger(cents) && cents > 0 && cents <= 2147483647;
  const start = Date.parse(startedAt);
  for(const item of items){
    const url = supplierListingKey(site, item.url);
    if(!url) continue;
    const observedAt = item.observedAt ?? (item.fromCache ? null : at);
    const observedTime = Date.parse(observedAt);
    // Οι συμπληρωματικές πηγές διαβάζονται αφού αρχίσει το refresh, με δικό τους χρόνο παρατήρησης.
    const timestampValid = Number.isFinite(observedTime) && (item.fromCache || observedTime >= start);
    const fresh = timestampValid && !item.fromCache;
    const marketMismatch = item.market && item.market !== 'GR' || item.currency && item.currency !== 'EUR';
    const reason = !timestampValid ? 'invalid-observation-time' : marketMismatch ? 'market-or-currency' : item.reason || 'no-verifiable-price';
    const regular = item.verification === 'verified' && valid(item.regularCents);
    const priced = regular || valid(item.listedCents);
    const candidate = {url: item.url, observedAt, fresh, item,
      cents: !marketMismatch && priced && timestampValid ? (regular ? item.regularCents : item.listedCents) : null,
      kind: regular ? 'regular' : 'listed', reason};
    const previous = seen.get(url);
    if(!previous || previous.fresh !== candidate.fresh && candidate.fresh
      || previous.fresh === candidate.fresh && (previous.cents == null && candidate.cents != null
        || candidate.kind === 'regular' && candidate.cents != null && previous.kind === 'listed')){
      seen.set(url, candidate);
    } else if(candidate.fresh === previous.fresh && candidate.cents != null && previous.cents != null
      && candidate.kind === previous.kind && candidate.cents !== previous.cents){
      seen.set(url, {...previous, conflict: true, reason: 'conflicting-observations'});
    }
  }
  return seen;
}

// Ο πλήρης τίτλος είναι ευρετήριο υποψηφίων. Το μέγεθος, η ισχύς και τα IP δεν είναι κωδικοί.
function modelTitle(name){
  if(!productCodes(name).length) return null;
  return clean(name);
}

function productCodes(name){
  return codesIn(name).filter(c => /[A-Z]{2,}/.test(c) && /[0-9]{3,}/.test(c)
    && !/^(?:[0-9]+(?:X[0-9]+)*(?:MM|CM|ML|LM|KG|BTU|W|K|MA|HZ)|(?:IP|LED)[0-9]+)$/.test(c));
}

function verifiedIdentity(product, item){
  const brand = clean(product.brand), suppliedBrand = clean(item.brand);
  if(brand && suppliedBrand && brand !== suppliedBrand) return false;
  const knownBrand = brand || suppliedBrand;
  if(!knownBrand || !(brand && suppliedBrand) && !(` ${product.title} `).includes(` ${knownBrand} `)) return false;
  if(clean(item.unit) !== clean(product.unit)) return false;
  if(item.unitPriceUnit && product.unit && clean(item.unitPriceUnit) !== clean(product.unit)) return false;
  const codes = productCodes(product.title);
  const explicitModel = modelCode(item.mpn);
  if(explicitModel && !codes.includes(explicitModel)) return false;
  // Ο κατάλογος προκύπτει από αρχείο χωρίς δομημένο SKU/EAN. Η αποδοχή βασίζεται στη μάρκα
  // και στον κωδικό μέσα στον πλήρη τίτλο που ταιριάζει, ποτέ στο SKU του άλλου εμπόρου.
  return codes.length === 1;
}

function alternateOffers(searchCatalog, sources, offersBySupplier, directFresh, verified, reject){
  const catalogByTitle = new Map();
  for(const [id, title, brand, unit, names] of searchCatalog?.products ?? []){
    for(const name of [title, ...names]){
      const key = modelTitle(name);
      if(!key) continue;
      const previous = catalogByTitle.get(key);
      catalogByTitle.set(key, previous === undefined || previous?.id === id ? {id, brand, unit, title: key} : null);
    }
  }

  const rows = [];
  for(const {site, items, priceByUrl} of sources){
    const knownUrls = new Set((offersBySupplier.get(site) ?? []).map(({url}) => supplierListingKey(site, `https://${url}`)));
    const urlsByTitle = new Map();
    for(const item of items){
      if(!item.name) continue;
      const key = modelTitle(item.name);
      if(!key || !catalogByTitle.has(key)) continue;
      const url = supplierListingKey(site, item.url);
      if(!url) continue;
      const previous = urlsByTitle.get(key);
      urlsByTitle.set(key, previous === undefined || previous === url ? url : null);
    }
    const matches = new Map();
    for(const [key, url] of urlsByTitle){
      const product = catalogByTitle.get(key);
      if(!product || directFresh.has(product.id)) continue;
      if(!url){ reject(product.id, site, null, 'ambiguous-listing'); continue; }
      if(knownUrls.has(url)) continue;
      const price = priceByUrl.get(url);
      if(price?.cents == null || price.conflict){ reject(product.id, site, price?.url ?? null, price?.reason || 'no-verifiable-price'); continue; }
      if(modelTitle(price.item.name) !== key || !verifiedIdentity(product, price.item)){
        reject(product.id, site, price.url, 'identity-or-unit');
        continue;
      }
      if(verified.has(product.id) && !price.fresh) continue;
      const previous = matches.get(product.id);
      matches.set(product.id, previous === undefined || previous?.url === url ? {url, price} : null);
    }
    for(const [productId, match] of matches){
      if(!match){ reject(productId, site, null, 'ambiguous-listing'); continue; }
      rows.push({productId, site, price: match.price, method: 'brand-model-full-title'});
    }
  }
  return rows;
}

export async function refreshCatalog({catalog, searchCatalog, results, fetcher, store, at, startedAt = at, finishedAt = () => at, only, onCoverage, log = () => {}}){
  const offersBySupplier = new Map();
  for(const [productId, offers] of catalog.products){
    for(const [site, url] of offers){
      if(!offersBySupplier.has(site)) offersBySupplier.set(site, []);
      offersBySupplier.get(site).push({productId, url});
    }
  }
  const suppliers = {};
  const checked = new Set(), seen = new Set(), verified = new Set(), changed = new Set();
  const rejections = new Map();
  const reject = (id, supplier, url, reason) => {
    seen.add(id);
    if(!rejections.has(id)) rejections.set(id, []);
    rejections.get(id).push({supplier, url, reason});
  };
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
    const coverage = suppliers[site] = {listings: offers.length, seen: 0, verified: 0, verifiedFromCache: 0, reason: null};
    for(const offer of offers) checked.add(offer.productId);
    if(alternateOnly.has(site)){
      coverage.reason = 'αναζήτηση τιμής σε εναλλακτικούς προμηθευτές';
      coverage.status = 'disabled';
      return rows;
    }
    if(only && !only.includes(id) && !only.includes(site)){
      coverage.reason = 'εκτός φίλτρου εκτέλεσης';
      coverage.status = 'excluded';
      return rows;
    }
    const items = [...(result?.items || [])];
    const source = catalog.sources[site];
    const extra = result?.status === 'unavailable' || result?.fatal ? {} : supplemental(site, source, Boolean(result));
    if(extra.items){
      const supplement = await readSupplier({supplier: {id: site}, fetcher: enhancedFetcher, items: extra.items, at, log});
      items.push(...supplement.items);
      coverage.reason = supplement.reason;
    }
    const priceByUrl = observations(site, items, at, startedAt);
    if(items.length) freshSources.push({site, items, priceByUrl});
    const byProduct = new Map();
    for(const {productId, url} of offers){
      const key = supplierListingKey(site, `https://${url}`);
      if(!priceByUrl.has(key)) continue;
      coverage.seen++;
      seen.add(productId);
      const price = priceByUrl.get(key);
      if(price.cents == null || price.conflict){ reject(productId, site, price.url, price.reason); continue; }
      if(price.fresh) coverage.verified++;
      else coverage.verifiedFromCache++;
      verified.add(productId);
      const previous = byProduct.get(productId);
      if(!previous || price.fresh && !previous.fresh || price.fresh === previous.fresh
        && (price.kind === 'regular' && previous.kind !== 'regular' || price.kind === previous.kind && price.cents < previous.cents))
        byProduct.set(productId, price);
    }
    for(const [productId, price] of byProduct) rows.push({productId, site, price, method: 'supplier-url'});
    coverage.reason = [...new Set([result?.reason, extra.reason, coverage.reason].filter(Boolean))].join(' · ')
      || (!items.length ? 'δεν υπάρχει διαθέσιμη ροή τιμών για την πηγή' : null);
    coverage.status = coverage.reason ? (items.length ? 'partial' : 'unavailable') : 'available';
    return rows;
  }));
  const confirmed = [];
  for(const {productId, supplier, url, sku} of confirmedListings){
    if(!checked.has(productId) || verified.has(productId)) continue;
    const source = freshSources.find(row => row.site === supplier);
    if(!source) continue;
    const key = supplierListingKey(supplier, url);
    const items = source.items.filter(item => supplierListingKey(supplier, item.url) === key);
    if(!items.length || items.some(item => item.sku !== sku)) continue;
    const price = source.priceByUrl.get(key);
    if(price?.cents == null || price.conflict) continue;
    confirmed.push({productId, site: supplier, price, method: 'confirmed-supplier-sku'});
    verified.add(productId);
    seen.add(productId);
  }
  updates.push(confirmed);
  const fresh = new Set();
  for(const rows of updates){
    for(const {productId, price} of rows) if(price.fresh) fresh.add(productId);
  }
  const alternatives = alternateOffers(searchCatalog, freshSources, offersBySupplier, fresh, verified, reject);
  for(const {productId, price} of alternatives){
    verified.add(productId);
    seen.add(productId);
    if(price.fresh) fresh.add(productId);
  }
  updates.push(alternatives);
  // Το snapshot λαμβάνεται με το κλείδωμα της εκτέλεσης, πριν από την πρώτη δημοσίευση τιμής καταλόγου.
  const prior = onCoverage ? await store.loadCatalogPrices() : null;
  const offers = new Map();
  for(const rows of updates){
    if(!rows.length) continue;
    for(const row of rows){
      if(!offers.has(row.productId)) offers.set(row.productId, []);
      offers.get(row.productId).push(row);
    }
    const result = await store.publishCatalogPrices(rows.map(({productId, site, price}) =>
      ({product_id: productId, supplier_id: site, cents: price.cents, price_kind: price.kind, verified_at: price.observedAt})));
    newOffers += result.new;
    offersChanged += result.changed.length;
    for(const id of result.changed) changed.add(id);
  }
  const stats = {total: catalog.products.length, checked: checked.size, seen: seen.size, verified: fresh.size,
    verifiedFromCache: verified.size - fresh.size, rejected: seen.size - verified.size, notFound: checked.size - seen.size,
    withoutVerified: checked.size - fresh.size,
    fromAlternateSource: new Set(alternatives.filter(r => r.price.fresh).map(r => r.productId)).size,
    fromConfirmedListing: confirmed.filter(r => r.price.fresh).length, offersChanged, newOffers, changed: changed.size, suppliers};
  if(onCoverage) await onCoverage({stats, catalog, searchCatalog, offers, rejections, seen, fresh, verified, prior, startedAt, at: finishedAt()});
  return stats;
}
