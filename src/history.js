// Ιστορικό προσφορών της συσκευής: ό,τι γράφτηκε στο PDF (αριθμός, πελάτης, γραμμές, σύνολα), για να το ξαναδεί
// και να το ξαναστείλει ο τεχνίτης, και πότε πάει στον πελάτη (ημερολόγιο). Η αποθήκευση δεν σπάει ποτέ την εφαρμογή:
// ό,τι δεν διαβάζεται σωστά αγνοείται (όπως στο prices.js). Η οθόνη διαβάζει ΠΑΝΤΑ από εδώ (localStorage)· ο
// συγχρονισμός με τον λογαριασμό (src/sync.js) γίνεται στο παρασκήνιο.
//
// Ταυτότητα: κάθε προσφορά έχει σταθερό id (uuid) — ο αριθμός (no) είναι μετρητής ανά συσκευή και σε δύο κινητά
// μπορεί να επαναληφθεί. updated = πότε άλλαξε τελευταία (ms), για «η νεότερη αλλαγή κερδίζει». Οι συναρτήσεις που
// δέχονται «κλειδί» παίρνουν id (string) ή no (αριθμό· για ό,τι δεν έχει ακόμα id).
import { athensDate, isDate, isTime, isDays } from './dates.js';

export const STORE = 'ergolav.quotes';
export const MAX_QUOTES = 500;      // οι παλαιότερες φεύγουν πρώτες
export const BACKUP = 'ergolav.quotes.backup.';   // + YYYY-MM-DD: αντίγραφο πριν από τη μετάπτωση
export const MAX_BACKUPS = 2;
// Κατάσταση: draft = έγινε PDF αλλά δεν στάλθηκε· sent = στάλθηκε· won = κλείστηκε· lost = χάθηκε.
export const STATUSES = ['draft', 'sent', 'won', 'lost'];
const SCHEDULE = ['scheduled_date', 'scheduled_time', 'duration_days', 'status'];
// Σβησμένες προσφορές που δεν έχει μάθει ακόμα ο λογαριασμός: [{id, at}] (το σβήσιμο είναι deleted_at, όχι διαγραφή).
export const DELETED = 'ergolav.quotes.deleted';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Νέο uuid v4 (crypto.randomUUID ή, σε παλιό browser, getRandomValues). */
export function newId(){
  const c = globalThis.crypto;
  if(typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const match = key => typeof key === 'string' ? q => q.id === key : q => q.no === key;

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

/** Καθαρισμένη εγγραφή ή null αν δεν στέκει (ποτέ μισή προσφορά στο ιστορικό). Χρησιμοποιείται και για ό,τι
 *  έρχεται από τον λογαριασμό (μη αξιόπιστο). */
export function clean(q){
  if(!q || typeof q !== 'object' || !Number.isSafeInteger(q.no) || q.no < 1 || !Number.isFinite(q.at) || q.at <= 0) return null;
  const s = q.sum || {};
  if(!['mat', 'lab', 'net', 'vat', 'total'].every(k => isCents(s[k])) || !Number.isFinite(q.vatRate) || !Array.isArray(q.rows)) return null;
  const rows = q.rows.filter(r => r && typeof r.name === 'string' && Number.isFinite(r.qty) && r.qty > 0 && isCents(r.mat))
    .map(r => ({name: str(r.name), qty: r.qty, unit: str(r.unit, 20), mat: r.mat}));
  if(rows.length !== q.rows.length) return null;
  const p = q.profile || {};
  return {...(typeof q.id === 'string' && UUID.test(q.id) && {id: q.id}),
    ...(Number.isFinite(q.updated) && q.updated > 0 && {updated: q.updated}),
    no: q.no, at: q.at, title: str(q.title), client: str(q.client), rows,
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
    // Μία εγγραφή ανά id· όσες δεν έχουν ακόμα id (παλιές), μία ανά αριθμό.
    const seen = new Set();
    return data.map(clean).filter(q => { const k = q?.id ?? `no:${q?.no}`; return q && !seen.has(k) && seen.add(k); })
      .sort((a, b) => b.no - a.no || (b.updated || b.at) - (a.updated || a.at));
  } catch { return []; }
}

// ── Ποιος βλέπει (κοινή συσκευή, εύρημα H4) ──
// Κάθε προσφορά ανήκει στον λογαριασμό που τη δημιούργησε ({id: userId}, το ίδιο κλειδί με τον συγχρονισμό, src/sync.js).
// Η οθόνη δείχνει ΜΟΝΟ τις προσφορές του συνδεδεμένου· χωρίς σύνδεση, μόνο όσες δεν ανήκουν σε κανέναν. Οι προσφορές
// ενός άλλου λογαριασμού μένουν στη συσκευή (δεν σβήνονται, δεν ανεβαίνουν σε λάθος λογαριασμό) αλλά δεν φαίνονται.
// Χωρίς setViewer (εφαρμογή χωρίς λογαριασμό): όλες, όπως πριν.
export const OWNERS = 'ergolav.sync.owners';    // {id: userId}
let viewerOf = null;
/** fn() → userId του συνδεδεμένου ή null· null (αντί για fn) = χωρίς λογαριασμούς, χωρίς φίλτρο. */
export function setViewer(fn){ viewerOf = typeof fn === 'function' ? fn : null; }
function viewer(){
  if(!viewerOf) return undefined;
  try { const v = viewerOf(); return typeof v === 'string' && v ? v : null; } catch { return null; }
}
export function owners(){
  try { const v = JSON.parse(storage()?.getItem(OWNERS) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch { return {}; }
}
function claimIds(ids, uid){
  if(!uid || !ids.length) return;
  const o = owners();
  let changed = false;
  for(const id of ids) if(typeof id === 'string' && UUID.test(id) && !o[id]){ o[id] = uid; changed = true; }
  if(changed) try { storage()?.setItem(OWNERS, JSON.stringify(o)); } catch {}
}
/** Όσες προσφορές της συσκευής δεν ανήκουν σε κανέναν (φτιάχτηκαν πριν από τους λογαριασμούς) τις παίρνει ο uid:
 *  ο πρώτος που συνδέεται σε αυτή τη συσκευή, όπως και στον συγχρονισμό. Οι επόμενοι δεν τις βλέπουν. */
export const claimUnowned = uid => claimIds(stored().map(q => q.id), uid);

/** Σβήνει από τη συσκευή ΜΟΝΟ τις προσφορές (και τα σβησμένα) του uid· όσες ανήκουν σε άλλον λογαριασμό μένουν.
 *  Επιστρέφει πόσες έμειναν στη συσκευή. */
export function removeOwned(uid){
  const o = owners(), mine = id => !!id && o[id] === uid;
  const left = stored().filter(q => !mine(q.id));
  write(left);
  writeDeleted(listDeleted().filter(d => !mine(d.id)));
  for(const id of Object.keys(o)) if(o[id] === uid) delete o[id];
  try { const s = storage(); if(Object.keys(o).length) s?.setItem(OWNERS, JSON.stringify(o)); else s?.removeItem(OWNERS); } catch {}
  if(!left.length) try { storage()?.removeItem(STORE); } catch {}
  return left.length;
}

/** Όλες οι προσφορές που βλέπει ο συνδεδεμένος, η νεότερη πρώτη. Κάθε μία έχει ημερομηνία: όσες δεν πέρασαν ακόμα
 *  μετάπτωση (π.χ. δεν χώρεσε το αντίγραφο) φαίνονται στη μέρα δημιουργίας τους, όπως θα τις έβαζε η μετάπτωση. */
export function listQuotes(){
  const uid = viewer(), o = uid === undefined ? null : owners();
  const seen = !o ? () => true : q => (q.id && o[q.id] || null) === uid;
  return stored().filter(seen).map(q => has(q, 'scheduled_date') ? q : {...q, ...fromCreated(q)});
}

/** Η προσφορά με αυτό το κλειδί (id ή no). */
export const getQuote = key => listQuotes().find(match(key)) ?? null;

function write(list){
  try { const s = storage(); if(!s) return false; s.setItem(STORE, JSON.stringify(list.slice(0, MAX_QUOTES))); return true; }
  catch { return false; }
}

// Η χρονοσφραγίδα μιας αλλαγής ΔΕΝ ισούται ποτέ με την προηγούμενη της ίδιας προσφοράς: ο συγχρονισμός θεωρεί «ανεβασμένο»
// ό,τι έχει updated <= της εκδοχής που ανέβηκε, άρα μια αλλαγή στο ίδιο χιλιοστό θα χανόταν. Ίση → +1 ms· όλα τα άλλα ως έχουν.
const after = (prev, now) => Number.isFinite(prev) && now === prev ? now + 1 : now;

/** Αποθηκεύει (ή ενημερώνει, αν ξαναφτιάχτηκε το PDF της ίδιας προσφοράς). false αν η συσκευή δεν την κράτησε.
 *  Ίδια προσφορά = ίδιο id· χωρίς id (παλιός κώδικας): ίδιος αριθμός, και κρατά το id που είχε. */
export function saveQuote(q, now = Date.now()){
  const c = clean(q);
  if(!c) return false;
  const list = stored(), same = c.id ? match(c.id) : x => x.no === c.no && !x.id;
  const prev = c.id ? list.find(same) : list.find(x => x.no === c.no);
  c.id ??= prev?.id ?? newId();
  c.updated = after(prev?.updated ?? prev?.at, now);
  const ok = write([c, ...list.filter(x => x.id !== c.id && !(c.id && same(x)) && !(prev && x === prev))].sort((a, b) => b.no - a.no));
  if(ok) claimIds([c.id], viewer());             // νέα προσφορά: ανήκει σε όποιον είναι συνδεδεμένος
  return ok;
}

/** Σβήνει από τη συσκευή· ο λογαριασμός το μαθαίνει στον επόμενο συγχρονισμό (deleted_at). */
export function deleteQuote(key, now = Date.now()){
  const list = stored(), q = list.find(match(key));
  if(!q) return write(list);                    // τίποτα να σβήσει· false μόνο αν η συσκευή δεν γράφει
  if(q.id) addDeleted([{id: q.id, at: after(q.updated ?? q.at, now)}]);
  return write(list.filter(x => x !== q));
}

// ── Σβησμένες, για τον συγχρονισμό ──
export function listDeleted(){
  try {
    const d = JSON.parse(storage()?.getItem(DELETED) || '[]');
    return Array.isArray(d) ? d.filter(x => x && UUID.test(x.id) && Number.isFinite(x.at)) : [];
  } catch { return []; }
}
function writeDeleted(d){ try { const s = storage(); if(!d.length) s?.removeItem(DELETED); else s?.setItem(DELETED, JSON.stringify(d)); } catch {} }
function addDeleted(items){
  const m = new Map(listDeleted().map(x => [x.id, x]));
  for(const x of items) if(!m.has(x.id) || m.get(x.id).at < x.at) m.set(x.id, x);
  writeDeleted([...m.values()].slice(-2000));
}
/** Ο λογαριασμός τα έμαθε: φεύγουν από τη λίστα (μόνο αν δεν ξανασβήστηκαν στο μεταξύ). */
export function clearDeleted(items){
  const done = new Map(items.map(x => [x.id, x.at]));
  writeDeleted(listDeleted().filter(x => !(done.has(x.id) && done.get(x.id) >= x.at)));
}

/**
 * Αλλαγές από τον λογαριασμό: [{id, data, updated (ms), deleted (ms|null)}]. Τα data είναι ΜΗ αξιόπιστα: περνούν από
 * το clean(), και το id της γραμμής είναι αυτό που μετράει. Η νεότερη αλλαγή κερδίζει (ίδια ώρα: μένει η τοπική).
 * Επιστρέφει {applied, ids} (τα id που άλλαξαν στη συσκευή).
 */
export function applyRemote(rows){
  const list = stored(), byId = new Map(list.filter(q => q.id).map(q => [q.id, q]));
  const del = new Map(listDeleted().map(x => [x.id, x.at]));
  const ids = [];
  let changed = false;
  for(const r of rows){
    if(!r || typeof r.id !== 'string' || !UUID.test(r.id) || !Number.isFinite(r.updated)) continue;
    const local = byId.get(r.id), localAt = local ? (local.updated || local.at) : (del.get(r.id) ?? -1);
    if(r.updated <= localAt) continue;
    if(r.deleted){
      if(local){ byId.delete(r.id); changed = true; ids.push(r.id); }
      continue;
    }
    const c = clean({...(r.data && typeof r.data === 'object' ? r.data : {}), id: r.id, updated: r.updated});
    if(!c) continue;
    byId.set(r.id, c); changed = true; ids.push(r.id);
  }
  if(!changed) return {applied: 0, ids, ok: true};
  const ok = write([...byId.values(), ...list.filter(q => !q.id)].sort((a, b) => b.no - a.no));
  return {applied: ids.length, ids, ok};
}

/** Δίνει id (και updated) σε όσες αποθηκευμένες προσφορές δεν έχουν· μία φορά, στο άνοιγμα. Μόνο προσθέτει πεδία. */
export function ensureIds(){
  const s = storage();
  let data;
  try { data = JSON.parse(s?.getItem(STORE) || '[]'); } catch { return 0; }
  if(!Array.isArray(data)) return 0;
  let n = 0;
  const out = data.map(q => {
    // Μόνο έγκυρες προσφορές· ό,τι άλλο (σκουπίδια, μισές εγγραφές) μένει ΑΚΡΙΒΩΣ όπως ήταν, όπως στη μετάπτωση.
    if(!q || typeof q !== 'object' || Array.isArray(q) || (typeof q.id === 'string' && UUID.test(q.id)) || !clean(q)) return q;
    n++;
    return {...q, id: newId(), ...(!(Number.isFinite(q.updated) && q.updated > 0) && Number.isFinite(q.at) && {updated: q.at})};
  });
  if(!n) return 0;
  try { s.setItem(STORE, JSON.stringify(out)); return n; } catch { return 0; }
}

/** Αλλάζει μόνο ημερομηνία, ώρα, διάρκεια ή κατάσταση μιας προσφοράς (από το ημερολόγιο)· τίποτα άλλο.
 *  Μόλις ο τεχνίτης ορίσει ημερομηνία, η «ημ. δημιουργίας» σβήνει. false αν δεν υπάρχει ή δεν αποθηκεύτηκε. */
export function updateQuote(key, patch, now = Date.now()){
  const list = stored(), i = list.findIndex(match(key));
  if(i < 0 || !patch || typeof patch !== 'object') return false;
  const q = has(list[i], 'scheduled_date') ? {...list[i]} : {...list[i], ...fromCreated(list[i])};
  for(const k of SCHEDULE) if(has(patch, k)) q[k] = patch[k];
  if(['scheduled_date', 'scheduled_time', 'duration_days'].some(k => has(patch, k))) delete q.scheduled_from_created;
  q.updated = after(list[i].updated ?? list[i].at, now);
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
