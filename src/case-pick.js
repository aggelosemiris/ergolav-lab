// Μέρος 3: ποια ανάλυση μπαίνει για κάθε εργασία της προσφοράς (μόνο με ALLAXE_BOT_ENABLED). Καθαρές συναρτήσεις,
// χωρίς DOM και χωρίς αποθήκευση: τα δεδομένα (CASE_DATA, ANALYSES), οι κανόνες και η επιλογή της προσφοράς μπαίνουν
// ως ορίσματα, ώστε να ελέγχονται με τεστ.
//
// Σειρά προτεραιότητας για την περίπτωση: επιλογή του μάστορα σε αυτή την προσφορά > κανόνας του μάστορα >
// λέξεις της φωνής > βασική (η σημερινή ανάλυση). Μια περίπτωση μπαίνει ΜΟΝΟ αν είναι η βασική ή έχει εγκριθεί
// (υπάρχει στο CASE_DATA)· αλλιώς δοκιμάζεται η επόμενη. Ό,τι λέει η γραμμή της προσφοράς (π.χ. ο τύπος «κρεμαστή»
// από τον κωδικό) δεν το αλλάζει ούτε κανόνας ούτε φωνή.
// Εκδοχή λόγου: επιλογή της προσφοράς > κανόνας > κανονική. Σε κάθε σημείο μπαίνει η εγκεκριμένη απλή/σύντομη·
// όπου δεν υπάρχει, μένει η κανονική.
import { SECTIONS } from './analysis-schema.js';
import { CATALOG } from './catalog.js';
import { nextQuestion, meets, covers, caseId, lineAnswers, caseLabel } from './case-map.js';

export const SOURCE_LABEL = {
  base: 'βασική περίπτωση', chosen: 'επιλογή σου', rule: 'από τον κανόνα σου', voice: 'από όσα είπες',
  generic: 'γενική ανάλυση', own: 'γραμμένη από σένα', library: 'από τη βιβλιοθήκη σου',
};
export const VARIANT_LABEL = {n: 'κανονική', s: 'απλά λόγια', c: 'σύντομη'};
export const VARIANTS = ['n', 's', 'c'];

export const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
const phon = t => t.replace(/ει|οι/g, 'ι').replace(/αι/g, 'ε').replace(/[ηυ]/g, 'ι').replace(/ω/g, 'ο');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Η ρίζα ξεκινά λέξη μέσα στο κείμενο (κανονικοποιημένο): «αλλαγ» πιάνει «αλλαγή», όχι «μεταλλαγή». */
const hasStem = (text, stem) => new RegExp(`(^|[^a-z0-9α-ω])${reEsc(plain(stem))}`).test(text);
// Ίδιο σπάσιμο σε φράσεις με το src/parse.js (μία φράση ≈ ένα υλικό).
const SPLIT = /[.,;!?·](?=\s|$)|\n|\s(?:και|επίσης|επισης|έπειτα|επειτα|μετά|μετα|ακόμα|ακομα|ακόμη|ακομη|συν|and|also)\s/iu;

/** Οι απαντήσεις που δείχνουν οι λέξεις ενός κειμένου: μόνο όπου μία απάντηση της ερώτησης ακούστηκε (όχι δύο). */
export function voiceAnswers(material, text){
  const t = plain(text), hits = {};
  for(const q of material.questions) for(const a of q.answers)
    if((a.words || []).some(w => hasStem(t, w))) (hits[q.id] ??= new Set()).add(a.id);
  return Object.fromEntries(Object.entries(hits).filter(([, s]) => s.size === 1).map(([q, s]) => [q, [...s][0]]));
}

/** Τα κλειδιά μιας γραμμής για τον χάρτη: «είδος» και «είδος:τύπος» (ο τύπος από τον κωδικό, όπως στο tasks.js). */
export function lineKeys(line){
  const item = CATALOG.find(c => c.id === line?.id);
  if(!item) return [];
  const words = plain(`${line.name || ''} ${line.desc || ''}`);
  const opt = (item.options || []).find(o => line.code && o.code === line.code) || (item.options || []).find(o => words.includes(plain(o.label)));
  return opt ? [item.id, `${item.id}:${opt.label}`] : [item.id];
}

