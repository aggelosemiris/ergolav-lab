// «Μοιάζει με…» χωρίς AI: για ένα είδος εκτός καταλόγου, το πιο κοντινό υλικό του χάρτη και οι πιο πιθανές γενικές
// κατηγορίες. Ψάχνει στα ονόματα των υλικών, του καταλόγου, στους τύπους και στις εργασίες του tools/catalog
// (CASE_DATA.similar / genericTerms), με κανονικοποίηση τόνων και κεφαλαίων, ρίζες (ενικός/πληθυντικός) και συνώνυμα.

const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
// Λέξεις που δεν λένε τι είναι το είδος.
const STOP = new Set(['και', 'με', 'για', 'σε', 'στο', 'στη', 'στην', 'στον', 'του', 'της', 'των', 'το', 'τα', 'τη', 'την', 'τον', 'τις', 'τουσ',
  'η', 'ο', 'οι', 'απο', 'ενα', 'ενασ', 'μια', 'μιασ', 'νεο', 'νεα', 'νεοσ', 'καινουργιο', 'καινουργια', 'παλιο', 'παλια', 'τοποθετηση', 'αλλαγη',
  'εργασια', 'εργασιεσ', 'ειδοσ', 'τεμ', 'τεμαχιο', 'τεμαχια', 'κομματι', 'κομματια', 'δυο', 'τρια', 'τεσσερα', 'σετ', 'κιτ', 'διαφορα']);
// Συνώνυμα και λέξεις της αγοράς → η λέξη του χάρτη.
const SYN = {wc: 'λεκανη', τουαλετα: 'λεκανη', καμπινεσ: 'λεκανη', βρυσουλα: 'βρυση', βρυσακι: 'βρυση', boiler: 'θερμοσιφωνασ',
  μπογια: 'βαψιμο', βαφη: 'βαψιμο', πλακιδιο: 'πλακακι', πλακιδια: 'πλακακια', ριζοκοιλια: 'σιφωνι', σιφονι: 'σιφωνι', ντουζ: 'ντουσ',
  νιπτηροσ: 'νιπτηρασ', ψευδοταβανο: 'ψευδοροφη', λαμπα: 'φωτιστικο', σποτακι: 'σποτ', πριζακι: 'πριζα', ρευματοδοτησ: 'πριζα',
  ντουλαπακι: 'ντουλαπι', καλοριφερ: 'σωμα καλοριφερ', inverter: 'κλιματιστικο', aircondition: 'κλιματιστικο', κλιμα: 'κλιματιστικο',
  τζακουζι: 'μπανιερα υδρομασαζ', υδρομασαζ: 'μπανιερα υδρομασαζ', φωτακι: 'φωτιστικο', απλικα: 'φωτιστικο', απλικεσ: 'φωτιστικο'};
const ENDINGS = ['ιματα', 'ματα', 'ακια', 'ακι', 'ουλα', 'ιεσ', 'ιων', 'ουσ', 'ων', 'εσ', 'ασ', 'οσ', 'ησ', 'εισ', 'ια', 'ιο', 'ια', 'μα', 'α', 'η', 'ο', 'ι', 'ε', 'υ'];

/** Η ρίζα μιας λέξης (κανονικοποιημένης): κόβεται η μεγαλύτερη κατάληξη που αφήνει τουλάχιστον 3 γράμματα. */
export function stem(w){
  for(const e of ENDINGS) if(w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length);
  return w;
}
/** Οι ρίζες ενός κειμένου, με τη σειρά τους, χωρίς τις λέξεις που δεν λένε τίποτα. */
export function stems(text){
  const words = plain(text).replace(/[^a-z0-9α-ω\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
  return words.flatMap(w => (SYN[w] || w).split(' ')).map(stem).filter(s => s.length >= 3);
}
const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Πόσο ταιριάζει ένα όνομα με μια λίστα όρων (0–1). Η πρώτη λέξη (το «κεφάλι»: σίτες αλουμινίου → σίτες) πρέπει
 * να ταιριάζει, αλλιώς 0· οι υπόλοιπες ανεβάζουν το σκορ.
 */
export function score(name, terms, extra = []){
  const q = stems(name);
  if(!q.length) return 0;
  const words = plain(name).replace(/[^a-z0-9α-ω\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
  // Το κεφάλι του ονόματος ταιριάζει με το κεφάλι ενός όρου («laminate» δεν είναι «πόρτα laminate»).
  if(!terms.some(term => { const h = stems(term)[0]; return h && same(h, q[0]); })) return 0;
  const t = [...terms.flatMap(stems), ...extra.flatMap(stems)];
  const hit = s => t.some(x => same(x, s));
  // Λέξη σε γενική που δεν ταιριάζει («βάση τηλεόρασης») λέει άλλο είδος: όχι ταίριασμα.
  if(words.slice(1).some(w => /(ου|ησ|ασ|ων|εωσ)$/.test(w) && !hit(stem(SYN[w] || w)))) return 0;
  return q.filter(hit).length / q.length;
}

/** Το υλικό του χάρτη που μοιάζει περισσότερο (ή null): {material, score}. */
export function findSimilar(data, name){
  let best = null;
  const head = stems(name)[0];
  for(const s of data.similar || []){
    // Ισοπαλία: κερδίζει το υλικό που το όνομά του ξεκινά όπως το είδος («σιφόνι μπανιέρας» → Σιφόνι, όχι Ντουζιέρα).
    const own = stems(s.t[0] || '')[0];
    const sc = score(name, s.t, s.x || []) + (head && own && same(own, head) ? 0.01 : 0);
    if(sc >= 0.5 && (!best || sc > best.score)) best = {material: s.m, score: sc};
  }
  return best;
}

/** Οι γενικές κατηγορίες με σειρά πιθανότητας· όσες δεν ταιριάζουν καθόλου μένουν στο τέλος με τη σειρά του χάρτη. */
export function rankGeneric(data, name){
  const q = stems(name);
  const terms = Object.fromEntries((data.genericTerms || []).map(g => [g.g, g.t]));
  const scored = (data.genericCategories || []).map((g, n) => {
    const t = (terms[g.id] || []).flatMap(stems), w = (g.words || []).map(plain);
    let s = 0;
    q.forEach((x, i) => { if(t.some(y => same(y, x)) || w.some(y => x.startsWith(y) || same(stem(y), x))) s += i === 0 ? 2 : 1; });
    return {id: g.id, name: g.name, score: s, n};
  });
  return scored.sort((a, b) => b.score - a.score || a.n - b.n);
}
