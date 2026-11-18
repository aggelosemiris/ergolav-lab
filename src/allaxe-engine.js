// Η μηχανή του «Άλλαξέ το» (Μέρος 4): η λογική της συζήτησης, χωριστά από την οθόνη. Αυτή είναι η μηχανή
// «βιβλιοθήκη» (χωρίς AI, μόνο εγκεκριμένα κείμενα). Μια μηχανή «AI» θα είναι δεύτερη υλοποίηση της ίδιας διεπαφής
// (βλ. docs/ALLAXE_BOT.md), χωρίς αλλαγές στην οθόνη, στους κανόνες ή στην αποθήκευση.
//
// Διεπαφή:  engine.start(ctx) → {state, out}      engine.next(state, event) → {state, out}
//   event: {type:'answer', value, index} | {type:'text', value} | {type:'order', value:[ids]} | {type:'close'}
//   out:   null (κλείνει) ή ΕΝΑ από τα τρία σχήματα:
//     {type:'ask', question, options:[...], ...}                  ερώτηση με κουμπιά (ή πεδίο κειμένου/σειρά)
//     {type:'pick', analysisId, variant, ...}                     άλλη περίπτωση ή εκδοχή λόγου (κάρτα ΠΡΙΝ/ΜΕΤΑ)
//     {type:'rewrite', text, summary, ...}                        αλλαγή ενός σημείου ή της σειράς (κάρτα)
//   Προαιρετικά πεδία: say (μήνυμα πριν), input {value, placeholder}, order {section, items}, focus {section, id, text},
//   card {…} για την κάρτα, effects [...] που κάνει η οθόνη (κανόνες), key για τις ανώνυμες μετρήσεις.
//   Στο pick/rewrite η οθόνη, με το «Κράτα το», κρατά την αλλαγή (pick: answers/variant, rewrite: edit) και στέλνει
//   την απάντηση στη μηχανή, που συνεχίζει (π.χ. «Να το κάνω έτσι πάντα;»).
import { SECTIONS, validateAnalysis, textProblem } from './analysis-schema.js';
import { nextQuestion, caseId, lineAnswers, caseLabel, meets } from './case-map.js';
import { pickAnalysis, materialFor, lineKeys, hasVariant, complete, plain, analysisForAnswers } from './case-pick.js';
import { findSimilar, rankGeneric } from './similar.js';
import { ARTICLES, guessArticle, withArticle, fillKind, cleanName } from './article.js';
import { applyEdits, MAX_TEXT } from './analysis-edits.js';

export const MENU = {wrong: 'Δεν είναι έτσι η δουλειά', tech: 'Πολύ τεχνικό', long: 'Πολύ μεγάλο', order: 'Λάθος σειρά', missing: 'Λείπει κάτι', other: 'Κάτι άλλο…'};
export const POINT = {tech: 'Πολύ τεχνικό', long: 'Πολύ μεγάλο', rewrite: 'Γράψ’ το αλλιώς', remove: 'Βγάλ’ το'};
export const CARD = {keep: 'Κράτα το', more: 'Κι άλλο…', cancel: 'Άκυρο', again: 'Ξαναγράψ’ το'};
export const ALWAYS = {yes: 'Ναι, πάντα', here: 'Μόνο εδώ'};
export const AFTER = {done: 'Όχι, τέλεια', more: 'Κι άλλο…', close: 'Κλείσε', own: 'Πρόσθεσε δικό μου βήμα', ready: 'Έτοιμο'};
export const ITEM = {yes: 'Ναι', no: 'Όχι', other: 'Άλλο είδος δουλειάς', mine: 'Θα το πω εγώ', article: 'Άλλο άρθρο', more: 'Και κάτι ακόμα', next: 'Συνέχεια'};
/** Οι σταθερές ετικέτες (για τις μετρήσεις: μόνο αυτές καταγράφονται αυτούσιες, ποτέ κείμενα). */
export const FIXED_LABELS = new Set([...Object.values(MENU), ...Object.values(POINT), ...Object.values(CARD), ...Object.values(ALWAYS), ...Object.values(AFTER), ...Object.values(ITEM)]);

