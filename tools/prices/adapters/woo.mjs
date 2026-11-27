// WooCommerce Store API (δομημένη, δημόσια ροή προϊόντων: /wp-json/wc/store/v1/products).
// Η κανονική τιμή είναι το ρητό πεδίο prices.regular_price· η τιμή προσφοράς (prices.sale_price/price) δεν κρατιέται.
// Προϊόντα με πολλές παραλλαγές (price_range) έχουν πολλές τιμές → «μη επαληθευμένο» (δεν διαλέγουμε μία στην τύχη).
import {gtin} from '../../../src/price-match.js';
import { decode, decide, unverified } from './common.mjs';

export function wooItem(p, base){
  const pr = p.prices || {}, minor = Number.isInteger(pr.currency_minor_unit) ? pr.currency_minor_unit : 2;
  const cents = v => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n > 0 ? Math.round(n * 10 ** (2 - minor)) : null; };
  const out = {id: String(p.id), sku: p.sku ? String(p.sku) : null, gtin: gtin(p.global_unique_id || p.gtin), currency: pr.currency_code || null, name: decode(p.name),
    brand: decode(p.brands?.[0]?.name) || null, url: p.permalink || `${base}/?p=${p.id}`, unit: null};
  if(pr.currency_code && pr.currency_code !== 'EUR') return {...out, ...unverified('currency')};
  if(p.type === 'variable' || pr.price_range) return {...out, ...unverified('variable-prices')};
  if(p.is_in_stock === false) return {...out, ...unverified('out-of-stock')};
  if(p.is_purchasable === false) return {...out, ...unverified('not-purchasable')};
  return {...out, ...decide(cents(pr.regular_price), cents(pr.price))};
}

/** Όλα τα προϊόντα, σελίδα-σελίδα. (Χωρίς orderby/order: το τείχος προστασίας του Toolcase απαντά 403 σε αυτές τις παραμέτρους.) */
export async function* wooItems({base, path = '/wp-json/wc/store/v1/products', fetcher, perPage = 100, maxPages = 600, partial = () => {}}){
  let announcedPages = 0;
  const ids = new Set();
  for(let page = 1; page <= maxPages; page++){
    const r = await fetcher.get(`${base}${path}?per_page=${perPage}&page=${page}`, {accept: 'application/json', allowStatus: [200, 400, 404]});
    if(r.status !== 200){
      if(page === 1 || announcedPages >= page || r.status !== 400)
        partial(`Store API: HTTP ${r.status}, σελίδα ${page}`);
      return;
    }
    let list; try { list = JSON.parse(r.body); } catch { throw new Error(`μη έγκυρο JSON στη σελίδα ${page}`); }
    if(!Array.isArray(list)) throw new Error(`μη έγκυρη λίστα προϊόντων στη σελίδα ${page}`);
    announcedPages = Math.max(announcedPages, Number(r.wpTotalPages) || 0);
    if(!list.length){
      if(announcedPages >= page) partial(`Store API: κενή σελίδα ${page} από ${announcedPages}`);
      return;
    }
    let added = 0;
    for(const p of list){
      if(p?.id == null){ partial(`Store API: προϊόν χωρίς id στη σελίδα ${page}`); continue; }
      const id = String(p.id);
      if(ids.has(id)){ partial(`Store API: επαναλαμβανόμενο id στη σελίδα ${page}`); continue; }
      ids.add(id); added++;
      yield wooItem(p, base);
    }
    if(!added || (announcedPages ? page >= announcedPages : list.length < perPage)) return;
  }
  partial(`Store API: όριο σελιδοποίησης ${maxPages}`);
}
