// Φάση 3: προϊόντα → τύποι υλικών → εργασίες. Γράφει data/taxonomy.json (επάγγελμα → κατηγορία → τύπος → εργασία, με
// πλήθος προϊόντων) και data/cache/leftovers.json (ό,τι δεν έπιασαν οι κανόνες, ομαδοποιημένο, για το Claude API).
// Αν υπάρχει data/cache/claude-types.json (αποτέλεσμα του classify-claude.mjs), οι αποφάσεις του μπαίνουν μετά τους κανόνες.
// Χρήση: node tools/catalog/taxonomy.mjs
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {TYPES, TASKS, classify, norm} from './taxonomy-rules.mjs';
import {CATALOG_TASKS} from './catalog-map.mjs';
import {CATALOG} from '../../src/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rows = [];
for(const f of fs.readdirSync(path.join(root, 'data/raw')).filter(f => f.endsWith('.jsonl')))
  for(const l of fs.readFileSync(path.join(root, 'data/raw', f), 'utf8').split('\n')) if(l) rows.push(JSON.parse(l));

/** «Κεφάλι» ονόματος: οι δύο πρώτες ελληνικές λέξεις χωρίς μάρκες/κωδικούς/διαστάσεις — η μονάδα ομαδοποίησης για το AI. */
export const head = name => norm(name).replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(x => x.length > 2 && !/^[a-z]+$/.test(x)).slice(0, 2).join(' ');
const leftoverKey = r => `${r.trade[0]} | ${head(r.name) || norm(r.name).slice(0, 40)}`;

// Αποφάσεις του Claude για τα υπόλοιπα (αν έχει τρέξει): key → {type, name, trade, category, needs, task, taskTitle}
const claudeFile = path.join(root, 'data/cache/claude-types.json');
const claude = fs.existsSync(claudeFile) ? JSON.parse(fs.readFileSync(claudeFile, 'utf8')) : {};
const typeById = Object.fromEntries(TYPES.map(t => [t.id, t]));
const extraTypes = {}, extraTasks = {};
for(const d of Object.values(claude)){
  if(d.type && !typeById[d.type] && !extraTypes[d.type]) extraTypes[d.type] = {id: d.type, name: d.name, trade: d.trade, category: d.category, needs: d.needs, task: d.task, source: 'claude'};
  if(d.task && !TASKS[d.task]) extraTasks[d.task] = {trade: d.trade, title: d.taskTitle, source: 'claude'};
}
const allTypes = {...typeById, ...extraTypes}, allTasks = {...TASKS, ...extraTasks};

const counts = {}, leftovers = {}, examples = {};
let byRules = 0, byClaude = 0;
for(const r of rows){
  let t = classify(r.name, r.category_path);
  if(t) byRules++;
  else { const d = claude[leftoverKey(r)]; if(d) { t = d.type ? allTypes[d.type] : {id: 'not-claude', needs: null}; byClaude++; } }
  if(!t){ const k = leftoverKey(r); (leftovers[k] ||= {n: 0, trade: r.trade[0], examples: []}).n++; if(leftovers[k].examples.length < 4) leftovers[k].examples.push(r.name.slice(0, 120)); continue; }
  counts[t.id] = (counts[t.id] || 0) + 1;
  if(t.needs !== null && (examples[t.id] ||= []).length < 3) examples[t.id].push({site: r.site, name: r.name.slice(0, 100)});
}

// ── επάγγελμα → κατηγορία → τύπος → εργασία
const trades = {};
for(const t of Object.values(allTypes)){
  if(t.needs === null || !counts[t.id]) continue;
  const cat = ((trades[t.trade] ||= {}) [t.category] ||= {});
  cat[t.id] = {name: t.name, needs_analysis: t.needs, task: t.task || null, task_title: t.task ? allTasks[t.task]?.title : null, products: counts[t.id], examples: examples[t.id], ...(t.source ? {source: t.source} : {})};
}

// ── κατάλογος εφαρμογής → εργασία
const catalog = [], unmatched = [];
for(const item of CATALOG){
  const m = CATALOG_TASKS[item.id];
  if(!m){ unmatched.push({id: item.id, name: item.name, why: 'Δεν υπάρχει αντιστοίχιση.'}); continue; }
  if(m.options){
    for(const o of item.options || []){
      const task = m.options[o.label];
      if(!task) unmatched.push({id: item.id, option: o.label, name: `${item.name} ${o.label}`, why: 'Τύπος χωρίς αντιστοίχιση.'});
      else catalog.push({id: item.id, option: o.label, name: `${item.name} ${o.label}`, task, task_title: allTasks[task].title});
    }
  } else if(m.task){
    catalog.push({id: item.id, name: item.name, task: m.task, task_title: allTasks[m.task].title, ...(m.consumable ? {consumable: true} : {}), ...(m.service ? {service: true} : {}), ...(m.qualifiers ? {qualifiers: m.qualifiers} : {})});
  } else unmatched.push({id: item.id, name: item.name, why: m.why});
}
for(const c of catalog) if(!allTasks[c.task]) throw new Error(`Άγνωστη εργασία ${c.task} για ${c.id}`);