const CUT = 45;
export const cut = (t, n = CUT) => t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
const secTitle = key => SECTIONS.find(s => s.key === key)?.title || key;
const VSAY = {s: 'Το γράφω σε πιο απλά λόγια, για πελάτη που δεν ξέρει τεχνικά. Για παράδειγμα:', c: 'Το κάνω πιο σύντομο. Για παράδειγμα:'};
const VRULE = {s: 'Πάντα απλά λόγια', c: 'Πάντα σύντομα'};
const idOf = text => { let h = 0; for(const ch of plain(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h.toString(36); };

/**
 * ctx (από την οθόνη): {task, lines, voice, rules, chosen, ops, scope: null | {section, id}}
 *   rules/chosen όπως στο pickAnalysis· ops: οι αλλαγές που ισχύουν ήδη (κανόνα + προσφοράς).
 */
export function createLibraryEngine({data, base}){
  // Η ανάλυση όπως φαίνεται, για μια επιλογή περίπτωσης/εκδοχής: pickAnalysis + οι αλλαγές.
  const view = (ctx, chosen = ctx.chosen) => {
    const p = pickAnalysis({data, base, task: ctx.task, lines: ctx.lines, voice: ctx.voice, rules: ctx.rules, chosen});
    return p && {...p, analysis: applyEdits(p.analysis, ctx.ops, data).analysis};
  };
  const items = a => a.sections.flatMap(s => s.items.map(it => ({...it, section: s.key})));
  const material = ctx => materialFor(data, ctx.task, ctx.lines);
  const acc = ctx => material(ctx)?.acc || 'αυτή την εργασία';
  const ruleKey = ctx => material(ctx)?.id || `task:${ctx.task}`;

  function menu(state, question = 'Τι δεν σου αρέσει εδώ;', say){
    const v = view(state.ctx);
    const options = [
      material(state.ctx) && MENU.wrong,
      hasVariant(v.analysis, 's', data) && MENU.tech,
      hasVariant(v.analysis, 'c', data) && MENU.long,
      MENU.order, MENU.missing, MENU.other,
    ].filter(Boolean);
    state.at = 'menu';
    return {type: 'ask', key: 'menu', ...(say && {say}), question, options};
  }
  function pointMenu(state, id, question = 'Τι θες να κάνω με αυτό;'){
    const it = items(view(state.ctx).analysis).find(x => x.id === id);
    if(!it) return menu(state);
    state.at = 'point'; state.point = id;
    const d = data.items[id] || {};
    return {type: 'ask', key: 'point', question, focus: {section: it.section, id, text: it.text},
      options: [d.s && POINT.tech, d.c && POINT.long, POINT.rewrite, POINT.remove].filter(Boolean)};
  }
  // ── Ερωτήσεις περίπτωσης: μία-μία, όσες δεν απαντά ήδη η γραμμή της προσφοράς.
  function askCase(state){
    const m = material(state.ctx);
    const q = nextQuestion(m, state.answers);
    if(!q) return proposeCase(state);
    state.at = 'question'; state.q = q.id;
    return {type: 'ask', key: `question:${q.id}`, question: q.ask, options: q.answers.map(a => a.label), ...(state.say && {say: state.say})};
  }
  function proposeCase(state){
    const ctx = state.ctx, m = material(ctx), now = view(ctx);
    const full = complete(m, state.answers, {}, {});
    const id = caseId(m, full);
    const cand = view(ctx, {...ctx.chosen, answers: full});
    if(id === now.caseId) return menu(state, 'Αυτή είναι ήδη η περίπτωση που έχει η ανάλυση. Θες να αλλάξεις κάτι άλλο;');
    if(!cand || cand.caseId !== id || cand.source !== 'chosen' || (m.exclude || []).some(e => meets(full, e.when)))
      return menu(state, 'Αυτή την περίπτωση δεν την έχω ακόμα έτοιμη. Πες μου τι θες να αλλάξει.');
    state.at = 'card'; state.pending = {kind: 'case', answers: full, label: `${m.name}: ${caseLabel(m, full)}`};
    return {type: 'pick', key: 'card:case', say: 'Βρήκα την ανάλογη ανάλυση:', analysisId: id, answers: full, variant: cand.variant,
      card: {before: {label: now.label, title: now.analysis.title, struck: true}, after: {label: cand.label, analysis: cand.analysis}},
      options: [CARD.keep, CARD.more, CARD.cancel]};
  }
  // ── Εκδοχή λόγου σε όλη την εργασία, με ένα σημείο για παράδειγμα.
  function proposeVariant(state, v){
    const ctx = state.ctx, now = view(ctx);
    if(now.variant === v) return menu(state, 'Είναι ήδη σε αυτή την εκδοχή. Θες κάτι άλλο;');
    const cand = view(ctx, {...ctx.chosen, variant: v});
    const before = items(now.analysis), after = items(cand.analysis);
    const n = after.findIndex((it, i) => it.text !== before[i]?.text);
    state.at = 'card'; state.pending = {kind: 'variant', variant: v};
    return {type: 'pick', key: `card:variant-${v}`, say: VSAY[v], analysisId: now.caseId || ctx.task, variant: v,
      card: {example: {before: before[Math.max(n, 0)]?.text, after: after[Math.max(n, 0)]?.text}}, options: [CARD.keep, CARD.more, CARD.cancel]};
  }
  // ── Αλλαγές σημείων: η κάρτα και ο έλεγχος κανόνων γραφής (ίδιοι με τις σημερινές αναλύσεις).
  function proposeEdit(state, edit, summary, card, extra = {}){
    const now = view(state.ctx).analysis, res = applyEdits(now, [edit], data), after = res.analysis;
    if(edit.op === 'add' && !res.changed.length)
      return {bad: `το «${secTitle(edit.section)}» έχει ήδη ${SECTIONS.find(s => s.key === edit.section).max} σημεία, όσα χωράνε.`};
    const known = new Set(validateAnalysis(now, {withIds: false}));
    const bad = validateAnalysis(after, {withIds: false}).filter(e => !known.has(e));
    if(bad.length) return {bad: bad[0]};
    state.at = extra.at || 'card'; state.pending = {kind: 'edit', edit};
    return {type: 'rewrite', key: `card:${edit.op}`, text: edit.text || edit.item?.text || '', summary, edit, card,
      options: extra.options || [CARD.keep, CARD.more, CARD.cancel], ...(extra.say && {say: extra.say})};
  }
  function suggestions(ctx){
    const m = material(ctx), now = view(ctx), have = new Set(items(now.analysis).flatMap(i => [i.id, plain(i.text)]));
    const out = [], seen = new Set();
    const add = (id, section, text) => {
      const k = plain(text);
      if(!text || have.has(id) || have.has(k) || seen.has(k)) return;
      seen.add(k); out.push({id, section, text});
    };
    const v = now.variant, txt = (id, n) => (v !== 'n' && data.items[id]?.[v]) || n;
    if(m){
      for(const x of data.extras[m.id] || []) if(!x.when || meets(now.answers, x.when)) add(x.id, x.section, txt(x.id, data.items[x.id]?.n));
      // Σημεία άλλων περιπτώσεων του ίδιου υλικού (τα πιο κοινά πρώτα).
      const freq = new Map();
      const others = [...Object.entries(data.cases).filter(([id]) => id.startsWith(`${m.id}:`)).map(([, c]) => c.sections),
        ...m.base.map(b => base[b.task]).filter(Boolean).map(a => Object.fromEntries(a.sections.map(s => [s.key, s.items.map(i => i.id)])))];
      const textOf = id => data.items[id]?.n || Object.values(base).flatMap(a => a.sections.flatMap(s => s.items)).find(i => i.id === id)?.text;
      for(const secs of others) for(const [k, ids] of Object.entries(secs)) for(const id of ids) freq.set(id, {k, n: (freq.get(id)?.n || 0) + 1});
      for(const [id, {k}] of [...freq].sort((a, b) => b[1].n - a[1].n)) add(id, k, txt(id, textOf(id)));
    }
    // Σημεία άλλων αναλύσεων της ίδιας ειδικότητας.
    for(const a of Object.values(base)) if(a.trade && a.trade === now.analysis.trade && a.id !== ctx.task)
      for(const s of a.sections) for(const it of s.items) add(it.id, s.key, txt(it.id, it.text));
    return out.slice(0, 6);
  }
  function missing(state){
    const list = suggestions(state.ctx);
    state.at = 'missing'; state.list = list;
    if(!list.length) return {type: 'ask', key: 'missing-none', question: `Έχεις ήδη βάλει όλα τα βήματα που έχω για ${acc(state.ctx)}.`, options: [AFTER.own]};
    return {type: 'ask', key: 'missing', question: 'Μήπως λείπει κάποιο από αυτά;', options: [...list.map(x => cut(x.text, 60)), AFTER.own]};
  }
  const sectionsAsk = (state, at, key, question = 'Σε ποια ενότητα;', min = 1) => {
    state.at = at;
    const secs = view(state.ctx).analysis.sections.filter(s => s.items.length >= min);
    state.secs = secs.map(s => s.key);
    return {type: 'ask', key, question, options: secs.map(s => s.title)};
  };
  // Μετά από «Κράτα το» σε αλλαγή σημείου: πρώτα «Μπήκε…», στο τέλος μία ερώτηση για όλες μαζί.
  function closing(state){
    if(state.changes.length && !state.askedEdits){
      state.at = 'always-edits'; state.askedEdits = true;
      return {type: 'ask', key: 'always-edits', question: `Να κρατήσω αυτές τις αλλαγές και στις επόμενες προσφορές με ${acc(state.ctx)};`, options: [ALWAYS.yes, ALWAYS.here]};
    }
    return null;
  }
  const finished = (state, question, effects) => {
    state.at = 'finished';
    return {type: 'ask', key: 'finished', question, options: [AFTER.close], ...(effects && {effects})};
  };

  // ── Είδος εκτός καταλόγου (Μέρος 5): «Μοιάζει με…» → είδος δουλειάς (γενική ανάλυση) → «Θα το πω εγώ».
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const genericAnalysis = (id, name, article) => {
    const g = data.generic[id], cat = (data.genericCategories || []).find(x => x.id === id);
    return {id: `generic-${id}`, title: `${g.title}: ${cap(cleanName(name))}`, trade: '', typical_duration: g.duration, related_consumables: [],
      requires_licensed_professional: !!g.licensed, notes_for_master: cat?.safety || '',
      sections: SECTIONS.map(s => ({key: s.key, title: s.title, items: (g.sections[s.key] || []).map(iid => ({id: iid, text: fillKind(data.items[iid]?.n || '', name, article)}))}))};
  };
  function itemCategories(state, all = false){
    const name = state.ctx.item.name, ready = rankGeneric(data, name).filter(g => data.generic[g.id]);
    state.at = all ? 'item-category-all' : 'item-category';
    state.list = (all ? ready : ready.slice(0, 6)).map(g => g.id);
    if(!ready.length) return {...itemOwnStart(state), say: 'Δεν έχω ακόμα έτοιμες γενικές αναλύσεις για είδη εκτός καταλόγου.'};
    return {type: 'ask', key: all ? 'item-category-all' : 'item-category', question: 'Τι δουλειά είναι, για να βάλω την ανάλογη;',
      options: [...state.list.map(id => ready.find(g => g.id === id).name), ...(all ? [] : [ITEM.other]), ITEM.mine]};
  }
  function itemGenericCard(state){
    const {name} = state.ctx.item, id = state.category, article = state.article || guessArticle(name);
    state.article = article; state.at = 'item-card';
    const cat = data.genericCategories.find(g => g.id === id), a = genericAnalysis(id, name, article);
    state.pending = {kind: 'library', entry: {kind: 'generic', category: id, article, analysis: a}};
    return {type: 'pick', key: 'card:generic', analysisId: `generic:${id}`, variant: 'n',
      say: `Αυτή είναι η γενική ανάλυση για «${cat.name}», με ${withArticle(name, article)} μέσα:`,
      card: {before: {title: 'Χωρίς ανάλυση', label: '', struck: true}, after: {label: cat.name, analysis: a}},
      options: [CARD.keep, ITEM.article, ITEM.other, ITEM.mine]};
  }
  const OWN = [['preparation', 'Πες μου με δικά σου λόγια. Τι κάνεις πρώτα;', 'π.χ. Παίρνουμε μέτρα και ελέγχουμε το σημείο όπου θα μπει.'],
    ['steps', 'Μετά τι κάνεις;', 'π.χ. Στερεώνουμε τη βάση με βίδες και ούπα.'],
    ['checks', 'Τι ελέγχεις στο τέλος;', 'π.χ. Δοκιμάζουμε ότι λειτουργεί και δεν κουνιέται.']];
  function itemOwnStart(state){
    state.at = 'item-own'; state.own = {preparation: [], steps: [], checks: []}; state.ownStep = 0;
    return ownAsk(state);
  }
  function ownAsk(state, question, extra = {}){
    const [key, q, ph] = OWN[state.ownStep];
    const more = state.own[OWN[state.ownStep - 1]?.[0]]?.length && !extra.again;
    return {type: 'ask', key: `item-own-${key}`, question: question || (extra.again ? 'Και τι άλλο;' : q), options: more ? [ITEM.more] : [],
      input: {value: '', placeholder: ph}, ...extra.say && {say: extra.say}};
  }
  function ownAnalysis(state){
    const {name} = state.ctx.item, k = plain(name).replace(/[^a-z0-9α-ω]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'eidos';
    return {id: `own-${k}`, title: cap(cleanName(name)), trade: '', typical_duration: '', related_consumables: [], requires_licensed_professional: false, notes_for_master: '',
      sections: SECTIONS.map(s => ({key: s.key, title: s.title, items: (state.own[s.key] || []).map((text, n) => ({id: `own.${k}.${s.key}.${n + 1}`, text}))}))};
  }
  function ownCard(state){
    state.at = 'item-own-card';
    const a = ownAnalysis(state);
    state.pending = {kind: 'library', entry: {kind: 'own', analysis: a}};
    return {type: 'pick', key: 'card:own', analysisId: a.id, variant: 'n', say: 'Έτσι θα φαίνεται στον πελάτη:',
      card: {after: {label: '', analysis: a}}, options: [CARD.keep, ITEM.more, CARD.cancel]};
  }
  function itemCaseAsk(state){
    const m = data.materials.find(x => x.id === state.material);
    const q = nextQuestion(m, state.answers);
    if(q){ state.at = 'item-question'; state.q = q.id; return {type: 'ask', key: `item-question:${q.id}`, question: q.ask, options: q.answers.map(a => a.label)}; }
    const r = analysisForAnswers(data, base, m.id, state.answers);
    if(!r) return {...itemCategories(state), say: 'Αυτή την περίπτωση δεν την έχω ακόμα έτοιμη.'};
    state.at = 'item-card';
    const a = {...r.analysis, title: r.analysis.title};
    state.pending = {kind: 'library', entry: {kind: 'case', material: m.id, answers: r.answers, label: r.label, analysis: a}};
    return {type: 'pick', key: 'card:item-case', analysisId: r.caseId, answers: r.answers, variant: 'n', say: 'Βρήκα την ανάλογη ανάλυση:',
      card: {before: {title: 'Χωρίς ανάλυση', label: '', struck: true}, after: {label: `${m.name}: ${r.label}`, analysis: a}},
      options: [CARD.keep, ITEM.other, ITEM.mine]};
  }
  function itemKept(state){
    const {name} = state.ctx.item, p = state.pending;
    state.pending = null;
    return finished(state, `Το «${name}» μπήκε στη λίστα της ομάδας, χωρίς στοιχεία πελάτη, για να γραφτεί κανονική ανάλυση για όλους.`,
      [{kind: 'library', name, entry: p.entry}, {kind: 'missing', name, category: p.entry.category || null}]);
  }
  function startItem(ctx){
    const state = JSON.parse(JSON.stringify({ctx: {item: {name: ctx.item.name}}, at: null, changes: [], askedEdits: true}));
    const sim = findSimilar(data, ctx.item.name);
    if(sim){
      const m = data.materials.find(x => x.id === sim.material);
      state.at = 'item-similar'; state.material = m.id;
      return {state, out: {type: 'ask', key: 'item-similar', question: `Μοιάζει με: ${m.name}. Να βάλω αυτή την ανάλυση;`, options: [ITEM.yes, ITEM.no]}};
    }
    return {state, out: {...itemCategories(state), say: 'Έψαξα στον κατάλογο για κάτι παρόμοιο. Δεν βρέθηκε.'}};
  }
  function nextItem(state, ev){
    const v = ev?.value, out = o => ({state, out: o});
    if(ev?.type === 'close') return out(null);
    switch(state.at){
      case 'item-similar':
        if(v === ITEM.yes){ state.answers = {}; return out(itemCaseAsk(state)); }
        return out(itemCategories(state));
      case 'item-question': {
        const m = data.materials.find(x => x.id === state.material);
        const q = m.questions.find(x => x.id === state.q && (!x.when || meets(state.answers, x.when)));
        const a = q?.answers.find(x => x.label === v) || q?.answers[ev.index];
        if(a) state.answers[q.id] = a.id;
        return out(itemCaseAsk(state));
      }
      case 'item-category': case 'item-category-all': {
        if(v === ITEM.other) return out(itemCategories(state, true));
        if(v === ITEM.mine) return out(itemOwnStart(state));
        const id = state.list[ev.index];
        if(!id) return out(itemCategories(state));
        state.category = id; state.article = null;
        return out(itemGenericCard(state));
      }
      case 'item-card':
        if(v === CARD.keep) return out(itemKept(state));
        if(v === ITEM.article){
          state.at = 'item-article';
          // Κάθε άρθρο μία φορά («τη» και «την» είναι το ίδιο άρθρο).
          state.forms = ARTICLES.filter((a, i) => ARTICLES.findIndex(x => withArticle(state.ctx.item.name, x) === withArticle(state.ctx.item.name, a)) === i);
          return out({type: 'ask', key: 'item-article', question: 'Πώς το λες;', options: state.forms.map(a => withArticle(state.ctx.item.name, a))});
        }
        if(v === ITEM.other) return out(itemCategories(state, true));
        if(v === ITEM.mine) return out(itemOwnStart(state));
        return out(itemCategories(state));
      case 'item-article': {
        const a = state.forms[ev.index];
        if(a) state.article = a;
        return out(itemGenericCard(state));
      }
      case 'item-own': {
        if(v === ITEM.more && ev.type === 'answer'){ state.ownStep -= 1; return out(ownAsk(state, null, {again: true})); }
        const text = String(v || '').trim();
        const bad = textProblem(text);
        if(bad) return out(ownAsk(state, null, {say: bad}));
        state.own[OWN[state.ownStep][0]].push(text);
        state.ownStep += 1;
        return out(state.ownStep >= OWN.length ? ownCard(state) : ownAsk(state));
      }
      case 'item-own-card':
        if(v === CARD.keep) return out(itemKept(state));
        if(v === ITEM.more){ state.at = 'item-own'; state.ownStep = OWN.length - 1; return out(ownAsk(state, null, {again: true})); }
        return out(finished(state, 'Εντάξει, δεν κράτησα τίποτα.'));
      case 'finished': return out(null);
      default: return out(itemCategories(state));
    }
  }

  function start(ctx){
    if(ctx.item) return startItem(ctx);
    // Μόνο απλά δεδομένα στην κατάσταση (αποθηκεύεται/αντιγράφεται): από τις γραμμές μόνο ό,τι χρειάζεται ο χάρτης.
    const lines = (ctx.lines || []).map(({id, code, name, desc}) => ({id, code, name, desc}));
    const state = JSON.parse(JSON.stringify({ctx: {...ctx, lines, ops: ctx.ops || []}, at: null, changes: [], askedEdits: false}));
    return {state, out: ctx.scope?.id ? pointMenu(state, ctx.scope.id) : menu(state)};
  }

  function next(state, ev){
    state = JSON.parse(JSON.stringify(state));
    if(state.ctx.item) return nextItem(state, ev);
    const ctx = state.ctx, v = ev?.value, now = () => view(ctx);
    const out = (o) => ({state, out: o});
    if(ev?.type === 'close') return out(state.at === 'finished' || state.at === 'always-edits' ? null : closing(state));

    switch(state.at){
      case 'menu': {
        if(v === MENU.wrong){
          const m = material(ctx), fixed = lineAnswers(m, ctx.lines.flatMap(lineKeys));
          state.answers = {...fixed};
          const known = Object.keys(fixed).map(q => m.questions.find(x => x.id === q)?.answers.find(a => a.id === fixed[q])?.label).filter(Boolean);
          state.say = known.length ? `Από τη γραμμή της προσφοράς ξέρω: ${known.join(', ')}.` : null;
          return out(askCase(state));
        }
        if(v === MENU.tech) return out(proposeVariant(state, 's'));
        if(v === MENU.long) return out(proposeVariant(state, 'c'));
        if(v === MENU.order) return out(sectionsAsk(state, 'order-section', 'order-section', 'Σε ποια ενότητα;', 2));
        if(v === MENU.missing) return out(missing(state));
        if(v === MENU.other){
          state.at = 'other'; state.list = items(now().analysis).map(i => i.id);
          return out({type: 'ask', key: 'other', question: 'Ποιο σημείο θες να αλλάξεις;', options: items(now().analysis).map(i => cut(i.text))});
        }
        return out(menu(state));
      }
      case 'question': {
        const q = material(ctx).questions.find(x => x.id === state.q && (!x.when || meets(state.answers, x.when)));
        const a = q?.answers.find(x => x.label === v) || q?.answers[ev.index];
        if(!a) return out(askCase(state));
        state.answers[q.id] = a.id; state.say = null;
        return out(askCase(state));
      }
      case 'card': {
        const p = state.pending;
        if(v === CARD.cancel){ state.pending = null; return out(menu(state, 'Εντάξει, δεν άλλαξε τίποτα. Θες κάτι άλλο;')); }
        if(v === CARD.more){ state.pending = null; return out(menu(state, 'Τι άλλο δεν σου αρέσει;')); }
        if(v === CARD.again && p?.kind === 'edit'){
          state.at = 'rewrite-text';
          return out({type: 'ask', key: 'rewrite-text', question: 'Πες μου πώς θες να γράφει. Μπορείς και με το μικρόφωνο.', options: [],
            input: {value: p.edit.text, placeholder: 'Γράψε το βήμα όπως θες να το διαβάσει ο πελάτης'}});
        }
        if(v !== CARD.keep || !p) return out(menu(state));
        state.pending = null;
        if(p.kind === 'case' || p.kind === 'variant'){
          ctx.chosen = {...ctx.chosen, ...(p.kind === 'case' ? {answers: p.answers} : {variant: p.variant})};
          state.at = 'always'; state.always = p;
          return out({type: 'ask', key: `always-${p.kind}`, question: 'Να το κάνω έτσι πάντα στις επόμενες προσφορές;', options: [ALWAYS.yes, ALWAYS.here]});
        }
        ctx.ops.push(p.edit); state.changes.push(p.edit);
        state.at = 'after-edit';
        return out({type: 'ask', key: 'after-edit', question: 'Μπήκε. Θες κάτι ακόμα;', options: [AFTER.done, AFTER.more]});
      }
      case 'always': {
        const p = state.always;
        if(v === ALWAYS.yes){
          const effect = p.kind === 'case' ? {kind: 'caseRule', material: material(ctx).id, answers: p.answers, label: p.label}
            : {kind: 'speechRule', variant: p.variant, label: VRULE[p.variant]};
          return out(finished(state, 'Έγινε. Μπήκε στους «Οι κανόνες μου».', [effect]));
        }
        return out(finished(state, 'Εντάξει, μόνο σε αυτή την προσφορά.'));
      }
      case 'after-edit': {
        if(v === AFTER.more) return out(menu(state, 'Τι άλλο δεν σου αρέσει;'));
        return out(closing(state) || null);
      }
      case 'always-edits': {
        if(v === ALWAYS.yes) return out(finished(state, 'Έγινε. Μπήκε στους «Οι κανόνες μου».',
          [{kind: 'editRule', key: ruleKey(ctx), ops: state.changes, label: `${material(ctx)?.name || view(ctx).analysis.title}: ${state.changes.length === 1 ? '1 αλλαγή' : `${state.changes.length} αλλαγές`}`}]));
        return out(finished(state, 'Εντάξει, μόνο σε αυτή την προσφορά.'));
      }
      case 'finished': return out(closing(state) || null);
      case 'order-section': {
        const key = state.secs[ev.index] ?? state.secs[now().analysis.sections.filter(s => s.items.length >= 2).findIndex(s => s.title === v)];
        const s = now().analysis.sections.find(x => x.key === key);
        if(!s) return out(menu(state));
        state.at = 'order'; state.section = key;
        return out({type: 'ask', key: 'order', question: 'Βάλε τα στη σειρά που θες, με τα ↑ ↓.', options: [AFTER.ready],
          order: {section: key, items: s.items.map(i => ({id: i.id, text: i.text}))}});
      }
      case 'order': {
        const s = now().analysis.sections.find(x => x.key === state.section);
        const order = ev.type === 'order' && Array.isArray(v) ? v : s.items.map(i => i.id);
        if(order.join() === s.items.map(i => i.id).join()) return out(menu(state, 'Η σειρά έμεινε ίδια. Θες κάτι άλλο;'));
        const after = order.map(id => s.items.find(i => i.id === id)?.text).filter(Boolean);
        const r = proposeEdit(state, {op: 'order', section: s.key, order}, `Νέα σειρά στο «${s.title}»`,
          {section: s.title, before: s.items.map(i => i.text), after, ordered: !!SECTIONS.find(x => x.key === s.key)?.ordered});
        return out(r.bad ? menu(state, `Δεν γίνεται έτσι: ${r.bad}`) : r);
      }
      case 'missing': {
        if(v === AFTER.own) return out(sectionsAsk(state, 'own-section', 'own-section'));
        const x = state.list[ev.index];
        if(!x) return out(missing(state));
        const r = proposeEdit(state, {op: 'add', section: x.section, item: {id: x.id, text: x.text}}, `Μπαίνει στο «${secTitle(x.section)}»: + ${x.text}`,
          {add: {section: secTitle(x.section), text: x.text}});
        return out(r.bad ? {...missing(state), say: `Δεν χωράει: ${r.bad}`} : r);
      }
      case 'own-section': {
        const key = state.secs[ev.index];
        if(!key) return out(sectionsAsk(state, 'own-section', 'own-section'));
        state.at = 'own-text'; state.section = key;
        return out({type: 'ask', key: 'own-text', question: 'Πες μου το βήμα.', options: [],
          input: {value: '', placeholder: 'π.χ. Σφραγίζουμε με σιλικόνη τη βάση στο δάπεδο.'}});
      }
      case 'own-text': {
        const t = String(v || '').trim().slice(0, MAX_TEXT);
        if(t.length < 8) return out({type: 'ask', key: 'own-text', question: 'Γράψ’ το λίγο πιο αναλυτικά, για να το καταλάβει ο πελάτης.', options: [], input: {value: t, placeholder: ''}});
        const r = proposeEdit(state, {op: 'add', section: state.section, item: {id: `own.${state.section}.${idOf(t)}`, text: t}},
          `Μπαίνει στο «${secTitle(state.section)}»: + ${t}`, {add: {section: secTitle(state.section), text: t}});
        return out(r.bad ? {type: 'ask', key: 'own-text', question: `Δεν μπορώ να το γράψω έτσι: ${r.bad}`, options: [], input: {value: t, placeholder: ''}} : r);
      }
      case 'other': {
        const id = state.list[ev.index];
        return out(id ? pointMenu(state, id) : menu(state));
      }
      case 'point': {
        const id = state.point, it = items(now().analysis).find(x => x.id === id);
        if(!it) return out(menu(state));
        if(v === POINT.tech || v === POINT.long){
          const vv = v === POINT.tech ? 's' : 'c', t = data.items[id]?.[vv];
          if(!t || t === it.text) return out(pointMenu(state, id, 'Είναι ήδη σε αυτή την εκδοχή. Θες κάτι άλλο;'));
          const r = proposeEdit(state, {op: 'variant', item: id, variant: vv, text: t}, vv === 's' ? 'Σε πιο απλά λόγια' : 'Πιο σύντομο',
            {before: [it.text], after: [t]}, {say: vv === 's' ? 'Το γράφω σε πιο απλά λόγια:' : 'Το κάνω πιο σύντομο:'});
          return out(r.bad ? pointMenu(state, id, `Δεν γίνεται: ${r.bad}`) : r);
        }
        if(v === POINT.rewrite){
          state.at = 'rewrite-text';
          return out({type: 'ask', key: 'rewrite-text', question: 'Πες μου πώς θες να γράφει. Μπορείς και με το μικρόφωνο.', options: [],
            input: {value: it.text, placeholder: 'Γράψε το βήμα όπως θες να το διαβάσει ο πελάτης'}});
        }
        if(v === POINT.remove){
          const r = proposeEdit(state, {op: 'remove', item: id}, 'Βγαίνει από την ανάλυση:', {remove: it.text});
          if(r.bad || items(applyEdits(now().analysis, [{op: 'remove', item: id}], data).analysis).some(x => x.id === id)){
            const min = SECTIONS.find(s => s.key === it.section).min;
            return out(pointMenu(state, id, `Το «${secTitle(it.section)}» θέλει τουλάχιστον ${min} σημεία. Θες να το γράψεις αλλιώς;`));
          }
          return out(r);
        }
        return out(pointMenu(state, id));
      }
      case 'rewrite-text': {
        const id = state.point, it = items(now().analysis).find(x => x.id === id);
        const t = String(v || '').trim().slice(0, MAX_TEXT);
        if(!it) return out(menu(state));
        if(t.length < 8 || t === it.text) return out({type: 'ask', key: 'rewrite-text', question: t === it.text ? 'Είναι ίδιο με το τωρινό. Άλλαξέ το όπως θες.' : 'Γράψ’ το λίγο πιο αναλυτικά.', options: [],
          input: {value: t || it.text, placeholder: ''}});
        const r = proposeEdit(state, {op: 'replace', item: id, text: t}, 'Νέο κείμενο', {before: [it.text], after: [t]},
          {options: [CARD.keep, CARD.again, CARD.cancel]});
        return out(r.bad ? {type: 'ask', key: 'rewrite-text', question: `Δεν μπορώ να το γράψω έτσι: ${r.bad}`, options: [], input: {value: t, placeholder: ''}} : r);
      }
      default: return out(menu(state));
    }
  }
  return {name: 'library', start, next, view};
}
