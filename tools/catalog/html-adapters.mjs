// Συλλογή από σελίδες κατηγοριών, για sites χωρίς δημόσιο feed.
// 1. Βρίσκει κατηγορίες: συνδέσμους της αρχικής (και των κατηγοριών) με κείμενο που ταιριάζει στα επαγγέλματα του site.
// 2. Για κάθε κατηγορία περνά όλες τις σελίδες (rel=next / «Επόμενη»), όσο το επιτρέπει το robots.txt.
// 3. Από κάθε σελίδα κρατά μόνο όνομα, URL, μάρκα, τιμή (JSON-LD ή κάρτες προϊόντος της πλατφόρμας).
import * as cheerio from 'cheerio';
import {Blocked, Disallowed} from './fetcher.mjs';

// Πώς μοιάζει ένας σύνδεσμος κατηγορίας / προϊόντος ανά πλατφόρμα (ή ανά site).
const CATEGORY_URL = {
  woocommerce: /\/product-category\//,
  prestashop: /\/\d+-[^/.]+\/?$/,
  opencart: /route=product\/category|\/catalog\/|\/[\p{L}0-9-]+\/?$/iu,
  magento: /\/proionta\/|\/[\p{L}0-9-]+\/?$/iu,
  praktiker: /\/(c|cg)\//,
  default: /./,
};
const PRODUCT_URL = /\/p\/|\/product\/|route=product\/product|product_id=|\.html$|-p-[A-Z]+\./i;

const CARD_SETS = [
  {card: 'li.product, div.product.type-product, ul.products > li', name: '.woocommerce-loop-product__title, .product-title, h2, h3', link: 'a.woocommerce-LoopProduct-link, a.product-image-link, a[href]', price: '.price ins .amount, .price .amount, .price'},
  {card: '.product-miniature, .js-product-miniature', name: '.product-title a, .product-name a, h2 a, h3 a, .product-title', link: '.product-title a, a.product-thumbnail, a[href]', price: '.price, .product-price, [itemprop=price]'},
  {card: '.product-thumb, .product-layout, .product-grid-item', name: '.caption h4 a, .name a, h4 a, .product-name a', link: '.caption h4 a, .name a, h4 a, a[href]', price: '.price-new, .price'},
  {card: 'li.product-item, .product-item-info', name: 'a.product-item-link, .product-item-name a', link: 'a.product-item-link, a[href]', price: '[data-price-type=finalPrice], .price'},
  {card: '.ty-grid-list__item, .ty-product-list, .ut2-gl__item', name: '.product-title, .ty-grid-list__item-name a', link: 'a.product-title, .ty-grid-list__item-name a, a[href]', price: '.ty-price-num, .ty-price'},   // CS-Cart
  {card: '[itemtype*="schema.org/Product"]', name: '[itemprop=name]', link: '[itemprop=url], a[href]', price: '[itemprop=price]'},
  // Praktiker και γενικές κάρτες: σύνδεσμος προς /p/ με τίτλο και τιμή μέσα στην κάρτα
  {card: '[class*="product-card"], [class*="productCard"], [class*="ProductCard"], [data-product-id], [data-sku]', name: '[class*="title"], [class*="name"], h2, h3, a[href*="/p/"]', link: 'a[href*="/p/"], a[href]', price: '[class*="price"]'},
];

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
/** «1.234,56 €» → 1234.56 · «12,90€» → 12.9 · «€ 12.90» → 12.9 */
export function parsePrice(text){
  const s = clean(text).replace(/ /g, ' ');
  const m = s.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*€|€\s*(\d+(?:[.,]\d{1,2})?)/);
  if(!m) return null;
  if(m[3]) return Number(m[3].replace(',', '.'));
  return Number(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
}

function jsonLd($){
  const items = [];
  $('script[type="application/ld+json"]').each((_, e) => {
    let j; try { j = JSON.parse($(e).text()); } catch { return; }
    for(const x of [].concat(j['@graph'] || j)) items.push(x);
  });
  return items;
}

