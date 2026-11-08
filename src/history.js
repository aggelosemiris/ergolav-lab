// Ιστορικό προσφορών της συσκευής: ό,τι γράφτηκε στο PDF (αριθμός, πελάτης, γραμμές, σύνολα), για να το ξαναδεί
// και να το ξαναστείλει ο τεχνίτης, και πότε πάει στον πελάτη (ημερολόγιο). Η αποθήκευση δεν σπάει ποτέ την εφαρμογή:
// ό,τι δεν διαβάζεται σωστά αγνοείται (όπως στο prices.js). Τα δεδομένα μένουν μόνο σε αυτή τη συσκευή.
import { athensDate, isDate, isTime, isDays } from './dates.js';

export const STORE = 'ergolav.quotes';
export const MAX_QUOTES = 500;      // οι παλαιότερες φεύγουν πρώτες
export const BACKUP = 'ergolav.quotes.backup.';   // + YYYY-MM-DD: αντίγραφο πριν από τη μετάπτωση
export const MAX_BACKUPS = 2;
// Κατάσταση: draft = έγινε PDF αλλά δεν στάλθηκε· sent = στάλθηκε· won = κλείστηκε· lost = χάθηκε.
export const STATUSES = ['draft', 'sent', 'won', 'lost'];
const SCHEDULE = ['scheduled_date', 'scheduled_time', 'duration_days', 'status'];

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const isCents = v => Number.isInteger(v) && v >= 0 && v < 1e11;
const str = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Πότε πάει: scheduled_date 'YYYY-MM-DD' ή null («Δεν ξέρω ακόμα»), scheduled_time 'HH:MM' ή null, duration_days ≥ 1.
// Εγγραφή χωρίς καθόλου κλειδί scheduled_date = παλιά, πριν από το ημερολόγιο: μένει έτσι μέχρι τη μετάπτωση.
function cleanSchedule(q){
  if(!has(q, 'scheduled_date')) return {};
  const date = isDate(q.scheduled_date) ? q.scheduled_date : null;
  return {scheduled_date: date, scheduled_time: date && isTime(q.scheduled_time) ? q.scheduled_time : null,
    duration_days: isDays(q.duration_days) ? q.duration_days : 1, status: STATUSES.includes(q.status) ? q.status : 'sent',
    ...(date && q.scheduled_from_created === true && {scheduled_from_created: true})};
}
// Παλιά προσφορά: στη μέρα δημιουργίας της (ώρα Ελλάδας), με σήμανση, κατάσταση «Στάλθηκε». Μόνο ό,τι λείπει.
function fromCreated(q){
  const add = {scheduled_date: athensDate(q.at), scheduled_time: null, duration_days: 1, status: 'sent', scheduled_from_created: true};
  return Object.fromEntries(Object.entries(add).filter(([k]) => !has(q, k)));
}

/** Καθαρισμένη εγγραφή ή null αν δεν στέκει (ποτέ μισή προσφορά στο ιστορικό). */
function clean(q){
  if(!q || typeof q !== 'object' || !Number.isSafeInteger(q.no) || q.no < 1 || !Number.isFinite(q.at) || q.at <= 0) return null;
  const s = q.sum || {};
  if(!['mat', 'lab', 'net', 'vat', 'total'].every(k => isCents(s[k])) || !Number.isFinite(q.vatRate) || !Array.isArray(q.rows)) return null;
  const rows = q.rows.filter(r => r && typeof r.name === 'string' && Number.isFinite(r.qty) && r.qty > 0 && isCents(r.mat))
    .map(r => ({name: str(r.name), qty: r.qty, unit: str(r.unit, 20), mat: r.mat}));
  if(rows.length !== q.rows.length) return null;
  const p = q.profile || {};
  return {no: q.no, at: q.at, title: str(q.title), client: str(q.client), rows,
    sum: {mat: s.mat, lab: s.lab, net: s.net, vat: s.vat, total: s.total}, vatRate: q.vatRate,
    profile: {name: str(p.name, 80), trade: str(p.trade, 80), phone: str(p.phone, 30), ...(/^[0-9a-f]{8}$/.test(p.logo) && {logo: p.logo})},
    ...cleanSchedule(q)};
}

// Όπως είναι αποθηκευμένες (καθαρισμένες), η νεότερη πρώτη.
function stored(){
  try {
    const raw = storage()?.getItem(STORE);
    const data = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(data)) return [];
    const seen = new Set();
    return data.map(clean).filter(q => q && !seen.has(q.no) && seen.add(q.no)).sort((a, b) => b.no - a.no);
  } catch { return []; }
}

/** Όλες οι προσφορές, η νεότερη πρώτη. Κάθε μία έχει ημερομηνία: όσες δεν πέρασαν ακόμα μετάπτωση (π.χ. δεν χώρεσε
 *  το αντίγραφο) φαίνονται στη μέρα δημιουργίας τους, όπως θα τις έβαζε η μετάπτωση — καμία δεν χάνεται. */
export function listQuotes(){
  return stored().map(q => has(q, 'scheduled_date') ? q : {...q, ...fromCreated(q)});
}

