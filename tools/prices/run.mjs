// Εβδομαδιαία ενημέρωση τιμών: μία εκτέλεση. Τρέχει από το GitHub Actions (.github/workflows/prices.yml) κάθε 7 ημέρες.
//
//   node tools/prices/run.mjs --store supabase            (παραγωγή: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
//   node tools/prices/run.mjs --store file:prices.json    (τοπικά, χωρίς Supabase)
// Επιλογές: --only praktiker,toolcase · --cache <φάκελος> (εξ ορισμού tools/prices/.cache) · --report <αρχείο.md>
//           --users <αρχείο.json> (προϊόντα χρηστών για δοκιμή με αρχείο: [{user_id, key, name, unit, …}])
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import { createFetcher } from './fetch.mjs';
import { SUPPLIERS, ALTERNATES } from './suppliers.mjs';
import { runOnce } from './engine.mjs';
import { createMemoryStore } from './stores/memory.mjs';
import { createSupabaseStore } from './stores/supabase.mjs';
import { report } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const log = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const storeArg = opt('--store', 'file:' + path.join(here, '.data', 'prices.json'));
let store;
if(storeArg === 'supabase') store = createSupabaseStore({url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY, log});
else {
  const file = storeArg.replace(/^file:/, ''); fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  store = createMemoryStore({file});
  const users = opt('--users');
  if(users){
    const rows = JSON.parse(fs.readFileSync(users, 'utf8'));
    for(const u of rows) if(!store.db.user_products.some(x => x.user_id === u.user_id && x.key === u.key)) store.db.user_products.push({deleted: false, price_product_id: null, ...u});
  }
}
const only = opt('--only')?.split(',');
const suppliers = [...SUPPLIERS, ...ALTERNATES].filter(s => !only || only.includes(s.id));
const fetcher = createFetcher({cacheDir: opt('--cache', path.join(here, '.cache')), log});

const t0 = Date.now();
const result = await runOnce({store, suppliers, fetcher, log});
if(result.skipped) process.exit(0);
const {stats} = result;
log(`τέλος σε ${Math.round((Date.now() - t0) / 1000)}″ · αιτήματα ${fetcher.stats.requests} (cache ${fetcher.stats.cached}, επαναλήψεις ${fetcher.stats.retries})`);
for(const [id, s] of Object.entries(stats.suppliers)) log(`  ${id.padEnd(12)} ${s.status.padEnd(11)} προϊόντα ${s.items} · επαληθευμένα ${s.verified} · αντιστοιχίσεις ${s.matched}${s.reason ? ' · ' + s.reason : ''}`);
log(`  προϊόντα: ${JSON.stringify(stats.products)}`);
const out = opt('--report');
if(out){ fs.writeFileSync(out, report({stats, updates: result.updates, fetcherStats: fetcher.stats, store})); log(`αναφορά: ${out}`); }
