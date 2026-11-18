import { stripPersonal } from './rewrite-client.js';
// «Άλλαξέ το» χωρίς AI (μόνο με ALLAXE_BOT_ENABLED): κανόνες του μάστορα και η ανάλυση κάθε προσφοράς, στη συσκευή.
// - Κανόνας περίπτωσης: ένας ανά υλικό ({answers, label}), ο νέος αντικαθιστά τον παλιό.
// - Κανόνας λόγου: ένας γενικός («Πάντα απλά λόγια» = 's' / «Πάντα σύντομα» = 'c').
// - Ανά προσφορά: η επιλογή του μάστορα «μόνο εδώ» και, μόλις φτιαχτεί το PDF, το στιγμιότυπο της ανάλυσης που
//   μπήκε. Μια προσφορά που έχει σταλεί δείχνει ΑΚΡΙΒΩΣ αυτό το στιγμιότυπο, ό,τι κι αν αλλάξει μετά (κανόνες, κείμενα).
// Η αποθήκευση δεν σπάει ποτέ την εφαρμογή: ό,τι δεν διαβάζεται σωστά αγνοείται.

export const CASE_RULES = 'ergolav.caseRules';
export const SPEECH_RULE = 'ergolav.speechRule';
export const QUOTE_ANALYSES = 'ergolav.quoteAnalyses';
export const MAX_QUOTE_ANALYSES = 100;   // οι παλαιότερες φεύγουν πρώτες

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const read = (key, fallback) => { try { return JSON.parse(storage()?.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { storage()?.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const isAnswers = a => a && typeof a === 'object' && !Array.isArray(a) && Object.values(a).every(v => typeof v === 'string');

// ── Κανόνες περίπτωσης: {[υλικό]: {answers, label, created}}
export function caseRules(){
  return Object.fromEntries(Object.entries(obj(read(CASE_RULES, {}))).filter(([, r]) => isAnswers(r?.answers))
    .map(([m, r]) => [m, {answers: r.answers, label: String(r.label || ''), created: Number(r.created) || 0}]));
}
// at: η ώρα της αλλαγής (από τον συγχρονισμό· αλλιώς τώρα).
export function setCaseRule(material, answers, label, at = Date.now()){
  if(!material || !isAnswers(answers)) return false;
  clearDeleted(`rule:case:${material}`);
  return write(CASE_RULES, {...caseRules(), [material]: {answers, label: String(label || ''), created: at}});
}
export function removeCaseRule(material, at = Date.now()){
  const r = caseRules();
  delete r[material];
  deleted(`rule:case:${material}`, at);
  return write(CASE_RULES, r);
}

// ── Κανόνας λόγου: 's' | 'c' | null
export const speechRule = () => { const v = read(SPEECH_RULE, null); return v === 's' || v === 'c' ? v : null; };
export const setSpeechRule = (v, at = Date.now()) => v === 's' || v === 'c' ? (clearDeleted('rule:speech'), write(SPEECH_RULE, v) && write(SPEECH_RULE_AT, at)) : false;
export const removeSpeechRule = (at = Date.now()) => { deleted('rule:speech', at); try { storage()?.removeItem(SPEECH_RULE); return true; } catch { return false; } };
export const SPEECH_RULE_AT = 'ergolav.speechRuleAt';
export const speechRuleAt = () => Number(read(SPEECH_RULE_AT, 0)) || 0;

/** Οι κανόνες στη μορφή που θέλει το pickAnalysis. */
export const pickRules = () => ({cases: caseRules(), variant: speechRule(), edits: editRules()});

// ── Ανά προσφορά: {[αρ.]: {at, picks: {[εργασία]: {answers?, variant?}}, snapshot?: {at, docs}}}
const quotes = () => obj(read(QUOTE_ANALYSES, {}));
// Πάντα μεγαλύτερο από κάθε προηγούμενο, ώστε «νεότερη» να σημαίνει «αλλάχτηκε τελευταία» και μέσα στο ίδιο ms.
const stamp = all => Math.max(Date.now(), ...Object.values(all).map(q => (Number(q?.at) || 0) + 1));
function saveQuotes(all){
  const keep = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_QUOTE_ANALYSES);
  return write(QUOTE_ANALYSES, Object.fromEntries(keep));
}
export const quotePicks = no => obj(quotes()[no]?.picks);
/** Η επιλογή «μόνο εδώ» για μια εργασία μιας προσφοράς· null = σβήνει. */
export function setQuotePick(no, task, pick){
  const all = quotes(), q = {...obj(all[no]), at: stamp(all)};
  q.picks = {...obj(q.picks)};
  if(pick) q.picks[task] = pick; else delete q.picks[task];
  all[no] = q;
  return saveQuotes(all);
}
/** Το στιγμιότυπο της ανάλυσης που μπήκε στο PDF της προσφοράς: {sig, docs: [{id, lines, analysis, pick}]} ή null.
 *  sig: οι γραμμές της προσφοράς τότε· αν άλλαξαν, το στιγμιότυπο δεν ισχύει. */
export function quoteSnapshot(no){
  const s = quotes()[no]?.snapshot;
  return s && typeof s.sig === 'string' && Array.isArray(s.docs) ? {sig: s.sig, docs: s.docs} : null;
}
export function saveQuoteSnapshot(no, sig, docs){
  const all = quotes();
  all[no] = {...obj(all[no]), at: stamp(all), snapshot: {at: Date.now(), sig, docs}};
  return saveQuotes(all);
}

// ── Αλλαγές «μόνο εδώ» ανά προσφορά και εργασία (σειρά, + βήμα, − βήμα, δικό του κείμενο): [{op…}] (src/analysis-edits.js)
export const quoteEdits = no => { const e = obj(quotes()[no]?.edits); return Object.fromEntries(Object.entries(e).filter(([, v]) => Array.isArray(v))); };
export function setQuoteEdits(no, task, ops){
  const all = quotes(), q = {...obj(all[no]), at: stamp(all)};
  q.edits = {...obj(q.edits)};
  if(Array.isArray(ops) && ops.length) q.edits[task] = ops; else delete q.edits[task];
  all[no] = q;
  return saveQuotes(all);
}

// ── Κανόνες αλλαγών: {[υλικό ή task:εργασία]: {ops, label, created}}· μπαίνουν σε κάθε νέα ανάλυση του υλικού.
export const EDIT_RULES = 'ergolav.editRules';
export function editRules(){
  return Object.fromEntries(Object.entries(obj(read(EDIT_RULES, {}))).filter(([, r]) => Array.isArray(r?.ops) && r.ops.length)
    .map(([k, r]) => [k, {ops: r.ops, label: String(r.label || ''), created: Number(r.created) || 0}]));
}
export function setEditRule(key, ops, label, at = Date.now()){
  if(!key || !Array.isArray(ops) || !ops.length) return false;
  clearDeleted(`rule:edit:${key}`);
  return write(EDIT_RULES, {...editRules(), [key]: {ops, label: String(label || ''), created: at}});
}
export function removeEditRule(key, at = Date.now()){ const r = editRules(); delete r[key]; deleted(`rule:edit:${key}`, at); return write(EDIT_RULES, r); }

// ── Ανώνυμες μετρήσεις χρήσης: ποιο κουμπί, ποιο υλικό/ανάλυση, «Κράτα το» ή «Άκυρο». ΧΩΡΙΣ κείμενα, χρήστη ή πελάτη.
export const METRICS = 'ergolav.botMetrics';
export const MAX_METRICS = 1000;
const ALLOWED = ['ev', 'step', 'choice', 'material', 'analysis', 'outcome', 'engine'];
export function track(event){
  const e = {t: Date.now()};
  for(const k of ALLOWED) if(typeof event?.[k] === 'string' && event[k].length <= 80) e[k] = event[k];
  const list = Array.isArray(read(METRICS, [])) ? read(METRICS, []) : [];
  return write(METRICS, [...list, e].slice(-MAX_METRICS));
}
export const metrics = () => { const l = read(METRICS, []); return Array.isArray(l) ? l : []; };

/** Αντίγραφο όλων όσων αλλάζει το bot (για την «Αναίρεση»)· restore το ξαναγράφει ακριβώς. */
const KEYS = () => [CASE_RULES, SPEECH_RULE, SPEECH_RULE_AT, QUOTE_ANALYSES, EDIT_RULES, LIBRARY, DELETED, MISSING_QUEUE];
export function snapshotAll(){ const s = {}; for(const k of KEYS()){ try { s[k] = storage()?.getItem(k) ?? null; } catch { s[k] = null; } } return s; }
export function restoreAll(s){
  for(const k of KEYS()){ try { if(s[k] == null) storage()?.removeItem(k); else storage()?.setItem(k, s[k]); } catch {} }
}

// ── Σβησμένα (για τον συγχρονισμό: «η πιο πρόσφατη αλλαγή κερδίζει» και στα σβησίματα): {[κλειδί]: ώρα}
export const DELETED = 'ergolav.syncDeleted';
export const deletedAt = () => obj(read(DELETED, {}));
function deleted(key, at = Date.now()){ write(DELETED, {...deletedAt(), [key]: at}); }
export function clearDeleted(key){ const d = deletedAt(); delete d[key]; write(DELETED, d); }

// ── Βιβλιοθήκη του μάστορα: αναλύσεις για είδη εκτός καταλόγου, με κλειδί το κανονικοποιημένο όνομα.
//   {[κλειδί]: {name, kind:'generic'|'own'|'case'|'official', analysis, category?, article?, material?, answers?, createdIn?, updated}}
export const LIBRARY = 'ergolav.library';
export const MAX_LIBRARY = 200;
const lplain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
/** Το κλειδί ενός είδους: πεζά, χωρίς τόνους, χωρίς σημεία στίξης, έως 60 χαρακτήρες («Σίτες!» = «σιτες»). */
export const libKey = name => lplain(name).replace(/[^a-z0-9α-ω ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const okAnalysis = a => a && typeof a === 'object' && typeof a.title === 'string' && Array.isArray(a.sections);
export function library(){
  return Object.fromEntries(Object.entries(obj(read(LIBRARY, {}))).filter(([k, e]) => k && okAnalysis(e?.analysis) && typeof e.name === 'string'));
}
export const libraryEntry = name => library()[libKey(name)] || null;
export function saveLibrary(name, entry, at = Date.now()){
  const key = libKey(name);
  if(!key || !okAnalysis(entry?.analysis)) return false;
  const all = library();
  all[key] = {...entry, name: String(name).trim().slice(0, 80), updated: at};
  const keep = Object.entries(all).sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0)).slice(0, MAX_LIBRARY);
  clearDeleted(`analysis:${key}`);
  return write(LIBRARY, Object.fromEntries(keep));
}
export function removeLibrary(key, at = Date.now()){ const all = library(); delete all[key]; deleted(`analysis:${key}`, at); return write(LIBRARY, all); }

// ── «Υπάρχει πλέον έτοιμη ανάλυση…»: ρωτιέται μία φορά ανά είδος.
export const OFFICIAL_ASKED = 'ergolav.officialAsked';
export const officialAsked = key => !!obj(read(OFFICIAL_ASKED, {}))[key];
export const setOfficialAsked = key => write(OFFICIAL_ASKED, {...obj(read(OFFICIAL_ASKED, {})), [key]: Date.now()});

// ── Λίστα ομάδας (missing_items): ΜΟΝΟ κανονικοποιημένο όνομα και κατηγορία. Ουρά στη συσκευή μέχρι να σταλεί.
export const MISSING_QUEUE = 'ergolav.missingQueue';
export const MAX_MISSING = 200;
/**
 * Το όνομα που πάει στη λίστα: χωρίς ονόματα/τηλέφωνα της προσφοράς (personal), χωρίς αριθμούς, μόνο γράμματα,
 * έως 5 λέξεις και 40 χαρακτήρες. null αν δεν μένει κάτι που να μοιάζει με είδος.
 */
const CUT_AT = new Set(['για', 'στον', 'στην', 'στη', 'στο', 'στα', 'στουσ', 'στισ', 'του', 'τησ', 'των', 'απο', 'κ', 'κοσ', 'κα', 'κυρια', 'κυριο', 'κυριοσ', 'οδοσ', 'οδο']);
const NAME_STOP = new Set(['και', 'με', 'σε', 'το', 'τα', 'τη', 'την', 'τον', 'ο', 'η', 'οι', 'ενα', 'μια', 'τεμ']);
export function missingName(name, personal = {}){
  const t = lplain(stripPersonal(String(name ?? ''), personal)).replace(/\[[^\]]*\]/g, ' ').replace(/[^a-zα-ω ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Από το «για…», «στον…», «του…» και μετά λέει συνήθως για ποιον ή πού: κόβεται (μπορεί να έχει στοιχεία πελάτη).
  const words = t.split(' '), cut = words.findIndex(w => CUT_AT.has(w));
  const out = (cut < 0 ? words : words.slice(0, cut)).filter(w => w.length > 1 && !NAME_STOP.has(w)).slice(0, 5).join(' ').slice(0, 40).trim();
  return out.length >= 2 ? out : null;
}
export function queueMissing(name, category, personal){
  const n = missingName(name, personal);
  if(!n) return false;
  const q = missingQueue();
  return write(MISSING_QUEUE, [...q, {name: n, category: typeof category === 'string' && /^[a-z-]{2,30}$/.test(category) ? category : null}].slice(-MAX_MISSING));
}
export const missingQueue = () => { const q = read(MISSING_QUEUE, []); return Array.isArray(q) ? q.filter(x => x && typeof x.name === 'string') : []; };
/** Αφαιρεί τα πρώτα n (όσα στάλθηκαν). */
export const dropMissing = n => write(MISSING_QUEUE, missingQueue().slice(n));
