// Εργαλείο ανάπτυξης: πόσα προϊόντα πιάνουν οι κανόνες και ποια «κεφάλια» ονομάτων μένουν.
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {classify, norm} from '../taxonomy-rules.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rows = []; for(const f of fs.readdirSync(path.join(root, 'data/raw')).filter(f => f.endsWith('.jsonl'))) for(const l of fs.readFileSync(path.join(root, 'data/raw', f), 'utf8').split('\n')) if(l) rows.push(JSON.parse(l));
const byType = {}, left = {}; let hit = 0, irrelevant = 0;
for(const r of rows){
  const t = classify(r.name, r.category_path);
  if(!t){ const h = norm(r.name).replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(x => x.length > 2 && !/^[a-z]+$/.test(x)).slice(0, 2).join(' '); const k = `${r.trade[0]} | ${h}`; (left[k] ||= {n: 0, ex: r.name}).n++; continue; }
  hit++; if(t.needs === null) irrelevant++; byType[t.id] = (byType[t.id] || 0) + 1;
}
console.log(`rows ${rows.length} · classified ${hit} (${(100 * hit / rows.length).toFixed(1)}%) · of which irrelevant ${irrelevant} · left ${rows.length - hit} in ${Object.keys(left).length} heads`);
const top = Object.entries(left).sort((a, b) => b[1].n - a[1].n);
console.log(top.slice(0, Number(process.env.N || 80)).map(([k, v]) => `${v.n}\t${k}\t${v.ex.slice(0, 60)}`).join('\n'));
if(process.env.TYPES) console.log(Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '));