/** Κάρτες χωρίς σταθερές κλάσεις (π.χ. Tailwind): ομαδοποίηση συνδέσμων ανά προϊόν, τιμή από τον κοντινότερο
 *  πρόγονο που περιέχει «€» και κανένα άλλο προϊόν. */
function linkCards($, abs, productRe){
  const groups = new Map();
  $('a[href]').each((_, a) => { const h = abs($(a).attr('href')); if(h && productRe.test(h)) (groups.get(h) || groups.set(h, []).get(h)).push(a); });
  const out = [];
  for(const [url, anchors] of groups){
    // Το κείμενο του συνδέσμου πρώτα· το title είναι συχνά «0 κριτικές για …».
    const name = anchors.flatMap(a => [clean($(a).text()), clean($(a).attr('title'))]).map(n => n.replace(/^\(?\d+\)?\s*κριτικ\S*\s*(για\s*)?/i, ''))
      .filter(n => n.length >= 4 && n.length < 200 && !n.includes('<') && !/^(δες|προβολή|αγόρασ|περισσότερ)/i.test(n)).sort((x, y) => y.length - x.length)[0];
    if(!name || name.length < 4) continue;
    let el = $(anchors[0]), card = null;
    for(let i = 0; i < 8; i++){
      el = el.parent(); if(!el.length) break;
      const others = new Set(el.find('a[href]').map((_, x) => abs($(x).attr('href'))).get().filter(h => h && productRe.test(h)));
      if(others.size > 1) break;
      if(/€/.test(el.text())){ card = el; break; }
    }
    // Με παλιά και νέα τιμή, η τελική είναι η μικρότερη.
    const label = card ? clean(card.text()).replace(/(\d)\s+,(\d{2})/g, '$1,$2') : '';   // «10 ,99 €» (σε δύο span)
    const prices = [...label.matchAll(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*€/g)].map(m => parsePrice(m[0])).filter(p => Number.isFinite(p) && p > 0);
    out.push({name, url, brand: null, price: prices.length ? Math.min(...prices) : null, priceLabel: label.slice(0, 200)});
  }
  return out;
}

/** Προϊόντα μιας σελίδας κατηγορίας: πρώτα JSON-LD, αλλιώς οι κάρτες με τα περισσότερα αποτελέσματα. */
export function extractProducts($, pageUrl, productRe = null){
  const abs = h => { try { return new URL(h, pageUrl).href.split('#')[0]; } catch { return null; } };
  const fromLd = [];
  for(const x of jsonLd($)){
    const list = x['@type'] === 'ItemList' ? (x.itemListElement || []).map(e => e.item || e) : [].concat(x['@type']).includes('Product') ? [x] : [];
    for(const p of list){
      if(!p?.name || !(p.url || p['@id'])) continue;
      const offer = [].concat(p.offers || [])[0] || {};
      fromLd.push({name: clean(p.name), url: abs(p.url || p['@id']), brand: clean(p.brand?.name || (typeof p.brand === 'string' ? p.brand : '')) || null,
        price: offer.price != null ? Number(offer.price) : offer.lowPrice != null ? Number(offer.lowPrice) : null, priceLabel: ''});
    }
  }
  let best = [];
  for(const set of CARD_SETS){
    const found = [];
    $(set.card).each((_, c) => {
      const card = $(c);
      const link = abs(card.find(set.link).first().attr('href') || card.attr('href'));
      const name = clean(card.find(set.name).first().text()) || clean(card.find(set.link).first().attr('title'));
      if(!link || !name || name.length > 300 || !PRODUCT_URL.test(link) && set.card.startsWith('[class')) return;
      const priceEl = card.find(set.price).first();
      const price = priceEl.attr('data-price-amount') ? Number(priceEl.attr('data-price-amount')) : priceEl.attr('content') ? Number(priceEl.attr('content')) : parsePrice(priceEl.text());
      found.push({name, url: link, brand: clean(card.attr('data-brand') || card.find('[itemprop=brand]').first().text()) || null, price: Number.isFinite(price) ? price : null, priceLabel: clean(priceEl.text())});
    });
    const uniq = [...new Map(found.map(p => [p.url, p])).values()];
    if(uniq.length > best.length) best = uniq;
  }
  if(productRe){ const lc = linkCards($, abs, productRe); if(lc.length > best.length) best = lc; }
  // Το JSON-LD κερδίζει όταν δίνει τουλάχιστον όσα και οι κάρτες (πιο αξιόπιστα πεδία).
  return fromLd.length && fromLd.length >= best.length ? fromLd : best;
}

