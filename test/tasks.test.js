import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskOfLine, quoteTasks, WHY } from '../src/tasks.js';
import { lineFor } from '../src/parse.js';
import { CATALOG } from '../src/catalog.js';
import { CATALOG_TASKS } from '../src/catalog-tasks.js';
import { ANALYSES } from '../src/analyses-data.js';

// Γραμμή όπως τη φτιάχνει ο parser, με τον τύπο που διάλεξε ο τεχνίτης (κωδικός + ετικέτα στο όνομα).
const pick = (id, label, qty = 1) => {
  const item = CATALOG.find(c => c.id === id), o = item.options.find(x => x.label === label);
  return {...lineFor(id, qty), name: `${item.name} ${o.label}`, code: o.code};
};
const has = id => !!ANALYSES[id];

test('κάθε είδος του καταλόγου έχει εργασία με έτοιμη ανάλυση (εκτός από την ερώτηση «ντουζιέρα ή σετ ντους;»)', () => {
  for(const item of CATALOG){
    const m = CATALOG_TASKS[item.id];
    assert.ok(m, `λείπει αντιστοίχιση για ${item.id}`);
    if(item.id === 'showerask'){ assert.equal(m.task, null); continue; }
    const tasks = m.options ? (item.options || []).map(o => m.options[o.label]) : [m.task, ...Object.values(m.qualifiers || {})];
    for(const t of tasks) assert.ok(ANALYSES[t], `${item.id}: λείπει ανάλυση για «${t}»`);
  }
});

test('ο τύπος της γραμμής αλλάζει την εργασία: κρεμαστή ή δαπέδου λεκάνη, νερό ή αποχέτευση', () => {
  assert.equal(taskOfLine(pick('wc', 'κρεμαστή')).task, 'plumb-wc-wall-hung');
  assert.equal(taskOfLine(pick('wc', 'δαπέδου')).task, 'plumb-wc-floor');
  assert.equal(taskOfLine(pick('pipe', 'αποχέτευσης PVC Φ110')).task, 'plumb-drain-network');
  assert.equal(taskOfLine(pick('pipe', 'PPR Φ25')).task, 'plumb-water-network');
  assert.equal(taskOfLine(pick('valve', 'φωτός χωνευτός')).task, 'elec-socket');
  assert.equal(taskOfLine(pick('tank', 'εξωτερικό')).task, 'plumb-cistern-external');
});

test('άλλο μέγεθος χωρίς κωδικό: η ετικέτα στο όνομα, αλλιώς «χωρίς ανάλυση»', () => {
  assert.equal(taskOfLine({id: 'wc', name: 'Λεκάνη κρεμαστή', code: ''}).task, 'plumb-wc-wall-hung');
  assert.deepEqual(taskOfLine({id: 'pipe', name: 'Σωλήνας Φ32', code: ''}), {task: null, why: WHY.type});
});

test('πλακάκι: «τοίχου» στο όνομα ή στην περιγραφή του τεχνίτη → επικόλληση τοίχου', () => {
  assert.equal(taskOfLine(lineFor('tile', 10)).task, 'tile-floor');
  assert.equal(taskOfLine({...lineFor('tile', 10), name: 'Πλακάκι τοίχου'}).task, 'tile-wall');
  assert.equal(taskOfLine({...lineFor('tile', 10), desc: 'Πλακάκι τοιχου μπάνιου 30×60'}).task, 'tile-wall');
});

test('δικό του είδος ή άγνωστη λέξη: χωρίς ανάλυση, με τον λόγο', () => {
  assert.deepEqual(taskOfLine({id: 'unknown', name: 'Ντουλάπι κουζίνας'}), {task: null, why: WHY.custom});
  assert.deepEqual(taskOfLine({name: 'Κάτι'}), {task: null, why: WHY.custom});
});

test('προσφορά: σειρά πρώτης εμφάνισης, διπλές εργασίες μαζί, αναλώσιμα στην εργασία τους', () => {
  const lines = [pick('wc', 'κρεμαστή'), pick('mixer', 'νιπτήρα αναμεικτική'), pick('tank', 'εντοιχισμού'),
    lineFor('hose', 2), {...lineFor('tile', 10), name: 'Πλακάκι τοίχου'}, lineFor('glue', 3), {id: 'unknown', name: 'Ντουλάπι'}];
  const r = quoteTasks(lines, has);
  assert.deepEqual(r.tasks.map(t => t.id), ['plumb-wc-wall-hung', 'plumb-mixer-basin', 'tile-wall']);
  assert.deepEqual(r.tasks[0].lines.map(l => l.id), ['wc', 'tank']);                 // λεκάνη + καζανάκι = μία εργασία
  assert.deepEqual(r.tasks[1].lines.map(l => l.id), ['mixer', 'hose']);              // σπιράλ → μπαταρία
  assert.deepEqual(r.tasks[2].lines.map(l => l.id), ['tile', 'glue']);               // κόλλα → πλακάκι τοίχου
  assert.deepEqual(r.without.map(w => [w.line.name, w.why]), [['Ντουλάπι', WHY.custom]]);
});

test('αναλώσιμο χωρίς την εργασία του: χωρίς ανάλυση· υπηρεσίες μπαίνουν κανονικά', () => {
  const r = quoteTasks([lineFor('glue', 3), lineFor('elbow', 4), lineFor('pressure', 1), lineFor('demolition', 1)], has);
  assert.deepEqual(r.tasks.map(t => t.id), ['plumb-pressure-test', 'gen-demolition']);
  assert.deepEqual(r.without.map(w => w.why), [WHY.consumable, WHY.consumable]);
});

test('εργασία χωρίς ανάλυση στη συσκευή: «δεν υπάρχει ακόμα ανάλυση»', () => {
  const r = quoteTasks([lineFor('heater', 1)], () => false);
  assert.deepEqual(r.tasks, []);
  assert.equal(r.without[0].why, WHY.missing);
});
