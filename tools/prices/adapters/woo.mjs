// WooCommerce Store API (δομημένη, δημόσια ροή προϊόντων: /wp-json/wc/store/v1/products).
// Η κανονική τιμή είναι το ρητό πεδίο prices.regular_price· η τιμή προσφοράς (prices.sale_price/price) δεν κρατιέται.
// Προϊόντα με πολλές παραλλαγές (price_range) έχουν πολλές τιμές → «μη επαληθευμένο» (δεν διαλέγουμε μία στην τύχη).
import { decode, decide, unverified } from './common.mjs';

export function wooItem(p, base){
  const pr = p.prices || {}, minor = Number.isInteger(pr.currency_minor_unit) ? pr.currency_minor_unit : 2;
  const cents = v => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n > 0 ? Math.round(n * 10 ** (2 - minor)) : null; };
  const out = {id: String(p.id), sku: p.sku ? String(p.sku) : null, gtin: null, name: decode(p.name),
    brand: decode(p.brands?.[0]?.name) || null, url: p.permalink || `${base}/?p=${p.id}`, unit: null};
  if(pr.currency_code && pr.currency_code !== 'EUR') return {...out, ...unverified('currency')};
  if(p.type === 'variable' || pr.price_range) return {...out, ...unverified('variable-prices')};
  if(p.is_purchasable === false) return {...out, ...unverified('not-purchasable')};
  return {...out, ...decide(cents(pr.regular_price), cents(pr.price))};
}

/** Όλα τα προϊόντα, σελίδα-σελίδα. (Χωρίς orderby/order: το τείχος προστασίας του Toolcase απαντά 403 σε αυτές τις παραμέτρους.) */
export async function* wooItems({base, path = '/wp-json/wc/store/v1/products', fetcher, perPage = 100, maxPages = 600}){
  for(let page = 1; page <= maxPages; page++){
    const r = await fetcher.get(`${base}${path}?per_page=${perPage}&page=${page}`, {accept: 'application/json', allowStatus: [200, 400, 404]});
    if(r.status !== 200) return;
    let list; try { list = JSON.parse(r.body); } catch { throw new Error(`μη έγκυρο JSON στη σελίδα ${page}`); }
    if(!Array.isArray(list) || !list.length) return;
    for(const p of list) yield wooItem(p, base);
    const total = Number(r.wpTotalPages);
    if((total && page >= total) || list.length < perPage) return;
  }
}
