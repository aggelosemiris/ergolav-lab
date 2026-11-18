// Μέρος 1: ο χάρτης των τρόπων τοποθέτησης (data/cases/map.json) → έλεγχος συνέπειας, περιπτώσεις, και αναφορές
// docs/ANALYSIS_MAP.md και docs/analysis-map.html (δέντρο ανά υλικό). Κανένα κείμενο ανάλυσης δεν γράφεται εδώ.
//
// Χρήση:  node tools/catalog/analysis-map.mjs           (έλεγχος + αναφορές)
//         node tools/catalog/analysis-map.mjs --check   (μόνο έλεγχος· λάθος → exit 1)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATALOG } from '../../src/catalog.js';
import { CATALOG_TASKS } from '../../src/catalog-tasks.js';
import { ANALYSES } from '../../src/analyses-data.js';
import { cases, enumerate, nextQuestion, caseLabel, covers } from '../../src/case-map.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const loadMap = () => JSON.parse(fs.readFileSync(path.join(root, 'data/cases/map.json'), 'utf8'));
const written = () => Object.assign({}, ...fs.readdirSync(path.join(root, 'data/analyses')).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(root, 'data/analyses', f), 'utf8')).analyses));

// Τα «κλειδιά» των γραμμών: «είδος» ή «είδος:τύπος» ή «είδος:qualifier».
const lineKeys = () => {
  const keys = new Set();
  for(const c of CATALOG){
    keys.add(c.id);
    for(const o of c.options || []) keys.add(`${c.id}:${o.label}`);
    for(const q of c.qualifiers || []) keys.add(`${c.id}:${q.name}`);
  }
  return keys;
};

