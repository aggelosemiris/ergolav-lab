// Φάση 5: οι αναλύσεις (data/analyses/*.json) των εργασιών που αντιστοιχούν σε είδη του καταλόγου της εφαρμογής
// γράφονται στο src/analyses-data.js. Η εφαρμογή τις φορτώνει μαζί με τη σελίδα, ώστε το PDF της ανάλυσης να βγαίνει
// και χωρίς σύνδεση. Τρέξ' το ξανά όταν αλλάζουν οι αναλύσεις ή το src/catalog-tasks.js.
//
// Χρήση:  node tools/catalog/export-app-data.mjs
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {CATALOG_TASKS} from '../../src/catalog-tasks.js';
import {validateAnalysis} from '../../src/analysis-schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'data/analyses');

const all = {};
for(const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort())
  Object.assign(all, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).analyses);

// Όλες οι εργασίες που μπορεί να πάρει μια γραμμή: task, τύποι (options) και qualifiers.
const wanted = new Set();
for(const m of Object.values(CATALOG_TASKS))
  for(const t of [m.task, ...Object.values(m.options || {}), ...Object.values(m.qualifiers || {})]) if(t) wanted.add(t);

const missing = [...wanted].filter(id => !all[id]);
const invalid = [...wanted].filter(id => all[id]).map(id => [id, validateAnalysis(all[id])]).filter(([, e]) => e.length);
if(missing.length || invalid.length){
  console.error([...missing.map(id => `✗ ${id}: δεν υπάρχει ανάλυση`), ...invalid.map(([id, e]) => `✗ ${id}: ${e.join('; ')}`)].join('\n'));
  process.exit(1);
}

const ids = [...wanted].sort();
const out = [
  '// Παράγεται από το tools/catalog/export-app-data.mjs από τα data/analyses/*.json· μην το αλλάζεις με το χέρι.',
  '// Οι αναλύσεις των εργασιών που αντιστοιχούν σε είδη του καταλόγου (src/catalog-tasks.js). Φορτώνονται μαζί με',
  '// τη σελίδα, ώστε το PDF της ανάλυσης να βγαίνει και χωρίς σύνδεση.',
  'export const ANALYSES = {',
  ...ids.map(id => `  ${JSON.stringify(id)}: ${JSON.stringify(all[id])},`),
  '};',
  '',
];
fs.writeFileSync(path.join(root, 'src/analyses-data.js'), out.join('\n'));
console.log(`src/analyses-data.js: ${ids.length} αναλύσεις, ${Math.round(Buffer.byteLength(out.join('\n')) / 1024)} KB`);
