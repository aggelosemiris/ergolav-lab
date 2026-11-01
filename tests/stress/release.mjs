// Stress test πριν από διάθεση σε πελάτες: parser, αριθμοί, στοιχεία επιχείρησης, μνήμη τιμών.
// Χωρίς dependencies, χωρίς δίκτυο. Εκτέλεση: node tests/stress/release.mjs [--n 5000] [--seed 1]
// Αρχές που ελέγχονται: «ποτέ σιωπηλά λάθος τιμή», «ποτέ σιωπηλά χαμένο υλικό», «ποτέ προσωπικά στοιχεία ως προϊόν».
import { parse } from '../../src/parse.js';
import { parseAmount, formatEur } from '../../src/number.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const N = arg('--n', 5000), SEED = arg('--seed', 1);

// ── Επαναλήψιμη τυχαιότητα ──
let s = SEED >>> 0 || 1;
const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── Αριθμοί σε λέξεις (1–999), όπως τους λέει ο μάστορας ──
const U = ['', 'ένα', 'δύο', 'τρία', 'τέσσερα', 'πέντε', 'έξι', 'επτά', 'οκτώ', 'εννέα'];
const T = ['δέκα', 'έντεκα', 'δώδεκα', 'δεκατρία', 'δεκατέσσερα', 'δεκαπέντε', 'δεκαέξι', 'δεκαεπτά', 'δεκαοκτώ', 'δεκαεννέα'];
const D = ['', '', 'είκοσι', 'τριάντα', 'σαράντα', 'πενήντα', 'εξήντα', 'εβδομήντα', 'ογδόντα', 'ενενήντα'];
const H = ['', 'εκατόν', 'διακόσια', 'τριακόσια', 'τετρακόσια', 'πεντακόσια', 'εξακόσια', 'επτακόσια', 'οκτακόσια', 'εννιακόσια'];
function words(n){
  if(n === 100) return 'εκατό';
  const h = Math.floor(n / 100), r = n % 100, out = [];
  if(h) out.push(H[h]);
  if(r >= 10 && r < 20) out.push(T[r - 10]);
  else { if(r >= 20) out.push(D[Math.floor(r / 10)]); if(r % 10) out.push(U[r % 10]); }
  return out.join(' ');
}