/** Έλεγχος συνέπειας του χάρτη· επιστρέφει λίστα λαθών. */
export function checkMap(map = loadMap()){
  const err = [], keys = lineKeys(), all = written(), ids = new Set();
  const covered = new Map();   // κλειδί καταλόγου → υλικό
  for(const m of map.materials){
    if(ids.has(m.id)) err.push(`${m.id}: διπλό id υλικού`); ids.add(m.id);
    if(!m.name || !m.acc) err.push(`${m.id}: λείπει όνομα ή αιτιατική`);
    for(const k of m.catalog || []){
      if(!keys.has(k)) err.push(`${m.id}: άγνωστο είδος καταλόγου «${k}»`);
      if(covered.has(k)) err.push(`${m.id}: το «${k}» ανήκει ήδη στο ${covered.get(k)}`);
      covered.set(k, m.id);
    }
    for(const k of m.inside || []) if(!CATALOG_TASKS[k]?.consumable) err.push(`${m.id}: το «${k}» δεν είναι αναλώσιμο`);
    const seen = [];
    for(const q of m.questions){
      const where = `${m.id}.${q.id}`;
      if(!q.ask) err.push(`${where}: λείπει η ερώτηση`);
      if(q.answers.length < 2 || q.answers.length > 4) err.push(`${where}: θέλει 2–4 απαντήσεις`);
      if(new Set(q.answers.map(a => a.id)).size !== q.answers.length) err.push(`${where}: διπλή απάντηση`);
      for(const [wq, wa] of Object.entries(q.when || {})){
        const prev = seen.filter(p => p.id === wq);
        if(!prev.length) err.push(`${where}: το when αναφέρεται σε «${wq}», που δεν έχει ρωτηθεί πριν`);
        else for(const a of wa) if(!prev.some(p => p.answers.some(x => x.id === a))) err.push(`${where}: άγνωστη απάντηση «${wq}=${a}»`);
      }
      if(seen.some(p => p.id === q.id) && !q.when) err.push(`${where}: δεύτερη εκδοχή ερώτησης χωρίς when`);
      for(const [k, a] of Object.entries(q.line || {})){
        if(!keys.has(k)) err.push(`${where}: άγνωστη γραμμή «${k}»`);
        if(!q.answers.some(x => x.id === a)) err.push(`${where}: η γραμμή «${k}» δίνει άγνωστη απάντηση «${a}»`);
      }
      seen.push(q);
    }
    const every = enumerate(m), good = cases(m);
    for(const e of m.exclude || []) if(!every.some(c => c.excluded === e.why)) err.push(`${m.id}: εξαίρεση που δεν πιάνει καμία περίπτωση («${e.why.slice(0, 40)}…»)`);
    for(const b of m.base || []){
      if(!ANALYSES[b.task]) err.push(`${m.id}: η βασική «${b.task}» δεν είναι στην εφαρμογή`);
      if(!good.some(c => c.source === 'base' && c.task === b.task)) err.push(`${m.id}: η βασική «${b.task}» δεν καλύπτει καμία περίπτωση`);
      if(every.some(c => c.excluded && covers(b.answers, c.answers) && Object.keys(b.answers).every(k => k in c.answers))) err.push(`${m.id}: η βασική «${b.task}» πέφτει σε εξαιρεμένη περίπτωση`);
    }
    for(const e of m.existing || []){
      if(!all[e.task]) err.push(`${m.id}: η γραμμένη ανάλυση «${e.task}» δεν υπάρχει`);
      if(!good.some(c => c.source === 'existing' && c.task === e.task)) err.push(`${m.id}: η «${e.task}» δεν καλύπτει καμία νέα περίπτωση`);
    }
    // Κάθε σημερινή εργασία των ειδών του υλικού έχει βασική περίπτωση.
    for(const k of m.catalog || []){
      const [id, label] = k.split(':'), ct = CATALOG_TASKS[id];
      const task = ct?.options ? (label ? ct.options[label] : null) : ct?.task;
      const tasks = task ? [task] : ct?.options ? [...new Set(Object.values(ct.options))] : [];
      for(const t of tasks) if(t && !(m.base || []).some(b => b.task === t)) err.push(`${m.id}: η εργασία «${t}» (από «${k}») δεν έχει βασική περίπτωση`);
    }
  }
  // Κάθε είδος του καταλόγου: σε υλικό, ή αναλώσιμο μέσα σε υλικό.
  const inside = new Set(map.materials.flatMap(m => m.inside || []));
  for(const c of CATALOG){
    const own = [...covered.keys()].filter(k => k === c.id || k.startsWith(`${c.id}:`));
    if(CATALOG_TASKS[c.id]?.consumable){ if(!inside.has(c.id)) err.push(`αναλώσιμο «${c.id}» χωρίς υλικό`); continue; }
    if(!own.length) err.push(`το είδος «${c.id}» δεν είναι σε κανένα υλικό`);
    else if(!own.includes(c.id) && c.options) for(const o of c.options) if(!covered.has(`${c.id}:${o.label}`)) err.push(`ο τύπος «${c.id}:${o.label}» δεν είναι σε κανένα υλικό`);
  }
  const gids = new Set();
  for(const g of map.generic || []){
    if(gids.has(g.id)) err.push(`γενική «${g.id}»: διπλό id`); gids.add(g.id);
    for(const t of g.from) if(!all[t]) err.push(`γενική «${g.id}»: άγνωστη εργασία «${t}»`);
  }
  if(gids.size < 15 || gids.size > 25) err.push(`γενικές κατηγορίες: ${gids.size}, θέλει 15–25`);
  return err;
}

/** Σύνοψη ανά υλικό. */
export function summary(map = loadMap()){
  return map.materials.map(m => {
    const every = enumerate(m), good = cases(m);
    const n = s => good.filter(c => c.source === s).length;
    return {m, every, good, cases: good.length, excluded: every.filter(c => c.excluded), base: n('base'), existing: n('existing'), fresh: n('new')};
  }).sort((a, b) => a.m.order - b.m.order);
}

// ── Αναφορές
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const SOURCE = {base: 'βασική (η σημερινή ανάλυση)', existing: 'υπάρχει γραμμένη ανάλυση', new: 'νέα, γράφεται στο Μέρος 2'};

