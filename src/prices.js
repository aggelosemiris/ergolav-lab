// Τιμές υλικού: τρεις προτάσεις (οικονομική / κανονική / ακριβή) και μνήμη των τιμών που έγραψε ο τεχνίτης.
// Ποσά σε ακέραια λεπτά, χωρίς ΦΠΑ. Καμία εξάρτηση. Η αποθήκευση δεν σπάει ποτέ την εφαρμογή:
// ό,τι δεν διαβάζεται σωστά αγνοείται εντελώς (ποτέ μισή τιμή).

// ΠΡΟΣΩΡΙΝΟΙ συντελεστές επί της τιμής καταλόγου — θα αντικατασταθούν από πραγματικές τιμές αγοράς.
export const FACTORS = {eco: 0.6, premium: 1.9};
export const STALE_DAYS = 180;      // πάνω από τόσες ημέρες: «έλεγξε αν άλλαξε»
export const MAX_PER_KEY = 3;       // έως τρεις τιμές ανά προϊόν
export const STORE = 'ergolav.prices';
const DAY = 86400000;

const round10 = c => Math.max(10, Math.round(c / 10) * 10);   // στρογγυλοποίηση στα 10 λεπτά, ελάχιστο 10

/** Οι τρεις προτάσεις από την τιμή καταλόγου, ή null αν δεν υπάρχει τιμή υλικού (π.χ. μόνο εργασία). */
export function tiers(base){
  if(!(base > 0)) return null;
  return {eco: round10(base * FACTORS.eco), normal: base, premium: round10(base * FACTORS.premium)};
}

/** Κάθε τύπος προϊόντος έχει δική του μνήμη: είδος + κωδικός του τύπου (π.χ. κρεμαστή ≠ δαπέδου). */
export const priceKey = l => `${l.id}|${l.code || l.name}`;

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const valid = e => !!e && Number.isInteger(e.c) && e.c > 0 && e.c < 1e9 && Number.isFinite(e.at) && e.at > 0;

/** Όλη η μνήμη, καθαρισμένη. Παλιό σχήμα ({key: {c, at}}) = λίστα ενός στοιχείου. Άκυρες εγγραφές πέφτουν μία-μία. */
export function loadAll(){
  const out = Object.create(null);                      // «__proto__» κ.λπ. ως κλειδιά δεν πειράζουν κάτι
  try {
    const raw = storage()?.getItem(STORE);
    if(!raw) return out;
    const data = JSON.parse(raw);
    if(!data || typeof data !== 'object' || Array.isArray(data)) return out;
    for(const [key, v] of Object.entries(data)){
      const seen = new Set();
      const list = (Array.isArray(v) ? v : [v]).filter(valid)
        .sort((a, b) => b.at - a.at)
        .filter(e => !seen.has(e.c) && seen.add(e.c))
        .slice(0, MAX_PER_KEY).map(e => ({c: e.c, at: e.at}));
      if(list.length) out[key] = list;
    }
  } catch { /* αγνοείται */ }
  return out;
}

/** Οι τιμές του προϊόντος, η πιο πρόσφατη πρώτη. */
export const history = key => loadAll()[key] ?? [];

/** Θυμάται μια τιμή (λεπτά). Η ίδια τιμή ανανεώνει μόνο την ημερομηνία. Επιστρέφει false αν δεν αποθηκεύτηκε. */
export function remember(key, cents, now = Date.now()){
  if(!Number.isInteger(cents) || cents <= 0 || cents >= 1e9) return false;
  try {
    const s = storage(); if(!s) return false;
    const all = loadAll();
    const list = (all[key] || []).filter(e => e.c !== cents);
    list.unshift({c: cents, at: now});
    all[key] = list.sort((a, b) => b.at - a.at).slice(0, MAX_PER_KEY);
    s.setItem(STORE, JSON.stringify(all));
    return true;
  } catch { return false; }
}

export const ageDays = (at, now = Date.now()) => Math.max(0, Math.floor((now - at) / DAY));
export const isStale = (at, now = Date.now()) => ageDays(at, now) > STALE_DAYS;

/** Σχετική ημερομηνία σε απλά ελληνικά. */
export function ageLabel(at, now = Date.now()){
  const d = ageDays(at, now);
  if(d === 0) return 'σήμερα';
  if(d === 1) return 'χθες';
  if(d < 14) return `πριν από ${d} ημέρες`;
  if(d < 60){ const w = Math.floor(d / 7); return `πριν από ${w} εβδομάδες`; }
  if(d < 365){ const m = Math.floor(d / 30); return `πριν από ${m} μήνες`; }
  const y = Math.floor(d / 365);
  return y === 1 ? 'πριν από 1 χρόνο' : `πριν από ${y} χρόνια`;
}
