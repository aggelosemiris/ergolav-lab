// Λίστες υλικών ανά ειδικότητα: data/materials/*.txt → data/materials.json (+ σύνοψη σε markdown).
// Χωρίς εξαρτήσεις. Οι λίστες γράφονται με το χέρι (μία γραμμή ανά είδος), ώστε να διαβάζονται και να ελέγχονται εύκολα.
//
//   node tools/materials/build.mjs            γράφει data/materials.json και data/reports/materials.md
//   node tools/materials/build.mjs --check    μόνο έλεγχος (το χρησιμοποιεί το test/materials.test.js)
//
// Μορφή αρχείου:
//   # trade: <id> | <όνομα ειδικότητας> | <τεχνίτης>
//   ## <ομάδα>
//   id | όνομα | μονάδα | συνώνυμα (με κόμμα) | παραλλαγές (με «;») | τύπος του data/taxonomy.json (ή κενό)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
export const UNITS = ['τεμ.', 'μ.', 'τ.μ.', 'κ.μ.', 'κιλό', 'σακί', 'λίτρο', 'σετ', 'ζεύγος', 'συσκευασία', 'ρολό', 'τόνος'];

/** Διαβάζει όλα τα αρχεία. Επιστρέφει {trades, errors}. */
export function readLists(dir = path.join(ROOT, 'data', 'materials'), taxonomyFile = path.join(ROOT, 'data', 'taxonomy.json')){
  const tax = JSON.parse(fs.readFileSync(taxonomyFile, 'utf8'));
  const taxTypes = new Map();
  for(const [trade, groups] of Object.entries(tax.trades)) for(const types of Object.values(groups)) for(const [id, t] of Object.entries(types)) taxTypes.set(id, {trade, name: t.name});
  const errors = [], trades = [];
  for(const file of fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort()){
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    let trade = null, group = null;
    lines.forEach((raw, i) => {
      const line = raw.trim(), where = `${file}:${i + 1}`;
      if(!line) return;
      const head = line.match(/^#\s*trade:\s*(.+)$/);
      if(head){
        const [id, name, worker] = head[1].split('|').map(s => s.trim());
        trade = {id, name, worker, file, groups: []}; trades.push(trade); return;
      }
      if(line.startsWith('## ')){ group = {name: line.slice(3).trim(), items: []}; trade?.groups.push(group); return; }
      if(line.startsWith('#')) return;
      if(!trade || !group) return errors.push(`${where}: γραμμή έξω από ειδικότητα/ομάδα`);
      const f = line.split('|').map(s => s.trim());
      if(f.length !== 6) return errors.push(`${where}: ${f.length} πεδία αντί για 6`);
      const [id, name, unit, syn, variants, taxonomy] = f;
      if(!/^[a-z0-9-]+$/.test(id)) errors.push(`${where}: άκυρο id «${id}»`);
      if(!name) errors.push(`${where}: χωρίς όνομα`);
      if(!UNITS.includes(unit)) errors.push(`${where}: άγνωστη μονάδα «${unit}»`);
      if(taxonomy && !taxTypes.has(taxonomy)) errors.push(`${where}: άγνωστος τύπος taxonomy «${taxonomy}»`);
      group.items.push({id, name, unit, synonyms: syn ? syn.split(',').map(s => s.trim()).filter(Boolean) : [],
        variants: variants ? variants.split(';').map(s => s.trim()).filter(Boolean) : [], taxonomy: taxonomy || null});
    });
  }
  for(const t of trades){
    const seen = new Set();
    for(const it of t.groups.flatMap(g => g.items)){ if(seen.has(it.id)) errors.push(`${t.file}: διπλό id «${it.id}»`); seen.add(it.id); }
    for(const it of t.groups.flatMap(g => g.items)) if(it.synonyms.length < 1) errors.push(`${t.file}: «${it.id}» χωρίς συνώνυμα`);
  }
  return {trades, errors, taxTypes, taxonomy: tax};
}

/** Πλήθη ανά ειδικότητα και σε σχέση με το taxonomy. */
export function stats({trades, taxTypes, taxonomy}){
  const rows = trades.map(t => {
    const items = t.groups.flatMap(g => g.items);
    const inTax = items.filter(i => i.taxonomy);
    return {id: t.id, name: t.name, worker: t.worker, groups: t.groups.length, items: items.length,
      variants: items.reduce((a, i) => a + Math.max(1, i.variants.length), 0),
      synonyms: items.reduce((a, i) => a + i.synonyms.length, 0),
      itemsInTaxonomy: inTax.length, variantsInTaxonomy: inTax.reduce((a, i) => a + Math.max(1, i.variants.length), 0),
      taxonomyTypes: [...new Set(inTax.map(i => i.taxonomy))]};
  });
  const used = new Set(rows.flatMap(r => r.taxonomyTypes));
  const unusedTax = [...taxTypes.entries()].filter(([id]) => !used.has(id)).map(([id, t]) => `${id} (${t.name})`);
  // Παραλλαγές που υπάρχουν ήδη στον κατάλογο της εφαρμογής (taxonomy.catalog: ό,τι τιμολογεί σήμερα το ergolav).
  return {rows, unusedTax, catalogVariants: taxonomy.catalog.length, taxonomyTypes: taxTypes.size};
}

export function markdown({rows, unusedTax, catalogVariants, taxonomyTypes}, date){
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  const out = [`# Λίστες υλικών ανά ειδικότητα (${date})`, '',
    'Πηγή: `data/materials/*.txt` (γραμμένες με το χέρι, μία γραμμή ανά είδος) → `data/materials.json` με `node tools/materials/build.mjs`.',
    `Σύγκριση με το \`data/taxonomy.json\`: ${taxonomyTypes} τύποι υλικών από 8 γενικά καταστήματα· ο κατάλογος της εφαρμογής τιμολογεί σήμερα ${catalogVariants} παραλλαγές (taxonomy.catalog).`,
    '', '- **Είδη**: ένα είδος = μία γραμμή (π.χ. «Κοιλοδοκός τετράγωνος»).',
    '- **Παραλλαγές**: οι τιμές των βασικών χαρακτηριστικών του είδους (διάσταση, διάμετρος, λίτρα, ισχύς…)· είδος χωρίς παραλλαγές μετρά 1.',
    '- **Ήδη στο taxonomy**: είδη που αντιστοιχούν σε υπάρχοντα τύπο του taxonomy (στήλη 6 του αρχείου).', '',
    '| Ειδικότητα | Ομάδες | Είδη | Παραλλαγές | Συνώνυμα | Είδη ήδη στο taxonomy | Παραλλαγές αυτών | Τύποι taxonomy που καλύπτει |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.name} | ${r.groups} | ${r.items} | ${r.variants} | ${r.synonyms} | ${r.itemsInTaxonomy} (${Math.round(100 * r.itemsInTaxonomy / r.items)}%) | ${r.variantsInTaxonomy} | ${r.taxonomyTypes.length} |`),
    `| **Σύνολο** | ${sum('groups')} | **${sum('items')}** | **${sum('variants')}** | ${sum('synonyms')} | **${sum('itemsInTaxonomy')}** (${Math.round(100 * sum('itemsInTaxonomy') / sum('items'))}%) | ${sum('variantsInTaxonomy')} | ${new Set(rows.flatMap(r => r.taxonomyTypes)).size} από ${taxonomyTypes} |`,
    '', `Τύποι του taxonomy που δεν αντιστοιχίστηκαν σε κανένα είδος (${unusedTax.length}): ${unusedTax.join(', ') || '—'}.`, ''];
  return out.join('\n');
}

/**
 * Ένα CSV ανά ειδικότητα για έλεγχο από τεχνικό (data/reports/materials-review/<id>.csv).
 * Ελληνικό Excel: διαχωριστικό «;» και BOM ώστε να ανοίγει σωστά με διπλό κλικ (και στο Google Sheets).
 */
export const REVIEW_COLUMNS = ['Ομάδα', 'Είδος', 'Παραλλαγές', 'Μονάδα', 'Συνώνυμα', 'Σωστό (ναι/όχι)', 'Τι λείπει'];
export function reviewCsv(trade){
  const cell = v => /[";\n,]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows = [REVIEW_COLUMNS, ...trade.groups.flatMap(g => g.items.map(i =>
    [g.name, i.name, i.variants.join(' · '), i.unit, i.synonyms.join(', '), '', '']))];
  return '\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

if(path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)){
  const data = readLists();
  if(data.errors.length){ console.error(data.errors.join('\n')); process.exit(1); }
  const s = stats(data);
  if(process.argv.includes('--check')){ console.log(`OK: ${s.rows.length} ειδικότητες, ${s.rows.reduce((a, r) => a + r.items, 0)} είδη`); process.exit(0); }
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(ROOT, 'data', 'materials.json'), JSON.stringify({generated: date, units: UNITS,
    trades: data.trades.map(({file, ...t}) => t)}, null, 1) + '\n');
  fs.writeFileSync(path.join(ROOT, 'data', 'reports', 'materials.md'), markdown(s, date));
  const reviewDir = path.join(ROOT, 'data', 'reports', 'materials-review');
  fs.mkdirSync(reviewDir, {recursive: true});
  for(const t of data.trades) fs.writeFileSync(path.join(reviewDir, `${t.id}.csv`), reviewCsv(t));
  for(const r of s.rows) console.log(`${r.name.padEnd(28)} είδη ${String(r.items).padStart(3)} · παραλλαγές ${String(r.variants).padStart(4)} · στο taxonomy ${r.itemsInTaxonomy}`);
}