// ── Υλικά: [id, μονάδα, ενικός, πληθυντικός, μορφή «υλικό ποσότητα»] ──
// Μετρούμενα: «12 μέτρα σωλήνα». Τεμάχια: «3 λεκάνες». Εργασίες κατ.: χωρίς αριθμό.
const MEAS = {'μ.': ['μέτρα', 'μ.', 'μέτρα'], 'τ.μ.': ['τετραγωνικά', 'τ.μ.', 'τετραγωνικά'], 'σακί': ['σακιά'], 'κάδος': ['κάδους']};
const LIM = {'τεμ.': 20, 'μ.': 250, 'τ.μ.': 150, 'σακί': 40, 'κάδος': 8};
const ITEMS = [
  ['pipe', 'μ.', 'σωλήνα', 'σωλήνα', 'σωλήνας'], ['cable', 'μ.', 'καλώδιο', 'καλώδιο', 'καλώδιο'],
  ['tile', 'τ.μ.', 'πλακάκι', 'πλακάκι', 'πλακάκι'], ['waterproof', 'τ.μ.', 'στεγάνωση', 'στεγάνωση', 'στεγάνωση'],
  ['screed', 'τ.μ.', 'εξομάλυνση', 'εξομάλυνση', 'εξομάλυνση'], ['plaster', 'τ.μ.', 'σοβάς', 'σοβάς', 'σοβάς'],
  ['drywall', 'τ.μ.', 'ψευδοροφή', 'ψευδοροφή', 'ψευδοροφή'], ['paint', 'τ.μ.', 'βάψιμο', 'βάψιμο', 'βάψιμο'],
  ['glue', 'σακί', 'κόλλα', 'κόλλα', 'κόλλα'], ['grout', 'σακί', 'αρμόστοκο', 'αρμόστοκο', 'αρμόστοκος'],
  ['debris', 'κάδος', 'μπάζα', 'μπάζα', 'μπάζα'],
  ['valve', 'τεμ.', 'διακόπτη', 'διακόπτες'], ['mixer', 'τεμ.', 'μπαταρία νιπτήρα', 'μπαταρίες νιπτήρα'],
  ['tap', 'τεμ.', 'βρύση', 'βρύσες'], ['wc', 'τεμ.', 'λεκάνη', 'λεκάνες'], ['tank', 'τεμ.', 'καζανάκι', 'καζανάκια'],
  ['basin', 'τεμ.', 'νιπτήρα', 'νιπτήρες'], ['vanity', 'τεμ.', 'έπιπλο μπάνιου', 'έπιπλα μπάνιου'],
  ['showerset', 'τεμ.', 'σετ ντους', 'σετ ντους'], ['shower', 'τεμ.', 'ντουζιέρα', 'ντουζιέρες'],
  ['cabin', 'τεμ.', 'καμπίνα', 'καμπίνες'], ['bathtub', 'τεμ.', 'μπανιέρα', 'μπανιέρες'], ['sink', 'τεμ.', 'νεροχύτη', 'νεροχύτες'],
  ['heater', 'τεμ.', 'θερμοσίφωνα', 'θερμοσίφωνες'], ['siphon', 'τεμ.', 'σιφόνι', 'σιφόνια'], ['hose', 'τεμ.', 'σπιράλ', 'σπιράλ'],
  ['float', 'τεμ.', 'φλοτέρ', 'φλοτέρ'], ['flush', 'τεμ.', 'μηχανισμό καζανακιού', 'μηχανισμούς καζανακιού'],
  ['ballvalve', 'τεμ.', 'βάνα', 'βάνες'], ['elbow', 'τεμ.', 'γωνία', 'γωνίες'], ['coupling', 'τεμ.', 'ρακόρ', 'ρακόρ'],
  ['tee', 'τεμ.', 'ταυ', 'ταυ'], ['manifold', 'τεμ.', 'συλλέκτη', 'συλλέκτες'], ['door', 'τεμ.', 'πόρτα', 'πόρτες'],
  ['socket', 'τεμ.', 'πρίζα', 'πρίζες'], ['light', 'τεμ.', 'σποτ', 'σποτ'],
  ['demolition', 'κατ.', 'αποξήλωση'], ['pressure', 'κατ.', 'δοκιμή πίεσης'],
];
// Θόρυβος: ΔΕΝ πρέπει να γίνει ποτέ γραμμή προϊόντος, ούτε να φανεί στον τίτλο.
const PII = ['Παπαδόπουλο', 'Νικολάου', 'Μαρία', 'Γιώργο', 'Χαλάνδρι', 'Γλυφάδα', 'Νέα Σμύρνη', '6912345678', '2101234567', '6977000111'];
const NOISE = ['για τον κύριο Παπαδόπουλο', 'για την κυρία Μαρία', 'κ. Νικολάου', 'στο Χαλάνδρι', 'στη Γλυφάδα', 'στη Νέα Σμύρνη',
  'τηλέφωνο 6912345678', 'στο 2101234567', 'κινητό 6977000111', 'για τον Γιώργο', 'αύριο στις 10', 'την Τρίτη το πρωί',
  'στις 12 Νοεμβρίου', 'λοιπόν', 'ε', 'επίσης', 'θέλω', 'χρειάζεται', 'ένα', 'μία'];
const SEPS = [', ', ' και ', '. ', '\n', '; ', ', επίσης '];
const stripAccents = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Ποσότητα: ψηφία, δεκαδικά (μόνο μετρούμενα), λέξεις.
function qtyText(unit){
  const max = LIM[unit];
  if(unit !== 'τεμ.' && rnd() < 0.15){ const v = int(1, Math.min(max, 99)) + 0.5; return [v, rnd() < 0.5 ? String(v).replace('.', ',') : null]; }
  const v = int(1, max);
  return [v, rnd() < 0.4 ? words(v) : String(v)];
}

