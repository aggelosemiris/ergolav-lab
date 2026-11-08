// Γραμμή προσφοράς → εργασία με έτοιμη ανάλυση (αντιστοίχιση της Φάσης 3, src/catalog-tasks.js).
// Η γραμμή κρατά το id του είδους και τον κωδικό του τύπου που επιλέχθηκε, άρα η εργασία βγαίνει με ακρίβεια
// και ανά τύπο (κρεμαστή ή δαπέδου λεκάνη). Γραμμές χωρίς εργασία φαίνονται στον τεχνίτη ως «χωρίς ανάλυση».
import { CATALOG } from './catalog.js';
import { CATALOG_TASKS } from './catalog-tasks.js';

const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');

export const WHY = {
  custom: 'Δικό σου είδος, εκτός καταλόγου· δεν υπάρχει έτοιμη ανάλυση.',
  type: 'Τύπος εκτός καταλόγου· δεν υπάρχει έτοιμη ανάλυση.',
  consumable: 'Αναλώσιμο· περιγράφεται μέσα στην εργασία που το χρησιμοποιεί, αν είναι στην προσφορά.',
  missing: 'Δεν υπάρχει ακόμα ανάλυση για αυτή την εργασία.',
};

/** Η εργασία μιας γραμμής: {task, consumable, also} ή {task: null, why}. also: άλλες εργασίες του ίδιου αναλώσιμου. */
export function taskOfLine(line){
  const m = CATALOG_TASKS[line?.id];
  if(!m) return {task: null, why: WHY.custom};
  if(!m.task && !m.options) return {task: null, why: m.why || WHY.custom};
  const words = plain(`${line.name || ''} ${line.desc || ''}`);
  let task = m.task;
  if(m.options){
    // Ο τύπος από τον κωδικό· αν ο τεχνίτης έβαλε άλλο μέγεθος (χωρίς κωδικό), από την ετικέτα στο όνομα.
    const opts = CATALOG.find(c => c.id === line.id)?.options || [];
    const opt = opts.find(o => line.code && o.code === line.code) || opts.find(o => words.includes(plain(o.label)));
    task = opt ? m.options[opt.label] : null;
    const all = new Set(Object.values(m.options));
    if(!task && all.size === 1) task = [...all][0];
    if(!task) return {task: null, why: WHY.type};
  }
  for(const [w, t] of Object.entries(m.qualifiers || {})) if(words.includes(plain(w))) task = t;
  return {task, consumable: !!m.consumable, also: m.also || []};
}

/**
 * Οι εργασίες μιας προσφοράς, με τη σειρά που εμφανίζονται, χωρίς διπλές: [{id, lines}].
 * Ένα αναλώσιμο (κόλλα, σπιράλ…) μπαίνει στην πρώτη από τις εργασίες του (task, also) που υπάρχει από κανονικό
 * είδος της προσφοράς· αλλιώς μένει χωρίς ανάλυση. has(id): αν υπάρχει ανάλυση για την εργασία.
 * without: οι γραμμές χωρίς ανάλυση, με τον λόγο.
 */
export function quoteTasks(lines, has = () => true){
  const found = lines.map(line => ({line, ...taskOfLine(line)}));
  const main = new Set(found.filter(f => f.task && !f.consumable).map(f => f.task));
  const tasks = new Map(), without = [];
  for(const f of found){
    const task = f.consumable ? [f.task, ...f.also].find(t => main.has(t)) : f.task;
    const why = !f.task ? f.why : !task ? WHY.consumable : !has(task) ? WHY.missing : null;
    if(why){ without.push({line: f.line, why}); continue; }
    if(!tasks.has(task)) tasks.set(task, []);
    tasks.get(task).push(f.line);
  }
  return {tasks: [...tasks].map(([id, lines]) => ({id, lines})), without};
}