// Το δέντρο: σε κάθε κόμβο η επόμενη ερώτηση που ισχύει· φύλλα = περιπτώσεις.
function tree(m, answers = {}){
  const q = nextQuestion(m, answers);
  if(!q){
    const c = enumerate(m).find(x => JSON.stringify(x.answers) === JSON.stringify(answers));
    const g = cases(m).find(x => x.id === c.id);
    return {leaf: true, id: c.id, excluded: c.excluded, source: g?.source, task: g?.task};
  }
  return {q, children: q.answers.map(a => ({a, node: tree(m, {...answers, [q.id]: a.id})}))};
}

function md(map, rows){
  const total = k => rows.reduce((n, r) => n + r[k], 0);
  const out = [
    '# Χάρτης των τρόπων τοποθέτησης', '',
    `Από το \`data/cases/map.json\` με το \`node tools/catalog/analysis-map.mjs\`. Μέρος 1: χωρίς κείμενα ακόμα. ${new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Athens'})}.`, '',
    '## Σύνοψη', '',
    `- **${rows.length} υλικά** που χρειάζονται ανάλυση (από τις 41 εγγραφές του καταλόγου· τα 7 αναλώσιμα περιγράφονται μέσα στην εργασία τους, η «ντουζιέρα ή σετ ντους;» είναι ερώτηση).`,
    `- **${total('cases')} περιπτώσεις** που έχουν νόημα (από ${rows.reduce((n, r) => n + r.every.length, 0)} συνδυασμούς· ${total('excludedN')} εξαιρούνται, με τον λόγο).`,
    `- Από αυτές: **${total('base')}** καλύπτει ήδη η σημερινή ανάλυση (βασική), **${total('existing')}** έχουν έτοιμο κείμενο από τις 96 γραμμένες αναλύσεις (θέλουν μόνο έλεγχο), **${total('fresh')}** γράφονται στο Μέρος 2.`,
    `- **${(map.generic || []).length} γενικές κατηγορίες** για υλικά εκτός καταλόγου.`, '',
    '| # | Υλικό | Ερωτήσεις | Περιπτώσεις | Βασική | Έτοιμο κείμενο | Νέες | Εξαιρέσεις |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.m.order} | ${r.m.name} | ${new Set(r.m.questions.map(q => q.id)).size} | ${r.good.length} | ${r.base} | ${r.existing} | ${r.fresh} | ${r.excludedN} |`),
    '', '## Σειρά παραγωγής', '',
    'Πρώτα τα 10 πιο συχνά υλικά, με εκτίμηση από την πρακτική των ανακαινίσεων (η εφαρμογή δεν έχει ακόμα στοιχεία χρήσης· οι ανώνυμες μετρήσεις του Μέρους 4 θα δείξουν την πραγματική σειρά).', '',
    ...rows.map(r => `${r.m.order}. ${r.m.name} — ${r.fresh} νέες περιπτώσεις${r.m.order === 10 ? '\n\n— μετά το 10 —\n' : ''}`), '',
    '## Θέματα κανονισμών και ασφάλειας', '', 'Να τα δει ειδικός πριν εγκριθούν τα κείμενα.', '',
    ...rows.flatMap(r => {
      const notes = [...(r.m.safety || []), ...r.m.questions.flatMap(q => q.answers.filter(a => a.safety).map(a => `«${a.label}»: ${a.safety}`))];
      return notes.length ? [`- **${r.m.name}**`, ...notes.map(n => `  - ${n}`)] : [];
    }), '',
    '## Ανά υλικό', '',
  ];
  for(const r of rows){
    const m = r.m;
    out.push(`### ${m.order}. ${m.name}`, '');
    out.push(`Είδη καταλόγου: ${m.catalog.map(k => `\`${k}\``).join(', ')}${m.inside?.length ? ` · αναλώσιμα μέσα: ${m.inside.map(k => `\`${k}\``).join(', ')}` : ''}`);
    out.push(`Βασική: ${m.base.map(b => `\`${b.task}\``).join(', ')}${m.existing?.length ? ` · έτοιμα κείμενα: ${m.existing.map(e => `\`${e.task}\``).join(', ')}` : ''}`, '');
    out.push('**Ερωτήσεις και λέξεις φωνής**', '');
    for(const q of m.questions){
      const when = q.when ? ` _(μόνο αν ${Object.entries(q.when).map(([k, v]) => `${k} = ${v.join(' ή ')}`).join(', ')})_` : '';
      const line = q.line ? ` _(η γραμμή απαντά: ${Object.entries(q.line).map(([k, v]) => `${k} → ${v}`).join('; ')})_` : '';
      out.push(`- **${q.ask}**${when}${line}`);
      for(const a of q.answers) out.push(`  - ${a.label} \`${a.id}\`${a.words?.length ? ` — λέξεις: ${a.words.map(w => `«${w}»`).join(', ')}` : ''}`);
    }
    out.push('', '**Δέντρο**', '');
    (function walk(node, depth){
      if(node.leaf) return;
      for(const {a, node: child} of node.children){
        const pad = '  '.repeat(depth);
        if(child.leaf) out.push(`${pad}- ${node.q.ask} → **${a.label}** → ${child.excluded ? `~~${child.id}~~ — εξαιρείται: ${child.excluded}` : `\`${child.id}\` — ${SOURCE[child.source]}${child.task ? ` (\`${child.task}\`)` : ''}`}`);
        else { out.push(`${pad}- ${node.q.ask} → **${a.label}**`); walk(child, depth + 1); }
      }
    })(tree(m), 0);
    for(const n of m.lineNotes || []) out.push('', `Σημείωση: ${n}`);
    out.push('');
  }
  out.push('## Γενικές κατηγορίες (υλικά εκτός καταλόγου)', '',
    'Η ανάλυση βγαίνει από τις αναλύσεις των εργασιών της στήλης «Πηγή», με το {είδος} στη θέση του υλικού (Μέρος 2).', '',
    '| Κατηγορία | Παραδείγματα | Πηγή | Λέξεις |', '|---|---|---|---|',
    ...(map.generic || []).map(g => `| ${g.name}${g.safety ? ` ⚠️` : ''} | ${g.examples.join(', ')} | ${g.from.map(t => `\`${t}\``).join(', ')} | ${g.words.map(w => `«${w}»`).join(', ')} |`), '');
  return out.join('\n');
}

function html(map, rows){
  const total = k => rows.reduce((n, r) => n + r[k], 0);
  const leaf = (n, a) => n.excluded
    ? `<li class="leaf ex"><span class="a">${esc(a)}</span><s>${esc(n.id)}</s><small>Εξαιρείται: ${esc(n.excluded)}</small></li>`
    : `<li class="leaf ${n.source}"><span class="a">${esc(a)}</span><code>${esc(n.id)}</code><em>${esc(SOURCE[n.source])}${n.task ? ` · ${esc(n.task)}` : ''}</em></li>`;
  const branch = node => `<ul>${node.children.map(({a, node: c}) => c.leaf ? leaf(c, a.label)
    : `<li><details open><summary><span class="a">${esc(a.label)}</span><span class="q">${esc(c.q.ask)}</span></summary>${branch(c)}</details></li>`).join('')}</ul>`;
  const words = m => m.questions.map(q => `<div class="kw"><b>${esc(q.ask)}</b>${q.when ? `<small>μόνο αν ${esc(Object.entries(q.when).map(([k, v]) => `${k} = ${v.join(' ή ')}`).join(', '))}</small>` : ''}<ul>${q.answers.map(a =>
    `<li>${esc(a.label)}${a.words?.length ? `: ${a.words.map(w => `<mark>${esc(w)}</mark>`).join(' ')}` : ''}${a.safety ? ` <span class="warn">⚠ ${esc(a.safety)}</span>` : ''}</li>`).join('')}</ul></div>`).join('');
  const card = r => {
    const t = tree(r.m), safety = r.m.safety || [];
    return `<section class="mat" id="${esc(r.m.id)}">
  <header><span class="ord">${r.m.order}</span><h2>${esc(r.m.name)}</h2>
    <p class="nums"><b>${r.good.length}</b> περιπτώσεις · <span class="pill base">${r.base} βασική</span> <span class="pill existing">${r.existing} έτοιμο κείμενο</span> <span class="pill new">${r.fresh} νέες</span>${r.excludedN ? ` <span class="pill ex">${r.excludedN} εξαιρούνται</span>` : ''}</p>
    <p class="cat">Από: ${r.m.catalog.map(k => `<code>${esc(k)}</code>`).join(' ')}${r.m.inside?.length ? ` · μέσα: ${r.m.inside.map(k => `<code>${esc(k)}</code>`).join(' ')}` : ''} · βασική: ${r.m.base.map(b => `<code>${esc(b.task)}</code>`).join(' ')}</p></header>
  ${safety.length ? `<div class="safety">${safety.map(s => `<p>⚠ ${esc(s)}</p>`).join('')}</div>` : ''}
  <details class="tree" open><summary>Δέντρο: ${esc(t.q.ask)}</summary>${branch(t)}</details>
  <details class="words"><summary>Ερωτήσεις και λέξεις φωνής</summary>${words(r.m)}</details>