export const getQuote = no => listQuotes().find(q => q.no === no) ?? null;

function write(list){
  try { const s = storage(); if(!s) return false; s.setItem(STORE, JSON.stringify(list.slice(0, MAX_QUOTES))); return true; }
  catch { return false; }
}

/** Αποθηκεύει (ή ενημερώνει, αν ξαναφτιάχτηκε το PDF της ίδιας προσφοράς). false αν η συσκευή δεν την κράτησε. */
export function saveQuote(q){
  const c = clean(q);
  if(!c) return false;
  return write([c, ...stored().filter(x => x.no !== c.no)].sort((a, b) => b.no - a.no));
}

export function deleteQuote(no){
  return write(stored().filter(q => q.no !== no));
}

/** Αλλάζει μόνο ημερομηνία, ώρα, διάρκεια ή κατάσταση μιας προσφοράς (από το ημερολόγιο)· τίποτα άλλο.
 *  Μόλις ο τεχνίτης ορίσει ημερομηνία, η «ημ. δημιουργίας» σβήνει. false αν δεν υπάρχει ή δεν αποθηκεύτηκε. */
export function updateQuote(no, patch){
  const list = stored(), i = list.findIndex(q => q.no === no);
  if(i < 0 || !patch || typeof patch !== 'object') return false;
  const q = has(list[i], 'scheduled_date') ? {...list[i]} : {...list[i], ...fromCreated(list[i])};
  for(const k of SCHEDULE) if(has(patch, k)) q[k] = patch[k];
  if(['scheduled_date', 'scheduled_time', 'duration_days'].some(k => has(patch, k))) delete q.scheduled_from_created;
  const c = clean(q);
  if(!c) return false;
  list[i] = c;
  return write(list);
}

/**
 * Μετάπτωση στο ημερολόγιο: κάθε αποθηκευμένη προσφορά χωρίς κλειδί scheduled_date μπαίνει στη μέρα δημιουργίας της
 * (scheduled_from_created: true, κατάσταση «Στάλθηκε»). Δουλεύει πάνω στο ακατέργαστο JSON: προσθέτει μόνο τα πεδία
 * που λείπουν, δεν αλλάζει, δεν σβήνει και δεν αναδιατάσσει τίποτα άλλο. Πριν γράψει, κρατά αντίγραφο ολόκληρου του
 * ιστορικού (ergolav.quotes.backup.<ημερομηνία>)· αν το αντίγραφο δεν χωρέσει, δεν γράφει τίποτα.
 * Τρέχει σε κάθε άνοιγμα αλλά γράφει μόνο όταν βρει κάτι: δεύτερη εκτέλεση = καμία αλλαγή.
 * Επιστρέφει {migrated, total, backup?, error?}.
 */
export function migrateQuotes(now = Date.now()){
  const s = storage();
  let raw = null, data;
  try { raw = s?.getItem(STORE) ?? null; data = raw ? JSON.parse(raw) : []; } catch { return {migrated: 0, total: 0, error: 'read'}; }
  if(!Array.isArray(data)) return {migrated: 0, total: 0};
  // Μόνο αντικείμενα με έγκυρη ώρα δημιουργίας: ό,τι άλλο (σκουπίδια) μένει όπως ήταν.
  const due = q => q && typeof q === 'object' && !Array.isArray(q) && !has(q, 'scheduled_date') && Number.isFinite(q.at) && q.at > 0;
  const migrated = data.filter(due).length;
  if(!migrated) return {migrated: 0, total: data.length};
  const backup = backupKey(s, now);
  try { s.setItem(backup, raw); } catch { return {migrated: 0, total: data.length, pending: migrated, error: 'backup'}; }
  try { s.setItem(STORE, JSON.stringify(data.map(q => due(q) ? {...q, ...fromCreated(q)} : q))); }
  catch { return {migrated: 0, total: data.length, pending: migrated, backup, error: 'write'}; }
  pruneBackups(s);
  return {migrated, total: data.length, backup};
}

// Ένα αντίγραφο ανά μέρα· αν η μέρα έχει ήδη (δεύτερη μετάπτωση την ίδια μέρα), «.2», «.3» … — κανένα δεν σβήνεται εδώ.
function backupKey(s, now){
  const base = BACKUP + athensDate(now);
  let key = base;
  for(let n = 2; s.getItem(key) !== null; n++) key = `${base}.${n}`;
  return key;
}
/** Τα αντίγραφα που υπάρχουν, το νεότερο πρώτο. */
export function listBackups(s = storage()){
  const keys = [];
  try { for(let i = 0; i < s.length; i++){ const k = s.key(i); if(k?.startsWith(BACKUP)) keys.push(k); } } catch { return []; }
  return keys.sort((a, b) => b.localeCompare(a, 'en', {numeric: true}));
}
// Κρατά τα MAX_BACKUPS νεότερα (κάθε αντίγραφο είναι όσο όλο το ιστορικό· η μνήμη της συσκευής είναι περιορισμένη).
function pruneBackups(s){
  for(const k of listBackups(s).slice(MAX_BACKUPS)) try { s.removeItem(k); } catch {}
}
