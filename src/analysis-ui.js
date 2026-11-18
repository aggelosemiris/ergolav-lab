// Ανάλυση εργασιών: δεύτερο PDF για τον πελάτη με τα στάδια κάθε εργασίας της προσφοράς (έτοιμες αναλύσεις
// της Φάσης 4, ή η εκδοχή του τεχνίτη). Ο τεχνίτης τη βλέπει πριν φύγει. Πατά μια ενότητα ή ένα βήμα → «Άλλαξέ το»
// → το AI ξαναγράφει μόνο εκείνο το σημείο → πριν/μετά δίπλα δίπλα → «Κράτα το νέο». Και «Οι κανόνες μου».
// Το PDF βγαίνει και χωρίς σύνδεση· σύνδεση θέλει μόνο το «Άλλαξέ το».
import { ANALYSES } from './analyses-data.js';
import { SECTIONS, LICENSED_NOTE } from './analysis-schema.js';
import { quoteTasks, WHY } from './tasks.js';
import * as CONFIG from './config.js';
import { CASE_DATA } from './cases-data.js';
import { pickAnalysis, pickTag, voiceFor } from './case-pick.js';
import { pickRules, quotePicks, quoteEdits, quoteSnapshot, saveQuoteSnapshot, caseRules, removeCaseRule, speechRule, removeSpeechRule,
  editRules, removeEditRule, restoreAll } from './allaxe-store.js';
import { applyEdits, mergeOps } from './analysis-edits.js';
import { library, libKey, saveLibrary, removeLibrary, officialAsked, setOfficialAsked } from './allaxe-store.js';
import { analysisForAnswers } from './case-pick.js';
import { createSync } from './allaxe-sync.js';
import { mountBot, undoToast } from './allaxe-ui.js';
import { getVersion, saveVersion, resetVersion, listRules, addRule, updateRule, deleteRule, deviceId } from './analysis-store.js';
import { QUICK, MESSAGES, personalFrom, rewriteRequest, applyRewrite, rewriteSection, ruleFrom } from './rewrite-client.js';
import { createMic, micSupported } from './mic.js';
import { makePdf } from './share.js';
import { formatQty } from './number.js';

// Μόνο ρητό true ανοίγει το bot· config χωρίς τη σημαία (π.χ. παλιό ή mock) = όπως πριν.
const ALLAXE_BOT_ENABLED = CONFIG.ALLAXE_BOT_ENABLED === true;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const FOOT = 'Η ανάλυση περιγράφει τη συνήθη σειρά εργασιών για τα είδη της προσφοράς. Αν στον χώρο σας χρειαστεί κάποια αλλαγή, θα σας το πούμε πριν γίνει. Τιμές και όροι είναι αυτοί της προσφοράς.';
const ordered = key => !!SECTIONS.find(s => s.key === key)?.ordered;
const list = (key, texts, li = t => esc(t), start = 1) => {
  const tag = ordered(key) ? 'ol' : 'ul';
  return `<${tag}${tag === 'ol' && start > 1 ? ` start="${start}"` : ''}>${texts.map(t => `<li>${li(t)}</li>`).join('')}</${tag}>`;
};

/** Οι εργασίες μιας προσφοράς με έτοιμη ανάλυση, και οι γραμμές χωρίς. */
export const analysisFor = lines => quoteTasks(lines, id => !!ANALYSES[id]);
/** Η ανάλυση που ισχύει για μια εργασία: η εκδοχή του τεχνίτη, αλλιώς η αρχική. */
const current = id => { const mine = getVersion(id); return {analysis: mine || ANALYSES[id], mine: !!mine}; };

// Οι γραμμές μιας προσφοράς ως «υπογραφή»: στιγμιότυπο ανάλυσης ισχύει μόνο για τις ίδιες ακριβώς γραμμές.
const signature = lines => JSON.stringify(lines.map(l => [l.id, l.code || '', l.name || '', l.desc || '', l.qty, l.unit || '']));
/**
 * Οι εργασίες με την ανάλυσή τους. ALLAXE_BOT_ENABLED = false: ακριβώς όπως πριν (αρχική ή εκδοχή του τεχνίτη).
 * true: η περίπτωση από επιλογή «μόνο εδώ» > κανόνα > φωνή > βασική (src/case-pick.js), μόνο εγκεκριμένα κείμενα.
 * Προσφορά που έχει σταλεί, με τις ίδιες γραμμές: ακριβώς το στιγμιότυπο που μπήκε στο PDF της.
 */
