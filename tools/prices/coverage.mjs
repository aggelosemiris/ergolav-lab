// Ανάλυση κάλυψης τιμών ΧΩΡΙΣ βάση: για κάθε είδος του καταλόγου, τι βρέθηκε σε κάθε προμηθευτή, και για όσα δεν έχουν
// επαληθευμένη τιμή αναφοράς, τα κοντινότερα προϊόντα και γιατί δεν ταίριαξαν. Διαβάζει τα προϊόντα των προμηθευτών από
// την cache του fetcher (μία εκτέλεση του run.mjs πριν = 0 νέα αιτήματα) και δεν γράφει πουθενά εκτός από την αναφορά.
//
//   node tools/prices/coverage.mjs --cache <φάκελος> [--v2] [--out αναφορά.md] [--json αποτελέσματα.json]
//   --v2: με τις νέες λίστες υλικών (συνώνυμα/παραλλαγές) — ό,τι θα έκανε το MATERIALS_V2_ENABLED = true.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createFetcher } from './fetch.mjs';
import { activeSuppliers } from './suppliers.mjs';
import { buildInventory, indexItems, offersFor } from './engine.mjs';
import { catalogProducts } from '../../src/price-rules.js';
import { matchItem, reference, wordsOf } from '../../src/price-match.js';

const hasRoot = (words, r) => words.some(s => s === r || (r.length >= 3 && s.startsWith(r)));
const eur = c => c == null ? '—' : (c / 100).toFixed(2).replace('.', ',') + ' €';

/** Τα προϊόντα κάθε ενεργού προμηθευτή (από cache όπου υπάρχει). */
export async function loadItems({suppliers, fetcher, log = () => {}}){
  const out = {};
  await Promise.all(suppliers.filter(s => s.enabled !== false).map(async s => {
    const items = [];
    try { for await (const it of s.items({fetcher, supplier: s, log})) items.push(it); }
    catch(e){ log(`${s.id}: ${e.message}`); }
    out[s.id] = items;
  }));
  return out;
}

/**
 * Η κάλυψη: [{entry, status, ref, offers, nearest}] για κάθε προϊόν λιανικής του καταλόγου.
 * status: verified (επαληθευμένη τιμή αναφοράς) · single (επαληθευμένη τιμή από 1 μόνο προμηθευτή) ·
 *         unverified (ταίριαξαν προϊόντα αλλά χωρίς επαληθευμένη τιμή) · none (τίποτα δεν ταίριαξε).
 */
export function coverage({itemsBySupplier, suppliers, v2 = false, nearestN = 3}){
  const inventory = buildInventory({catalog: catalogProducts(undefined, {v2})}).filter(e => e.source === 'catalog');
  const sups = suppliers.filter(s => itemsBySupplier[s.id]?.length).map(s => ({...s, vatIncluded: true}));
  const idx = Object.fromEntries(sups.map(s => [s.id, indexItems(itemsBySupplier[s.id])]));
  const words = Object.fromEntries(sups.map(s => [s.id, itemsBySupplier[s.id].map(it => wordsOf(`${it.name} ${it.brand ?? ''}`))]));
  return inventory.map(e => {
    if(e.kind !== 'product') return {entry: e, status: 'not-applicable', offers: [], nearest: []};
    const offers = sups.flatMap(s => offersFor(e, s, itemsBySupplier[s.id], idx[s.id]));
    const verified = offers.filter(o => o.verification === 'verified');
    const ref = reference(verified.map(o => ({supplier: o.supplier_id, cents: o.unit_cents, method: o.match_method})));
    const status = ref.status === 'verified' ? 'verified' : ref.n === 1 ? 'single' : offers.length ? 'unverified' : 'none';
    let nearest = [];
    if(status !== 'verified'){
      // Κοντινότερα: όσα έχουν τις περισσότερες ρίζες της προδιαγραφής (all + any), με τον λόγο που τα απέρριψε ο matcher.
      const roots = [...e.spec.all, ...(e.spec.any || [])];
      const scored = [];
      for(const s of sups) itemsBySupplier[s.id].forEach((it, i) => {
        const w = words[s.id][i], score = roots.filter(r => hasRoot(w, r)).length;
        if(score >= Math.max(1, Math.ceil(roots.length / 2))) scored.push({supplier: s.id, name: it.name, score, cents: it.regularCents ?? it.currentCents ?? null,
          verification: it.verification, reason: matchItem(e.spec, it).reason || (it.verification !== 'verified' ? it.reason : 'ok')});
      });
      nearest = scored.sort((a, b) => b.score - a.score || (a.reason === 'ok' ? -1 : 0)).slice(0, nearestN);
    }
    return {entry: e, status, ref, offers, nearest};
  });
}

