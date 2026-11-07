// Ιστορικό προσφορών της συσκευής: ό,τι γράφτηκε στο PDF (αριθμός, πελάτης, γραμμές, σύνολα), για να το ξαναδεί
// και να το ξαναστείλει ο τεχνίτης. Η αποθήκευση δεν σπάει ποτέ την εφαρμογή: ό,τι δεν διαβάζεται σωστά αγνοείται
// (όπως στο prices.js). Τα δεδομένα μένουν μόνο σε αυτή τη συσκευή.

export const STORE = 'ergolav.quotes';
export const MAX_QUOTES = 300;      // οι παλαιότερες φεύγουν πρώτες

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const isCents = v => Number.isInteger(v) && v >= 0 && v < 1e11;
const str = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';

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
    profile: {name: str(p.name, 80), trade: str(p.trade, 80), phone: str(p.phone, 30), ...(/^[0-9a-f]{8}$/.test(p.logo) && {logo: p.logo})}};
}

/** Όλες οι προσφορές, η νεότερη πρώτη. */
export function listQuotes(){
  try {
    const raw = storage()?.getItem(STORE);
    const data = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(data)) return [];
    const seen = new Set();
    return data.map(clean).filter(q => q && !seen.has(q.no) && seen.add(q.no)).sort((a, b) => b.no - a.no);
  } catch { return []; }
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
  return write([c, ...listQuotes().filter(x => x.no !== c.no)].sort((a, b) => b.no - a.no));
}

export function deleteQuote(no){
  return write(listQuotes().filter(q => q.no !== no));
}
