// Το πάνελ του «Άλλαξέ το» (μόνο με ALLAXE_BOT_ENABLED): συζήτηση που ανεβαίνει από κάτω, πάνω από την ανάλυση.
// Η οθόνη ξέρει ΜΟΝΟ τα τρία σχήματα της μηχανής (ask / pick / rewrite)· η λογική είναι στο src/allaxe-engine.js.
// Τίποτα δεν αλλάζει πριν από το «Κράτα το». Μετά: οι γραμμές που άλλαξαν φωτίζονται και φαίνεται «Αναίρεση» για 6″.
import { CASE_DATA } from './cases-data.js';
import { ANALYSES } from './analyses-data.js';
import { createLibraryEngine, CARD, FIXED_LABELS } from './allaxe-engine.js';
import { voiceFor, pickTag } from './case-pick.js';
import { mergeOps } from './analysis-edits.js';
import { pickRules, quotePicks, setQuotePick, quoteEdits, setQuoteEdits, setCaseRule, setSpeechRule, editRules, setEditRule,
  track, snapshotAll, restoreAll, saveLibrary, queueMissing } from './allaxe-store.js';
import { personalFrom } from './rewrite-client.js';
import { SECTIONS } from './analysis-schema.js';
import { createMic, micSupported } from './mic.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; };
const ordered = key => !!SECTIONS.find(s => s.key === key)?.ordered;

/**
 * getDoc(task): {id, lines, analysis, pick} όπως φαίνεται · quote(): {no, voice}
 * onApplied(task, undoSnapshot): ξαναζωγραφίζει την ανάλυση (φωτίζει τις αλλαγές, δείχνει «Αναίρεση») · onRules(): οι κανόνες άλλαξαν
 */
