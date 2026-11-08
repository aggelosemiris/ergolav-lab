// Συλλογή ονομάτων υλικών (Φάση 2). Κρατά ΜΟΝΟ: site, url, κατηγορία, όνομα, μάρκα, μονάδα, τιμή, ημερομηνία, επάγγελμα.
// Όχι περιγραφές, όχι φωτογραφίες, όχι κείμενα.
// Χρήση: node tools/catalog/collect.mjs [siteId …]      (χωρίς ορίσματα: όλα τα sites)
// Έξοδος: data/raw/<site>.jsonl (ένα προϊόν ανά γραμμή) και data/raw/<site>.report.json
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {createFetcher, Blocked, Disallowed} from './fetcher.mjs';
import {SITES, TRADES} from './sites.mjs';
import {collectHtml} from './html-adapters.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = path.join(root, 'data/raw');
const TODAY = new Date().toISOString().slice(0, 10);
const logFile = path.join(root, 'data/cache/collect.log');
fs.mkdirSync(RAW, {recursive: true}); fs.mkdirSync(path.dirname(logFile), {recursive: true});
const log = m => { const line = `${new Date().toISOString()} ${m}`; console.error(line); fs.appendFileSync(logFile, line + '\n'); };
const fetcher = createFetcher({cacheDir: path.join(root, 'data/cache/pages'), log});
const platforms = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, 'data/cache/platforms.json'), 'utf8')).map(p => [p.id, p]));

// Κατηγορίες που μοιάζουν σχετικές αλλά δεν είναι ανακαίνιση σπιτιού (π.χ. «κλιματισμός αυτοκινήτων»).
const NOT_RENOVATION = /αυτοκιν|μοτοσυκλ|σκάφ|ένδυσ|υπόδησ|παιχν|καλλυντ|κατοικίδ|βιβλί|γραφικ(ή|ά) ύλ|κάμπινγκ|camping/i;

// Τα μενού γράφουν συχνά με κεφαλαία χωρίς τόνους («ΕΣΩΤΕΡΙΚΕΣ ΠΟΡΤΕΣ»): η σύγκριση γίνεται χωρίς τόνους και με σ αντί ς.
export const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
const NORM_TRADES = Object.fromEntries(Object.entries(TRADES).map(([k, t]) => [k, new RegExp(norm(t.re.source), 'i')]));
const NORM_NOT = new RegExp(norm(NOT_RENOVATION.source), 'i');

/** Επαγγέλματα που ταιριάζουν σε μια διαδρομή κατηγορίας (μόνο όσα καλύπτει το site). */
export function tradesFor(text, siteTrades){
  const t = norm(text);
  if(NORM_NOT.test(t)) return [];
  return siteTrades.filter(k => NORM_TRADES[k].test(t)).map(k => TRADES[k].name);
}

/** Μονάδα πώλησης όταν φαίνεται καθαρά στο όνομα ή στην ετικέτα τιμής· αλλιώς null. */
export function inferUnit(name, priceLabel = ''){
  const s = `${name} ${priceLabel}`.toLowerCase();
  if(/(\/|ανά\s*)(τ\.?\s?μ\.?|m2|m²|τετρ)/.test(s)) return 'τ.μ.';
  if(/(\/|ανά\s*)(μέτρο|μ\.|m\b|τρέχον)/.test(s)) return 'μ.';
  if(/\b\d+([.,]\d+)?\s?(kg|κιλ|κγρ)/.test(s)) return 'κιλά';
  if(/\b\d+([.,]\d+)?\s?(lt|l\b|λίτρ|λτ)/.test(s)) return 'λίτρα';
  if(/\b(ρολό|κουλούρα)\b.*\b\d+\s?(m|μ)\b/.test(s)) return 'μ.';
  return null;
}

const priceEur = (minor, unit = 2) => minor == null || minor === '' ? null : Math.round(Number(minor)) / 10 ** unit;
const stripTags = s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;/g, '–').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// ── WooCommerce Store API (δημόσιο product feed) ─────────────────────────────
async function wooCategories(base){
  const all = []; let page = 1, pages = 1;
  do{
    const r = await fetcher.get(`${base}/wp-json/wc/store/v1/products/categories?per_page=100&page=${page}`, {accept: 'application/json'});
    if(r.status !== 200) break;
    all.push(...JSON.parse(r.body)); pages = Number(r.wpTotalPages || 1); page++;
  } while(page <= pages);
  const byId = new Map(all.map(c => [c.id, {...c, name: stripTags(c.name)}]));
  const pathOf = c => { const p = []; let x = c, guard = 0; while(x && guard++ < 10){ p.unshift(x.name); x = byId.get(x.parent); } return p; };
  for(const c of byId.values()) c.path = pathOf(c);
  return byId;
}

