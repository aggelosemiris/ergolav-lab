// Αναφορά της συλλογής (Φάση 2): σύνολα ανά site και ανά επάγγελμα, σύγκριση με τα σύνολα που δείχνει κάθε site,
// κατηγορίες που απέτυχαν. Χρήση: node tools/catalog/report.mjs  → data/reports/collection.md (+ collection-details.md)
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {SITES, TRADES} from './sites.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = path.join(root, 'data/raw'), OUT = path.join(root, 'data/reports');
fs.mkdirSync(OUT, {recursive: true});

// Sites που εγκρίθηκαν αλλά δεν συλλέχθηκαν (και γιατί).
const NOT_COLLECTED = {
  'ergo-tel': 'Απάντησε 503 στο bot μας (μπλοκάρισμα) — σταματήσαμε.',
  'e-shop': 'Οι τιμές και τα προϊόντα των σχετικών κατηγοριών φορτώνουν με JavaScript· η σχετική γκάμα (ηλεκτρολογικά/κλιματιστικά) είναι μικρή.',
  'kotsovolos': 'Η σελίδα στήνεται εξ ολοκλήρου με JavaScript (Next.js)· χωρίς προϊόντα στο HTML.',
};

const fmt = n => n == null ? '—' : n.toLocaleString('el-GR');
const reports = [], products = {};
for(const s of SITES){
  const f = path.join(RAW, `${s.id}.report.json`);
  if(!fs.existsSync(f)) continue;
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  reports.push({...r, trades: s.trades});
  products[s.id] = fs.readFileSync(path.join(RAW, `${s.id}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

const lines = [];
const total = Object.values(products).reduce((n, p) => n + p.length, 0);
const withPrice = Object.values(products).reduce((n, p) => n + p.filter(x => x.price_eur != null).length, 0);
lines.push('# Συλλογή ονομάτων υλικών — αναφορά', '',
  `Ημερομηνία: ${new Date().toISOString().slice(0, 10)} · ${reports.length} sites · **${fmt(total)} προϊόντα** (μοναδικά URL ανά site) · ${fmt(withPrice)} με δημόσια τιμή.`,
  'Κρατήθηκαν μόνο όνομα, μάρκα, μονάδα, τιμή, κατηγορία και URL. Τα raw δεδομένα είναι στο `data/raw/` (εκτός git).', '');

// ── ανά επάγγελμα
lines.push('## Ανά επάγγελμα', '', '| Επάγγελμα | Sites με ≥ 20 προϊόντα | Sites με ≥ 1 | Προϊόντα | Στόχος 6 sites |', '|---|---|---|---|---|');
for(const t of Object.values(TRADES)){
  const per = Object.entries(products).map(([id, ps]) => [id, ps.filter(p => p.trade.includes(t.name)).length]).filter(([, n]) => n > 0);
  const strong = per.filter(([, n]) => n >= 20);
  lines.push(`| ${t.name} | ${strong.length} (${strong.map(([id, n]) => `${id} ${fmt(n)}`).join(', ')}) | ${per.length} | ${fmt(per.reduce((a, [, n]) => a + n, 0))} | ${strong.length >= 6 ? '✅' : '❌'} |`);
}
lines.push('', '«Sites με ≥ 20 προϊόντα»: για να μη μετρά ως κάλυψη ένα site με 1–2 τυχαία προϊόντα του επαγγέλματος.', '');

// ── ανά site
lines.push('## Ανά site', '', '| Site | Μέθοδος | Προϊόντα | Κατηγορίες | Ίδιο σύνολο με το site | Αποτυχίες | Λεπτά |', '|---|---|---|---|---|---|---|');
for(const r of reports){
  const withTotal = r.categories.filter(c => c.siteTotal != null);
  const match = withTotal.filter(c => c.found >= c.siteTotal).length;
  const failed = r.categories.filter(c => c.error).length + r.errors.length;
  lines.push(`| ${r.site} | ${r.method?.replace(/\s*\(.*/, '') || '—'} | ${fmt(r.products)} | ${r.categories.length} | ${withTotal.length ? `${match}/${withTotal.length}` : 'το site δεν δείχνει σύνολο'} | ${failed || '—'} | ${r.minutes ?? '—'} |`);
}
for(const [id, why] of Object.entries(NOT_COLLECTED)) lines.push(`| ${id} | — | 0 | — | — | ${why} | — |`);
lines.push('', '«Ίδιο σύνολο»: κατηγορίες όπου βρήκαμε τουλάχιστον όσα προϊόντα δηλώνει το site, προς όσες κατηγορίες δείχνουν σύνολο.', '');

// ── αποτυχίες συνοπτικά
const NOTES = {karag: 'Δεν δείχνει προϊόντα δημόσια (το Store API δηλώνει 0 προϊόντα, οι σελίδες κατηγοριών είναι άδειες) — λειτουργεί ως κατάλογος.'};
lines.push('## Αποτυχίες και περιορισμοί', '');
for(const [id, n] of Object.entries(NOTES)) lines.push(`- **${id}**: ${n}`);
for(const r of reports){
  const bad = r.categories.filter(c => c.error);
  const short = r.categories.filter(c => c.siteTotal != null && c.found < c.siteTotal);
  if(!bad.length && !r.errors.length && !short.length) continue;
  const reasons = {}; for(const c of bad) reasons[c.error] = (reasons[c.error] || 0) + 1;
  lines.push(`- **${r.site}**: ` + [...r.errors, ...Object.entries(reasons).map(([e, n]) => `${n} κατηγορίες: ${e}`),
    short.length ? `${short.length} κατηγορίες με λιγότερα από όσα δηλώνει το site (π.χ. ${short.slice(0, 2).map(c => `«${c.category.slice(0, 40)}» ${c.found}/${c.siteTotal}`).join(', ')})` : ''].filter(Boolean).join(' · '));
}
fs.writeFileSync(path.join(OUT, 'collection.md'), lines.join('\n') + '\n');

// ── λεπτομέρειες ανά κατηγορία
const d = ['# Συλλογή — ανά κατηγορία', ''];
for(const r of reports){
  d.push(`## ${r.site} (${fmt(r.products)} προϊόντα)`, '', '| Κατηγορία | Βρέθηκαν | Σύνολο site | Σελίδες | Σημείωση |', '|---|---|---|---|---|');
  for(const c of r.categories) d.push(`| ${c.category.replace(/\|/g, '/')} | ${fmt(c.found)} | ${fmt(c.siteTotal)} | ${c.pages} | ${c.error || ''} |`);
  d.push('');
}
fs.writeFileSync(path.join(OUT, 'collection-details.md'), d.join('\n') + '\n');
console.log(lines.join('\n'));