export function counts(rows){
  const c = {total: rows.length, product: 0, verified: 0, single: 0, unverified: 0, none: 0, notApplicable: 0};
  for(const r of rows) r.status === 'not-applicable' ? c.notApplicable++ : (c.product++, c[r.status]++);
  return c;
}

export function markdown(rows, {title = 'Κάλυψη τιμών', v2 = false} = {}){
  const c = counts(rows), L = [`# ${title}${v2 ? ' (νέες λίστες, MATERIALS_V2)' : ''}`, ''];
  L.push(`Είδη καταλόγου ${c.total} · λιανικής ${c.product} · **επαληθευμένη τιμή αναφοράς ${c.verified} (${Math.round(100 * c.verified / c.product)}%)** · ` +
    `1 προμηθευτής ${c.single} · μόνο μη επαληθευμένα ${c.unverified} · τίποτα ${c.none} · εκτός (υπηρεσία/ανά τ.μ.) ${c.notApplicable}.`, '');
  L.push('| Είδος | Κατάσταση | Αναφορά | Ταίριαξαν (επαλ./σύνολο) | Κοντινότερο προϊόν → γιατί όχι |', '|---|---|---|---|---|');
  const label = {verified: '✅ επαληθευμένη', single: '◐ 1 προμηθευτής', unverified: '○ μη επαληθευμένα', none: '✗ τίποτα', 'not-applicable': '— εκτός'};
  for(const r of rows){
    const v = r.offers.filter(o => o.verification === 'verified');
    const why = r.offers.filter(o => o.verification !== 'verified').reduce((a, o) => (a[o.verification_reason || o.verification] = (a[o.verification_reason || o.verification] || 0) + 1, a), {});
    const near = r.nearest.map(n => `${n.supplier}: «${n.name.slice(0, 60)}» ${eur(n.cents)} → ${n.reason}`).join('<br>');
    L.push(`| ${r.entry.name.replace(/\|/g, '/')} | ${label[r.status]} | ${eur(r.ref?.cents)} | ${v.length}/${r.offers.length}${Object.keys(why).length ? ' (' + Object.entries(why).map(([k, n]) => `${k} ${n}`).join(', ') + ')' : ''} | ${near.replace(/\|/g, '/')} |`);
  }
  return L.join('\n') + '\n';
}

if(path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)){
  const args = process.argv.slice(2), opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
  const v2 = args.includes('--v2');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fetcher = createFetcher({cacheDir: opt('--cache', path.join(here, '.cache')), log: m => console.error(m)});
  const suppliers = activeSuppliers({v2});
  const itemsBySupplier = await loadItems({suppliers, fetcher, log: m => console.error(m)});
  const rows = coverage({itemsBySupplier, suppliers, v2});
  console.log(JSON.stringify({v2, ...counts(rows), requests: fetcher.stats.requests, cached: fetcher.stats.cached}));
  if(opt('--out')) fs.writeFileSync(opt('--out'), markdown(rows, {v2}));
  if(opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(rows.map(r => ({ref: r.entry.catalogRef, name: r.entry.name, status: r.status,
    cents: r.ref?.cents ?? null, suppliers: r.ref?.suppliers ?? {}, nearest: r.nearest})), null, 1));
}
