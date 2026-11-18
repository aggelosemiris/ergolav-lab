// Σελίδες ελέγχου των κειμένων (Μέρος 2): docs/review/<υλικό>.html και docs/review/index.html.
// Ανά περίπτωση: οι απαντήσεις της και κάθε σημείο κανονική | απλή | σύντομη δίπλα-δίπλα· «Εγκρίνω» / «Θέλει διόρθωση»
// με σχόλιο· εξαγωγή αρχείου αποφάσεων (JSON) που περνά με το tools/catalog/apply-reviews.mjs.
// Οι αποφάσεις μένουν στον browser (localStorage) μέχρι την εξαγωγή· τίποτα δεν στέλνεται πουθενά.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { SECTIONS } from '../../src/analysis-schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
// Το JSON μέσα σε <script>: ποτέ «</script>» ή σχόλια HTML από το κείμενο.
const embed = v => JSON.stringify(v).replace(/</g, '\\u003c');

const CSS = `
:root{--bg:#F4F4F1;--paper:#FFFFFF;--ink:#1A1D21;--dim:#5E646B;--line:#D9DBD5;--pen:#2140A8;--pen-soft:#E3E8F7;--ok:#1E7A4C;--ok-soft:#E1F2E8;--warn:#A35A00;--warn-soft:#FBEBD2;--new:#6B3FA0;--new-soft:#EFE7F8;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171A;--paper:#1F2226;--ink:#EDEEEA;--dim:#A2A8AE;--line:#34383D;--pen:#8FA6F2;--pen-soft:#243056;--ok:#6CCB97;--ok-soft:#183324;--warn:#F0B35C;--warn-soft:#3A2C16;--new:#C7A6F0;--new-soft:#2E2340}}
:root[data-theme="dark"]{--bg:#15171A;--paper:#1F2226;--ink:#EDEEEA;--dim:#A2A8AE;--line:#34383D;--pen:#8FA6F2;--pen-soft:#243056;--ok:#6CCB97;--ok-soft:#183324;--warn:#F0B35C;--warn-soft:#3A2C16;--new:#C7A6F0;--new-soft:#2E2340}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px 16px 120px}
main{max-width:1100px;margin:0 auto}
a{color:var(--pen)}
h1{font-size:24px;line-height:1.2}
.lede{color:var(--dim);max-width:70ch;margin-top:4px}
.bar{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.bar label{font-size:13px;color:var(--dim);display:flex;gap:6px;align-items:center}
input,textarea,select{font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-height:44px}
textarea{width:100%;min-height:60px;margin-top:6px}
button{font:inherit;cursor:pointer;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:6px 12px;font-weight:600}
button.primary{background:var(--pen);border-color:var(--pen);color:#fff}
button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--pen);outline-offset:2px}
.progress{font-size:13px;color:var(--dim);margin-left:auto}
h2{font-size:18px;margin:26px 0 8px}
.case{background:var(--paper);border:1px solid var(--line);border-radius:14px;margin-top:10px}
.case>summary{list-style:none;cursor:pointer;padding:12px 14px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.case>summary::-webkit-details-marker{display:none}
.case>summary b{font-size:16px}
.case .lbl{color:var(--dim);font-size:13px;flex-basis:100%}
.state{font-size:12px;font-weight:700;border-radius:999px;padding:1px 8px;margin-left:auto}
.state.ok{background:var(--ok-soft);color:var(--ok)}.state.fix{background:var(--warn-soft);color:var(--warn)}.state.todo{background:var(--pen-soft);color:var(--pen)}.state.base{background:var(--bg);color:var(--dim)}
.body{padding:0 14px 14px}
.meta{font-size:13px;color:var(--dim)}
.sec{margin-top:12px}
.sec h3{font-size:14px;margin-bottom:4px}
.row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:8px 0;border-top:1px solid var(--line)}
.row>div{min-width:0;overflow-wrap:anywhere}
.row .v small{display:block;font-size:11px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.row .acts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.row .tag{font-size:11px;border-radius:6px;padding:0 6px}
.tag.new{background:var(--new-soft);color:var(--new)}.tag.cur{background:var(--bg);color:var(--dim)}
.decide{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}
.decide .on.ok{background:var(--ok);border-color:var(--ok);color:#fff}
.decide .on.fix{background:var(--warn);border-color:var(--warn);color:#fff}
.decide textarea{flex-basis:100%}
.decide .what{font-size:13px;color:var(--dim)}
.small{font-size:13px}
.note{background:var(--warn-soft);color:var(--warn);border-radius:10px;padding:8px 12px;font-size:13px;margin-top:8px}
.hidden{display:none!important}
@media (max-width:640px){.row{grid-template-columns:1fr}.bar{position:static}}
@media (prefers-reduced-motion:no-preference){.case[open]>.body{animation:in .15s ease-out}@keyframes in{from{opacity:0}to{opacity:1}}}
`;