function phrase([id, unit, sg, pl, after]){
  if(unit === 'κατ.') return {id, qty: 1, text: sg};
  let [v, t] = qtyText(unit);
  if(t == null) t = String(v).replace('.', ',');
  if(unit === 'τεμ.') return {id, qty: v, text: `${t} ${v === 1 ? sg : pl}`};
  const uw = pick(MEAS[unit]);
  // «12 μέτρα σωλήνα» ή «σωλήνας 12 μέτρα»
  return {id, qty: v, text: after && rnd() < 0.35 ? `${after} ${t} ${uw}` : `${t} ${uw} ${sg}`};
}

const fail = [], stats = {cases: 0, items: 0, ms: []};
const report = (kind, text, detail) => { if(fail.length < 400) fail.push({kind, text, detail}); else fail.length++; };
const crashes = [];   // ολόκληρες οι είσοδοι που έριξαν εξαίρεση (για αναπαραγωγή)

// ═══ Α. Προσφορές με γνωστή απάντηση (oracle) ═══
for(let c = 0; c < N; c++){
  const chosen = shuffle(ITEMS.slice()).slice(0, int(1, 14));
  const parts = chosen.map(phrase);
  const noise = Array.from({length: int(0, 4)}, () => pick(NOISE));
  const labor = rnd() < 0.3 ? int(1, 30) * 50 : null;
  const pieces = shuffle([...parts.map(p => p.text), ...noise]);
  if(labor) pieces.push(rnd() < 0.5 ? `εργασία ${labor >= 1000 ? labor.toLocaleString('el-GR') : labor} ευρώ` : `εργασία ${labor}`);
  if(rnd() < 0.5) pieces.unshift(pick(['Ανακαίνιση μπάνιου', 'Επισκευή κουζίνας', 'Αντικατάσταση υδραυλικών']));
  let text = pieces.map((p, i) => (i ? pick(SEPS) : '') + p).join('');
  const style = rnd();
  if(style < 0.15) text = stripAccents(text);
  else if(style < 0.25) text = text.toLocaleUpperCase('el-GR');
  const t0 = performance.now();
  let r;
  try { r = parse(text); } catch(e){ crashes.push({text, error: e.stack}); report('ΕΞΑΙΡΕΣΗ', text, e.stack.split('\n').slice(0, 2).join(' ')); continue; }
  stats.ms.push(performance.now() - t0);
  stats.cases++; stats.items += parts.length;
  const lines = r.lines, real = lines.filter(l => !l.unknown);
  for(const p of parts){
    const got = real.filter(l => l.id === p.id && !l.suggest);
    if(got.length === 0) report('ΧΑΜΕΝΟ ΥΛΙΚΟ', text, `${p.id} («${p.text}»)`);
    else if(got.length > 1) report('ΔΙΠΛΗ ΓΡΑΜΜΗ', text, `${p.id} ×${got.length}`);
    else if(Math.abs(got[0].qty - p.qty) > 1e-9 && !got[0].qtyMissing) report('ΛΑΘΟΣ ΠΟΣΟΤΗΤΑ', text, `${p.id}: είπε ${p.qty} («${p.text}»), βγήκε ${got[0].qty}${got[0].dupAsk ? ' (ρωτάει)' : ''}`);
  }
  const ids = new Set(parts.map(p => p.id));
  for(const l of real) if(!ids.has(l.id) && !l.suggest) report('ΕΠΙΠΛΕΟΝ ΓΡΑΜΜΗ', text, `${l.id} «${l.name}» ${l.qty}`);
  for(const l of lines.filter(l => l.unknown && l.keep)) report('ΘΟΡΥΒΟΣ ΩΣ ΠΡΟΪΟΝ', text, `«${l.name}» (${l.said})`);
  const visible = JSON.stringify([r.title, lines.filter(l => !l.unknown || l.keep).map(l => [l.name, l.said])]);
  for(const w of PII) if(visible.includes(w) || stripAccents(visible).includes(stripAccents(w))) report('ΠΡΟΣΩΠΙΚΑ ΣΤΟΙΧΕΙΑ', text, `«${w}» στον τίτλο/γραμμές: ${visible.slice(0, 160)}`);
  if(labor && r.labor?.cents !== labor * 100) report('ΕΡΓΑΣΙΑ', text, `είπε ${labor} €, βγήκε ${JSON.stringify(r.labor)}`);
  for(const l of lines){
    if(!Number.isFinite(l.qty) || l.qty < 0) report('ΑΚΥΡΗ ΠΟΣΟΤΗΤΑ', text, `${l.id} qty=${l.qty}`);
    if(!Number.isInteger(l.mat) || l.mat < 0 || !Number.isInteger(l.lab) || l.lab < 0) report('ΑΚΥΡΗ ΤΙΜΗ', text, `${l.id} mat=${l.mat} lab=${l.lab}`);
  }
  if(JSON.stringify(parse(text).lines.map(l => [l.id, l.qty, l.name])) !== JSON.stringify(lines.map(l => [l.id, l.qty, l.name]))) report('ΜΗ ΝΤΕΤΕΡΜΙΝΙΣΤΙΚΟ', text, '');
}

