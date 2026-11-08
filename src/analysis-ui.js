// Ανάλυση εργασιών: δεύτερο PDF για τον πελάτη με τα στάδια κάθε εργασίας της προσφοράς (έτοιμες αναλύσεις
// της Φάσης 4, ή η εκδοχή του τεχνίτη). Ο τεχνίτης τη βλέπει πριν φύγει. Πατά μια ενότητα ή ένα βήμα → «Άλλαξέ το»
// → το AI ξαναγράφει μόνο εκείνο το σημείο → πριν/μετά δίπλα δίπλα → «Κράτα το νέο». Και «Οι κανόνες μου».
// Το PDF βγαίνει και χωρίς σύνδεση· σύνδεση θέλει μόνο το «Άλλαξέ το».
import { ANALYSES } from './analyses-data.js';
import { SECTIONS, LICENSED_NOTE } from './analysis-schema.js';
import { quoteTasks } from './tasks.js';
import { getVersion, saveVersion, resetVersion, listRules, addRule, updateRule, deleteRule, deviceId } from './analysis-store.js';
import { QUICK, MESSAGES, personalFrom, rewriteRequest, applyRewrite, rewriteSection, ruleFrom } from './rewrite-client.js';
import { createMic, micSupported } from './mic.js';
import { makePdf } from './share.js';
import { formatQty } from './number.js';

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

/**
 * show/cta: της εφαρμογής. quote(): {no, at, client, profile, lines} της προσφοράς που φαίνεται· head(): η κεφαλίδα
 * του PDF της προσφοράς (ίδιο στυλ)· fileName(): όνομα αρχείου· quoteFile(): Promise με το PDF της προσφοράς.
 * onReady(file)/onDiscard(): η ανάλυση μπαίνει/βγαίνει από την αποστολή· onSend(): «Στείλε και τα δύο»· onBack().
 */
export function mountAnalysis({show, cta, quote, head, fileName, quoteFile, onReady, onDiscard, onSend, onBack}){
  let docs = [], without = [], file = null, attached = false, gen = 0;
  const onScreen = () => $('s-analysis').classList.contains('on');
  const status = msg => { $('anStatus').textContent = msg || ''; $('anStatus').hidden = !msg; };

  // ── Η οθόνη και το PDF
  function open(){
    const r = analysisFor(quote().lines);
    docs = r.tasks.map(t => ({...t, ...current(t.id)}));
    without = r.without;
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
    $('anWithout').hidden = !without.length;
    $('anWithout').innerHTML = `<b>Χωρίς ανάλυση · δεν μπαίνουν στο PDF</b><ul>${without.map(w =>
      `<li><span>${esc(w.line.desc || w.line.name)}</span><small>${esc(w.why)}</small></li>`).join('')}</ul>`;
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
  function taskHtml({id, analysis: a, lines}, num){
    const sec = s => `<h4 data-sel="${s.key}" tabindex="0">${esc(s.title)}</h4>` + (ordered(s.key) ? '<ol>' : '<ul>') +
      s.items.map((it, i) => `<li data-sel="${s.key}" data-i="${i}" tabindex="0">${esc(it.text)}</li>`).join('') + (ordered(s.key) ? '</ol>' : '</ul>');
    const [first, ...rest] = a.sections;
    return `<section class="an-task" data-task="${esc(id)}">
      <div class="an-top"><h3>${num}${esc(a.title)}</h3>
        <div class="an-for">Αφορά: ${lines.map(l => `${esc(l.desc || l.name)} · ${formatQty(l.qty)} ${esc(l.unit)}`).join(', ')}</div>
        ${a.requires_licensed_professional ? `<p class="an-lic">${esc(LICENSED_NOTE)}</p>` : ''}
        <div class="an-sec">${sec(first)}</div></div>
      ${rest.map(s => `<div class="an-sec">${sec(s)}</div>`).join('')}
      <p class="an-dur"><b>Διάρκεια:</b> ${esc(a.typical_duration)}</p>
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
    const n = analysisFor(quote().lines).tasks.length;
    $('anEntryText').textContent = attached ? 'Θα σταλεί μαζί με την προσφορά, ως δεύτερο PDF.'
      : n ? `Δεύτερο PDF με τα στάδια ${n === 1 ? 'της εργασίας' : `των ${n} εργασιών`}, στο ίδιο στυλ με την προσφορά.`
      : 'Τα είδη αυτής της προσφοράς δεν έχουν ακόμα έτοιμη ανάλυση.';
    $('anOpen').hidden = !n;
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
    if(selEl === el) return;
    deselect();
    selEl = el;
    el.classList.add('sel');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sel-go'; b.textContent = '✏️ Άλλαξέ το';
    b.onclick = e => {
      e.stopPropagation();
      openRewrite(el.closest('[data-task]').dataset.task, el.dataset.sel, el.dataset.i == null ? null : Number(el.dataset.i));
    };
    el.append(b);
  }
  $('apdf').addEventListener('click', e => { const el = e.target.closest('[data-sel]'); if(el) select(el); else deselect(); });
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
    const n = listRules().length;
    $('anRules').textContent = n ? `Οι κανόνες μου (${n})` : 'Οι κανόνες μου';
  }
  function openRules(backTo){
    rulesBack = backTo;
    paintRules();
    show('s-rules', 'Οι κανόνες μου');
    cta(null);
  }
  function paintRules(){
    const rules = listRules();
    $('rulesEmpty').hidden = rules.length > 0;
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

  return {open, reset, refreshEntry, openRules, detach, rulesCount: () => listRules().length};
}