// Η λογική της σελίδας (τρέχει στον browser).
const APP = String.raw`
const D = JSON.parse(document.getElementById('data').textContent);
const KEY = 'ergolav-review:' + D.material;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let S = {reviewer: '', decisions: {}};
try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} paint(); };
$('reviewer').value = S.reviewer || '';
$('reviewer').oninput = e => { S.reviewer = e.target.value; save(); };
// Αποφάσεις: μόνο για το κείμενο που φαίνεται (ίδιο αποτύπωμα)· ό,τι άλλαξε από τότε ξαναζητά έλεγχο.
const keys = {};
for(const c of D.cases) if(c.review) keys[c.review.key] = c.review;
for(const [, it] of Object.entries(D.items)) keys[it.review.key] = it.review;
for(const x of D.extras) keys[x.review.key] = x.review;
const verdict = k => { const d = S.decisions[k]; return d && d.hash === keys[k].hash ? d.verdict : (keys[k].reviewed ? 'ok' : null); };
const decideHtml = (k, what) => {
  const d = S.decisions[k] && S.decisions[k].hash === keys[k].hash ? S.decisions[k] : null, v = verdict(k);
  return '<div class="decide" data-key="' + esc(k) + '"><span class="what">' + what + '</span>'
    + '<button type="button" class="ok' + (v === 'ok' ? ' on' : '') + '" data-v="ok" aria-pressed="' + (v === 'ok') + '">Εγκρίνω</button>'
    + '<button type="button" class="fix' + (v === 'fix' ? ' on' : '') + '" data-v="fix" aria-pressed="' + (v === 'fix') + '">Θέλει διόρθωση</button>'
    + '<textarea placeholder="Τι να διορθωθεί;" aria-label="Σχόλιο"' + (v === 'fix' ? '' : ' hidden') + '>' + esc(d && d.comment || '') + '</textarea></div>';
};
const item = (id, withSc) => {
  const it = D.items[id];
  return '<div class="row" data-item="' + esc(id) + '">'
    + '<div class="v"><small>Κανονική <span class="tag ' + (it.source === 'new' ? 'new">νέο' : 'cur">σημερινό') + '</span></small>' + esc(it.n) + '</div>'
    + '<div class="v"><small>Απλή</small>' + esc(it.s) + '</div>'
    + '<div class="v"><small>Σύντομη</small>' + esc(it.c) + '</div>'
    + (withSc ? '<div class="acts">' + decideHtml(it.review.key, 'Απλή και σύντομη:') + '</div>' : '') + '</div>';
};
const body = c => {
  let h = '<p class="meta">Περίπτωση: ' + esc(c.label) + ' · ' + esc(c.duration) + (c.task ? ' · κείμενο: ' + esc(c.task) : '') + '</p>';
  if(c.licensed) h += '<p class="note">' + esc(D.licensedNote) + '</p>';
  if(c.safety) h += '<p class="note">Ασφάλεια: ' + esc(c.safety) + '</p>';
  for(const s of D.sections){ const ids = c.sections[s.key] || []; if(!ids.length) continue;
    h += '<div class="sec"><h3>' + esc(s.title) + '</h3>' + ids.map(id => item(id, true)).join('') + '</div>'; }
  if(c.review) h += decideHtml(c.review.key, c.source === 'existing' ? 'Η περίπτωση (έτοιμο κείμενο):' : 'Η περίπτωση (σύνθεση και νέα κείμενα):');
  return h;
};
const groups = [['base', 'Βασικές περιπτώσεις (σημερινές αναλύσεις)', 'Τα κείμενα δεν αλλάζουν· ελέγχεις μόνο την απλή και τη σύντομη εκδοχή.'],
  ['existing', 'Περιπτώσεις με έτοιμο κείμενο', 'Από τις 96 γραμμένες αναλύσεις.'], ['new', D.material === 'generic' ? 'Κατηγορίες' : 'Νέες περιπτώσεις', '']];
let html = '';
for(const [src, title, sub] of groups){
  const list = D.cases.filter(c => c.source === src); if(!list.length) continue;
  html += '<h2>' + title + ' (' + list.length + ')</h2>' + (sub ? '<p class="small meta">' + sub + '</p>' : '');
  for(const c of list) html += '<details class="case" data-case="' + esc(c.id) + '"><summary><b>' + esc(c.title) + '</b><span class="state" data-state="' + esc(c.id) + '"></span><span class="lbl">' + esc(c.label) + '</span></summary><div class="body"></div></details>';
}
if(D.extras.length){
  html += '<h2>Επιπλέον βήματα για το «Λείπει κάτι» (' + D.extras.length + ')</h2>';
  html += '<div class="case" style="padding:0 14px 14px">' + D.extras.map(x => '<div class="sec"><h3>' + esc((D.sections.find(s => s.key === x.section) || {}).title || x.section)
    + (x.when ? ' · <span class="meta">μόνο όταν ' + esc(Object.entries(x.when).map(([k, v]) => k + ' = ' + v.join(' ή ')).join(', ')) + '</span>' : '') + '</h3>'
    + item(x.id, true) + decideHtml(x.review.key, 'Να μπαίνει ως επιπλέον βήμα:') + '</div>').join('') + '</div>';
}
$('cases').innerHTML = html;
// Το σώμα κάθε περίπτωσης φτιάχνεται όταν ανοίξει (οι σελίδες έχουν εκατοντάδες σημεία).
document.querySelectorAll('details.case').forEach(d => d.addEventListener('toggle', () => {
  const b = d.querySelector('.body'); if(d.open && !b.innerHTML) b.innerHTML = body(D.cases.find(c => c.id === d.dataset.case));
}));
document.addEventListener('click', e => {
  const btn = e.target.closest('.decide button'); if(!btn) return;
  const k = btn.closest('.decide').dataset.key, v = btn.dataset.v, prev = S.decisions[k];
  S.decisions[k] = {verdict: v, hash: keys[k].hash, comment: v === 'fix' ? (prev && prev.comment || '') : ''};
  save();
});
document.addEventListener('input', e => {
  const box = e.target.closest('.decide'); if(!box || e.target.tagName !== 'TEXTAREA') return;
  const k = box.dataset.key; S.decisions[k] = Object.assign({verdict: 'fix', hash: keys[k].hash}, S.decisions[k], {comment: e.target.value});
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
});
function paint(){
  // Ίδιο σημείο σε πολλές περιπτώσεις: η απόφαση φαίνεται παντού.
  document.querySelectorAll('.decide').forEach(box => {
    const v = verdict(box.dataset.key);
    box.querySelectorAll('button').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    box.querySelector('textarea').hidden = v !== 'fix';
  });
  for(const c of D.cases){
    const el = document.querySelector('[data-state="' + CSS.escape(c.id) + '"]'); if(!el) continue;
    const ks = [...(c.review ? [c.review.key] : []), ...Object.values(c.sections).flat().map(id => D.items[id].review.key)];
    const vs = ks.map(verdict), fix = vs.includes('fix'), done = vs.every(v => v === 'ok');
    el.className = 'state ' + (fix ? 'fix' : done ? 'ok' : 'todo');
    el.textContent = fix ? 'θέλει διόρθωση' : done ? 'εγκρίθηκε' : vs.filter(Boolean).length + '/' + vs.length;
  }
  const all = Object.keys(keys), dec = all.filter(k => verdict(k));
  $('progress').textContent = dec.length + ' από ' + all.length + ' αποφάσεις · ' + all.filter(k => verdict(k) === 'fix').length + ' για διόρθωση';
}
document.addEventListener('toggle', paint, true);
$('filter').onchange = e => {
  const f = e.target.value;
  document.querySelectorAll('details.case').forEach(d => {
    const st = d.querySelector('.state').className;
    d.classList.toggle('hidden', f === 'todo' ? /\b(ok)\b/.test(st) : f === 'fix' ? !/\bfix\b/.test(st) : false);
  });
};
$('export').onclick = () => {
  if(!S.reviewer.trim()){ $('reviewer').focus(); alert('Γράψε πρώτα το όνομά σου (ποιος ελέγχει).'); return; }
  const decisions = Object.entries(S.decisions).filter(([k, d]) => keys[k] && d.hash === keys[k].hash).map(([key, d]) => ({key, hash: d.hash, verdict: d.verdict, comment: d.comment || ''}));
  const file = {format: 'ergolav-reviews', version: 1, material: D.material, reviewer: S.reviewer.trim(), exported_at: new Date().toISOString(), decisions};
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], {type: 'application/json'}));
  a.download = 'ergolav-elegxos-' + D.material + '-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
};
$('approveSc').onclick = () => {
  // Γρήγορα: όσες απλές/σύντομες δεν έχουν απόφαση, στις ανοιχτές περιπτώσεις.
  document.querySelectorAll('details.case[open] .row .decide').forEach(box => { const k = box.dataset.key; if(!verdict(k)) S.decisions[k] = {verdict: 'ok', hash: keys[k].hash, comment: ''}; });
  save();
};
paint();
`;