// ═══ Β. Κακόβουλη / τυχαία είσοδος: ποτέ εξαίρεση, ποτέ NaN, πάντα γρήγορα ═══
const ADV = [
  '', ' ', '\n\n\n', '.,;!?', '0 λεκάνες', '-3 λεκάνες', '−3 λεκάνες', '1e309 μέτρα σωλήνα', 'NaN λεκάνες', 'Infinity μέτρα σωλήνα',
  '99999999999999999999 λεκάνες', '0,0000001 μέτρα σωλήνα', '1.000.000 μέτρα σωλήνα', '12,,5 μέτρα σωλήνα', '12.5.3 μέτρα σωλήνα',
  '<img src=x onerror=alert(1)> 2 λεκάνες', '<script>alert(1)</script>', '"; DROP TABLE x; --', '${7*7} λεκάνες', '__proto__ 3', 'constructor 2',
  '🚽🚽🚽 2 λεκάνες 🛁', 'λεκάνη\u0000\u0007\u001b', '‮λεκάνη', 'λ́έκ́άνη', 'ΛΕΚΑΝΗ ΚΡΕΜΑΣΤΗ', 'lekani kremasti',
  'όχι όχι όχι όχι λεκάνη', 'δεν δεν χρειάζεται τίποτα', 'τελικά τελικά 5', 'και και και και', ', , , , ,',
  'λεκάνη '.repeat(2000), '12 μέτρα σωλήνα, '.repeat(1500), 'α'.repeat(100000), ('ροπ, ').repeat(3000),
  Array.from({length: 5000}, () => String.fromCharCode(int(32, 0x3ff))).join(''),
];
for(let i = 0; i < 300; i++) ADV.push(Array.from({length: int(1, 400)}, () => pick([...'αβγδεζηθικλμνξοπρστυφχψω ΑΒΓ0123456789.,;:!?€%/-\n«»"\'()<>&', ' και ', ' όχι ', ' τελικά ', 'λεκάνη', 'σωλήνα', 'μέτρα', 'τετραγωνικά', '1.500', 'ευρώ', 'εργασία'])).join(''));
const ADV_MS = 2000;
for(const text of ADV){
  const t0 = performance.now();
  let r;
  try { r = parse(text); } catch(e){ crashes.push({text, error: e.stack}); report('ΕΞΑΙΡΕΣΗ (κακόβουλη είσοδος)', text.slice(0, 80), e.message); continue; }
  const ms = performance.now() - t0;
  if(ms > ADV_MS) report('ΑΡΓΟ', `${text.slice(0, 40)}… (${text.length} χαρ.)`, `${Math.round(ms)} ms`);
  for(const l of r.lines){
    if(!Number.isFinite(l.qty)) report('ΑΚΥΡΗ ΠΟΣΟΤΗΤΑ (κακόβουλη)', text.slice(0, 80), `${l.id} qty=${l.qty}`);
    // qty 0 («0 λεκάνες»): η οθόνη ελέγχου την κλειδώνει («Ποσότητα 0», ποτέ στο PDF) — ελέγχεται στο release.e2e.
    if(l.qty < 0) report('ΑΡΝΗΤΙΚΗ ΠΟΣΟΤΗΤΑ', text.slice(0, 80), `${l.id} qty=${l.qty}`);
    if(l.qty > 1e6 && !l.qtyCheck && !l.unknown) report('ΤΕΡΑΣΤΙΑ ΠΟΣΟΤΗΤΑ ΧΩΡΙΣ ΕΡΩΤΗΣΗ', text.slice(0, 80), `${l.id} qty=${l.qty}`);
    if(typeof l.name !== 'string') report('ΟΝΟΜΑ ΟΧΙ ΚΕΙΜΕΝΟ', text.slice(0, 80), String(l.name));
  }
}