/** Οι φράσεις του κειμένου της φωνής που αφορούν τις γραμμές μιας εργασίας· αλλιώς τα ονόματα των γραμμών. */
export function voiceFor(text, lines){
  const segs = String(text || '').split(SPLIT).filter(Boolean).map(s => s.trim()).filter(Boolean);
  const ids = new Set(lines.map(l => l.id));
  const kws = CATALOG.filter(c => ids.has(c.id)).flatMap(c => c.keywords || []).map(k => phon(plain(k)).split('+')[0]);
  const mine = segs.filter(s => { const p = phon(plain(s)); return kws.some(k => k && new RegExp(`(^|[^a-z0-9α-ω])${reEsc(k)}`).test(p)); });
  return mine.length ? mine.join(' · ') : lines.map(l => `${l.name || ''} ${l.desc || ''}`).join(' · ');
}

/** Το υλικό του χάρτη για μια εργασία: από τα κλειδιά των γραμμών, και όπου ταιριάζουν πολλά, αυτό που έχει την εργασία. */
export function materialFor(data, task, lines){
  const keys = new Set(lines.flatMap(lineKeys));
  const all = data.materials.filter(m => m.catalog.some(k => keys.has(k)));
  const owns = m => [...m.base, ...(m.existing || [])].some(b => b.task === task);
  return all.find(owns) || null;
}

/** Πλήρης περίπτωση: για κάθε ερώτηση που ισχύει, η γραμμή > η προτίμηση > η βασική > η πρώτη απάντηση. */
export function complete(material, prefer = {}, fixed = {}, defaults = {}){
  const a = {};
  for(let q; (q = nextQuestion(material, a));){
    const ok = v => v != null && q.answers.some(x => x.id === v);
    const d = defaults[q.id];
    a[q.id] = [fixed[q.id], prefer[q.id], ...(Array.isArray(d) ? d : [d]), q.answers[0].id].find(ok);
  }
  return a;
}

/** Η ανάλυση (στη μορφή των σημερινών) μιας εγκεκριμένης περίπτωσης. */
function fromCase(c, data, task, base){
  return {id: task, title: c.title, trade: base?.trade || '', typical_duration: c.duration, related_consumables: [],
    requires_licensed_professional: !!c.licensed, notes_for_master: '',
    sections: SECTIONS.map(s => ({key: s.key, title: s.title, items: (c.sections[s.key] || []).map(id => ({id, text: data.items[id]?.n ?? ''}))}))};
}

/** Η εκδοχή λόγου σε όλη την ανάλυση: η εγκεκριμένη απλή/σύντομη σε κάθε σημείο, αλλιώς η κανονική. */
export function withVariant(analysis, variant, data){
  if(!variant || variant === 'n') return {analysis, variant: 'n'};
  let used = false;
  const sections = analysis.sections.map(s => ({...s, items: s.items.map(it => {
    const t = data.items[it.id]?.[variant];
    if(t) used = true;
    return t ? {...it, text: t} : it;
  })}));
  return used ? {analysis: {...analysis, sections}, variant} : {analysis, variant: 'n'};
}
/** Έχει η ανάλυση εγκεκριμένη εκδοχή λόγου (για να φανούν τα «Πολύ τεχνικό» / «Πολύ μεγάλο»); */
export const hasVariant = (analysis, variant, data) => analysis.sections.some(s => s.items.some(it => data.items[it.id]?.[variant]));

/** Ο κανόνας περίπτωσης ενός υλικού ισχύει μόνο αν δεν αντιλέγει σε ό,τι λέει η γραμμή. */
const fits = (answers, fixed) => Object.entries(fixed).every(([q, v]) => !(q in answers) || answers[q] === v);

/**
 * Η ανάλυση μιας εργασίας της προσφοράς.
 * data: CASE_DATA · base: ANALYSES · task: id εργασίας · lines: οι γραμμές της · voice: κείμενο της φωνής
 * rules: {cases: {[υλικό]: {answers}}, variant: 's'|'c'|null} · chosen: {answers?, variant?} (μόνο αυτή η προσφορά)
 * → {task, material, caseId, answers, label, source, variant, variantFrom, analysis} ή null (χωρίς ανάλυση, όπως σήμερα).
 */
