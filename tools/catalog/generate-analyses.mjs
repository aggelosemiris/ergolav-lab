// Φάση 4: παραγωγή αναλύσεων εργασιών με το Message Batches API (50% φθηνότερο για μεγάλο όγκο).
// Ο prompt διαβάζεται από το prompts/analysis.md (κομμάτια «System» και «Αίτημα»). Κάθε απάντηση ελέγχεται με το
// JSON schema (structured outputs) και με τους κανόνες του src/analysis-schema.js· όσες απορριφθούν ξαναζητούνται
// (έως 2 φορές), με τα σφάλματα μέσα στο αίτημα. Γράφει data/analyses/<επάγγελμα>.json και data/reports/analyses-generation.md.
//
// Χρήση:  node tools/catalog/generate-analyses.mjs --dry                 (εκτίμηση κόστους, χωρίς κλήσεις)
//         node tools/catalog/generate-analyses.mjs                       (μόνο εργασίες χωρίς ανάλυση)
//         node tools/catalog/generate-analyses.mjs --only=id1,id2 --replace
// Χρειάζεται ANTHROPIC_API_KEY στο περιβάλλον (ποτέ στο repo).
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {RESPONSE_SCHEMA} from '../../src/analysis-schema.js';
import {TASKS} from './taxonomy-rules.mjs';
import {buildAnalyses, tradeKey, loadTrade} from './build-analyses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL = 'claude-opus-5-5';
const PRICE = {input: 2 / 1e6, output: 10 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 2.5 / 1e6};   // Opus 5.5 στο Batches (−50%)
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));