// Εργασίες που χρειάζονται ανάλυση: όσες έχουν τύπο με needs=true ή είδος καταλόγου.
const usedTasks = new Set([...Object.values(allTypes).filter(t => t.needs && counts[t.id]).map(t => t.task), ...catalog.map(c => c.task)]);
const tasks = Object.fromEntries([...usedTasks].sort().map(id => [id, {...allTasks[id],
  types: Object.values(allTypes).filter(t => t.task === id && counts[t.id]).map(t => t.id),
  products: Object.values(allTypes).filter(t => t.task === id).reduce((n, t) => n + (counts[t.id] || 0), 0),
  catalog: catalog.filter(c => c.task === id).map(c => c.option ? `${c.id}:${c.option}` : c.id)}]));

const irrelevant = Object.values(allTypes).filter(t => t.needs === null).reduce((n, t) => n + (counts[t.id] || 0), 0) + (counts['not-claude'] || 0);
const leftCount = Object.values(leftovers).reduce((n, l) => n + l.n, 0);
const out = {
  generated: new Date().toISOString().slice(0, 10),
  totals: {products: rows.length, by_rules: byRules, by_claude: byClaude, unclassified: leftCount, irrelevant,
    material_types: Object.values(allTypes).filter(t => t.needs !== null && counts[t.id]).length, tasks: usedTasks.size},
  trades, tasks, catalog, catalog_unmatched: unmatched,
};
fs.writeFileSync(path.join(root, 'data/taxonomy.json'), JSON.stringify(out, null, 1) + '\n');
fs.writeFileSync(path.join(root, 'data/cache/leftovers.json'), JSON.stringify(Object.entries(leftovers).sort((a, b) => b[1].n - a[1].n).map(([key, v]) => ({key, ...v})), null, 1));
console.log(JSON.stringify(out.totals));

// ── αναφορά για τον άνθρωπο: data/reports/taxonomy.md
const md = ['# Ταξινομία υλικών → εργασιών (Φάση 3)', '',
  `${out.generated} · ${rows.length.toLocaleString('el-GR')} προϊόντα · κανόνες: ${byRules.toLocaleString('el-GR')} · Claude: ${byClaude.toLocaleString('el-GR')} · ` +
  `χωρίς ταξινόμηση: ${leftCount.toLocaleString('el-GR')} · εκτός (έπιπλα, εργαλεία, συσκευές…): ${irrelevant.toLocaleString('el-GR')}`, '',
  '## Ανά επάγγελμα', '', '| Επάγγελμα | Τύποι υλικών | με ανάλυση | αναλώσιμα | Εργασίες | Προϊόντα |', '|---|---|---|---|---|---|'];
for(const [tr, cats] of Object.entries(trades)){
  const ts = Object.values(cats).flatMap(c => Object.values(c));
  md.push(`| ${tr} | ${ts.length} | ${ts.filter(x => x.needs_analysis).length} | ${ts.filter(x => !x.needs_analysis).length} | ${new Set(ts.filter(x => x.needs_analysis).map(x => x.task)).size} | ${ts.reduce((n, x) => n + x.products, 0).toLocaleString('el-GR')} |`);
}
md.push('', '## Εργασίες', '', '| Εργασία | Επάγγελμα | Τύποι | Προϊόντα | Είδη καταλόγου |', '|---|---|---|---|---|');
for(const [id, t] of Object.entries(tasks)) md.push(`| ${t.title} (\`${id}\`)${t.licensed ? ' ⚖️' : ''} | ${t.trade} | ${t.types.length} | ${t.products.toLocaleString('el-GR')} | ${t.catalog.join(', ') || '—'} |`);
md.push('', '⚖️ = κατά νόμο από αδειούχο/πιστοποιημένο επαγγελματία.', '', '## Κατάλογος εφαρμογής → εργασία', '', '| Είδος | Εργασία | Σημείωση |', '|---|---|---|');
for(const c of catalog) md.push(`| ${c.name} | ${c.task_title} | ${[c.consumable && 'αναλώσιμο μέσα στην εργασία', c.service && 'υπηρεσία', c.qualifiers && 'με «τοίχου» → τοίχου'].filter(Boolean).join(', ')} |`);
md.push('', '**Δεν ταιριάζουν:**', ...unmatched.map(u => `- ${u.name} (\`${u.id}\`): ${u.why}`), '');
fs.mkdirSync(path.join(root, 'data/reports'), {recursive: true});
fs.writeFileSync(path.join(root, 'data/reports/taxonomy.md'), md.join('\n') + '\n');