// ═══ Γ. Αριθμοί σε λέξεις 1–999 (ποσότητα) ═══
for(let n = 1; n <= 999; n++){
  const t = `${words(n)} μέτρα καλώδιο`, l = parse(t).lines.find(l => l.id === 'cable');
  if(!l || l.qty !== n) report('ΑΡΙΘΜΟΣ ΣΕ ΛΕΞΕΙΣ', t, `βγήκε ${l?.qty}`);
}
for(const [t, v] of [['χίλια μέτρα καλώδιο', 1000], ['χίλια διακόσια μέτρα καλώδιο', 1200], ['δυόμισι μέτρα καλώδιο', 2.5], ['τρεισήμισι μέτρα καλώδιο', 3.5], ['μισό μέτρο καλώδιο', 0.5]]){
  const l = parse(t).lines.find(l => l.id === 'cable');
  if(!l || l.qty !== v) report('ΑΡΙΘΜΟΣ ΣΕ ΛΕΞΕΙΣ', t, `βγήκε ${l?.qty}`);
}

// ═══ Γ2. Μεγέθη/διαστάσεις: υπάρχει → αυτό χωρίς ερώτηση· δεν υπάρχει → ερώτηση· ποτέ ποσότητα ═══
const SIZED = [['heater', 'θερμοσίφωνας', 'λίτρα', 'λ.', [60, 80, 100, 120, 160]], ['vanity', 'έπιπλο μπάνιου', 'εκατοστά', 'εκ.', [60, 80, 100]],
  ['basin', 'νιπτήρας', 'εκατοστά', 'εκ.', [45, 50, 60, 70]], ['door', 'πόρτα', 'εκατοστά', 'εκ.', [70, 80, 90]], ['hose', 'σπιράλ', 'εκατοστά', 'εκ.', [30, 40, 50]]];