// ── prompt από το prompts/analysis.md
const md = fs.readFileSync(path.join(root, 'prompts/analysis.md'), 'utf8');
const SYSTEM = md.split(/^## System\s*$/m)[1].split(/^---\s*$/m)[0].trim();
const TEMPLATE = md.split(/^## Αίτημα.*$/m)[1].match(/```\n([\s\S]*?)```/)[1].trim();

const taxonomy = JSON.parse(fs.readFileSync(path.join(root, 'data/taxonomy.json'), 'utf8'));
const typeInfo = {};
for(const cats of Object.values(taxonomy.trades)) for(const types of Object.values(cats)) for(const [id, t] of Object.entries(types)) typeInfo[id] = t;

export function requestText(id, extraErrors = []){
  const task = TASKS[id], tx = taxonomy.tasks[id] || {types: [], catalog: []};
  const types = tx.types.map(t => typeInfo[t]?.name).filter(Boolean);
  const examples = tx.types.flatMap(t => (typeInfo[t]?.examples || []).map(e => e.name)).slice(0, 6);
  let text = TEMPLATE.replace('{{title}}', task.title).replace('{{id}}', id).replace('{{trade}}', task.trade)
    .replace('{{licensed}}', task.licensed ? 'ναι' : 'όχι')
    .replace('{{types}}', types.join(', ') || '—').replace('{{examples}}', examples.join(' ¦ ') || '—')
    .replace('{{catalog}}', tx.catalog.join(', ') || '—');
  if(extraErrors.length) text += `\n\nΗ προηγούμενη απάντηση απορρίφθηκε για αυτούς τους λόγους· διόρθωσέ τους:\n- ${extraErrors.join('\n- ')}`;
  return text;
}

const existing = new Set(Object.keys(TASKS).filter(id => loadTrade(tradeKey(TASKS[id].trade)).analyses[id]));
const todo = args.only ? String(args.only).split(',') : Object.keys(TASKS).filter(id => args.replace || !existing.has(id));

if(args.dry){
  const sys = SYSTEM.length / 3.3, req = todo.reduce((n, id) => n + requestText(id).length / 3.3, 0), out = todo.length * 3500;
  const cost = sys * PRICE.cacheWrite + sys * Math.max(0, todo.length - 1) * PRICE.cacheRead + req * PRICE.input + out * PRICE.output;
  console.log(JSON.stringify({analyses: todo.length, model: MODEL, est_input_tokens: Math.round(sys * todo.length + req), est_output_tokens: out, est_cost_usd: Math.round(cost * 100) / 100}, null, 1));
  process.exit(0);
}
if(!todo.length){ console.log('Όλες οι εργασίες έχουν ήδη ανάλυση (χρησιμοποίησε --replace για αντικατάσταση).'); process.exit(0); }

const client = new Anthropic();
const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
const report = {requested: todo.length, rounds: [], failed: {}};

async function runBatch(ids, errorsById = {}){
  const batch = await client.messages.batches.create({requests: ids.map(id => ({custom_id: id, params: {
    model: MODEL, max_tokens: 16000,
    system: [{type: 'text', text: SYSTEM, cache_control: {type: 'ephemeral'}}],
    messages: [{role: 'user', content: requestText(id, errorsById[id] || [])}],
    output_config: {effort: 'medium', format: {type: 'json_schema', schema: RESPONSE_SCHEMA}},
  }}))});
  console.error(`batch ${batch.id}: ${ids.length} αιτήματα`);
  let b;
  while(true){
    b = await client.messages.batches.retrieve(batch.id);
    if(b.processing_status === 'ended') break;
    console.error(`  ${b.processing_status} · σε εξέλιξη ${b.request_counts.processing}`);
    await new Promise(r => setTimeout(r, 60_000));
  }
  const raws = [], failed = {};
  for await (const r of await client.messages.batches.results(batch.id)){
    if(r.result.type !== 'succeeded'){ failed[r.custom_id] = [`αποτέλεσμα ${r.result.type}`]; continue; }
    const m = r.result.message;
    usage.input += m.usage.input_tokens; usage.output += m.usage.output_tokens;
    usage.cacheRead += m.usage.cache_read_input_tokens || 0; usage.cacheWrite += m.usage.cache_creation_input_tokens || 0;
    if(m.stop_reason === 'refusal' || m.stop_reason === 'max_tokens'){ failed[r.custom_id] = [`stop_reason ${m.stop_reason}`]; continue; }
    const text = m.content.filter(c => c.type === 'text').map(c => c.text).join('');
    try { raws.push({id: r.custom_id, ...JSON.parse(text)}); } catch { failed[r.custom_id] = ['Η απάντηση δεν ήταν έγκυρο JSON.']; }
  }
  const built = buildAnalyses(raws, {replace: !!args.replace});
  Object.assign(failed, built.errors);
  report.rounds.push({batch: batch.id, requests: ids.length, ok: built.ok.length, failed: Object.keys(failed).length});
  return failed;
}

let failed = await runBatch(todo);
for(let round = 2; round <= 3 && Object.keys(failed).length; round++) failed = await runBatch(Object.keys(failed), failed);
report.failed = failed;

const cost = usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite;
const ok = report.rounds.reduce((n, r) => n + r.ok, 0);
const out = ['# Παραγωγή αναλύσεων με το Message Batches API', '', `${new Date().toISOString().slice(0, 10)} · μοντέλο \`${MODEL}\``, '',
  `- Αιτήματα: ${report.requested} · εντάξει: ${ok} · αποτυχίες στο τέλος: ${Object.keys(failed).length}`,
  `- Γύροι: ${report.rounds.map(r => `${r.requests}→${r.ok}`).join(', ')}`,
  `- Tokens: εισόδου ${usage.input.toLocaleString('el-GR')} · εξόδου ${usage.output.toLocaleString('el-GR')} · cache read ${usage.cacheRead.toLocaleString('el-GR')} · cache write ${usage.cacheWrite.toLocaleString('el-GR')}`,
  `- Κόστος (τιμές Batches): **$${cost.toFixed(2)}**`, '',
  ...Object.entries(failed).map(([id, e]) => `- ✗ \`${id}\`: ${e.join('; ')}`)];
fs.writeFileSync(path.join(root, 'data/reports/analyses-generation.md'), out.join('\n') + '\n');
console.log(out.join('\n'));
