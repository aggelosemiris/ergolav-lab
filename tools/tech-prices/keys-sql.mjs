// Οι επιτρεπτές παραλλαγές για τις «τιμές από τεχνικούς»: data/materials.json → supabase/seed/tech-price-keys.sql.
// Ξανατρέξιμο στο SQL editor (μετά τη migration 20261125000000_tech_prices.sql, και κάθε φορά που αλλάζουν οι λίστες):
// προσθέτει/ενημερώνει τις παραλλαγές και απενεργοποιεί όσες δεν υπάρχουν πια (δεν σβήνει τιμές).
//   node tools/tech-prices/keys-sql.mjs          γράφει το αρχείο
//   node tools/tech-prices/keys-sql.mjs --check  μόνο έλεγχος (το χρησιμοποιεί το test/tech-prices.test.js)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { variantProducts } from '../../src/material-prices.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = path.join(ROOT, 'supabase', 'seed', 'tech-price-keys.sql');
export const APP_OUT = path.join(ROOT, 'src', 'material-keys.json');

/**
 * Για την εφαρμογή (μόνο με TECH_PRICES_ENABLED, έξω από το precache): οι κανόνες αντιστοίχισης γραμμής → παραλλαγή, ίδιοι
 * με το src/material-prices.js. Μόνο οι συγκεκριμένες παραλλαγές (όχι εύρος / χωρίς μέγεθος): οι γενικές δεν αντιστοιχίζονται
 * με βεβαιότητα. {v, rows: [[κλειδί, μονάδα, λέξεις, συνώνυμα, λέξεις παραλλαγής, μεγέθη, αριθμοί]]}
 */
export function appKeys(materials){
  const seen = new Set(), rows = [];
  for(const p of variantProducts(materials)){
    if((p.skip && p.skip !== 'not-retail-unit') || seen.has(p.key)) continue;
    seen.add(p.key);
    rows.push([p.key, p.unit, p.spec.all, p.spec.allAlt, p.spec.must, p.spec.attrs, p.spec.nums]);
  }
  return {v: 1, rows};
}

/** Κλειδί παραλλαγής: «id είδους|παραλλαγή» (κενή παραλλαγή για είδη χωρίς παραλλαγές). Ίδιο με το src/material-prices.js. */
export const variantKey = (itemId, variant = '') => `${itemId}|${variant}`;

/** Ένα κλειδί ανά παραλλαγή. Το ίδιο είδος σε δύο ειδικότητες (π.χ. ηλιακός θερμοσίφωνας) = ίδιο προϊόν → μία φορά·
 *  αν όμως έχει άλλη μονάδα, είναι λάθος της λίστας → σταματά. */
export function keys(materials){
  const out = new Map();
  for(const t of materials.trades) for(const g of t.groups) for(const it of g.items)
    for(const v of it.variants.length ? it.variants : ['']){
      const key = variantKey(it.id, v), had = out.get(key);
      if(had && had.unit !== it.unit) throw new Error(`${key}: δύο μονάδες (${had.unit} / ${it.unit})`);
      if(!had) out.set(key, {key, unit: it.unit});
    }
  return [...out.values()];
}

export function sql(materials){
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const rows = keys(materials);
  return [
    '-- Γράφεται από το `node tools/tech-prices/keys-sql.mjs` (από το data/materials.json)· μην το αλλάζεις με το χέρι.',
    '-- Ξανατρέξιμο: προσθέτει/ενημερώνει τις παραλλαγές και απενεργοποιεί όσες δεν υπάρχουν πια (δεν σβήνει τιμές).',
    'begin;',
    'create temporary table _keys (key text primary key, unit text not null) on commit drop;',
    'insert into _keys (key, unit) values',
    rows.map(r => `  (${q(r.key)}, ${q(r.unit)})`).join(',\n') + ';',
    'insert into public.tech_price_keys (key, unit, active, updated_at) select key, unit, true, now() from _keys',
    '  on conflict (key) do update set unit = excluded.unit, active = true, updated_at = now()',
    '  where public.tech_price_keys.unit is distinct from excluded.unit or not public.tech_price_keys.active;',
    'update public.tech_price_keys set active = false, updated_at = now() where active and key not in (select key from _keys);',
    'commit;',
    `select count(*) as "ενεργές παραλλαγές (αναμένονται ${rows.length})" from public.tech_price_keys where active;`, ''].join('\n');
}

if(path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)){
  const materials = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'materials.json'), 'utf8'));
  const s = sql(materials);
  const a = JSON.stringify(appKeys(materials)) + '\n';
  if(process.argv.includes('--check')){ process.exit(fs.readFileSync(OUT, 'utf8') === s && fs.readFileSync(APP_OUT, 'utf8') === a ? 0 : 1); }
  fs.mkdirSync(path.dirname(OUT), {recursive: true}); fs.writeFileSync(OUT, s); fs.writeFileSync(APP_OUT, a);
  console.log(`${keys(materials).length} παραλλαγές → ${path.relative(ROOT, OUT)}`);
}
