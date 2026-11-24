// Τιμές για ΟΛΕΣ τις παραλλαγές των λιστών υλικών (data/materials.json) → src/material-prices.json (μικρό, για το κινητό,
// διαβάζεται ΜΟΝΟ με MATERIALS_V2_ENABLED) + αναφορά κάλυψης ανά ειδικότητα. ΔΕΝ γράφει στη βάση και ΔΕΝ είναι μέρος της
// εβδομαδιαίας εκτέλεσης (prices.yml): τρέχει με το χέρι, πάνω στην cache του fetcher (ίδιος bot, robots.txt, 2″/site).
//
//   node tools/prices/materials-prices.mjs --cache <φάκελος> [--out src/material-prices.json] [--report <αρχείο.md>]
//                                          [--with-specialists]   (+ οι απενεργοποιημένοι προμηθευτές ειδικοτήτων, ΜΟΝΟ στην αναφορά)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createFetcher } from './fetch.mjs';
import { activeSuppliers, SPECIALISTS } from './suppliers.mjs';
import { indexItems } from './engine.mjs';
import { loadItems } from './coverage.mjs';
import { matchItem } from '../../src/price-match.js';
import { variantProducts, unitPriceMaterial, materialReference, compactPrices } from '../../src/material-prices.js';

const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(here, '..', '..');

/** Οι υποψήφιοι μιας παραλλαγής: πρόθεμα της μεγαλύτερης λέξης του είδους και κάθε συνωνύμου. */
function candidates(spec, idx){
  const out = new Set();
  for(const set of [spec.all, ...spec.allAlt]){
    if(!set.length) continue;
    const r = [...set].sort((a, b) => b.length - a.length)[0];
    for(const i of idx.byPrefix.get(r.slice(0, 3)) || []) out.add(i);
  }
  return out;
}

/** Τιμολόγηση: [{product, ref, offers, why}] για κάθε παραλλαγή. itemsBySupplier: {id: [items]}. */
export function priceMaterials({materials, itemsBySupplier}){
  const products = variantProducts(materials);
  const sups = Object.entries(itemsBySupplier).filter(([, items]) => items.length).map(([id, items]) => ({id, items, idx: indexItems(items)}));
  return products.map(p => {
    if(p.skip) return {product: p, ref: null, offers: [], why: p.skip};
    const offers = [], why = {};
    for(const s of sups) for(const i of candidates(p.spec, s.idx)){
      const it = s.items[i], m = matchItem(p.spec, it);
      if(!m.ok) continue;
      if(it.verification !== 'verified'){ why[it.reason || 'unverified'] = (why[it.reason || 'unverified'] || 0) + 1; continue; }
      const u = unitPriceMaterial(p, {name: it.name, regularCents: it.regularCents, vatIncluded: true, unit: it.unit, unitPriceCents: it.unitPriceCents, unitPriceUnit: it.unitPriceUnit});
      if(u.error){ why[u.error] = (why[u.error] || 0) + 1; continue; }
      offers.push({supplier: s.id, id: String(it.id), name: it.name, cents: u.cents});
    }
    const ref = offers.length ? materialReference(offers) : null;
    return {product: p, ref, offers, why: ref ? (ref.verified ? null : 'insufficient') : Object.keys(why).length ? Object.entries(why).sort((a, b) => b[1] - a[1])[0][0] : 'no-match'};
  });
}

