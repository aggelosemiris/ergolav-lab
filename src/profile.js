// Στοιχεία της επιχείρησης του τεχνίτη (μπαίνουν μία φορά) και αριθμός προσφοράς ανά συσκευή.
// Η αποθήκευση δεν σπάει ποτέ την εφαρμογή: ό,τι δεν διαβάζεται σωστά αγνοείται (όπως στο prices.js).

export const PROFILE = 'ergolav.profile';
export const COUNTER = 'ergolav.quoteNo';

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const clean = (v, max = 80) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const digits = s => s.replace(/\D/g, '');

/** Έλεγχος πριν την αποθήκευση· {profile} ή {error, field}. Υποχρεωτικό μόνο το όνομα.
 *  ΑΦΜ δεν ζητείται ούτε κρατιέται (ούτε γράφεται στο PDF): ό,τι υπήρχε από παλιότερη έκδοση πετιέται. */
export function checkProfile(input){
  const p = {name: clean(input?.name), trade: clean(input?.trade), phone: clean(input?.phone, 30)};
  if(!p.name) return {error: 'Γράψε το όνομα της επιχείρησης ή το ονοματεπώνυμό σου.', field: 'name'};
  // Ό,τι γράφεται στο PDF του πελάτη δεν μπαίνει σιωπηλά λάθος.
  if(p.phone && (!/^[+\d\s().-]+$/.test(p.phone) || digits(p.phone).length < 10 || digits(p.phone).length > 15))
    return {error: 'Το τηλέφωνο θέλει 10 ψηφία (π.χ. 6912345678) — ή άφησέ το κενό.', field: 'phone'};
  return {profile: p};
}

/** Τα αποθηκευμένα στοιχεία, ή null (δεν υπάρχουν / χαλασμένα / χωρίς όνομα). */
export function loadProfile(){
  try {
    const raw = storage()?.getItem(PROFILE);
    if(!raw) return null;
    const r = checkProfile(JSON.parse(raw));
    // Παλιά αποθήκευση με ΑΦΜ: ξαναγράφεται χωρίς αυτό, ώστε να μη μένει στη συσκευή.
    if(r.profile && /"afm"/.test(raw)) try { storage().setItem(PROFILE, JSON.stringify(r.profile)); } catch {}
    return r.profile ?? null;
  } catch { return null; }
}

/** Αποθηκεύει· {profile, saved} ή {error, field}. saved=false: δεκτά για αυτή τη χρήση, αλλά η συσκευή δεν τα κράτησε. */
export function saveProfile(input){
  const r = checkProfile(input);
  if(r.error) return r;
  try { storage().setItem(PROFILE, JSON.stringify(r.profile)); return {profile: r.profile, saved: true}; }
  catch { return {profile: r.profile, saved: false}; }
}

/** Αρχικά από τις δύο πρώτες λέξεις («Νίκος Παπαδάκης» → «ΝΠ»)· μία λέξη → τα δύο πρώτα γράμματα. */
export function initials(name){
  const words = clean(name).split(' ').map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const s = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '').slice(0, 2);
  return s.toLocaleUpperCase('el-GR').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Ο τελευταίος αριθμός που δόθηκε (0 αν κανένας ή χαλασμένος). */
export function lastQuoteNo(){
  try {
    const n = Number(storage()?.getItem(COUNTER));
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/** Δίνει τον επόμενο αριθμό προσφοράς (1, 2, 3…) και τον θυμάται. */
export function takeQuoteNo(){
  const n = lastQuoteNo() + 1;
  try { storage()?.setItem(COUNTER, String(n)); } catch { /* μένει μόνο για αυτή την προσφορά */ }
  return n;
}
