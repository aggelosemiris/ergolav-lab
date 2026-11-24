// Adapters σελίδων κατηγορίας για προμηθευτές ειδικοτήτων χωρίς δομημένη ροή (όλοι ΑΠΕΝΕΡΓΟΠΟΙΗΜΕΝΟΙ: suppliers.mjs).
// Σταθεροί κανόνες πάνω στη σήμανση κάθε πλατφόρμας, όχι γενική «μαντεψιά» τιμής. Κανονική τιμή ΜΟΝΟ όταν το site τη
// δηλώνει ρητά (διαγραμμένη αρχική ή μοναδική τιμή χωρίς ένδειξη προσφοράς). Ίδιος fetcher με τους υπόλοιπους:
// ergolav-price-bot, robots.txt, ένα αίτημα κάθε 2″ ανά site, cache 6 ημερών. Η σελιδοποίηση γίνεται μόνο αν την επιτρέπει
// το robots.txt (ο fetcher το ελέγχει σε κάθε αίτημα· αν απαγορεύεται, σταματά η κατηγορία, χωρίς παράκαμψη).
import { decode, decide, eurToCents, unverified } from './common.mjs';

const amounts = html => [...String(html).matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})/g)].map(m => eurToCents(m[1]));
const abs = (base, href) => { try { return new URL(decode(href), base).href; } catch { return null; } };