export function collect(q){
  if(!ALLAXE_BOT_ENABLED){
    const r = analysisFor(q.lines);
    return {docs: r.tasks.map(t => ({...t, ...current(t.id)})), without: r.without};
  }
  const r = quoteTasks(q.lines, () => true);
  const snap = q.status && q.status !== 'draft' ? quoteSnapshot(q.no) : null;
  if(snap && snap.sig === signature(q.lines))
    return {docs: snap.docs.map(d => ({...d, mine: false, frozen: true})), without: r.without};
  const rules = pickRules(), picks = quotePicks(q.no), edits = quoteEdits(q.no), docs = [], without = [...r.without];
  for(const t of r.tasks){
    const pick = pickAnalysis({data: CASE_DATA, base: ANALYSES, task: t.id, lines: t.lines, voice: voiceFor(q.voice, t.lines), rules, chosen: picks[t.id] || null});
    // Οι αλλαγές του μάστορα: πρώτα ο κανόνας του υλικού, μετά όσες έκανε «μόνο εδώ».
    const ops = pick && mergeOps(rules.edits[pick.material || `task:${t.id}`]?.ops || [], edits[t.id] || []);
    if(pick) docs.push({...t, analysis: ops.length ? applyEdits(pick.analysis, ops, CASE_DATA).analysis : pick.analysis, mine: false, pick});
    else for(const line of t.lines) without.push({line, why: WHY.missing});
  }
  // Είδη εκτός καταλόγου (Μέρος 5): από τη βιβλιοθήκη του μάστορα, αλλιώς πλαίσιο «Φτιάξε ανάλυση».
  const lib = library(), items = [], seen = new Map();
  for(const w of [...without]){
    if(w.why !== WHY.custom && w.why !== WHY.type) continue;
    const name = (w.line.desc || w.line.name || '').trim(), key = libKey(name);
    if(!key) continue;
    without.splice(without.indexOf(w), 1);
    if(seen.has(key)){ seen.get(key).lines.push(w.line); continue; }
    const e = lib[key];
    if(e){
      const src = e.createdIn === q.no ? ({generic: 'generic', own: 'own', case: 'chosen'}[e.kind] || 'library') : 'library';
      const cat = CASE_DATA.genericCategories.find(g => g.id === e.category);
      const official = CASE_DATA.promoted?.[key];
      const d = {id: `lib:${key}`, lines: [w.line], analysis: e.analysis, mine: false, library: key, name: e.name,
        pick: {source: src, material: e.material || null, label: e.kind === 'generic' ? cat?.name || '' : e.label || '', variant: 'n', caseId: null},
        ...(official && e.kind !== 'official' && !officialAsked(key) && {officialOffer: official})};
      docs.push(d); seen.set(key, d);
    } else {
      const it = {key, name, lines: [w.line]};
      items.push(it); seen.set(key, it);
    }
  }
  return {docs, without, items};
}

/**
 * show/cta: της εφαρμογής. quote(): {no, at, client, profile, lines} της προσφοράς που φαίνεται· head(): η κεφαλίδα
 * του PDF της προσφοράς (ίδιο στυλ)· fileName(): όνομα αρχείου· quoteFile(): Promise με το PDF της προσφοράς.
 * onReady(file)/onDiscard(): η ανάλυση μπαίνει/βγαίνει από την αποστολή· onSend(): «Στείλε και τα δύο»· onBack().
 */