const HOME = /^(αρχική|αρχικη|αρχική σελίδα|home|ε?πίσω|shop|κατάστημα|προϊόντα|βρίσκεστε εδώ:?)$/i;
export function breadcrumb($){
  for(const x of jsonLd($)) if(x['@type'] === 'BreadcrumbList'){
    const names = (x.itemListElement || []).sort((a, b) => a.position - b.position).map(e => clean(e.name || e.item?.name).replace(/\s*[›»>\/]$/, '')).filter(n => n && !HOME.test(n));
    if(names.length) return names;
  }
  const crumbs = $('.breadcrumb li, .breadcrumbs li, nav.woocommerce-breadcrumb, [class*="breadcrumb"] li, [class*="breadcrumb"] a').map((_, e) => clean($(e).text())).get();
  const names = (crumbs.length === 1 ? crumbs[0].split(/\s*[\/›»>]\s*/) : crumbs).map(n => clean(n).replace(/\s*[›»>\/]$/, '')).filter(n => n && n.length < 80 && !HOME.test(n));
  const h1 = clean($('h1').first().text());
  if(h1 && names[names.length - 1] !== h1 && h1.length < 80) names.push(h1);
  return [...new Set(names)];
}

const TOTAL = [
  /από\s+([\d.]+)\s+αποτελέσμ/i, /([\d.]+)\s+αποτελέσματα/i, /Υπάρχ(?:ει|ουν)\s+([\d.]+)\s+προϊόν/i,
  /Εμφάνιση\s+\d+\s*(?:έως|-|–)\s*\d+\s+από\s+([\d.]+)/i, /There (?:are|is) ([\d.]+) products?/i, /([\d.]+)\s+(?:προϊόντα|είδη|κωδικοί)\b/i,
];
export function siteTotal($){
  const t = clean($('body').text());
  for(const re of TOTAL){ const m = t.match(re); if(m) return Number(m[1].replace(/\./g, '')); }
  const tb = $('.toolbar-amount .toolbar-number').last().text();
  return tb ? Number(tb.replace(/\D/g, '')) || null : null;
}

export function nextPage($, pageUrl){
  const h = $('link[rel=next]').attr('href') || $('a[rel=next]').attr('href') ||
    $('a.next, .next > a, li.next a, a.next.page-numbers, .pagination-next a, a[aria-label*="Επόμεν"], a[title*="Επόμεν"], a[aria-label*="Next"]').first().attr('href');
  if(!h || h === '#') return null;
  try { return new URL(h, pageUrl).href; } catch { return null; }
}

function categoryLinks($, pageUrl, site, platform, tradesFor){
  const host = new URL(site.url).hostname, pattern = site.categoryUrl || CATEGORY_URL[platform] || CATEGORY_URL.default;
  const out = new Map();
  $('a[href]').each((_, a) => {
    const text = clean($(a).text()).replace(/\s*\d[\d.]*\s*προϊόντα$/i, '');
    if(!text || text.length > 70) return;
    let u; try { u = new URL($(a).attr('href'), pageUrl); } catch { return; }
    u.hash = '';
    // Τα ελληνικά URL έρχονται κωδικοποιημένα (%CE%…): οι έλεγχοι γίνονται στο αποκωδικοποιημένο path.
    let path = u.pathname; try { path = decodeURIComponent(path); } catch {}
    if(u.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '') || PRODUCT_URL.test(path + u.search) && !pattern.test(path + u.search)) return;
    if(!pattern.test(path + u.search)) return;
    if(tradesFor(`${text} ${path.replace(/[-_/]/g, ' ')}`, site.trades).length) out.set(u.href, text);
  });
  return out;
}