let sizedN = 0;
for(const [id, word, unitW, lbl, have] of SIZED) for(let v = 20; v <= 200; v += 5){
  for(const q of [1, 2, 3]){
    const t = `${q > 1 ? q + ' ' : ''}${word} ${rnd() < 0.5 ? v : words(v)} ${unitW}`, l = parse(t).lines.find(l => l.id === id);
    sizedN++;
    if(!l){ report('ΜΕΓΕΘΟΣ: ΧΑΜΕΝΟ', t, ''); continue; }
    if(l.qty !== q) report('ΜΕΓΕΘΟΣ ΩΣ ΠΟΣΟΤΗΤΑ', t, `qty=${l.qty}`);
    if(have.includes(v) && (!l.name.endsWith(`${v} ${lbl}`) || l.sizeCheck)) report('ΜΕΓΕΘΟΣ ΥΠΑΡΧΕΙ ΑΛΛΑ ΔΕΝ ΜΠΗΚΕ', t, `${l.name} ${l.sizeCheck ? '(ρωτάει)' : ''}`);
    if(!have.includes(v) && !l.sizeCheck) report('ΑΛΛΟ ΜΕΓΕΘΟΣ ΧΩΡΙΣ ΕΡΩΤΗΣΗ', t, l.name);
  }
}
for(let i = 0; i < 2000; i++){
  const a = pick([20, 25, 30, 33, 40, 45, 60, 75, 80, 120]), b = pick([20, 30, 60, 90, 120]), q = int(1, 150);
  const sep = pick(['επί', 'x', 'χ', '×']), glue = sep === '×' || rnd() < 0.3 ? `${a}${sep}${b}` : `${a} ${sep} ${b}`;
  const t = rnd() < 0.5 ? `πλακάκι ${glue}, ${q} τετραγωνικά` : `${q} τετραγωνικά πλακάκι ${glue}`;
  const l = parse(t).lines.find(l => l.id === 'tile');
  sizedN++;
  if(!l || l.qty !== q || !l.name.includes(`${a}×${b}`)) report('ΔΙΑΣΤΑΣΗ ΠΛΑΚΑΚΙΟΥ', t, l ? `${l.name} qty=${l.qty}` : 'χάθηκε');
  const glueL = parse(t).lines.find(l => l.id === 'glue');
  if(glueL && glueL.qty !== Math.max(1, Math.ceil(Math.round(q * 5 * 1.1 / 25 * 1e6) / 1e6))) report('ΚΟΛΛΑ', t, `${glueL.qty}`);
}

// ═══ Δ. number.js: ελληνική γραφή στρογγυλή επιστροφή, σκουπίδια ποτέ αριθμός ═══
for(let i = 0; i < 20000; i++){
  const cents = int(1, 99999999), v = cents / 100;
  const txt = formatEur(v).replace(/\s*€$/, '').replace(/ /g, '');
  const r = parseAmount(txt);
  if(r.error || Math.round(r.value * 100) !== cents) report('ΑΝΑΓΝΩΣΗ ΠΟΣΟΥ', txt, JSON.stringify(r));
}
for(const bad of ['1.500', '1.5', '1 234', '12a', '-3', '', ' ', '€', '1,2,3', '1..2', '0x10', '1e3', 'NaN', 'Infinity', '٣', '１２', '12,345', '1.234.56']){
  const r = parseAmount(bad);
  if(r.value !== undefined) report('ΑΣΑΦΕΣ ΠΟΣΟ ΔΕΚΤΟ', bad, JSON.stringify(r));
}

// ═══ Αναφορά ═══
const ms = stats.ms.sort((a, b) => a - b), pct = q => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? 0;
const byKind = {};
for(const f of fail) if(f) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
const total = fail.length;
console.log(`\nΠροσφορές με γνωστή απάντηση: ${stats.cases} (${stats.items} υλικά) · ανάλυση p50 ${pct(.5).toFixed(2)} ms, p99 ${pct(.99).toFixed(2)} ms, max ${pct(1).toFixed(1)} ms`);
console.log(`Κακόβουλες είσοδοι: ${ADV.length} · αριθμοί σε λέξεις: 1004 · μεγέθη/διαστάσεις: ${sizedN} · ποσά number.js: 20.018`);
console.log(`\nΕυρήματα: ${total}${total ? '' : ' — κανένα'}`);
for(const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)} × ${k}`);
const shown = new Map();
for(const f of fail) if(f && (shown.get(f.kind) || 0) < 4){ shown.set(f.kind, (shown.get(f.kind) || 0) + 1); console.log(`\n[${f.kind}] ${f.detail}\n   «${f.text.replace(/\n/g, ' ⏎ ').slice(0, 300)}»`); }
if(crashes.length && process.env.CRASH_DUMP){ (await import('node:fs')).writeFileSync(process.env.CRASH_DUMP, JSON.stringify(crashes, null, 1)); console.log(`\nΕξαιρέσεις: ${process.env.CRASH_DUMP}`); }
process.exit(total ? 1 : 0);
