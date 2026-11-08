// Ελέγχει αναλύσεις (απάντηση μοντέλου ή χειρόγραφες, με απλά strings), βάζει σταθερά ids στα στοιχεία και τις γράφει
// στο data/analyses/<επάγγελμα>.json. Μια ανάλυση που ήδη υπάρχει ΔΕΝ αντικαθίσταται χωρίς --replace (κρατά τα ids της).
// Χρήση: node tools/catalog/build-analyses.mjs <αρχείο.json> [--replace]
//        το αρχείο: [{ "id": "<id εργασίας>", ...απάντηση κατά prompts/analysis.md }]
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {validateAnalysis, withItemIds} from '../../src/analysis-schema.js';
import {TASKS} from './taxonomy-rules.mjs';
import {TRADES} from './sites.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(root, 'data/analyses');
export const tradeKey = name => Object.entries(TRADES).find(([, t]) => t.name === name)?.[0];

export function loadTrade(key){
  const f = path.join(DIR, `${key}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {trade: TRADES[key].name, analyses: {}};
}

/** Επιστρέφει {ok: [...ids], errors: {id: [...]}}. */
export function buildAnalyses(raws, {replace = false} = {}){
  const result = {ok: [], errors: {}, skipped: []}, touched = new Map();
  for(const raw of raws){
    const task = TASKS[raw.id];
    if(!task){ result.errors[raw.id] = ['Άγνωστη εργασία (δεν υπάρχει στην ταξινομία).']; continue; }
    const a = withItemIds(raw, {id: raw.id, trade: task.trade});
    const errs = validateAnalysis(a);
    if(!!task.licensed !== a.requires_licensed_professional) errs.push(`Η εργασία ${task.licensed ? 'θέλει' : 'δεν θέλει'} αδειούχο κατά την ταξινομία.`);
    if(errs.length){ result.errors[raw.id] = errs; continue; }
    const key = tradeKey(task.trade), file = touched.get(key) || loadTrade(key);
    if(file.analyses[a.id] && !replace){ result.skipped.push(a.id); continue; }
    file.analyses[a.id] = a; touched.set(key, file); result.ok.push(a.id);
  }
  fs.mkdirSync(DIR, {recursive: true});
  for(const [key, file] of touched){
    file.analyses = Object.fromEntries(Object.entries(file.analyses).sort(([a], [b]) => a.localeCompare(b)));
    file.updated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(DIR, `${key}.json`), JSON.stringify(file, null, 1) + '\n');
  }
  return result;
}

if(import.meta.url === `file://${process.argv[1]}`){
  const [src] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const r = buildAnalyses(JSON.parse(fs.readFileSync(src, 'utf8')), {replace: process.argv.includes('--replace')});
  console.log(`εντάξει: ${r.ok.length} · υπήρχαν ήδη: ${r.skipped.length} · με σφάλματα: ${Object.keys(r.errors).length}`);
  for(const [id, e] of Object.entries(r.errors)) console.log(`✗ ${id}\n   - ${e.join('\n   - ')}`);
  if(Object.keys(r.errors).length) process.exitCode = 1;
}