async function collectWoo(site, out, report){
  const base = new URL(site.url).origin;
  const cats = await wooCategories(base);
  const relevant = c => tradesFor(c.path.join(' / '), site.trades).length > 0;
  // Κορυφαίες σχετικές κατηγορίες: σχετική, χωρίς σχετικό πρόγονο (τα παιδιά περιλαμβάνονται στο αίτημα).
  const top = [...cats.values()].filter(c => relevant(c) && !c.path.slice(0, -1).some((_, i) => { const anc = [...cats.values()].find(a => a.path.join('/') === c.path.slice(0, i + 1).join('/')); return anc && relevant(anc); }));
  report.categoriesTotal = cats.size; report.categoriesSelected = top.map(c => c.path.join(' / '));
  const seen = new Set();
  // Αν το robots.txt κλείνει το φίλτρο κατηγορίας (π.χ. «/*?category=»), όλα τα προϊόντα μαζί και φιλτράρισμα εδώ.
  const byCategory = top.length && await fetcher.robotsAllows(`${base}/wp-json/wc/store/v1/products?category=${top[0].id}&per_page=100&page=1`);
  const queries = byCategory ? top.map(c => ({c, q: `category=${c.id}&`})) : [{c: {path: ['(όλα τα προϊόντα, φιλτραρισμένα ανά κατηγορία)']}, q: ''}];
  if(!byCategory) report.errors.push('Το robots.txt κλείνει το φίλτρο κατηγορίας: διαβάστηκε όλο το feed και κρατήθηκαν οι σχετικές κατηγορίες.');
  for(const {c, q} of queries){
    const row = {category: c.path.join(' / '), siteTotal: null, found: 0, pages: 0};
    try{
      let page = 1, pages = 1;
      do{
        const r = await fetcher.get(`${base}/wp-json/wc/store/v1/products?${q}per_page=100&page=${page}`, {accept: 'application/json'});
        if(r.status !== 200){ row.error = `HTTP ${r.status}`; break; }
        if(page === 1) row.siteTotal = r.wpTotal != null ? Number(r.wpTotal) : null;
        pages = Number(r.wpTotalPages || 1); row.pages++;
        for(const p of JSON.parse(r.body)){
          row.found++;
          if(seen.has(p.id)) continue; seen.add(p.id);
          // Η βαθύτερη σχετική κατηγορία του προϊόντος δίνει τη διαδρομή.
          const pc = (p.categories || []).map(x => cats.get(x.id)).filter(Boolean).sort((a, b) => b.path.length - a.path.length);
          if(!byCategory && !pc.some(relevant)) continue;
          const best = pc.find(relevant) || c;
          const name = stripTags(p.name);
          const trade = tradesFor(best.path.join(' / ') + ' ' + name, site.trades);
          out.push({site: site.id, url: p.permalink, category_path: best.path, name,
            brand: (p.brands?.[0]?.name && stripTags(p.brands[0].name)) || null,
            unit: inferUnit(name, stripTags(p.prices?.price_suffix || '')),
            price_eur: p.prices?.price ? priceEur(p.prices.price, p.prices.currency_minor_unit) : null,
            price_date: p.prices?.price ? TODAY : null,
            trade: trade.length ? trade : tradesFor(best.path.join(' / '), site.trades)});
        }
        page++;
      } while(page <= pages);
    } catch(e){ row.error = e.name === 'Error' ? e.message : `${e.name}: ${e.message}`; if(e instanceof Blocked) { report.categories.push(row); throw e; } }
    report.categories.push(row);
  }
}

// ── κύρια ροή ─────────────────────────────────────────────────────────────────
async function collectSite(site){
  const out = [], report = {site: site.id, url: site.url, date: TODAY, method: null, categories: [], errors: []};
  const started = Date.now();
  try{
    const p = platforms[site.id] || {};
    if(p.storeApi && p.storeApiTotal !== 0){ report.method = 'WooCommerce Store API (δημόσιο feed)'; await collectWoo(site, out, report); }
    else { report.method = `σελίδες κατηγοριών (${p.platform || 'άγνωστη πλατφόρμα'})`; await collectHtml({site, platform: p.platform, fetcher, out, report, tradesFor, inferUnit, today: TODAY, log}); }
  } catch(e){
    report.errors.push(e instanceof Blocked ? `ΜΠΛΟΚΑΡΙΣΤΗΚΕ: ${e.message}` : e instanceof Disallowed ? `robots.txt: ${e.message}` : `${e.name}: ${e.message}`);
  }
  // Ένα προϊόν ανά URL.
  const uniq = [...new Map(out.map(x => [x.url, x])).values()];
  fs.writeFileSync(path.join(RAW, `${site.id}.jsonl`), uniq.map(x => JSON.stringify(x)).join('\n') + (uniq.length ? '\n' : ''));
  report.products = uniq.length; report.minutes = Math.round((Date.now() - started) / 600) / 100;
  report.byTrade = {}; for(const x of uniq) for(const t of x.trade) report.byTrade[t] = (report.byTrade[t] || 0) + 1;
  fs.writeFileSync(path.join(RAW, `${site.id}.report.json`), JSON.stringify(report, null, 1));
  log(`ΤΕΛΟΣ ${site.id}: ${uniq.length} προϊόντα, ${report.categories.length} κατηγορίες, ${report.errors.length} σφάλματα, ${report.minutes} λεπτά`);
}

if(import.meta.url === `file://${process.argv[1]}`){
  const ids = process.argv.slice(2);
  const todo = (ids.length ? SITES.filter(s => ids.includes(s.id)) : SITES)
    .map(s => process.env.MAX_CATEGORIES ? {...s, maxCategories: Number(process.env.MAX_CATEGORIES)} : s);   // μικρή δοκιμή
  log(`ΑΡΧΗ: ${todo.map(s => s.id).join(', ')}`);
  await Promise.all(todo.map(collectSite));
  log(`ΟΛΑ ΤΕΛΟΣ · αιτήματα ${fetcher.stats.requests}, από cache ${fetcher.stats.cached}, robots ${fetcher.stats.disallowed}`);
}