export async function collectHtml({site, platform, fetcher, out, report, tradesFor, inferUnit, today, log}){
  const maxCategories = site.maxCategories || 400, maxPages = site.maxPages || 300;
  const queue = [...(site.seeds || [site.url])].map(u => ({url: u, depth: 0, text: ''}));
  const seenCats = new Set(), seenProducts = new Set(), records = new Map();
  const add = (p, cat, trade) => {
    const rec = {site: site.id, url: p.url, category_path: cat, name: p.name, brand: p.brand || null, unit: inferUnit(p.name, p.priceLabel),
      price_eur: p.price ?? null, price_date: p.price != null ? today : null, trade};
    records.set(p.url, rec); out.push(rec);
  };
  while(queue.length && seenCats.size < maxCategories){
    const {url, depth, text} = queue.shift();
    if(seenCats.has(url)) continue; seenCats.add(url);
    const row = {category: text || url, url, siteTotal: null, found: 0, pages: 0};
    let page = url, path = null;
    const seenPages = new Set();
    try{
      while(page && !seenPages.has(page) && row.pages < maxPages){
        seenPages.add(page);
        const r = await fetcher.get(page);
        if(r.status !== 200){ row.error = `HTTP ${r.status}`; break; }
        const $ = cheerio.load(r.body);
        row.pages++;
        if(row.pages === 1){
          path = breadcrumb($); if(path.length) row.category = path.join(' / ');
          row.siteTotal = siteTotal($);
          // Υποκατηγορίες: μόνο από τις πρώτες σελίδες, για να μη γεμίσει η ουρά με τυχαίους συνδέσμους.
          if(depth < (site.maxDepth ?? 2)) for(const [u, t] of categoryLinks($, r.finalUrl, site, platform, tradesFor)) if(!seenCats.has(u)) queue.push({url: u, depth: depth + 1, text: t});
        }
        if(depth === 0 && !site.seedHasProducts) break;   // η αρχική σελίδα δίνει μόνο κατηγορίες
        const products = extractProducts($, r.finalUrl, site.productUrl || null);
        let fresh = 0;
        for(const p of products){
          row.found++;
          // Το επάγγελμα βγαίνει από την κατηγορία, όχι από το όνομα (αλλιώς «χριστουγεννιάτικα είδη κουζίνας» = ξυλουργός).
          const cat = path?.length ? path : [text];
          const trade = tradesFor(cat.join(' / '), site.trades);
          if(seenProducts.has(p.url)){
            // Ξανά σε πιο ειδική υποκατηγορία («… / Κατασκευαστικά Υλικά / Γυψοσανίδες»): κρατά τη βαθύτερη διαδρομή.
            const rec = records.get(p.url);
            if(rec && trade.length && cat.length > rec.category_path.length && rec.category_path.every((x, i) => x === cat[i])){ rec.category_path = cat; rec.trade = trade; }
            else if(!rec && trade.length) add(p, cat, trade);
            continue;
          }
          seenProducts.add(p.url); fresh++;
          if(trade.length) add(p, cat, trade);
        }
        if(!products.length || (!fresh && row.pages > 1)) break;   // τέλος ή η σελιδοποίηση γυρίζει τα ίδια
        page = nextPage($, r.finalUrl);
      }
    } catch(e){
      if(e instanceof Disallowed){ row.error = 'το robots.txt κλείνει αυτή τη σελίδα/σελιδοποίηση'; }
      else if(e instanceof Blocked){ row.error = e.message; report.categories.push(row); throw e; }
      else row.error = e.message;
    }
    if(depth > 0 || site.seedHasProducts) report.categories.push(row);
  }
  if(queue.length) report.errors.push(`Έμειναν ${queue.length} κατηγορίες εκτός ορίου (${maxCategories}).`);
}
