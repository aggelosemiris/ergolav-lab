// Praktiker: τα δεδομένα των σελίδων κατηγορίας (/<διαδρομή>?page=N, π.χ. /solines-exartimata) έχουν για κάθε προϊόν price (κανονική), special_price
// (προσφορά), is_strikethrough (η κανονική εμφανίζεται διαγραμμένη) και is_killer_price.
// ΠΡΟΣΟΧΗ: το JSON-LD της σελίδας προϊόντος δείχνει την ΤΡΕΧΟΥΣΑ τιμή (που μπορεί να είναι προσφορά) — δεν το χρησιμοποιούμε.
// Κανόνες: χωρίς special → κανονική = price· special < price ΚΑΙ διαγραμμένη → κανονική = price (ρητή), promo·
// special χωρίς διαγραμμένη κανονική ή «killer price» → μη επαληθευμένο.
import { decode, unverified } from './common.mjs';

const BASE = 'https://www.praktiker.gr';
const str = (o, k) => { const m = o.match(new RegExp(`(?:^|[,{])${k}:"((?:[^"\\\\]|\\\\.)*)"`)); return m ? JSON.parse(`"${m[1]}"`) : null; };
const val = (o, k) => { const m = o.match(new RegExp(`(?:^|[,{])${k}:([^,}\\]]+)`)); return m ? m[1] : null; };
const numOrNull = v => v == null || v === 'null' || v === 'void 0' ? null : /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined;   // undefined = άγνωστη μεταβλητή
const cents = v => v > 0 ? Math.round(v * 100) : null;

/** Τα προϊόντα μιας σελίδας κατηγορίας. */
export function parseListing(html){
  const starts = [...html.matchAll(/\{id:(\d+),sku:"/g)].map(m => m.index);
  const out = [];
  for(let i = 0; i < starts.length; i++){
    const o = html.slice(starts[i], starts[i + 1] ?? starts[i] + 4000);
    const sku = str(o, 'sku'), name = str(o, 'name'), url = str(o, 'url_key');
    if(!sku || !name || !url) continue;
    const price = numOrNull(val(o, 'price')), special = numOrNull(val(o, 'special_price'));
    const strike = val(o, 'is_strikethrough') === 'true', killer = val(o, 'is_killer_price') === 'true';
    const altUnit = str(o, 'alternative_unit_singular'), alt = numOrNull(val(o, 'alternative_price'));
    const item = {id: sku, sku, gtin: null, name: decode(name), brand: (b => b && b !== '-' ? b : null)(str(o, 'brand')),
      url: `${BASE}/${url.replace(/^\/+/, '')}`, unit: str(o, 'base_unit'),
      unitPriceCents: altUnit && alt > 0 ? cents(alt) : null, unitPriceUnit: altUnit || null};
    let d;
    if(!(price > 0)) d = unverified('no-regular-price');
    else if(special === undefined) d = unverified('special-price-unknown');
    else if(special == null || special === 0 || special >= price) d = killer ? unverified('killer-price') : {regularCents: cents(price), currentCents: cents(price), promo: false, verification: 'verified', reason: null};
    else if(strike) d = {regularCents: cents(price), currentCents: cents(special), promo: true, verification: 'verified', reason: null};
    else d = unverified('promo-without-original', {currentCents: cents(special), promo: true});
    if(d.verification !== 'verified') item.unitPriceCents = null;   // alternative_price = κανονική τιμή ανά 2η μονάδα (π.χ. τ.μ.)
    out.push({...item, ...d});
  }
  return out;
}

/** Οι υποκατηγορίες (πρώτου επιπέδου) μιας ομάδας κατηγοριών /cg/<seed>, από το δέντρο που έχει κάθε σελίδα. */
export function groupChildren(html, seed){
  const at = html.indexOf(`url_path:"cg/${seed}"`);
  if(at < 0) return [];
  const open = html.indexOf('children:[', at);
  if(open < 0 || open - at > 2000) return [];
  const out = []; let depth = 0;
  for(let i = open + 'children:'.length; i < html.length; i++){
    const c = html[i];
    if(c === '[' || c === '{') depth++;
    else if(c === ']' || c === '}'){ depth--; if(depth === 0) break; }
    else if(depth === 2 && html.startsWith('url_path:"', i)){
      const end = html.indexOf('"', i + 10); const p = html.slice(i + 10, end);
      if(/^(?:c\/)?[a-z0-9-]+$/.test(p)) out.push(p);      // «solines-exartimata» (στη ρίζα) ή «c/…»
      i = end;
    }
  }
  return [...new Set(out)];
}
const totalCount = html => Number(html.match(/totalCount:(\d+)/)?.[1]) || null;
const pageSize = html => Number(html.match(/page_size:(\d+)/)?.[1]) || null;

export async function* praktikerItems({fetcher, seeds, maxPagesPerCategory = 60, log = () => {}}){
  const seen = new Set();
  for(const seed of seeds){
    let children = [];
    try { children = groupChildren((await fetcher.get(`${BASE}/cg/${seed}`)).body, seed); }
    catch(e){ if(e.name === 'Blocked') throw e; log(`praktiker: ομάδα ${seed}: ${e.message}`); continue; }
    for(const c of children){
      for(let page = 1; page <= maxPagesPerCategory; page++){
        let r;
        try { r = await fetcher.get(`${BASE}/${c}${page > 1 ? `?page=${page}` : ''}`); }   // η διαδρομή όπως τη δίνει το δέντρο
        catch(e){ if(e.name === 'Blocked') throw e; log(`praktiker: ${c} σελίδα ${page}: ${e.message}`); break; }
        if(r.status !== 200) break;
        const items = parseListing(r.body);
        for(const it of items) if(!seen.has(it.id)){ seen.add(it.id); yield it; }
        const total = totalCount(r.body), size = pageSize(r.body) || items.length;
        if(!items.length || !total || page * size >= total) break;
      }
    }
  }
}
