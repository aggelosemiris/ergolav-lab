// Ανάλυση εργασιών στη συσκευή: η εκδοχή του τεχνίτη ανά εργασία (από το «Άλλαξέ το») και οι κανόνες ύφους του.
// Η εκδοχή του τεχνίτη χρησιμοποιείται σε κάθε επόμενη προσφορά με την ίδια εργασία· η αρχική μένει στην εφαρμογή
// και γυρνά με την «Επαναφορά». Η αποθήκευση δεν σπάει ποτέ την εφαρμογή: ό,τι δεν διαβάζεται σωστά αγνοείται.
// Τα δεδομένα μένουν μόνο σε αυτή τη συσκευή.
import { validateAnalysis } from './analysis-schema.js';

export const VERSIONS = 'ergolav.analyses.v1';
export const RULES = 'ergolav.styleRules';
export const DEVICE = 'ergolav.deviceId';
export const MAX_RULES = 20, MAX_RULE = 200;

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const read = (key, fallback) => {
  try { const v = JSON.parse(storage()?.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; }
};
const write = (key, value) => { try { storage()?.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const clean = s => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, MAX_RULE) : '';
const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');

// ── Εκδοχές του τεχνίτη: {[εργασία]: {analysis, updated}}
const versions = () => { const v = read(VERSIONS, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };

/** Η εκδοχή του τεχνίτη για μια εργασία, ή null (τότε ισχύει η αρχική). */
export function getVersion(id){
  const a = versions()[id]?.analysis;
  return a && a.id === id && !validateAnalysis(a).length ? a : null;
}
/** Κρατά την ανάλυση ως εκδοχή του τεχνίτη για την εργασία της. false αν δεν στέκει ή δεν χωράει στη συσκευή. */
export function saveVersion(analysis){
  if(validateAnalysis(analysis).length) return false;
  return write(VERSIONS, {...versions(), [analysis.id]: {analysis, updated: Date.now()}});
}
/** «Επαναφορά»: σβήνει την εκδοχή του τεχνίτη· η εργασία γυρνά στην αρχική ανάλυση. */
export function resetVersion(id){
  const v = versions();
  if(!(id in v)) return true;
  delete v[id];
  return write(VERSIONS, v);
}

// ── Κανόνες ύφους: [{id, text, created}]· μπαίνουν σε κάθε επόμενο «Άλλαξέ το».
/** Οι κανόνες με τη σειρά που γράφτηκαν. */
export function listRules(){
  const r = read(RULES, []);
  return Array.isArray(r) ? r.filter(x => x && typeof x.id === 'string' && clean(x.text)).map(x => ({id: x.id, text: clean(x.text), created: x.created || 0})) : [];
}
/** Νέος κανόνας· ίδιος με υπάρχοντα (χωρίς τόνους/κεφαλαία) δεν διπλογράφεται. Επιστρέφει τον κανόνα ή null. */
export function addRule(text){
  const t = clean(text), rules = listRules();
  if(!t) return null;
  const same = rules.find(r => plain(r.text) === plain(t));
  if(same) return same;
  if(rules.length >= MAX_RULES) return null;
  const rule = {id: newId(), text: t, created: Date.now()};
  return write(RULES, [...rules, rule]) ? rule : null;
}
/** Αλλαγή του κειμένου ενός κανόνα· κενό κείμενο = σβήσιμο. */
export function updateRule(id, text){
  const t = clean(text);
  if(!t) return deleteRule(id);
  return write(RULES, listRules().map(r => r.id === id ? {...r, text: t} : r));
}
export function deleteRule(id){ return write(RULES, listRules().filter(r => r.id !== id)); }

// ── Αναγνωριστικό συσκευής για το όριο αιτημάτων της υπηρεσίας (τυχαίο, χωρίς προσωπικά στοιχεία).
export function deviceId(){
  const v = read(DEVICE, null);
  if(typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) return v;
  const id = newId();
  write(DEVICE, id);
  return id;
}
function newId(){
  if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
