// Adapters για προμηθευτές χωρίς δομημένη ροή: διαβάζουν τις κάρτες προϊόντων των σελίδων κατηγορίας με σταθερούς
// κανόνες πάνω στη συγκεκριμένη σήμανση κάθε site (όχι γενική «μαντεψιά» τιμής).
import { decode, decide, eurToCents, unverified } from './common.mjs';

// ── Vrontinos ───────────────────────────────────────────────────────────────
// Κάρτα: <a href="/el/Product/ID.aspx">Όνομα</a> … <span class="product-tile-net-price">199,00 €</span>
// <span class="product-tile-final-price">169,15 €</span>. Με μία τιμή (final): αυτή είναι η τιμή του προϊόντος, χωρίς
// ένδειξη προσφοράς → κανονική. Με δύο τιμές: το site δεν ονομάζει ρητά την πρώτη «αρχική/κανονική» (η κλάση λέει «net»,
// που μπορεί να σημαίνει και «χωρίς ΦΠΑ») → μη επαληθευμένο. Δεν υπολογίζουμε κανονική από την προσφορά.
const VRONT = 'https://vrontinos.gr';
export function parseVrontinos(html){
  const out = [];
  for(const part of html.split('class="product-tile"').slice(1)){
    const a = part.match(/<div class="product-tile-title[^"]*">\s*<a href="(\/el\/Product\/([0-9A-Fa-f]{8})\.aspx)">([\s\S]*?)<\/a>/);
    if(!a) continue;
    const net = part.match(/product-tile-net-price">([^<]*)</)?.[1], fin = part.match(/product-tile-final-price">([^<]*)</)?.[1];
    const base = {id: a[2].toUpperCase(), sku: null, gtin: null, name: decode(a[3]), brand: null, url: VRONT + a[1], unit: null};
    const f = eurToCents(fin);
    if(net != null) out.push({...base, ...unverified('two-prices-without-label', {currentCents: f, promo: true})});
    else out.push({...base, ...(f ? {regularCents: f, currentCents: f, promo: false, verification: 'verified', reason: null} : unverified('no-price'))});
  }
  return out;
}
// Μόνο η πρώτη σελίδα κάθε ρυθμισμένης κατηγορίας, ΧΩΡΙΣ παραμέτρους: το site απαντά 403 στη σελιδοποίηση
// (?pagesize=…&splitter_products_offset=…) όταν τη ζητά bot — δεν την παρακάμπτουμε. (Οι υποκατηγορίες υπάρχουν μόνο
// στο γενικό μενού του site, ανάμεσα σε άσχετες· για να μπουν, προστίθενται ρητά στο suppliers.mjs.)
export async function* vrontinosItems({fetcher, categories, log = () => {}}){
  const seen = new Set();
  for(const cat of categories){
    let r;
    try { r = await fetcher.get(`${VRONT}/el/ProductCategory/${cat}.aspx`); }
    catch(e){ if(e.name === 'Blocked') throw e; log(`vrontinos: ${cat}: ${e.message}`); continue; }
    for(const it of parseVrontinos(r.body)) if(!seen.has(it.id)){ seen.add(it.id); yield it; }
  }
}

// ── Magento (Meidanis) ──────────────────────────────────────────────────────
// Κάρτα li.product-item: <a class="product-item-link" href="…">Όνομα</a> και κουτί τιμής με
// data-price-amount="…" data-price-type="oldPrice" (ρητή αρχική/κανονική) και "finalPrice" (τρέχουσα).
// Οι τιμές είναι με ΦΠΑ (price-including-tax). Χωρίς oldPrice: η finalPrice είναι η κανονική.
export function parseMagento(html){
  const out = [];
  for(const part of html.split(/class="product-item-info"/).slice(1)){
    const a = part.match(/<a[^>]*class="product-item-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) ||
              part.match(/<a[^>]*href="([^"]+)"[^>]*class="product-item-link"[^>]*>([\s\S]*?)<\/a>/);
    if(!a) continue;
    const amount = type => { const m = part.match(new RegExp(`data-price-amount="([\\d.]+)"\\s+data-price-type="${type}"`)); return m ? Math.round(Number(m[1]) * 100) : null; };
    const old = amount('oldPrice'), fin = amount('finalPrice');
    const id = part.match(/data-product-id="(\d+)"/)?.[1] || a[1];
    out.push({id: String(id), sku: null, gtin: null, name: decode(a[2]), brand: null, url: a[1], unit: null, ...decide(old ?? fin, fin)});
  }
  return out;
}
export async function* magentoItems({fetcher, categories, maxPages = 80, log = () => {}}){
  const seen = new Set();
  for(const url of categories){
    for(let page = 1; page <= maxPages; page++){
      let r;
      try { r = await fetcher.get(page > 1 ? `${url}?p=${page}` : url); }
      catch(e){ if(e.name === 'Blocked') throw e; log(`magento: ${url} σελίδα ${page}: ${e.message}`); break; }
      const items = parseMagento(r.body), fresh = items.filter(it => !seen.has(it.id));
      for(const it of fresh){ seen.add(it.id); yield it; }
      if(!fresh.length || !/class="action\s+next"/.test(r.body)) break;
    }
  }
}
