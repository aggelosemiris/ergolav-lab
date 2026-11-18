// Αλλαγές του μάστορα πάνω σε μια ανάλυση (από το «Άλλαξέ το» χωρίς AI): σειρά, προσθήκη, αφαίρεση, δικό του
// κείμενο, εκδοχή λόγου ενός σημείου. Κάθε αλλαγή είναι μικρό αντικείμενο, ώστε να κρατιέται ανά προσφορά ή ως κανόνας
// και να ξαναμπαίνει σε κάθε νέα ανάλυση του ίδιου υλικού. Όλες είναι ασφαλείς να ξαναεφαρμοστούν (ίδιο αποτέλεσμα)
// και αγνοούνται όταν δεν ταιριάζουν (π.χ. σημείο που δεν υπάρχει σε αυτή την περίπτωση).
//   {op:'order',   section, order:[ids]}
//   {op:'add',     section, item:{id, text}}
//   {op:'remove',  item}
//   {op:'replace', item, text}
//   {op:'variant', item, variant:'s'|'c'}
import { SECTIONS } from './analysis-schema.js';

export const MAX_TEXT = 320;
const spec = key => SECTIONS.find(s => s.key === key);

/** Νέα ανάλυση με τις αλλαγές· η αρχική δεν πειράζεται. changed: τα ids των σημείων που άλλαξαν ή μπήκαν. */
export function applyEdits(analysis, ops = [], data = {items: {}}){
  const changed = new Set();
  const sections = analysis.sections.map(s => ({...s, items: s.items.map(it => ({...it}))}));
  const find = id => { for(const s of sections){ const i = s.items.findIndex(it => it.id === id); if(i >= 0) return {s, i}; } return null; };
  for(const op of Array.isArray(ops) ? ops : []){
    if(!op || typeof op !== 'object') continue;
    if(op.op === 'order'){
      const s = sections.find(x => x.key === op.section);
      if(!s || !Array.isArray(op.order)) continue;
      const pos = id => { const i = op.order.indexOf(id); return i < 0 ? Infinity : i; };
      const sorted = s.items.map((it, n) => ({it, n})).sort((a, b) => pos(a.it.id) - pos(b.it.id) || a.n - b.n).map(x => x.it);
      sorted.forEach((it, n) => { if(s.items[n].id !== it.id) changed.add(it.id); });
      s.items = sorted;
    } else if(op.op === 'add'){
      const s = sections.find(x => x.key === op.section);
      const t = typeof op.item?.text === 'string' ? op.item.text.trim().slice(0, MAX_TEXT) : '';
      if(!s || !op.item?.id || !t || find(op.item.id) || s.items.length >= spec(s.key).max) continue;
      s.items.push({id: op.item.id, text: t});
      changed.add(op.item.id);
    } else if(op.op === 'remove'){
      const f = find(op.item);
      if(!f || f.s.items.length <= spec(f.s.key).min) continue;
      f.s.items.splice(f.i, 1);
    } else if(op.op === 'replace'){
      const f = find(op.item), t = typeof op.text === 'string' ? op.text.trim().slice(0, MAX_TEXT) : '';
      if(!f || !t || f.s.items[f.i].text === t) continue;
      f.s.items[f.i].text = t;
      changed.add(op.item);
    } else if(op.op === 'variant'){
      const f = find(op.item), t = data.items?.[op.item]?.[op.variant];
      if(!f || !t || f.s.items[f.i].text === t) continue;
      f.s.items[f.i].text = t;
      changed.add(op.item);
    }
  }
  return {analysis: {...analysis, sections}, changed: [...changed]};
}

/** Ίδια αλλαγή δύο φορές = μία (η τελευταία ισχύει)· κρατά τη σειρά. */
export function mergeOps(...lists){
  const key = o => o.op === 'order' ? `order:${o.section}` : o.op === 'add' ? `add:${o.item?.id}` : `${o.op}:${o.item}`;
  const out = new Map();
  for(const o of lists.flat()) if(o && typeof o === 'object' && o.op){
    const k = key(o);
    // Βγάλ' το μετά από αλλαγή κειμένου: η αλλαγή κειμένου δεν χρειάζεται πια.
    if(o.op === 'remove') for(const p of ['replace', 'variant']) out.delete(`${p}:${o.item}`);
    out.delete(k);
    out.set(k, o);
  }
  return [...out.values()];
}
