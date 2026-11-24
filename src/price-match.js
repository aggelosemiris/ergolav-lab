// Αντιστοίχιση προϊόντων με προϊόντα προμηθευτών ΧΩΡΙΣ AI: μόνο κανόνες, κανονικοποίηση κειμένου και ακριβείς τιμές
// χαρακτηριστικών. Καθαρές συναρτήσεις (χωρίς δίκτυο, χωρίς αποθήκευση): τις χρησιμοποιεί η εβδομαδιαία ενημέρωση
// τιμών (tools/prices/) και ελέγχονται με τεστ (test/price-match.test.js).
//
// Η αρχή: ένα προϊόν του προμηθευτή ταιριάζει ΜΟΝΟ αν
//   1. έχει το ίδιο αναγνωριστικό (EAN/GTIN ή κωδικό μοντέλου), ή
//   2. περιέχει όλες τις ρίζες λέξεων της προδιαγραφής, καμία από τις λέξεις που αποκλείονται, ΚΑΙ κάθε χαρακτηριστικό
//      της προδιαγραφής (διάμετρος, λίτρα, κιλά, διαστάσεις, διατομή, ίντσες, αμπέρ…) υπάρχει στο όνομά του με την ίδια
//      ακριβώς τιμή. Αν λείπει ή διαφέρει → δεν ταιριάζει (σακί 25 kg ≠ σακί 50 kg, θερμοσίφωνας 80 λ. ≠ 100 λ.).
// Η ομοιότητα ονομάτων από μόνη της δεν αρκεί ποτέ. Ό,τι δεν ταιριάζει με βεβαιότητα μένει «χωρίς αντιστοίχιση».
import { norm, phon } from './parse.js';
import { stem } from './similar.js';

export const VERSION = 1;            // αλλάζει όταν αλλάζουν οι κανόνες (μπαίνει στο match_key)
export const VERSION_V2 = 2;         // κανόνες με τις νέες λίστες υλικών (MATERIALS_V2): δικό τους match_key
export const VAT = 0.24;              // ΦΠΑ λιανικής (οι τιμές του καταλόγου είναι χωρίς ΦΠΑ)

// ── κείμενο ──
const STOP = new Set(['και', 'με', 'για', 'σε', 'στο', 'στη', 'στην', 'του', 'της', 'των', 'το', 'τα', 'τη', 'την', 'τον', 'η', 'ο', 'οι',
  'απο', 'ενα', 'μια', 'νεο', 'νεα', 'τυπου', 'σειρα', 'σειρασ', 'χρωμα', 'χρωματοσ', 'new', 'pro', 'the', 'and', 'with', 'of',
  // λέξεις μονάδων: το μέγεθος ελέγχεται ως χαρακτηριστικό, όχι ως λέξη («9000BTU» γράφεται και κολλητά)
  'btu', 'kg', 'κιλα', 'κιλο', 'κιλων', 'lt', 'ltr', 'λιτρα', 'λιτρων', 'ml', 'cm', 'mm', 'εκ', 'τεμ', 'τεμαχια', 'τεμαχιο', 'τμχ',
  'watt', 'kw', 'μετρα', 'μετρο', 'ιντσεσ', 'ιντσα']);

/** Το κείμενο σε κανονική μορφή: πεζά, χωρίς τόνους, ς→σ, «30 χ 60»/«30×60» → 30x60, «2,5» → 2.5, εισαγωγικά ίντσας → ". */
export function clean(text){
  return norm(String(text ?? ''))
    .replace(/[″“”]|''|΄΄/g, '"').replace(/½/g, ' 1/2')
    .replace(/(\d)\s*[x×*χ]\s*(?=\d)/g, '$1x')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ').trim();
}