export function mountAnalysis({show, cta, quote, head, fileName, quoteFile, onReady, onDiscard, onSend, onBack, db}){
  // Συγχρονισμός με τον λογαριασμό (μόνο με το flag και μόνο αν υπάρχει σύνδεση)· μετά ξαναζωγραφίζει ό,τι ήρθε.
  const sync = ALLAXE_BOT_ENABLED ? createSync(db) : null;
  const syncThen = () => sync?.().then(r => { if(r?.pulled){ paintMyRules(); if(onScreen()) reload(); } });
  if(sync) globalThis.addEventListener?.('online', () => syncThen());
  let docs = [], without = [], items = [], file = null, attached = false, gen = 0;
  const onScreen = () => $('s-analysis').classList.contains('on');
  const status = msg => { $('anStatus').textContent = msg || ''; $('anStatus').hidden = !msg; };

  // ── Η οθόνη και το PDF
  function open(){
    syncThen();
    ({docs, without, items = []} = collect(quote()));
    show('s-analysis', 'Ανάλυση εργασιών');
    status('');
    render();
    if(attached && file) restoreCta(); else prepare();
  }
  function render(){
    deselect();
    const q = quote();
    $('anNone').hidden = docs.length > 0;
    $('apdf').hidden = !docs.length;
    $('apdf').innerHTML = docs.length ? `${head()}
      <h2>Ανάλυση εργασιών</h2>
      <div class="who">Συνοδευτικό της προσφοράς Αρ. ${esc(q.no)}${q.client ? ` · Προς: ${esc(q.client)}` : ''}</div>
      <p class="an-intro">Τι θα γίνει σε κάθε εργασία, με ποια σειρά, και τι ελέγχουμε πριν σας την παραδώσουμε.</p>
      ${docs.map((d, n) => taskHtml(d, docs.length > 1 ? `${n + 1}. ` : '')).join('')}
      <p class="foot">${FOOT}</p>` : '';
    // Μόνο για τον τεχνίτη (δεν μπαίνουν στο PDF): γραμμές χωρίς ανάλυση, δικές του εκδοχές, σημειώσεις.
    $('anWithout').hidden = !without.length && !items.length && !docs.some(d => d.officialOffer);
    $('anWithout').innerHTML = (ALLAXE_BOT_ENABLED ? itemsHtml() : '') + (without.length ? `<b>Χωρίς ανάλυση · δεν μπαίνουν στο PDF</b><ul>${without.map(w =>
      `<li><span>${esc(w.line.desc || w.line.name)}</span><small>${esc(w.why)}</small></li>`).join('')}</ul>` : '');
    const mine = docs.filter(d => d.mine);
    $('anMine').hidden = !mine.length;
    $('anMine').innerHTML = `<b>Δικές σου εκδοχές</b><p>Μπαίνουν σε κάθε προσφορά με αυτή την εργασία. Η αρχική γυρνά με την «Επαναφορά».</p>${mine.map(d =>
      `<div class="an-mine-row"><span>${esc(d.analysis.title)}</span><button class="q-del" data-reset="${esc(d.id)}">Επαναφορά</button></div>`).join('')}`;
    $('anMine').querySelectorAll('[data-reset]').forEach(b => b.onclick = () => {
      if(!b.classList.contains('sure')){ b.classList.add('sure'); b.textContent = 'Σίγουρα;'; return; }
      resetVersion(b.dataset.reset); refresh(b.dataset.reset);
      status('Η εργασία γύρισε στην αρχική ανάλυση.');
    });
    const notes = docs.filter(d => d.analysis.notes_for_master);
    $('anNotes').hidden = !notes.length;
    $('anNotes').innerHTML = `<summary>Σημειώσεις για σένα · δεν μπαίνουν στο PDF</summary><ul>${notes.map(d =>
      `<li><b>${esc(d.analysis.title)}:</b> ${esc(d.analysis.notes_for_master)}</li>`).join('')}</ul>`;
    syncRulesLink();
  }
  // Η ετικέτα της περίπτωσης (μόνο με ALLAXE_BOT_ENABLED) φαίνεται μόνο εδώ: το data-html2canvas-ignore την κρατά έξω από το PDF.
  function taskHtml({id, analysis: a, lines, pick, frozen}, num){
    const sec = s => `<h4 data-sel="${s.key}" tabindex="0">${esc(s.title)}</h4>` + (ordered(s.key) ? '<ol>' : '<ul>') +
      s.items.map((it, i) => `<li data-sel="${s.key}" data-i="${i}" tabindex="0">${esc(it.text)}</li>`).join('') + (ordered(s.key) ? '</ol>' : '</ul>');
    const [first, ...rest] = ALLAXE_BOT_ENABLED ? a.sections.filter(s => s.items.length) : a.sections;
    return `<section class="an-task" data-task="${esc(id)}">
      <div class="an-top"><h3>${num}${esc(a.title)}</h3>
        ${pick ? `<p class="an-case" data-html2canvas-ignore>${esc(pickTag(pick, CASE_DATA))}</p>` : ''}
        ${pick && !frozen ? `<button type="button" class="an-change" data-change="${esc(id)}" data-html2canvas-ignore>✏️ Άλλαξέ το</button>` : ''}
        <div class="an-for">Αφορά: ${lines.map(l => `${esc(l.desc || l.name)} · ${formatQty(l.qty)} ${esc(l.unit)}`).join(', ')}</div>
        ${a.requires_licensed_professional ? `<p class="an-lic">${esc(LICENSED_NOTE)}</p>` : ''}
        <div class="an-sec">${sec(first)}</div></div>
      ${rest.map(s => `<div class="an-sec">${sec(s)}</div>`).join('')}
      ${!ALLAXE_BOT_ENABLED || a.typical_duration ? `<p class="an-dur"><b>Διάρκεια:</b> ${esc(a.typical_duration)}</p>` : ''}
    </section>`;
  }
  // Το PDF φτιάχνεται μόλις φανεί (και ξανά μετά από κάθε αλλαγή), ώστε το «Στείλε» να ανοίγει αμέσως.
  async function prepare(){
    const run = ++gen;
    file = null;
    if(attached){ attached = false; onDiscard(); }
    deselect();
    if(!docs.length) return restoreCta();
    cta('Ετοιμάζω το PDF της ανάλυσης…', null, true);
    try {
      const f = await makePdf($('apdf'), fileName());
      const offer = await quoteFile();
      if(run !== gen) return;
      if(!offer) throw new Error('Δεν έγινε το PDF της προσφοράς. Γύρνα πίσω και δοκίμασε ξανά.');
      file = f; attached = true; onReady(f);
      // Το στιγμιότυπο αυτού που μπήκε στο PDF: μετά την αποστολή, η προσφορά κρατά ακριβώς αυτή την ανάλυση.
      if(ALLAXE_BOT_ENABLED){
        const q = quote();
        saveQuoteSnapshot(q.no, signature(q.lines), docs.map(({id, lines, analysis, pick}) => ({id, lines, analysis, pick})));
      }
      restoreCta();
    } catch(e){
      if(run === gen && onScreen()) cta('Δοκίμασε ξανά', prepare, false, e.message || 'Δεν έγινε το PDF.');
    }
  }
  function restoreCta(){
    if(!onScreen()) return;
    if(!docs.length) cta('Πίσω στην προσφορά', back);
    else if(file) cta('Στείλε και τα δύο PDF', onSend, false, '');
    else cta('Ετοιμάζω το PDF της ανάλυσης…', null, true);
  }
  function refresh(id){
    const d = docs.find(x => x.id === id);
    if(d) Object.assign(d, current(id));
    render();
    prepare();
  }
  function back(){ deselect(); onBack(); }
  $('anBack').onclick = back;

  // Η κάρτα στην προεπισκόπηση της προσφοράς. Διπλό πάτημα στο «Έλεγξα»: το δεύτερο πέφτει εκεί που ήταν το κουμπί,
  // όπου μπορεί να βρεθεί αυτή η κάρτα· γι' αυτό τα κουμπιά της αγνοούν πατήματα για λίγο μετά την εμφάνιση της οθόνης.
  let shownAt = 0;
  const ghost = () => Date.now() - shownAt < 700;
  function refreshEntry(shown = true){
    if(shown) shownAt = Date.now();
    const c = ALLAXE_BOT_ENABLED ? collect(quote()) : null;
    const n = c ? c.docs.length : analysisFor(quote().lines).tasks.length, todo = c?.items?.length || 0;
    $('anEntryText').textContent = attached ? 'Θα σταλεί μαζί με την προσφορά, ως δεύτερο PDF.'
      : n ? `Δεύτερο PDF με τα στάδια ${n === 1 ? 'της εργασίας' : `των ${n} εργασιών`}, στο ίδιο στυλ με την προσφορά.`
      : todo ? 'Τα είδη αυτής της προσφοράς δεν έχουν ακόμα έτοιμη ανάλυση. Μπορείς να τη φτιάξεις από εδώ.'
      : 'Τα είδη αυτής της προσφοράς δεν έχουν ακόμα έτοιμη ανάλυση.';
    $('anOpen').hidden = !n && !todo;
    $('anOpen').textContent = attached ? 'Δες ή άλλαξέ την' : 'Φτιάξε και ανάλυση εργασιών';
    $('anRemove').hidden = !attached;
  }
  $('anOpen').onclick = () => { if(!ghost()) open(); };
  $('anRemove').onclick = () => { if(ghost()) return; gen++; detach(); onDiscard(); refreshEntry(false); };
  function detach(){ file = null; attached = false; }
  function reset(){ gen++; detach(); docs = []; without = []; closeRewrite(); $('apdf').innerHTML = ''; }

  // ── Επιλογή σημείου: πάτημα σε ενότητα ή βήμα → «Άλλαξέ το»
  let selEl = null;
  function deselect(){ selEl?.classList.remove('sel'); selEl?.querySelector('.sel-go')?.remove(); selEl = null; }
  function select(el){
    // Με ALLAXE_BOT_ENABLED το «Άλλαξέ το» με AI (worker/REWRITE_URL) δεν ανοίγει ποτέ· ανοίγει το bot χωρίς AI.
    const task = el.closest('[data-task]').dataset.task;
    if(ALLAXE_BOT_ENABLED && !docs.find(d => d.id === task)?.pick) return;
    if(ALLAXE_BOT_ENABLED && docs.find(d => d.id === task)?.frozen) return status('Η προσφορά έχει σταλεί· η ανάλυσή της μένει όπως στάλθηκε.');
    if(selEl === el) return;
    deselect();
    selEl = el;
    el.classList.add('sel');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sel-go'; b.textContent = '✏️ Άλλαξέ το';
    b.onclick = e => {
      e.stopPropagation();
      if(ALLAXE_BOT_ENABLED) return openBot(task, el.dataset.sel, el.dataset.i == null ? null : Number(el.dataset.i));
      openRewrite(task, el.dataset.sel, el.dataset.i == null ? null : Number(el.dataset.i));
    };
    el.append(b);
  }
  $('apdf').addEventListener('click', e => {
    const ch = e.target.closest('[data-change]');
    if(ch) return openBot(ch.dataset.change, null, null);
    const el = e.target.closest('[data-sel]'); if(el) select(el); else deselect();
  });

  // ── «Άλλαξέ το» χωρίς AI (ALLAXE_BOT_ENABLED): το bot, οι αλλαγές του, το φώτισμα και η «Αναίρεση»
  let flashIds = [];
  const texts = task => Object.fromEntries((docs.find(d => d.id === task)?.analysis.sections || []).flatMap(s => s.items.map(i => [i.id, i.text])));
  const bot = ALLAXE_BOT_ENABLED ? mountBot({
    getDoc: task => docs.find(d => d.id === task),
    quote,
    onApplied(task, undo){
      if(!onScreen()){ paintMyRules(); undoToast(() => { restoreAll(undo); paintMyRules(); }); return; }
      const before = texts(task);
      reload();
      const after = texts(task);
      flashIds = Object.keys(after).filter(id => after[id] !== before[id]);
      // Ίδια σημεία με άλλη σειρά: φωτίζονται όσα άλλαξαν θέση.
      const b = Object.keys(before), a = Object.keys(after);
      if(!flashIds.length) flashIds = a.filter((id, n) => b[n] !== id);
      if(!bot?.isOpen()) flash(task);
      undoToast(() => { restoreAll(undo); reload(); status('Η αλλαγή αναιρέθηκε.'); paintMyRules(); });
    },
    onRules(){ paintMyRules(); syncRulesLink(); },
    onClose(){ for(const d of docs) flash(d.id); },
  }) : null;
  function itemsHtml(){
    const offers = docs.filter(d => d.officialOffer);
    return items.map(it => `<div class="an-item"><p>Δεν υπάρχει έτοιμη ανάλυση για «${esc(it.name)}». Ο πελάτης δεν βλέπει αυτή την εργασία μέχρι να φτιαχτεί.</p>
      <button type="button" class="an-make" data-make="${esc(it.key)}">Φτιάξε ανάλυση</button></div>`).join('')
      + offers.map(d => `<div class="an-item"><p>Υπάρχει πλέον έτοιμη ανάλυση για «${esc(d.name)}». Να τη χρησιμοποιώ;</p>
      <div class="an-item-act"><button type="button" class="an-make" data-official="${esc(d.library)}" data-yes="1">Ναι</button><button type="button" class="an-keep" data-official="${esc(d.library)}">Κράτα τη δική μου</button></div></div>`).join('');
  }
  $('anWithout').addEventListener('click', e => {
    const mk = e.target.closest('[data-make]');
    if(mk && bot){ const it = items.find(x => x.key === mk.dataset.make); if(it) bot.openItem(it.name); return; }
    const of = e.target.closest('[data-official]');
    if(of){
      const key = of.dataset.official, d = docs.find(x => x.library === key);
      if(of.dataset.yes && d){
        const m = CASE_DATA.materials.find(x => x.id === d.officialOffer);
        const r = m && analysisForAnswers(CASE_DATA, ANALYSES, m.id, m.base[0]?.answers || {});
        if(r) saveLibrary(d.name, {kind: 'official', material: m.id, label: r.label, analysis: r.analysis});
      }
      setOfficialAsked(key);
      reload();
    }
  });
  function openBot(task, section, index){
    deselect();
    const d = docs.find(x => x.id === task);
    if(d?.library && !d.frozen) return bot.openItem(d.name);
    if(!d?.pick || d.frozen) return;
    const s = d.analysis.sections.find(x => x.key === section);
    bot.open(task, index == null || !s ? null : {section, id: s.items[index]?.id});
  }
  function reload(){ ({docs, without, items = []} = collect(quote())); render(); prepare(); }
  function flash(task){
    if(!flashIds.length || matchMedia('(prefers-reduced-motion: reduce)').matches){ flashIds = []; return; }
    const sec = $('apdf').querySelector(`[data-task="${CSS.escape(task)}"]`);
    const d = docs.find(x => x.id === task);
    if(!sec || !d) return;
    const ids = new Set(flashIds); flashIds = [];
    d.analysis.sections.forEach(s => s.items.forEach((it, i) => {
      if(ids.has(it.id)) sec.querySelector(`li[data-sel="${s.key}"][data-i="${i}"]`)?.classList.add('flash');
    }));
    setTimeout(() => sec.querySelectorAll('.flash').forEach(x => x.classList.remove('flash')), 1500);
  }
  // Οι κανόνες του bot ως ετικέτες με ×: κάτω από την ανάλυση και στο «Οι κανόνες μου».
  function botRules(){
    const out = [];
    for(const [m, r] of Object.entries(caseRules())) out.push({label: r.label || m, remove: () => removeCaseRule(m)});
    const v = speechRule();
    if(v) out.push({label: v === 's' ? 'Πάντα απλά λόγια' : 'Πάντα σύντομα', remove: removeSpeechRule});
    for(const [k, r] of Object.entries(editRules())) out.push({label: r.label || k, remove: () => removeEditRule(k)});
    return out;
  }
  function chips(box, empty){
    const rules = botRules();
    box.replaceChildren();
    const h = document.createElement('b'); h.textContent = 'Οι κανόνες μου'; box.append(h);
    if(!rules.length){ const p = document.createElement('p'); p.textContent = empty; box.append(p); return; }
    const wrap = document.createElement('div'); wrap.className = 'my-rules';
    for(const r of rules){
      const chip = document.createElement('span'), x = document.createElement('button');
      chip.textContent = r.label; x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', `Αφαίρεσε: ${r.label}`);
      x.onclick = () => { r.remove(); paintMyRules(); syncRulesLink(); if(onScreen()) reload(); };
      chip.append(x); wrap.append(chip);
    }
    box.append(wrap);
  }
  const EMPTY = 'Κανένας ακόμα. Όταν πεις «Να το κάνω έτσι πάντα», μπαίνει εδώ και ισχύει σε κάθε νέα προσφορά.';
  function paintMyRules(){
    if(!ALLAXE_BOT_ENABLED) return;
    $('anMyRules').hidden = false; chips($('anMyRules'), EMPTY);
    $('botRules').hidden = false; chips($('botRules'), EMPTY);
    paintLibrary();
  }
  // Η βιβλιοθήκη του μάστορα (είδη εκτός καταλόγου): τη βλέπει, την αλλάζει (ξανά από το bot) ή τη σβήνει.
  function paintLibrary(){
    const box = $('botLibrary'), all = Object.entries(library()).sort((a, b) => a[1].name.localeCompare(b[1].name, 'el'));
    box.hidden = false;
    const kind = e => e.kind === 'generic' ? `γενική ανάλυση · ${CASE_DATA.genericCategories.find(g => g.id === e.category)?.name || ''}`
      : e.kind === 'own' ? 'γραμμένη από σένα' : e.kind === 'official' ? 'η έτοιμη ανάλυση' : `όπως: ${CASE_DATA.materials.find(m => m.id === e.material)?.name || ''} · ${e.label || ''}`;
    box.innerHTML = `<h2 class="lib-h">Η βιβλιοθήκη μου</h2>` + (all.length ? `<div class="lib-list">${all.map(([k, e]) => `<div class="lib-row" data-lib="${esc(k)}">
      <b>${esc(e.name)}</b><small>${esc(kind(e))}</small>
      <details><summary>Δες την ανάλυση</summary>${e.analysis.sections.filter(s => s.items.length).map(s => `<h5>${esc(s.title)}</h5><ul>${s.items.map(i => `<li>${esc(i.text)}</li>`).join('')}</ul>`).join('')}</details>
      <div class="lib-act"><button type="button" class="linkbtn" data-a="edit">Άλλαξε</button><button type="button" class="q-del" data-a="del">Σβήσε</button></div></div>`).join('')}</div>`
      : '<p class="privacy">Κενή ακόμα. Όταν φτιάξεις ανάλυση για ένα είδος εκτός καταλόγου, μπαίνει εδώ και ξαναμπαίνει μόνη της στις επόμενες προσφορές.</p>');
    box.querySelectorAll('.lib-row').forEach(row => {
      const key = row.dataset.lib, e = library()[key];
      row.querySelector('[data-a="edit"]').onclick = () => bot?.openItem(e.name);
      const del = row.querySelector('[data-a="del"]');
      del.onclick = () => {
        if(!del.classList.contains('sure')){ del.classList.add('sure'); del.textContent = 'Σίγουρα;'; return; }
        removeLibrary(key); paintLibrary(); if(onScreen()) reload();
      };
    });
  }
  $('apdf').addEventListener('keydown', e => {
    if((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-sel]')){ e.preventDefault(); select(e.target); e.target.querySelector('.sel-go').focus(); }
  });

  // ── «Άλλαξέ το»
  const dlg = $('rwDialog');
  let rw = null;   // {task, section, index, quick, previous, result, ctrl}
  const view = v => { for(const k of ['ask', 'busy', 'result']) $(`rw-${k}`).hidden = k !== v; };
  const rwError = msg => { $('rwError').textContent = msg || ''; $('rwError').hidden = !msg; };
  function openRewrite(task, section, index){
    const d = docs.find(x => x.id === task), s = d.analysis.sections.find(x => x.key === section);
    rw = {task, section, index, quick: new Set(), previous: null, result: null, ctrl: null};
    $('rwSel').innerHTML = `<small>${esc(d.analysis.title)} · ${esc(s.title)}</small>` +
      (index == null ? list(section, s.items.map(i => i.text), t => `<mark>${esc(t)}</mark>`) : `<p><mark>${esc(s.items[index].text)}</mark></p>`);
    $('rwDislike').value = ''; $('rwWant').value = '';
    paintQuick();
    const n = listRules().length;
    $('rwRulesNote').hidden = !n;
    $('rwRulesNote').textContent = n === 1 ? 'Μπαίνει και ο κανόνας σου.' : `Μπαίνουν και οι ${n} κανόνες σου.`;
    rwError(''); view('ask');
    dlg.showModal();
  }
  function paintQuick(){
    $('rwQuick').replaceChildren(...QUICK.map(label => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(rw.quick.has(label)));
      b.onclick = () => { rw.quick.has(label) ? rw.quick.delete(label) : rw.quick.add(label); b.setAttribute('aria-pressed', String(rw.quick.has(label))); };
      return b;
    }));
  }
  async function go(){
    await stopMics();
    const run = rw, d = docs.find(x => x.id === run.task);
    const payload = rewriteRequest({analysis: d.analysis, section: run.section, index: run.index, dislike: $('rwDislike').value,
      want: $('rwWant').value, quick: [...run.quick], rules: listRules(), previous: run.previous}, personalFrom(quote()));
    if(!payload.dislike && !payload.want && !payload.quick.length)
      return rwError('Πες ή γράψε τι θέλεις να αλλάξει, ή διάλεξε μία από τις γρήγορες επιλογές.');
    rwError(''); view('busy');
    const t0 = Date.now(), tick = setInterval(() => { $('rwBusyTime').textContent = `${Math.round((Date.now() - t0) / 1000)} δευτ.`; }, 1000);
    $('rwBusyTime').textContent = '';
    run.ctrl = new AbortController();
    try {
      const {items} = await rewriteSection(payload, {deviceId: deviceId(), signal: run.ctrl.signal});
      if(rw !== run) return;
      const r = applyRewrite(d.analysis, payload.target, items);
      if(r.errors.length){ view('ask'); return rwError(MESSAGES.bad); }
      const sec = d.analysis.sections.find(x => x.key === run.section);
      // Ένα βήμα κρατά τον αριθμό του (3. → 3.), ώστε πριν και μετά να διαβάζονται όπως στο PDF.
      const at = payload.target.scope === 'item' ? sec.items.findIndex(i => i.id === payload.target.item_id) : 0;
      const before = payload.target.scope === 'item' ? [sec.items[at].text] : sec.items.map(i => i.text);
      run.result = {analysis: r.analysis, items};
      $('rwBefore').innerHTML = list(run.section, before, undefined, at + 1);
      $('rwAfter').innerHTML = list(run.section, items, undefined, at + 1);
      $('rwRemember').checked = false;
      $('rwRule').value = ruleFrom({quick: payload.quick, want: payload.want, dislike: payload.dislike});
      $('rwRuleBox').hidden = true;
      view('result');
    } catch(e){
      if(rw === run && e.code !== 'aborted'){ view('ask'); rwError(e.message); }
    } finally { clearInterval(tick); }
  }
  function keep(){
    const {analysis} = rw.result;
    if(!saveVersion(analysis)) return rwError('Δεν χωράει στη μνήμη της συσκευής. Σβήσε παλιές προσφορές και δοκίμασε ξανά.');
    let note = '';
    if($('rwRemember').checked && $('rwRule').value.trim()) note = addRule($('rwRule').value) ? ' Κράτησα και τον κανόνα σου.' : ' Ο κανόνας δεν κρατήθηκε (έως 20 κανόνες).';
    const id = rw.task;
    closeRewrite();
    refresh(id);
    status(`Κράτησα τη νέα εκδοχή· θα μπαίνει και στις επόμενες προσφορές με αυτή την εργασία.${note}`);
  }
  function closeRewrite(){
    rw?.ctrl?.abort();
    rw = null;
    stopMics();
    if(dlg.open) dlg.close();
  }
  $('rwGo').onclick = go;
  $('rwCancel').onclick = $('rwAbort').onclick = closeRewrite;
  $('rwStop').onclick = () => { rw?.ctrl?.abort(); view('ask'); };
  // «Ξαναδοκίμασε»: νέα εκδοχή με τα ίδια, και το AI μαθαίνει ποια δεν άρεσε. «Άλλαξε τι ζήτησες»: πίσω στα πεδία.
  $('rwRetry').onclick = () => { rw.previous = rw.result.items; go(); };
  $('rwEdit').onclick = () => { rw.previous = rw.result.items; rwError(''); view('ask'); };
  $('rwKeep').onclick = keep;
  $('rwRemember').onchange = () => { $('rwRuleBox').hidden = !$('rwRemember').checked; };
  dlg.addEventListener('cancel', e => { e.preventDefault(); closeRewrite(); });

  // Φωνή σε κάθε πεδίο, με τον ίδιο μηχανισμό της αρχικής οθόνης· ένα μικρόφωνο τη φορά.
  const mics = {};
  dlg.querySelectorAll('[data-mic]').forEach(b => {
    b.hidden = !micSupported;
    b.onclick = () => toggleMic(b.dataset.mic);
  });
  function micFor(field){
    const m = createMic({
      onText(fin, interim){ if(m.listening || interim) $(field).value = fin + (interim ? ` ${interim}` : ''); },
      onError(msg){ paintMics(); rwError(msg); },
    });
    return m;
  }
  async function toggleMic(field){
    const m = mics[field] ??= micFor(field);
    if(m.listening){ $(field).value = await m.stop(); return paintMics(); }
    await stopMics();
    rwError('');
    try { m.start($(field).value.trim()); } catch { rwError('Ο browser δεν υποστηρίζει φωνή εδώ· γράψ’ το.'); }
    paintMics();
  }
  async function stopMics(){
    for(const [field, m] of Object.entries(mics)) if(m.listening) $(field).value = await m.stop();
    paintMics();
  }
  function paintMics(){
    dlg.querySelectorAll('[data-mic]').forEach(b => {
      const on = !!mics[b.dataset.mic]?.listening;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Τέλος φωνής' : 'Πες το με φωνή');
      b.textContent = on ? '■' : '🎙';
    });
  }

  // ── Οι κανόνες μου: προβολή, αλλαγή, σβήσιμο
  let rulesBack = null;
  function syncRulesLink(){
    if(ALLAXE_BOT_ENABLED) paintMyRules();
    const n = listRules().length + (ALLAXE_BOT_ENABLED ? botRules().length : 0);
    $('anRules').textContent = n ? `Οι κανόνες μου (${n})` : 'Οι κανόνες μου';
  }
  function openRules(backTo){
    syncThen();
    rulesBack = backTo;
    paintRules();
    show('s-rules', 'Οι κανόνες μου');
    cta(null);
  }
  function paintRules(){
    const rules = listRules();
    $('rulesEmpty').hidden = rules.length > 0 || ALLAXE_BOT_ENABLED;
    if(ALLAXE_BOT_ENABLED){
      // Οι παλιοί κανόνες ύφους (για το AI) δεν σβήνονται: μένουν εδώ, χωριστά, και ξαναμπαίνουν αν προστεθεί μηχανή AI.
      paintMyRules();
      document.querySelector('#s-rules .lede').textContent = 'Ισχύουν σε κάθε νέα προσφορά. Μένουν σε αυτή τη συσκευή.';
      $('rulesList').dataset.old = rules.length ? 'Παλιές οδηγίες ύφους για το AI · δεν χρησιμοποιούνται χωρίς AI' : '';
    }
    $('rulesList').replaceChildren(...rules.map(r => {
      const el = document.createElement('div');
      el.className = 'rule';
      el.innerHTML = `<p class="rule-text"></p><div class="rule-act"><button class="linkbtn" data-a="edit">Άλλαξε</button><button class="q-del" data-a="del">Σβήσε</button></div>`;
      el.querySelector('.rule-text').textContent = r.text;
      el.querySelector('[data-a="edit"]').onclick = () => {
        el.innerHTML = `<label class="rule-label">Ο κανόνας<textarea class="rule-in" maxlength="200" rows="2"></textarea></label><div class="sug-act"><button data-a="save">Κράτα τον</button><button data-a="cancel">Άκυρο</button></div>`;
        const input = el.querySelector('textarea');
        input.value = r.text; input.focus();
        el.querySelector('[data-a="save"]').onclick = () => { updateRule(r.id, input.value); paintRules(); };
        el.querySelector('[data-a="cancel"]').onclick = paintRules;
      };
      const del = el.querySelector('[data-a="del"]');
      del.onclick = () => {
        if(!del.classList.contains('sure')){ del.classList.add('sure'); del.textContent = 'Σίγουρα;'; return; }
        deleteRule(r.id); paintRules();
      };
      return el;
    }));
  }
  $('rulesBack').onclick = () => rulesBack?.();
  $('anRules').onclick = () => openRules(() => { show('s-analysis', 'Ανάλυση εργασιών'); syncRulesLink(); restoreCta(); });

  return {open, reset, refreshEntry, openRules, detach, rulesCount: () => listRules().length + (ALLAXE_BOT_ENABLED ? botRules().length : 0)};
}