export function pickAnalysis({data, base, task, lines, voice = '', rules = {}, chosen = null}){
  const material = materialFor(data, task, lines);
  const baseA = base[task] || null;
  const vPick = chosen?.variant || rules.variant || null;
  const finish = r => {
    const v = withVariant(r.analysis, vPick, data);
    return {...r, analysis: v.analysis, variant: v.variant, variantFrom: v.variant === 'n' ? null : chosen?.variant ? 'chosen' : 'rule'};
  };
  const entry = material && [...material.base, ...(material.existing || [])].find(b => b.task === task);
  if(!entry) return baseA ? finish({task, material: material?.id || null, caseId: null, answers: {}, label: '', source: 'base', analysis: baseA}) : null;

  const fixed = lineAnswers(material, lines.flatMap(lineKeys));
  const resolve = prefer => {
    const full = complete(material, prefer, fixed, entry.answers);
    if((material.exclude || []).some(e => meets(full, e.when))) return null;
    const id = caseId(material, full);
    const b = material.base.find(x => covers(x.answers, full) && base[x.task]);
    if(b) return {full, id, isBase: true, analysis: {...base[b.task], id: task}};
    return data.cases[id] ? {full, id, isBase: false, analysis: fromCase(data.cases[id], data, task, baseA)} : null;
  };
  const rule = rules.cases?.[material.id]?.answers;
  const heard = voiceAnswers(material, voice);
  const tries = [
    chosen?.answers && ['chosen', chosen.answers],
    rule && fits(rule, fixed) && ['rule', rule],
    Object.keys(heard).length && ['voice', heard],
    ['base', {}],
  ].filter(Boolean);
  for(const [source, prefer] of tries){
    const r = resolve(prefer);
    if(!r) continue;
    // Φωνή που καταλήγει στη βασική = βασική (η ετικέτα λέει την αλήθεια για το από πού ήρθε το κείμενο).
    const src = source === 'voice' && r.isBase ? 'base' : source;
    return finish({task, material: material.id, caseId: r.id, answers: r.full, label: caseLabel(material, r.full), source: src, analysis: r.analysis});
  }
  return null;
}

/** Η ετικέτα κάτω από τον τίτλο (μόνο στην οθόνη): «Λεκάνη: Αλλαγή παλιάς · Κρεμαστή · ... · από τον κανόνα σου · απλά λόγια». */
export function pickTag(pick, data){
  const m = data.materials.find(x => x.id === pick.material);
  return [pick.label ? `${m ? `${m.name}: ` : ''}${pick.label}` : '', SOURCE_LABEL[pick.source] || '', pick.variant !== 'n' ? VARIANT_LABEL[pick.variant] : '']
    .filter(Boolean).join(' · ');
}

/**
 * Η ανάλυση μιας περίπτωσης χωρίς γραμμή καταλόγου (π.χ. είδος εκτός καταλόγου που «μοιάζει με» ένα υλικό):
 * {analysis, caseId, label, isBase} ή null αν η περίπτωση δεν έχει εγκριθεί ή έχει βγει έξω από τον χάρτη.
 */
export function analysisForAnswers(data, base, materialId, answers, task = null){
  const m = data.materials.find(x => x.id === materialId);
  if(!m) return null;
  const full = complete(m, answers, {}, m.base[0]?.answers || {});
  if((m.exclude || []).some(e => meets(full, e.when))) return null;
  const id = caseId(m, full), b = m.base.find(x => covers(x.answers, full) && base[x.task]);
  const t = task || b?.task || m.base[0]?.task;
  if(b) return {analysis: {...base[b.task]}, caseId: id, label: caseLabel(m, full), isBase: true, answers: full};
  return data.cases[id] ? {analysis: fromCase(data.cases[id], data, t, base[m.base[0]?.task]), caseId: id, label: caseLabel(m, full), isBase: false, answers: full} : null;
}