// ── WooCommerce χωρίς Store API (HTML) ─────────────────────────────────────────────────────────────────────────────
// Κάρτα: …type-product…> … <a href="…">Όνομα</a> (τίτλος) … <span class="price"> με <del> (αρχική) + <ins> (τρέχουσα),
// ή μία τιμή. Εύρος τιμών «13,50 € – 32,00 €» (μεταβλητό προϊόν) → μη επαληθευμένο. Κενή τιμή → παράλειψη.
export function parseWooHtml(html, base){
  const out = [];
  for(const part of String(html).split(/<(?:li|div)\b[^>]*class="[^"]*\btype-product\b/).slice(1)){
    const t = part.match(/class="(?:woocommerce-loop-product__title|wd-entities-title|product-title|name product-title)[^"]*"[^>]*>\s*(?:<a[^>]*href="([^"]+)"[^>]*>)?([\s\S]*?)<\/(?:a|h2|h3|p)>/);
    const link = part.match(/<a[^>]+href="([^"]+\/product\/[^"]+)"/)?.[1];
    if(!t) continue;
    const url = abs(base, t[1] || link || ''), name = decode(t[2]);
    const id = part.match(/\bpost-(\d+)\b/)?.[1] || url;
    if(!name || !id) continue;
    const price = part.match(/<span class="price">([\s\S]*?)<\/span>\s*(?:<\/span>|<\/div>|<span class="(?!woocommerce))/)?.[1] ??
                  part.match(/<span class="price">([\s\S]*?)<\/div>/)?.[1] ?? '';
    const base_ = {id: String(id), sku: null, gtin: null, name, brand: null, url, unit: null};
    if(!/woocommerce-Price-amount/.test(price)) continue;               // χωρίς τιμή στη λίστα
    const del = price.match(/<del[^>]*>([\s\S]*?)<\/del>/)?.[1], ins = price.match(/<ins[^>]*>([\s\S]*?)<\/ins>/)?.[1];
    if(del && ins){ out.push({...base_, ...decide(amounts(del)[0], amounts(ins)[0])}); continue; }
    const a = amounts(price.replace(/<span class="screen-reader-text">[\s\S]*?<\/span>/g, '')).filter(Boolean);
    out.push({...base_, ...(a.length === 1 ? decide(a[0], a[0]) : unverified(a.length > 1 ? 'price-range' : 'no-price', {currentCents: a[0] ?? null}))});
  }
  return out;
}
export async function* wooHtmlItems({fetcher, base, categories, maxPages = 30, log = () => {}}){
  const seen = new Set();
  for(const cat of categories){
    for(let page = 1; page <= maxPages; page++){
      const url = new URL(page > 1 ? `${cat.replace(/\/$/, '')}/page/${page}/` : cat, base).href;
      let r;
      try { r = await fetcher.get(url); } catch(e){ if(e.name === 'Blocked') throw e; log(`woo-html: ${url}: ${e.message}`); break; }
      if(r.status !== 200) break;
      const fresh = parseWooHtml(r.body, base).filter(it => !seen.has(it.id));
      for(const it of fresh){ seen.add(it.id); yield it; }
      if(!fresh.length || !new RegExp(`/page/${page + 1}/`).test(r.body)) break;
    }
  }
}

// ── OpenCart με θέμα Journal3 (palousis, e-plakakia) ───────────────────────────────────────────────────────────────
// Κάρτα .product-thumb: <div class="name"><a href="…">Όνομα</a> και <span class="price-normal">486,00€</span> (χωρίς
// προσφορά) ή <span class="price-new">…</span> <span class="price-old">…</span> (ρητή αρχική). Τιμές με ΦΠΑ.
export function parseJournal(html, base){
  const out = [];
  for(const part of String(html).split(/<div class="product-thumb\b/).slice(1)){
    const a = part.match(/<div class="name">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if(!a) continue;
    const url = abs(base, a[1]), id = decode(a[1]).match(/product_id=(\d+)/)?.[1] || url;
    const normal = part.match(/class="price-normal">([^<]*)</)?.[1], nw = part.match(/class="price-new">([^<]*)</)?.[1], old = part.match(/class="price-old">([^<]*)</)?.[1];
    const it = {id: String(id), sku: null, gtin: null, name: decode(a[2]), brand: null, url, unit: null};
    if(nw != null && old != null) out.push({...it, ...decide(eurToCents(old), eurToCents(nw))});
    else if(normal != null){ const c = eurToCents(normal); out.push({...it, ...(c ? decide(c, c) : unverified('no-price'))}); }
  }
  return out;
}
export async function* journalItems({fetcher, base, categories, maxPages = 30, log = () => {}}){
  const seen = new Set();
  for(const cat of categories){
    for(let page = 1; page <= maxPages; page++){
      const u = new URL(cat, base); if(page > 1) u.searchParams.set('page', String(page));
      let r;
      try { r = await fetcher.get(u.href); } catch(e){ if(e.name === 'Blocked') throw e; log(`journal: ${u.href}: ${e.message}`); break; }
      if(r.status !== 200) break;
      const fresh = parseJournal(r.body, base).filter(it => !seen.has(it.id));
      for(const it of fresh){ seen.add(it.id); yield it; }
      if(!fresh.length || !/[?&](?:amp;)?page=\d+/.test(r.body) || !r.body.includes(`page=${page + 1}`)) break;
    }
  }
}

// ── PrestaShop (kaxirismonotika) ──────────────────────────────────────────────────────────────────────────────────
// Κάρτα <article class="product-miniature … data-id-product="…">: όνομα στο product-title/product--hover-title,
// <span class="product-price" content="52.34"> (τρέχουσα) και, σε προσφορά, <span class="regular-price">…</span>.
export function parsePresta(html){
  const out = [];
  for(const part of String(html).split(/<article\s+class="product-miniature\b/).slice(1)){
    const id = part.match(/data-id-product="(\d+)"/)?.[1];
    const a = part.match(/class="product--hover-title">([\s\S]*?)<\/a>/) && part.match(/<a href="([^"]+)" class="product--hover-title">([\s\S]*?)<\/a>/) ||
              part.match(/class="product-title"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if(!id || !a) continue;
    const cur = part.match(/class="product-price"[^>]*content="([\d.]+)"/)?.[1], reg = part.match(/class="regular-price"[^>]*>([^<]*)</)?.[1];
    const c = cur ? Math.round(Number(cur) * 100) : null;
    const it = {id, sku: null, gtin: null, name: decode(a[2]), brand: null, url: decode(a[1]), unit: null};
    if(!(c > 0)){ out.push({...it, ...unverified('no-price')}); continue; }
    out.push({...it, ...(reg != null ? decide(eurToCents(reg), c) : decide(c, c))});
  }
  return out;
}
export async function* prestaItems({fetcher, base, categories, maxPages = 30, log = () => {}}){
  const seen = new Set();
  for(const cat of categories){
    for(let page = 1; page <= maxPages; page++){
      const u = new URL(cat, base); if(page > 1) u.searchParams.set('page', String(page));
      let r;
      try { r = await fetcher.get(u.href); } catch(e){ if(e.name === 'Blocked') throw e; log(`presta: ${u.href}: ${e.message}`); break; }
      if(r.status !== 200) break;
      const fresh = parsePresta(r.body).filter(it => !seen.has(it.id));
      for(const it of fresh){ seen.add(it.id); yield it; }
      if(!fresh.length || !/rel="next"/.test(r.body)) break;
    }
  }
}

// ── e-shop.gr (ISO-8859-7· ο fetcher αποκωδικοποιεί) ──────────────────────────────────────────────────────────────
// Λίστα: <a href="…-p-XXX.123" class="web-title-link"><b>Όνομα</b></a> και τιμή «59.50 €». Σε προσφορά γράφει
// «ΠΤΛ 59.50 € … MONO 39.90 €»: ΠΤΛ = προτεινόμενη τιμή λιανικής του κατασκευαστή, ΟΧΙ η κανονική του καταστήματος → μη
// επαληθευμένο. Μόνο η 1η σελίδα κατηγορίας (το robots.txt κλείνει το offset).
export function parseEshop(html){
  const out = [], seen = new Set();
  const re = /<a href="(https:\/\/www\.e-shop\.gr\/[^"]+-p-([A-Z]{3}\.\d+))" class="web-title-link"><b>([\s\S]*?)<\/b><\/a>((?:(?!<a href="https:\/\/www\.e-shop\.gr\/[^"]+-p-[A-Z]{3}\.\d+" class="web-title-link")[\s\S]){0,1200})/g;
  for(const m of String(html).matchAll(re)){
    if(seen.has(m[2])) continue; seen.add(m[2]);
    const tail = m[4], it = {id: m[2], sku: null, gtin: null, name: decode(m[3]), brand: null, url: m[1], unit: null};
    const rrp = /ΠΤΛ/.test(tail), mono = tail.match(/MONO(?:&nbsp;|\s)*([\d.]+)(?:&nbsp;|\s)*&euro;/)?.[1];
    const one = tail.match(/(\d+\.\d{2})(?:<\/b>)?(?:&nbsp;|\s)*&euro;/)?.[1];
    if(rrp || mono) out.push({...it, ...unverified('rrp-not-regular', {currentCents: eurToCents(mono ?? one), promo: true})});
    else out.push({...it, ...(one ? decide(eurToCents(one), eurToCents(one)) : unverified('no-price'))});
  }
  return out;
}
export async function* eshopItems({fetcher, categories, log = () => {}}){
  const seen = new Set();
  for(const cat of categories){
    let r;
    try { r = await fetcher.get(new URL(cat, 'https://www.e-shop.gr/').href); }
    catch(e){ if(e.name === 'Blocked') throw e; log(`e-shop: ${cat}: ${e.message}`); continue; }
    for(const it of parseEshop(r.body)) if(!seen.has(it.id)){ seen.add(it.id); yield it; }
  }
}