export function report({rows, extra = null, materials, at, suppliers}){
  const trades = materials.trades.map(t => ({id: t.id, name: t.name}));
  const count = (list, trade) => {
    const r = list.filter(x => x.product.trade === trade);
    const priceable = r.filter(x => !x.product.skip);
    return {all: r.length, priceable: priceable.length, verified: r.filter(x => x.ref?.verified).length, one: r.filter(x => x.ref && !x.ref.verified).length};
  };
  const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '—';
  const L = [`# Τιμές για όλες τις παραλλαγές των λιστών υλικών (${at})`, '',
    'Πηγή: `data/materials.json`. Εργαλείο: `node tools/prices/materials-prices.mjs` (χωρίς βάση, πάνω στην cache του fetcher).',
    `Προμηθευτές της εβδομαδιαίας εκτέλεσης (με v2): ${suppliers.join(', ')}.`, '',
    '**Κανόνες** (ίδιοι με την εβδομαδιαία εκτέλεση): μόνο ρητή κανονική τιμή (όχι προσφορά)· σωστή μονάδα και συσκευασία (π.χ. «25kg» → ανά',
    'κιλό, «4m» → ανά μέτρο), αλλιώς τίποτα· **επαληθευμένη = ≥ 2 προμηθευτές ή ≥ 3 διαφορετικά προϊόντα**· τιμή = διάμεσος· χωρίς ΦΠΑ·',
    `ημερομηνία ${at}. Επειδή οι λίστες δεν έχουν τιμή καταλόγου, όσες απέχουν > ×3 από τον διάμεσο δεν μετρούν.`,
    'Δεν τιμολογούνται: παραλλαγές με εύρος («2 έως 12 εξόδων», «6A–40A»: δεν λένε ένα προϊόν) και μονάδες κ.μ./τόνος.', '',
    `| Ειδικότητα | Παραλλαγές | Τιμολογήσιμες | **Επαληθευμένη τιμή** | 1 προμηθευτής/λίγα προϊόντα |${extra ? ' Με τους προμηθευτές ειδικοτήτων (απενεργ., μόνο δοκιμή) |' : ''}`,
    `|---|---|---|---|---|${extra ? '---|' : ''}`];
  const tot = {all: 0, priceable: 0, verified: 0, one: 0, ex: 0};
  for(const t of trades){
    const c = count(rows, t.id), e = extra ? count(extra, t.id) : null;
    for(const k of ['all', 'priceable', 'verified', 'one']) tot[k] += c[k]; if(e) tot.ex += e.verified;
    L.push(`| ${t.name} | ${c.all} | ${c.priceable} | **${c.verified}** (${pct(c.verified, c.all)}) | ${c.one} |${e ? ` ${e.verified} (${pct(e.verified, e.all)}) |` : ''}`);
  }
  L.push(`| **Σύνολο** | **${tot.all}** | ${tot.priceable} | **${tot.verified}** (${pct(tot.verified, tot.all)}) | ${tot.one} |${extra ? ` **${tot.ex}** (${pct(tot.ex, tot.all)}) |` : ''}`, '');
  const why = {};
  for(const r of rows) if(!r.ref?.verified) why[r.why] = (why[r.why] || 0) + 1;
  const LABEL = {'no-match': 'κανένα προϊόν δεν ταιριάζει με βεβαιότητα', insufficient: 'βρέθηκε, αλλά < 2 προμηθευτές και < 3 προϊόντα',
    'range-variant': 'παραλλαγή με εύρος (δεν λέει ένα προϊόν)', 'not-retail-unit': 'μονάδα κ.μ./τόνος (δεν πωλείται λιανική)',
    'pack-length-unknown': 'πωλείται σε συσκευασία χωρίς ρητό μήκος', 'pack-kg-unknown': 'χωρίς ρητό βάρος συσκευασίας', 'pack-l-unknown': 'χωρίς ρητό όγκο συσκευασίας',
    'unit-mismatch': 'ο προμηθευτής δεν λέει τη μονάδα (π.χ. τ.μ. ή κουτί)', 'pack-ambiguous': 'αμφίσημο πλήθος συσκευασίας', 'bag-without-weight': 'σακί χωρίς βάρος στην παραλλαγή',
    'two-prices-without-label': 'δύο τιμές χωρίς ετικέτα', 'promo-without-original': 'προσφορά χωρίς ρητή αρχική', 'rrp-not-regular': 'μόνο ΠΤΛ κατασκευαστή'};
  L.push('## Γιατί δεν βγήκε τιμή', '', '| Λόγος | Παραλλαγές |', '|---|---|',
    ...Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${LABEL[k] || k} | ${n} |`), '');
  return L.join('\n') + '\n';
}

if(path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)){
  const args = process.argv.slice(2), opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
  const at = new Date().toISOString().slice(0, 10);
  const materials = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'materials.json'), 'utf8'));
  const fetcher = createFetcher({cacheDir: opt('--cache', path.join(here, '.cache')), log: m => console.error(m)});
  const suppliers = activeSuppliers({v2: true});
  const items = await loadItems({suppliers, fetcher, log: m => console.error(m)});
  const rows = priceMaterials({materials, itemsBySupplier: items});
  let extra = null;
  if(args.includes('--with-specialists')){
    const spec = SPECIALISTS.filter(s => typeof s.items === 'function').map(s => ({...s, enabled: true}));   // μόνο για την αναφορά
    const more = await loadItems({suppliers: spec, fetcher, log: m => console.error(m)});
    extra = priceMaterials({materials, itemsBySupplier: {...items, ...more}});
  }
  const json = compactPrices(rows, at);
  fs.writeFileSync(opt('--out', path.join(ROOT, 'src', 'material-prices.json')), JSON.stringify(json) + '\n');
  const rep = report({rows, extra, materials, at, suppliers: suppliers.filter(s => s.enabled !== false).map(s => s.id)});
  if(opt('--report')) fs.writeFileSync(opt('--report'), rep);
  if(opt('--detail')) fs.writeFileSync(opt('--detail'), JSON.stringify(rows.map(r => ({key: r.product.key, trade: r.product.trade, ref: r.ref, why: r.why,
    offers: r.offers.slice(0, 6).map(o => [o.supplier, o.cents, o.name])}))));
  const v = rows.filter(r => r.ref?.verified).length;
  console.log(JSON.stringify({variants: rows.length, verified: v, withSpecialists: extra ? extra.filter(r => r.ref?.verified).length : null,
    bytes: JSON.stringify(json).length, requests: fetcher.stats.requests, cached: fetcher.stats.cached}));
}