export function mountBot({getDoc, quote, onApplied, onRules, onClose}){
  const engine = createLibraryEngine({data: CASE_DATA, base: ANALYSES});
  const dlg = $('botDialog'), log = $('botLog'), form = $('botInput'), text = $('botText');
  let S = null;   // {task, state, out, doc}

  const meta = () => S.item ? {material: '', analysis: 'item', engine: engine.name} : ({material: S.doc.pick?.material || '', analysis: S.doc.pick?.caseId || S.task, engine: engine.name});
  const safeQuote = () => { try { return quote() || {}; } catch { return {}; } };
  /** Είδος εκτός καταλόγου: «Μοιάζει με…» → είδος δουλειάς → «Θα το πω εγώ». Ανοίγει και χωρίς προσφορά (από τις ρυθμίσεις). */
  function openItem(name){
    const r = engine.start({item: {name}});
    S = {task: null, item: name, doc: null, state: r.state, out: null};
    log.replaceChildren();
    $('botSub').textContent = `«${name}» · εκτός καταλόγου`;
    if(!dlg.open) dlg.showModal();
    track({ev: 'open', step: 'item', ...meta()});
    show(r.out);
  }
  function open(task, scope = null){
    const doc = getDoc(task), q = quote();
    if(!doc?.pick) return;
    const rules = pickRules();
    const ruleOps = rules.edits[doc.pick.material || `task:${task}`]?.ops || [];
    const ctx = {task, lines: doc.lines, voice: voiceFor(q.voice, doc.lines), rules: {cases: rules.cases, variant: rules.variant},
      chosen: quotePicks(q.no)[task] || null, ops: mergeOps(ruleOps, quoteEdits(q.no)[task] || []), scope};
    const r = engine.start(ctx);
    S = {task, doc, state: r.state, out: null};
    log.replaceChildren();
    $('botSub').textContent = `${doc.analysis.title}${doc.pick.label ? ` · ${doc.pick.label}` : ''}`;
    if(!dlg.open) dlg.showModal();
    track({ev: 'open', step: scope ? 'point' : 'task', ...meta()});
    show(r.out);
  }
  function close(){ stopMic(); const was = dlg.open; if(was) dlg.close(); S = null; if(was) onClose?.(); }
  function step(ev){ const r = engine.next(S.state, ev); S.state = r.state; show(r.out); }
  function requestClose(){
    if(!S) return close();
    const r = engine.next(S.state, {type: 'close'});
    if(!r.out) return close();
    S.state = r.state; show(r.out);
  }

  // ── Ζωγραφική ενός βήματος
  function bot(t, cls = 'bot'){ if(t) log.append(el('div', `msg ${cls}`, t)); }
  function me(t){ log.append(el('div', 'msg me', t)); }
  function list(key, texts, cls){
    const l = el(ordered(key) ? 'ol' : 'ul');
    for(const t of texts) l.append(el('li', cls, t));
    return l;
  }
  function card(out){
    const c = out.card || {}, box = el('div', 'bcard');
    if(c.after?.analysis){                                         // άλλη περίπτωση: ΠΡΙΝ διαγραμμένη, ΜΕΤΑ ολόκληρη
      if(c.before) box.append(el('h4', null, 'Πριν'), el('p', 'was', `${c.before.title}${c.before.label ? ` (${c.before.label})` : ''}`), el('h4', null, 'Μετά'));
      const now = el('div', 'now');
      now.append(el('b', null, c.after.analysis.title));
      if(c.after.label) now.append(el('p', 'tagline', c.after.label));
      for(const s of c.after.analysis.sections) if(s.items.length) now.append(el('h5', null, s.title), list(s.key, s.items.map(i => i.text)));
      box.append(now);
    } else if(c.example){
      box.append(el('h4', null, 'Πριν'), el('p', null, c.example.before), el('h4', null, 'Μετά'), el('p', 'now', c.example.after));
    } else if(c.add){
      box.append(el('h4', null, `Μπαίνει στο «${c.add.section}»`), el('p', 'now', `+ ${c.add.text}`));
    } else if(c.remove != null){
      box.append(el('h4', null, 'Βγαίνει από την ανάλυση'), el('p', 'was', c.remove));
    } else if(c.before){
      box.append(el('h4', null, c.section ? `Πριν · ${c.section}` : 'Πριν'));
      box.append(c.ordered ? list('steps', c.before) : el('p', null, c.before.join(' · ')));
      box.append(el('h4', null, 'Μετά'));
      const after = c.ordered ? list('steps', c.after) : el('p', null, c.after.join(' · '));
      after.classList.add('now');
      box.append(after);
    }
    log.append(box);
  }
  function orderList(out){
    const ids = out.order.items.map(i => i.id), texts = Object.fromEntries(out.order.items.map(i => [i.id, i.text]));
    const ul = el('ol', 'border-list');
    const paint = () => {
      ul.replaceChildren(...ids.map((id, n) => {
        const li = el('li'); li.append(el('span', null, texts[id]));
        const up = el('button', null, '↑'), down = el('button', null, '↓');
        up.type = down.type = 'button';
        up.setAttribute('aria-label', 'Πιο πάνω'); down.setAttribute('aria-label', 'Πιο κάτω');
        up.disabled = n === 0; down.disabled = n === ids.length - 1;
        up.onclick = () => { [ids[n - 1], ids[n]] = [ids[n], ids[n - 1]]; paint(); ul.querySelectorAll('li')[n - 1]?.querySelector('button')?.focus(); };
        down.onclick = () => { [ids[n + 1], ids[n]] = [ids[n], ids[n + 1]]; paint(); ul.querySelectorAll('li')[n + 1]?.querySelectorAll('button')[1]?.focus(); };
        li.append(up, down);
        return li;
      }));
    };
    paint();
    const box = el('div', 'bcard'); box.append(ul);
    log.append(box);
    return ids;
  }
  function show(out){
    S.out = out;
    if(!out) return close();
    stopMic();
    for(const e of out.effects || []) effect(e);
    if(out.say) bot(out.say);
    if(out.focus) bot(out.focus.text, 'focus');
    if(out.type === 'ask') bot(out.question);
    if(out.type === 'pick' || out.type === 'rewrite'){ if(out.summary && !out.card) bot(out.summary); card(out); }
    const order = out.order ? orderList(out) : null;
    if(out.options?.length){
      const box = el('div', 'bot-opts');
      out.options.forEach((label, index) => {
        const b = el('button', label === CARD.keep || label === 'Ναι, πάντα' ? 'primary' : null, label);
        b.type = 'button';
        b.onclick = () => choose(box, b, label, index, order);
        box.append(b);
      });
      log.append(box);
    }
    form.hidden = !out.input;
    if(out.input){ text.value = out.input.value || ''; text.placeholder = out.input.placeholder || ''; }
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
      (out.input ? text : log.querySelector('.bot-opts:last-child button'))?.focus({preventScroll: true});
    });
  }
  function choose(box, b, label, index, order){
    box.querySelectorAll('button').forEach(x => { x.disabled = true; });
    b.classList.add('chosen');
    me(label);
    const out = S.out;
    track({ev: 'button', step: out.key || out.type, choice: FIXED_LABELS.has(label) ? label : `#${index}`, ...meta(),
      ...(label === CARD.keep && {outcome: 'keep'}), ...(label === CARD.cancel && {outcome: 'cancel'})});
    if((out.type === 'pick' || out.type === 'rewrite') && label === CARD.keep) keep(out);
    if(order) return step({type: 'order', value: order, index});
    step({type: 'answer', value: label, index});
  }
  // «Κράτα το»: η αλλαγή μπαίνει στην προσφορά (μόνο εδώ)· οι κανόνες έρχονται μετά, αν πει «Ναι, πάντα».
  function keep(out){
    if(S.item) return;                       // είδος εκτός καταλόγου: κρατιέται με το επόμενο βήμα (βιβλιοθήκη)
    const no = quote().no, task = S.task, undo = snapshotAll();
    if(out.type === 'pick'){
      const cur = quotePicks(no)[task] || {};
      setQuotePick(no, task, out.key === 'card:case' ? {...cur, answers: out.answers} : {...cur, variant: out.variant});
    } else setQuoteEdits(no, task, mergeOps(quoteEdits(no)[task] || [], [out.edit]));
    onApplied(task, undo);
    S.doc = getDoc(task) || S.doc;
    $('botSub').textContent = `${S.doc.analysis.title}${S.doc.pick?.label ? ` · ${S.doc.pick.label}` : ''}`;
  }
  function effect(e){
    if(e.kind === 'caseRule') setCaseRule(e.material, e.answers, e.label);
    else if(e.kind === 'speechRule') setSpeechRule(e.variant);
    else if(e.kind === 'editRule') setEditRule(e.key, mergeOps(editRules()[e.key]?.ops || [], e.ops), e.label);
    else if(e.kind === 'library'){
      const undo = snapshotAll();
      saveLibrary(e.name, {...e.entry, createdIn: safeQuote().no ?? null});
      onApplied(null, undo);
    } else if(e.kind === 'missing') queueMissing(e.name, e.category, personalFrom(safeQuote()));
    track({ev: 'rule', step: e.kind, ...meta()});
    onRules();
  }

  form.onsubmit = async e => {
    e.preventDefault();
    await stopMic();
    const v = text.value.trim();
    if(!v) return text.focus();
    me(v); form.hidden = true;
    track({ev: 'text', step: S.out?.key || 'text', ...meta()});
    step({type: 'text', value: v});
  };
  text.addEventListener('keydown', e => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); form.requestSubmit(); } });
  $('botClose').onclick = requestClose;
  dlg.addEventListener('cancel', e => { e.preventDefault(); requestClose(); });   // Esc
  dlg.addEventListener('click', e => {                                              // κλικ έξω από το πάνελ
    if(e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if(e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) requestClose();
  });

  // Μικρόφωνο: η αναγνώριση φωνής που έχει ήδη η εφαρμογή, μόνο όταν το bot περιμένει κείμενο.
  let mic = null;
  $('botMic').hidden = !micSupported;
  const paintMic = () => { const on = !!mic?.listening; $('botMic').setAttribute('aria-pressed', String(on)); $('botMic').textContent = on ? '■' : '🎙'; };
  async function stopMic(){ if(mic?.listening) text.value = await mic.stop(); paintMic(); }
  $('botMic').onclick = async () => {
    mic ??= createMic({onText(fin, interim){ if(mic.listening || interim) text.value = fin + (interim ? ` ${interim}` : ''); }, onError(){ paintMic(); }});
    if(mic.listening) return stopMic();
    try { mic.start(text.value.trim()); } catch {}
    paintMic();
  };

  return {open, openItem, close, isOpen: () => dlg.open};
}

/** «Αναίρεση» για 6″ μετά από κάθε «Κράτα το». */
export function undoToast(onUndo){
  const box = $('botUndo');
  clearTimeout(box._t);
  // Μέσα στο πάνελ όσο είναι ανοιχτό (αλλιώς θα έμενε πίσω από αυτό), στη σελίδα όταν κλείσει.
  ($('botDialog').open ? $('botDialog') : document.body).append(box);
  box.hidden = false;
  $('botUndoBtn').onclick = () => { box.hidden = true; clearTimeout(box._t); onUndo(); };
  box._t = setTimeout(() => { box.hidden = true; }, 6000);
}
export { restoreAll, pickTag };
