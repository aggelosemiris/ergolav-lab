// Σελίδα ανάγνωσης για τις αναλύσεις (όπως θα τις δει ο πελάτης), για έλεγχο από άνθρωπο.
// Χρήση: node tools/catalog/review-analyses.mjs [id …]   → data/reports/analyses-review.md
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {LICENSED_NOTE} from '../../src/analysis-schema.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(root, 'data/analyses'), only = process.argv.slice(2);
const all = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).flatMap(f => Object.values(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).analyses));
const list = only.length ? all.filter(a => only.includes(a.id)) : all;
const md = [`# Αναλύσεις εργασιών — ${list.length} για έλεγχο`, '',
  'Έτσι θα τυπώνονται στο δεύτερο PDF. Η «Σημείωση για τον τεχνίτη» **δεν** τυπώνεται. Τα `[id]` είναι τα σταθερά ids κάθε στοιχείου (για διορθώσεις).', ''];
for(const a of list){
  md.push(`---`, '', `## ${a.title}`, '', `*${a.trade} · ${a.typical_duration}* · \`${a.id}\``, '');
  if(a.requires_licensed_professional) md.push(`> ⚖️ ${LICENSED_NOTE}`, '');
  for(const s of a.sections){
    md.push(`**${s.title}**`, '');
    s.items.forEach((it, n) => md.push(`${s.key === 'steps' ? `${n + 1}.` : '-'} ${it.text} <sub>[${it.id.split('.').slice(1).join('.')}]</sub>`));
    md.push('');
  }
  md.push(`**Υλικά που χρησιμοποιούνται:** ${a.related_consumables.join(', ')}`, '', `> 🔧 Σημείωση για τον τεχνίτη (δεν τυπώνεται): ${a.notes_for_master}`, '');
}
fs.writeFileSync(path.join(root, 'data/reports/analyses-review.md'), md.join('\n') + '\n');
console.log(`data/reports/analyses-review.md · ${list.length} αναλύσεις`);