</section>`;
  };
  return `<!doctype html>
<html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Χάρτης τοποθέτησης</title>
<style>
:root{--bg:#F4F4F1;--paper:#FFFFFF;--ink:#1A1D21;--dim:#5E646B;--line:#D9DBD5;--pen:#2140A8;--pen-soft:#E3E8F7;--ok:#1E7A4C;--ok-soft:#E1F2E8;--warn:#A35A00;--warn-soft:#FBEBD2;--new:#6B3FA0;--new-soft:#EFE7F8;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171A;--paper:#1F2226;--ink:#EDEEEA;--dim:#A2A8AE;--line:#34383D;--pen:#8FA6F2;--pen-soft:#243056;--ok:#6CCB97;--ok-soft:#183324;--warn:#F0B35C;--warn-soft:#3A2C16;--new:#C7A6F0;--new-soft:#2E2340}}
:root[data-theme="dark"]{--bg:#15171A;--paper:#1F2226;--ink:#EDEEEA;--dim:#A2A8AE;--line:#34383D;--pen:#8FA6F2;--pen-soft:#243056;--ok:#6CCB97;--ok-soft:#183324;--warn:#F0B35C;--warn-soft:#3A2C16;--new:#C7A6F0;--new-soft:#2E2340}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:20px 16px 60px}
main{max-width:920px;margin:0 auto}
h1{font-size:26px;line-height:1.2;margin-bottom:6px}
.lede{color:var(--dim);max-width:62ch}
.totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:18px 0}
.totals div{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.totals b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
.totals span{color:var(--dim);font-size:13px}
nav{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 22px}
nav a{color:var(--pen);text-decoration:none;background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:13px}
nav a.top{border-color:var(--pen)}
.mat{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:16px;margin-top:14px}
.mat header{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:baseline}
.ord{grid-row:span 3;width:30px;height:30px;border-radius:50%;background:var(--pen-soft);color:var(--pen);display:grid;place-items:center;font-weight:700;font-size:14px}
h2{font-size:19px}
.nums,.cat{color:var(--dim);font-size:13px;overflow-wrap:anywhere}
.pill{display:inline-block;border-radius:999px;padding:0 8px;font-size:12px;font-weight:600}
.pill.base{background:var(--ok-soft);color:var(--ok)}.pill.existing{background:var(--pen-soft);color:var(--pen)}.pill.new{background:var(--new-soft);color:var(--new)}.pill.ex{background:var(--warn-soft);color:var(--warn)}
code{font:12px ui-monospace,Menlo,monospace;background:var(--bg);border-radius:4px;padding:1px 4px;overflow-wrap:anywhere}
.safety{margin-top:10px;background:var(--warn-soft);color:var(--warn);border-radius:10px;padding:8px 12px;font-size:13px}
details{margin-top:10px}
summary{cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center;gap:8px}
.tree ul{list-style:none;margin-left:14px;border-left:2px solid var(--line);padding-left:10px}
.tree>ul{margin-left:4px}
.tree li{margin:4px 0}
.tree summary{font-weight:500}
.a{font-weight:600}
.q{color:var(--dim);font-size:13px}
.leaf{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;padding:4px 8px;border-radius:8px;min-width:0;overflow-wrap:anywhere}
.leaf>*{min-width:0;max-width:100%}
@media (max-width:520px){.tree ul{margin-left:4px;padding-left:7px}.mat{padding:12px}body{padding:16px 10px 48px}}
.leaf em{font-style:normal;font-size:12px;color:var(--dim)}
.leaf.base{background:var(--ok-soft)}.leaf.existing{background:var(--pen-soft)}.leaf.new{background:var(--new-soft)}
.leaf.ex{background:var(--warn-soft);color:var(--warn)}.leaf.ex small{flex-basis:100%;font-size:12px}
.kw{margin-top:8px}.kw small{color:var(--dim);margin-left:6px}.kw ul{margin:4px 0 0 18px}
mark{background:var(--pen-soft);color:var(--pen);border-radius:4px;padding:0 4px;font-size:12px}
.warn{color:var(--warn);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13px;margin-top:10px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
.wrap{overflow-x:auto}
h3{margin-top:30px;font-size:18px}
</style></head><body><main>
<h1>Χάρτης τοποθέτησης</h1>
<p class="lede">Για κάθε υλικό: οι ερωτήσεις που αλλάζουν τα βήματα, όλες οι περιπτώσεις, ποια καλύπτει η σημερινή ανάλυση (βασική) και ποιες γράφονται. Χωρίς κείμενα ακόμα (Μέρος 1).</p>
<div class="totals">
  <div><b>${rows.length}</b><span>υλικά με ανάλυση</span></div>
  <div><b>${total('cases')}</b><span>περιπτώσεις</span></div>
  <div><b>${total('base')}</b><span>καλύπτει η σημερινή</span></div>
  <div><b>${total('existing')}</b><span>έτοιμο κείμενο (από τις 96)</span></div>
  <div><b>${total('fresh')}</b><span>νέες, Μέρος 2</span></div>
  <div><b>${total('excludedN')}</b><span>εξαιρούνται</span></div>
</div>
<nav>${rows.map(r => `<a href="#${esc(r.m.id)}"${r.m.order <= 10 ? ' class="top"' : ''}>${r.m.order}. ${esc(r.m.name)}</a>`).join('')}</nav>
${rows.map(card).join('\n')}
<h3>Γενικές κατηγορίες για υλικά εκτός καταλόγου (${(map.generic || []).length})</h3>
<div class="wrap"><table><tr><th>Κατηγορία</th><th>Παραδείγματα</th><th>Πηγή</th><th>Λέξεις</th></tr>
${(map.generic || []).map(g => `<tr><td><b>${esc(g.name)}</b>${g.safety ? `<br><span class="warn">⚠ ${esc(g.safety)}</span>` : ''}</td><td>${esc(g.examples.join(', '))}</td><td>${g.from.map(t => `<code>${esc(t)}</code>`).join(' ')}</td><td>${g.words.map(w => `<mark>${esc(w)}</mark>`).join(' ')}</td></tr>`).join('\n')}
</table></div>
</main></body></html>
`;
}

if(import.meta.url === pathToFileURL(process.argv[1] || '').href){
  const map = loadMap(), errors = checkMap(map);
  if(errors.length){ console.error(errors.map(e => `✗ ${e}`).join('\n')); process.exit(1); }
  const rows = summary(map).map(r => ({...r, excludedN: r.excluded.length}));
  if(!process.argv.includes('--check')){
    fs.writeFileSync(path.join(root, 'docs/ANALYSIS_MAP.md'), md(map, rows));
    fs.writeFileSync(path.join(root, 'docs/analysis-map.html'), html(map, rows));
  }
  const t = k => rows.reduce((n, r) => n + r[k], 0);
  console.log(`${rows.length} υλικά · ${t('cases')} περιπτώσεις (βασική ${t('base')}, έτοιμο κείμενο ${t('existing')}, νέες ${t('fresh')}) · ${t('excludedN')} εξαιρούνται · ${(map.generic || []).length} γενικές`);
  for(const r of rows) console.log(`  ${String(r.m.order).padStart(2)}. ${r.m.name.padEnd(32)} ${String(r.good.length).padStart(3)} = ${r.base} + ${r.existing} + ${r.fresh}${r.excludedN ? `  (−${r.excludedN})` : ''}`);
}