function page(out){
  const data = {...out, sections: SECTIONS.map(s => ({key: s.key, title: s.title}))};
  return `<!doctype html>
<html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Έλεγχος: ${esc(out.name)}</title><style>${CSS}</style></head><body><main>
<p class="small"><a href="index.html">← Όλα τα υλικά</a></p>
<h1>Έλεγχος κειμένων: ${esc(out.name)}</h1>
<p class="lede">Άνοιξε κάθε περίπτωση. Για κάθε σημείο: κανονική | απλή | σύντομη. Η εφαρμογή χρησιμοποιεί μόνο ό,τι εγκρίνεις. Οι αποφάσεις μένουν σε αυτόν τον browser· στο τέλος πάτα «Εξαγωγή» και στείλε το αρχείο.</p>
${out.note ? `<p class="note">${esc(out.note)}</p>` : ''}
<div class="bar">
  <label>Ελέγχει <input id="reviewer" autocomplete="name" placeholder="Το όνομά σου"></label>
  <label>Δείξε <select id="filter"><option value="all">όλες</option><option value="todo">χωρίς απόφαση</option><option value="fix">για διόρθωση</option></select></label>
  <button type="button" id="approveSc">Εγκρίνω τις απλές/σύντομες των ανοιχτών</button>
  <button type="button" class="primary" id="export">Εξαγωγή αποφάσεων</button>
  <span class="progress" id="progress"></span>
</div>
<div id="cases"></div>
</main>
<script id="data" type="application/json">${embed(data)}</script>
<script>${APP}</script>
</body></html>
`;
}