/** Οι ρίζες των λέξεων (κανονικοποιημένες και φωνητικές), χωρίς αριθμούς και λέξεις που δεν λένε τι είναι το είδος. */
export function stemsOf(text){
  return clean(text).replace(/[^a-z0-9α-ω.\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 2 && !STOP.has(w) && !/\d/.test(w))
    .map(w => phon(stem(w.replace(/\.+$/, '')))).filter(w => w.length >= 2);
}
/** Οι λέξεις ολόκληρες (κανονικοποιημένες, φωνητικές) και οι ρίζες τους: μια ρίζα κανόνα ταιριάζει αν είναι αρχή λέξης. */
export function wordsOf(text){
  const words = clean(text).replace(/[^a-z0-9α-ω.\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !/\d/.test(w)).map(w => phon(w.replace(/\.+$/, '')));
  return [...new Set([...words, ...stemsOf(text)])];
}
/** Οι λέξεις με τη σειρά τους (φωνητικές, ολόκληρες), για τον κανόνα σειράς. */
const wordsInOrder = text => clean(text).replace(/[^a-z0-9α-ω\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !/\d/.test(w)).map(phon);
/** Ρίζα για σύγκριση (ίδια επεξεργασία με τα stemsOf). */
export const root = w => phon(stem(clean(w)));
const hasRoot = (words, r) => words.some(words.near ? s => words.near(s, r) : s => s === r || (r.length >= 3 && s.startsWith(r)));

// ── χαρακτηριστικά ──
// Στη JavaScript τα \b και \w δεν ξέρουν ελληνικά: όριο λέξης και γράμματα λέξης γράφονται ρητά.
const E = '(?![α-ωa-z0-9])', W = '[α-ωa-z]*';
const N = '(?<![\\d.,])\\b';        // ακέραιο μέγεθος, όχι μέσα σε δεκαδικό («1.50cm» δεν είναι 50 εκ.)
const SECTIONS = new Set(['0.75', '1', '1.5', '2.5', '4', '6', '10', '16', '25', '35']);
const num = s => String(Number(s));

/**
 * Τα μετρήσιμα χαρακτηριστικά ενός ονόματος: {διάσταση: [τιμές]}. Κάθε κανόνας είναι μια σταθερή κανονική έκφραση.
 *   sec: διατομή καλωδίου «3x1.5» · size: διαστάσεις σε εκ. «30x60» (με τη σειρά που γράφτηκαν) · diam: διάμετρος (Φ16, 16x2mm)
 *   inch: «3/4» · l: λίτρα · kg: κιλά · cm: μήκος/πλάτος σε εκ. · out: έξοδοι/κυκλώματα · pos: θέσεις πίνακα
 *   a: αμπέρ · ma: mA · poles: πόλοι (1P, 3P+N) · trough: γούρνες · btu · ml · w: watt · kw
 */
export function attributes(text, v2 = false){ return parseAttributes(text, v2).attrs; }
/** Το κείμενο χωρίς τα μετρήσιμα χαρακτηριστικά («Κόλλα πλακιδίων 25 κιλά» → «κόλλα πλακιδίων»): οι λέξεις μονάδων
 *  δεν είναι λέξεις του είδους — το μέγεθος ελέγχεται ως χαρακτηριστικό. */
export const withoutAttributes = (text, v2 = false) => parseAttributes(text, v2).rest;
const POLES_WORD = {μονοπολικ: '1', διπολικ: '2', τριπολικ: '3', τετραπολικ: '4'};
function parseAttributes(text, v2 = false){
  let t = clean(text);
  const out = {};
  const add = (k, v) => { (out[k] ??= []).includes(v) || out[k].push(v); };
  if(v2){
    // MATERIALS_V2 — μόνο ρητές γραφές που οι προμηθευτές χρησιμοποιούν:
    //  διάμετρος και μήκος σωλήνα: «Φ.110X200cm» = Φ110, μήκος 2 μ. (το μήκος το διαβάζει το packLength)
    t = t.replace(/(?:φ|ø)\.?\s?(\d{2,3})x(?=\d{2,4}\s?(?:cm|εκ)(?![α-ωa-z0-9]))/g, (m, d) => (add('diam', num(d)), ' '));
    //  διάμετρος με πάχος τοιχώματος: «Φ25 x 4,2», «Φ.16x2» (σωλήνες/εξαρτήματα)
    t = t.replace(/(?:φ|ø)\.?\s?(\d{2,3})x\d{1,2}(?:\.\d)?(?:\s?mm)?(?![\dx])/g, (m, d) => (add('diam', num(d)), ' '));
    //  «Ρελέ διαρροής 2x40A» = 2 πόλοι, 40 A (πριν από τη διατομή: «3x16A» δεν είναι καλώδιο 3x16)
    t = t.replace(new RegExp(`\\b([1-4])x(\\d{1,3})\\s?a${E}`, 'g'), (m, p, a) => (add('poles', p), add('a', num(a)), ' '));
    //  «Διπολικό», «Τετραπολικό»
    t = t.replace(new RegExp(`(?<![α-ωa-z])(μονοπολικ|διπολικ|τριπολικ|τετραπολικ)${W}`, 'g'), (m, w) => (add('poles', POLES_WORD[w]), ' '));
    //  μικροαυτόματος «C16», «B10» (καμπύλη + αμπέρ) — ΜΟΝΟ αν το όνομα λέει ότι είναι μικροαυτόματος/MCB
    if(/\bmcb\b|μικροαυτοματ/.test(t)) t = t.replace(new RegExp(`\\b[bcd](\\d{1,2})${E}`, 'g'), (m, a) => (add('a', num(a)), ' '));
    //  διαστάσεις με κολλητή μονάδα: «170x70cm», «60x120cm», «80x80x5.5cm» (το απλό \b δεν πιάνει «70cm»)
    t = t.replace(new RegExp(`\\b(\\d{2,3})x(\\d{2,3})(?:x\\d{1,3}(?:\\.\\d+)?)?\\s?(?:cm|εκ)${E}`, 'g'),
      (m, a, b) => Number(a) >= 15 && Number(b) >= 15 ? (add('size', `${num(a)}x${num(b)}`), ' ') : m);
    //  «4 Παροχών» = 4 έξοδοι (συλλέκτες)
    t = t.replace(new RegExp(`${N}(\\d{1,2})\\s?παροχ${W}`, 'g'), (m, v) => (add('out', num(v)), ' '));
  }
  t = t.replace(new RegExp(`\\b([2-5])x(\\d+(?:\\.\\d+)?)(?:\\s?(?:mm2|mm²|τετ${W}))?(?![\\dx.])`, 'g'), (m, a, b) => SECTIONS.has(num(b)) ? (add('sec', `${a}x${num(b)}`), ' ') : m);
  t = t.replace(/(?:φ|ø|Ø)\.?\s?(\d{2,3})(?:\s?mm)?\b/g, (m, d) => (add('diam', num(d)), ' '));   // Φ16, Φ 16, Φ.16mm
  t = t.replace(/\b(\d{2})x(\d(?:\.\d)?)\s?mm\b/g, (m, d) => (add('diam', num(d)), ' '));
  t = t.replace(/\b(\d{2,3})x(\d{2,3})(?:x(\d{1,3}))?\b/g, (m, a, b) => Number(a) >= 15 && Number(b) >= 15 ? (add('size', `${num(a)}x${num(b)}`), ' ') : m);
  t = t.replace(new RegExp(`\\b(\\d\\s1\\/2|\\d\\/\\d|\\d)\\s?(?:"|ιντσ${W}|inch)`, 'g'), (m, v) => (add('inch', v.replace(/\s+/g, ' ')), ' '));
  t = t.replace(new RegExp(`\\b1 1\\/2\\s?γουρν${W}`, 'g'), () => (add('trough', '1.5'), ' '));
  t = t.replace(new RegExp(`\\b(\\d{1,2})\\s?γουρν${W}`, 'g'), (m, v) => (add('trough', num(v)), ' '));
  for(const [k, re] of [
    ['btu', `${N}(\\d{1,2}\\.\\d{3}|\\d{4,5})\\s?btu${E}`],
    ['ml', `${N}(\\d{2,4})\\s?ml${E}`],
    ...(v2 ? [['w', `${N}(\\d{2,4})\\s?wp${E}`], ['ka', `\\b(\\d{1,2}(?:\\.\\d)?)\\s?ka${E}`]] : []),
    ['kw', `\\b(\\d+(?:\\.\\d+)?)\\s?kw${E}`],
    ['w', `${N}(\\d{1,4})\\s?(?:w|watt)${E}`],
    ['l', `${N}(\\d{1,3})\\s?(?:lt|ltr|l|λιτρ${W}|λ)${E}`],
    ['kg', `\\b(\\d+(?:\\.\\d+)?)\\s?(?:kg|κιλ${W}|κγρ)${E}`],
    ['poles', `\\b([1-4])\\s?p(?:\\+n)?${E}`],
    ['ma', `${N}(\\d{2,3})\\s?ma${E}`],
    ['a', `${N}(\\d{1,3})\\s?a${E}`],
    ['out', `${N}(\\d{1,2})\\s?(?:εξοδ${W}|οδων|κυκλωμ${W})${E}`],
    ['pos', `${N}(\\d{1,3})\\s?(?:θεσ${W}|στοιχει${W}|modules?)${E}`],
    ['cm', `${N}(\\d{2,3})\\s?(?:εκ|cm)${E}`],
  ]) t = t.replace(new RegExp(re, 'g'), (m, v) => (add(k, num(k === 'btu' ? v.replace('.', '') : v)), ' '));
  return {attrs: out, rest: t};
}

/** Μήκος συσκευασίας σε μέτρα («κουλούρα 100m», «ρολό 50 μέτρα»). null αν δεν γράφεται με βεβαιότητα.
 *  v2: και μήκος σωλήνα σε εκ. («Φ110x300cm», «-200cm»), ΜΟΝΟ αν δεν υπάρχει μήκος σε μέτρα και είναι ένα και ≥ 50 εκ. */
export function packLength(text, v2 = false){
  const c = clean(text);
  const m = c.match(new RegExp(`\\b(\\d{1,3}(?:\\.\\d+)?)\\s?(?:m|μ|μετρ${W})${E}`, 'g'));
  if(m && m.length !== 1) return null;                  // δύο διαφορετικά μήκη → αμφίσημο
  if(m){ const v = Number(m[0].match(/[\d.]+/)[0]); return v > 0 ? v : null; }
  if(!v2) return null;
  // «-200cm», « 250cm», «Φ.110x200cm» — όχι «170x70cm» (διάσταση)
  const cm = [...c.matchAll(new RegExp(`(?:^|[\\s\\-]|(?<=[φø]\\.?\\s?\\d{2,3})x)(\\d{2,4})\\s?(?:cm|εκ)${E}`, 'g'))].map(x => Number(x[1]));
  return cm.length === 1 && cm[0] >= 50 ? cm[0] / 100 : null;
}
/** «τιμή ανά μέτρο», «/μ», «/m»: ο προμηθευτής γράφει ότι η τιμή είναι ανά μέτρο. */
const PER_METER = /(?:ανα|τιμη ανα|price per)\s?(?:μετρο|m)(?![α-ωa-z])|\/\s?(?:μ|m|μετρο)(?![α-ωa-z0-9])/;

/** Πόσα τεμάχια έχει η συσκευασία («σετ 10 τεμ.», «συσκευασία 2 τεμαχίων»). 1 αν δεν λέει τίποτα· null αν είναι αμφίσημο. */
export function packCount(text){
  const t = clean(text);
  const m = [...t.matchAll(new RegExp(`\\b(\\d{1,3})\\s?(?:τεμ${W}|τμχ|pcs)${E}`, 'g'))].map(x => Number(x[1]));
  if(!m.length) return 1;
  return new Set(m).size === 1 && m[0] > 0 ? m[0] : null;
}

// ── αναγνωριστικά ──
/** Έγκυρο GTIN-8/12/13/14 (ψηφίο ελέγχου). Τα «2…» (κωδικοί καταστήματος) δεν είναι διεθνή. */
export function gtin(v){
  const s = String(v ?? '').replace(/\D/g, '');
  if(![8, 12, 13, 14].includes(s.length) || /^0+$/.test(s) || (s.length === 13 && s[0] === '2')) return null;
  const d = [...s].map(Number), check = d.pop();
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === check ? s.padStart(14, '0') : null;
}
/** Κωδικός μοντέλου σε κανονική μορφή (κεφαλαία, χωρίς κενά/τελείες/παύλες): μόνο αν έχει και γράμματα και ψηφία, ή ≥ 6 ψηφία με διαχωριστικά. */
export function modelCode(v){
  const raw = String(v ?? '').trim();
  const s = raw.toUpperCase().replace(/[\s.\-_/]/g, '');
  if(s.length < 4 || s.length > 24 || !/^[A-Z0-9]+$/.test(s)) return null;
  if(/[A-Z]/.test(s) && /\d/.test(s)) return s;
  if(/^\d+$/.test(s) && s.length >= 6 && /[.\-]/.test(raw)) return s;
  return null;
}
/** Οι κωδικοί μοντέλων που γράφονται μέσα σε ένα όνομα (π.χ. «GRASHER WT2044», «Geberit 111.300.00.5»). */
export function codesIn(text){
  return [...new Set(String(text ?? '').split(/[\s,()]+/).map(modelCode).filter(Boolean))];
}

// ── προδιαγραφή ──
/**
 * Η προδιαγραφή ενός προϊόντος: {unit, all, none, attrs, gtin, mpn, brand, key}.
 * product: {name, unit, brand?, mpn?, gtin?, said?, strict?} και προαιρετικά rule: {all, none, attrs, unit} (κανόνες του
 * καταλόγου, src/price-rules.js) που αντικαθιστούν όσα βγαίνουν αυτόματα από το όνομα.
 *   said: η φράση όπως ειπώθηκε («δύο κλιματιστικά 12000 btu»): τα χαρακτηριστικά της μετρούν, γιατί το όνομα της γραμμής
 *         μπορεί να έχει χάσει τον αριθμό («Κλιματιστικά btu»).
 *   order (κανόνας): ρίζες που πρέπει να εμφανίζονται ΠΡΙΝ από τις υπόλοιπες της προδιαγραφής (η λέξη που λέει τι είναι
 *         το είδος: «Μηχανισμός για καζανάκι» ναι, «Καζανάκι με μηχανισμό» όχι). Στα προϊόντα χρηστών: η πρώτη τους λέξη.
 *   strict: (προϊόντα χρηστών) αν η προδιαγραφή δεν έχει ΚΑΝΕΝΑ μέγεθος, προϊόν προμηθευτή με μέγεθος (π.χ. 280 ml)
 *         δεν ταιριάζει — αλλιώς θα ανακατεύονταν διαφορετικά μεγέθη στον ίδιο μέσο όρο.
 */
export function specFor(product, rule = {}){
  const name = String(product.name ?? ''), v2 = !!rule.v2;
  const all = rule.all ? rule.all.map(root) : [...new Set(stemsOf(withoutAttributes(name, v2)))];
  const single = text => Object.fromEntries(Object.entries(attributes(text, v2)).filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
  const attrs = rule.attrs ?? {...single(product.said ?? ''), ...single(name)};
  const spec = {
    unit: unitOf(rule.unit ?? product.unit),
    all, any: (rule.any || []).map(root), order: (rule.order || (product.strict && all.length > 1 ? [all[0]] : [])).map(r => rule.order ? root(r) : r), none: [...new Set([...(rule.none || []), ...ACCESSORY].map(root))].filter(r => !all.includes(r)),
    attrs, gtin: gtin(product.gtin), mpn: modelCode(product.mpn) || null,
    brand: product.brand ? root(product.brand) : null,
    strict: !!product.strict,
  };
  if(v2){
    // Συνώνυμα (νέες λίστες): μια ρίζα του «all» καλύπτεται και από ΟΛΕΣ τις ρίζες μιας εναλλακτικής φράσης
    // (π.χ. «πολυστρωματικ» ή «pex»+«al» από το «PEX-AL-PEX»). Τα χαρακτηριστικά και τα «none» ισχύουν πάντα.
    spec.v2 = true;
    spec.first = (rule.first || []).map(root);
    spec.alt = Object.fromEntries(Object.entries(rule.alt || {}).map(([r, phrases]) => [root(r), phrases.map(p => [...new Set(stemsOf(p))]).filter(p => p.length)]));
  }
  spec.key = matchKey(spec);
  return spec;
}
/** Λέξεις εξαρτημάτων/ανταλλακτικών: ένα «κάλυμμα λεκάνης» δεν είναι λεκάνη. Δεν ισχύουν αν είναι μέρος της προδιαγραφής. */
export const ACCESSORY = ['ανταλλακτικ', 'εξαρτημ', 'καπακ', 'καλυμμ', 'βιδ', 'στηριγμ', 'στηριξ', 'ροζετ', 'φλαντζ', 'λαστιχ',
  'τσιμουχ', 'αυτοκολλ', 'κλειδ', 'εργαλει', 'κοφτ', 'καλιμπρ', 'επισκευ', 'εκθεσιακ', 'μεταχειρ', 'δειγμα', 'ρουξουν', 'προεκτασ',
  'ανταπτορ', 'στερεωσ'];

/** Μονάδα σε σταθερή μορφή: piece · m · m2 · bag · other. */
export function unitOf(u){
  const s = clean(u).replace(/\.$/, '');
  if(/^(τεμ|τεμαχιο|τεμαχια|τμχ|piece|pcs|τεμ\.)$/.test(s)) return 'piece';
  if(/^(μ|m|μετρο|μετρα|μετρου|τρεχον μετρο)$/.test(s)) return 'm';
  if(/^(τ\.?μ|m2|m²|τετραγωνικο μετρο|τετρ\.? μετρο)$/.test(s)) return 'm2';
  if(/^(σακι|σακια|bag)$/.test(s)) return 'bag';
  return s ? 'other' : 'piece';
}
/** Σταθερό κλειδί: ίδια προδιαγραφή = ίδια αναζήτηση για όλους τους χρήστες (μία φορά, όχι ανά χρήστη). */
export function matchKey(spec){
  const a = Object.keys(spec.attrs).sort().map(k => `${k}=${spec.attrs[k]}`).join(',');
  const alt = spec.v2 ? Object.keys(spec.alt || {}).sort().map(r => `${r}=${spec.alt[r].map(p => p.join('+')).join('/')}`).join(',') + (spec.first?.length ? '^' + spec.first.join('|') : '') : '';
  return [`v${spec.v2 ? VERSION_V2 : VERSION}${spec.strict ? 's' : ''}`, spec.unit, [...spec.all].sort().join('+') + (spec.order?.length ? '>' + spec.order.join('>') : ''), (spec.any || []).slice().sort().join('|'), a, spec.gtin || '', spec.mpn || '', spec.brand || '', ...(alt ? [alt] : [])].join(';');
}
/** Αρκετά συγκεκριμένη προδιαγραφή για αναζήτηση; (μία λέξη χωρίς χαρακτηριστικό ή αναγνωριστικό = πολύ γενικό). */
export const specific = spec => !!(spec.gtin || spec.mpn) || spec.all.length >= 2 || (spec.all.length >= 1 && Object.keys(spec.attrs).length >= 1);

// ── αντιστοίχιση ──
/**
 * Ταιριάζει ένα προϊόν προμηθευτή με την προδιαγραφή; item: {name, sku?, gtin?, brand?}
 * Επιστρέφει {ok: true, method: 'gtin'|'mpn'|'spec'} ή {ok: false, reason}.
 */
export function matchItem(spec, item){
  const name = String(item.name ?? '');
  const itemGtin = gtin(item.gtin) || gtin(item.sku);
  if(spec.gtin) return itemGtin === spec.gtin ? {ok: true, method: 'gtin'} : {ok: false, reason: itemGtin ? 'gtin-differs' : 'no-gtin'};
  if(spec.mpn){
    const codes = new Set([...codesIn(name), modelCode(item.sku)].filter(Boolean));
    if(!codes.has(spec.mpn)) return {ok: false, reason: 'mpn-differs'};
    if(spec.brand && !hasRoot(wordsOf(`${item.brand ?? ''} ${name}`), spec.brand)) return {ok: false, reason: 'brand-differs'};
    return {ok: true, method: 'mpn'};
  }
  let stems = wordsOf(`${name} ${item.brand ?? ''}`);
  if(spec.materials){
    // Λίστες υλικών (αυστηρότερα): (α) μόνο οι λέξεις ΠΡΙΝ από το «για/for» λένε τι είναι το προϊόν («Γωνία … για σωλήνα»
    // δεν είναι σωλήνας)· (β) η ρίζα ταιριάζει με λέξη, όχι με αρχή σύνθετης λέξης («τσιμέντο» ≠ «τσιμεντοκονίαμα»).
    // (γ) ό,τι ακολουθεί το «με/with» είναι συστατικό («Μπαλαντέζα με καλώδιο» ≠ καλώδιο): οι λέξεις του ΕΙΔΟΥΣ μετρούν
    // μόνο πριν από αυτό· οι λέξεις και τα μεγέθη της παραλλαγής ελέγχονται σε όλο το όνομα.
    const head = clean(name).split(/(?<![α-ωa-z])(?:για|for|με|with)(?![α-ωa-z])/)[0];
    const near = (s, r) => s === r || (r.length >= 3 && s.startsWith(r) && s.length - r.length <= 3);
    stems = Object.assign(wordsOf(`${head} ${item.brand ?? ''}`), {near});
    var fullStems = Object.assign(wordsOf(name), {near});
  }
  const viaAlt = new Set();
  // v2 (λίστες υλικών): ολόκληρο το όνομα του είδους ΜΠΟΡΕΙ να αντικατασταθεί από ένα συνώνυμο της λίστας (allAlt: όλες
  // οι λέξεις του συνωνύμου), και οι λέξεις της παραλλαγής που δεν είναι μέγεθος (must) πρέπει να υπάρχουν πάντα.
  const viaSet = spec.allAlt?.length && !spec.all.every(r => hasRoot(stems, r)) && spec.allAlt.some(p => p.every(x => hasRoot(stems, x)));
  if(!viaSet) for(const r of spec.all) if(!hasRoot(stems, r)){
    if(spec.alt?.[r]?.some(p => p.every(x => hasRoot(stems, x)))){ viaAlt.add(r); continue; }
    return {ok: false, reason: `missing:${r}`};
  }
  if(viaSet) for(const r of spec.order || []) viaAlt.add(r);
  if(spec.materials){
    // (δ) η λέξη του είδους είναι μία από τις 3 πρώτες ελληνικές λέξεις («Ηλεκτρικός Θερμοσίφωνας», «Gloria ΝΤΟΥΖΙΕΡΑ»).
    // Αργότερα (συνήθως σε γενική: «Σωλήνας αλουμινίου κουρτίνας ντουζιέρας») περιγράφει, δεν είναι το προϊόν.
    const greek = clean(name).match(/[α-ω]{2,}/g) || [];
    const roots = viaSet ? spec.allAlt.find(p => p.every(x => hasRoot(stems, x))) : spec.all;
    const early = Object.assign(greek.slice(0, 3).map(w => phon(w)).flatMap(w => [w, ...stemsOf(w)]), {near: stems.near});
    if(greek.length && roots.some(r => /[α-ω]/.test(r)) && !roots.some(r => hasRoot(early, r))) return {ok: false, reason: 'head-not-early'};
  }
  for(const r of spec.must || []) if(!hasRoot(fullStems ?? stems, r)) return {ok: false, reason: `missing-variant:${r}`};
  if(spec.nums?.length){ const c = clean(name); for(const n of spec.nums) if(!new RegExp(`(?<![\\d.a-zα-ω])${n.replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(c)) return {ok: false, reason: `missing-number:${n}`}; }
  if(spec.any?.length && !spec.any.some(r => hasRoot(stems, r))) return {ok: false, reason: 'missing-any'};
  for(const r of spec.none) if(hasRoot(stems, r)) return {ok: false, reason: `excluded:${r}`};
  if(spec.order?.length && !spec.order.some(r => viaAlt.has(r))){
    const seq = wordsInOrder(`${name}`), pos = r => seq.findIndex(w => w === r || (r.length >= 3 && w.startsWith(r)));
    const first = Math.max(...spec.order.map(pos)), others = spec.all.filter(r => !spec.order.includes(r)).map(pos).filter(i => i >= 0);
    if(spec.order.some(r => pos(r) < 0) || others.some(i => i < first)) return {ok: false, reason: 'head-not-first'};
  }
  if(spec.first?.length){
    const w0 = wordsInOrder(name)[0] || '';
    if(!spec.first.some(r => w0 === r || (r.length >= 3 && w0.startsWith(r)))) return {ok: false, reason: 'head-not-first'};
  }
  if(spec.brand && !hasRoot(stems, spec.brand)) return {ok: false, reason: 'brand-differs'};
  const at = attributes(name, spec.v2);
  for(const [k, v] of Object.entries(spec.attrs)){
    const have = at[k] || (k === 'cm' && at.size ? at.size.map(s => s.split('x')[0]) : null);
    if(!have) return {ok: false, reason: `no-${k}`};
    const same = k === 'size' ? (a, b) => sortSize(a) === sortSize(b) : (a, b) => a === b;
    if(have.length !== 1 || !same(have[0], v)) return {ok: false, reason: `${k}-differs`};
  }
  // Αυστηρά (προϊόν χρήστη ΧΩΡΙΣ κανένα μέγεθος): προϊόν προμηθευτή με μέγεθος δεν ταιριάζει — αλλιώς θα ανακατεύονταν
  // διαφορετικά μεγέθη (280 ml με 300 ml). Αν ο χρήστης έδωσε μέγεθος, αυτό ελέγχθηκε ήδη ακριβώς.
  if(spec.strict && !Object.keys(spec.attrs).length && Object.keys(at).length) return {ok: false, reason: `extra-${Object.keys(at)[0]}`};
  return {ok: true, method: 'spec'};
}

const sortSize = s => s.split('x').map(Number).sort((a, b) => a - b).join('x');   // 80x120 = 120x80

// ── τιμή ανά μονάδα ──
/**
 * Η τιμή του προϊόντος του προμηθευτή στη μονάδα της προδιαγραφής, χωρίς ΦΠΑ, σε λεπτά.
 * offer: {name, regularCents, vatIncluded, unit?, unitPriceCents?, unitPriceUnit?}
 *   unit: η μονάδα πώλησης που δηλώνει ο προμηθευτής (π.χ. Praktiker «Μέτρο»)·
 *   unitPriceCents/unitPriceUnit: τιμή ανά άλλη μονάδα που δίνει ρητά ο προμηθευτής (π.χ. ανά τ.μ. στα πλακάκια).
 * Επιστρέφει {cents, basis} ή {error}. Ποτέ μαντεψιά: αν η μονάδα δεν βγαίνει με βεβαιότητα → error.
 */
export function unitPrice(spec, offer){
  const exVat = c => offer.vatIncluded ? Math.round(c / (1 + VAT)) : c;
  if(!(offer.regularCents > 0)) return {error: 'no-regular-price'};
  const sold = offer.unit ? unitOf(offer.unit) : null;
  if(offer.unitPriceCents > 0 && unitOf(offer.unitPriceUnit) === spec.unit) return {cents: exVat(offer.unitPriceCents), basis: 'supplier-unit-price'};
  if(sold && sold === spec.unit && sold !== 'other') return {cents: exVat(offer.regularCents), basis: 'sold-per-unit'};
  if(spec.unit === 'piece'){
    if(sold && sold !== 'piece') return {error: 'unit-mismatch'};
    const n = packCount(offer.name);
    if(n == null) return {error: 'pack-ambiguous'};
    return {cents: exVat(Math.round(offer.regularCents / n)), basis: n === 1 ? 'piece' : `pack-of-${n}`};
  }
  if(spec.unit === 'm'){
    if(PER_METER.test(clean(offer.name))) return {cents: exVat(offer.regularCents), basis: 'priced-per-m'};
    const len = packLength(offer.name, spec.v2);
    if(!len) return {error: 'pack-length-unknown'};
    return {cents: exVat(Math.round(offer.regularCents / len)), basis: `pack-${len}m`};
  }
  if(spec.unit === 'bag'){
    if(!spec.attrs.kg) return {error: 'bag-without-weight'};
    return sold && sold !== 'piece' && sold !== 'bag' ? {error: 'unit-mismatch'} : {cents: exVat(offer.regularCents), basis: 'bag'};
  }
  return {error: 'unit-mismatch'};
}

// ── τιμή αναφοράς ──
export function median(values){
  const v = values.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if(!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}
export const MIN_SUPPLIERS_SPEC = 2;   // προδιαγραφή: τουλάχιστον 2 προμηθευτές για επαληθευμένη τιμή αναφοράς

/**
 * Από τις επαληθευμένες τιμές (ανά μονάδα, χωρίς ΦΠΑ) → τιμή αναφοράς.
 * offers: [{supplier, cents, method}] μόνο έγκυρες. Κάθε προμηθευτής μετρά μία φορά (διάμεσος των δικών του).
 * Επιστρέφει {status: 'verified'|'insufficient'|'none', cents, suppliers: {id: cents}, n}.
 * - Ίδιο αναγνωριστικό (gtin/mpn): ένας προμηθευτής αρκεί (είναι το ίδιο ακριβώς προϊόν).
 * - Προδιαγραφή: χρειάζονται MIN_SUPPLIERS_SPEC προμηθευτές.
 * Ποτέ 0 για τιμή που λείπει.
 */
export function reference(offers){
  const by = {};
  for(const o of offers) if(o.cents > 0) (by[o.supplier] ??= []).push(o);
  const suppliers = Object.fromEntries(Object.entries(by).map(([s, list]) => [s, median(list.map(o => o.cents))]));
  const n = Object.keys(suppliers).length;
  if(!n) return {status: 'none', cents: null, suppliers, n: 0};
  const exact = offers.some(o => o.method === 'gtin' || o.method === 'mpn');
  const cents = median(Object.values(suppliers));
  return {status: exact || n >= MIN_SUPPLIERS_SPEC ? 'verified' : 'insufficient', cents, suppliers, n};
}