export function writeReviewPages(map, res){
  const dir = path.join(root, 'docs/review');
  fs.mkdirSync(dir, {recursive: true});
  const rows = [];
  for(const [id, r] of Object.entries(res)){
    fs.writeFileSync(path.join(dir, `${id}.html`), page(r.out));
    const o = r.out, items = Object.values(o.items);
    const keys = [...o.cases.filter(c => c.review).map(c => c.review), ...items.map(i => i.review), ...o.extras.map(x => x.review)];
    rows.push({id, name: o.name, order: map.materials.find(m => m.id === id)?.order ?? map.materials.length + 1, cases: o.cases.length, fresh: o.cases.filter(c => c.source === 'new').length,
      items: items.length, decisions: keys.length, ok: keys.filter(k => k.reviewed).length});
  }
  rows.sort((a, b) => a.order - b.order);
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Έλεγχος κειμένων</title><style>${CSS}
table{width:100%;border-collapse:collapse;background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:14px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}td.n{font-variant-numeric:tabular-nums}
@media (max-width:520px){.opt{display:none}th,td{padding:8px 6px;font-size:14px}}</style></head><body><main>
<h1>Έλεγχος κειμένων ανάλυσης</h1>
<p class="lede">Ένα υλικό τη φορά. Η εφαρμογή χρησιμοποιεί μόνο τα εγκεκριμένα· οι σημερινές αναλύσεις δουλεύουν πάντα, όπως σήμερα.</p>
<table><tr><th>Υλικό</th><th>Περιπτ.</th><th>Νέες</th><th class="opt">Σημεία</th><th>Εγκρίσεις</th></tr>
${rows.map(r => `<tr><td><a href="${esc(r.id)}.html">${r.order}. ${esc(r.name)}</a></td><td class="n">${r.cases}</td><td class="n">${r.fresh}</td><td class="n opt">${r.items}</td><td class="n">${r.ok}/${r.decisions}</td></tr>`).join('\n')}
</table></main></body></html>
`);
}
