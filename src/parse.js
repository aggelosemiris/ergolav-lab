// Μετατρέπει ελεύθερη ομιλία («δώδεκα μέτρα σωλήνα και μια λεκάνη…») ή σημειώσεις σε γραμμές προσφοράς.
import { CATALOG, TITLE_WORDS } from './catalog.js';
import { parseAmount, toCents } from './number.js';

export const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ');
// Φωνητική μορφή: ανοχή στα συνηθισμένα ορθογραφικά (σολήνας/σωλήνας, λεκανι/λεκάνη, κολα/κόλλα).
export const phon = t => t.replace(/ει|οι/g, 'ι').replace(/αι/g, 'ε').replace(/[ηυ]/g, 'ι').replace(/ω/g, 'ο');

// Greeklish → ελληνικά («dwdeka metra swlina» → «δωδεκα μετρα σωλινα»).
const GL = [['th','θ'],['ch','χ'],['ps','ψ'],['ks','ξ'],['ou','ου'],['mp','μπ'],['a','α'],['b','μπ'],['c','κ'],['d','δ'],['e','ε'],
  ['f','φ'],['g','γ'],['h','η'],['i','ι'],['j','τζ'],['k','κ'],['l','λ'],['m','μ'],['n','ν'],['o','ο'],['p','π'],['q','κ'],['r','ρ'],
  ['s','σ'],['t','τ'],['u','ου'],['v','β'],['w','ω'],['x','χ'],['y','υ'],['z','ζ']];
const isLatin = t => /^[a-z]+$/.test(t);
const g = t => isLatin(t) ? greek(t) : t;          // greeklish token → ελληνικά (τα αγγλικά keywords ελέγχονται πρώτα)
function greek(t){
  let o = '';
  for(let i = 0; i < t.length;){ const p = GL.find(([l]) => t.startsWith(l, i)); if(p){ o += p[1]; i += p[0].length; } else o += t[i++]; }
  return o;
}

const UNITS = {ενα:1,ενασ:1,μια:1,μιασ:1,δυο:2,τρια:3,τρεισ:3,τεσσερα:4,τεσσερισ:4,πεντε:5,εξι:6,
  επτα:7,εφτα:7,οκτω:8,οχτω:8,εννεα:9,εννια:9};
const TEENS = {δεκα:10,εντεκα:11,ενδεκα:11,δωδεκα:12,δεκατρια:13,δεκατρεισ:13,δεκατεσσερα:14,δεκατεσσερισ:14,
  δεκαπεντε:15,δεκαεξι:16,δεκαεξη:16,δεκαεπτα:17,δεκαεφτα:17,δεκαοκτω:18,δεκαοχτω:18,δεκαεννεα:19,δεκαεννια:19};
const TENS = {εικοσι:20,τριαντα:30,σαραντα:40,πενηντα:50,εξηντα:60,εβδομηντα:70,ογδοντα:80,ενενηντα:90};
const HUNDREDS = {εκατο:100,εκατον:100,διακοσια:200,διακοσιεσ:200,διακοσιοι:200,τριακοσια:300,τριακοσιεσ:300,τετρακοσια:400,
  πεντακοσια:500,εξακοσια:600,επτακοσια:700,εφτακοσια:700,οκτακοσια:800,οχτακοσια:800,εννιακοσια:900,εννεακοσια:900,χιλια:1000,χιλιεσ:1000};
const FRAC = {μισο:0.5,μιση:0.5,μισα:0.5,μιαμιση:1.5};
const EN_NUM = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,fifteen:15,twenty:20,thirty:30,fifty:50,hundred:100};

// Σπάει σε φράσεις: στίξη (όχι μέσα σε δεκαδικούς) και συνδετικά που η ομιλία συχνά βγάζει χωρίς στίξη.
// Με τόνους και κεφαλαία («επίσης», «ΚΑΙ»): πριν, μόνο τα άτονα πεζά χώριζαν — «επίσης»/«μετά» με τόνο δεν χώριζαν ποτέ.
const SPLIT = /[.,;!?·](?=\s|$)|\n|\s(?:και|επίσης|επισης|έπειτα|επειτα|μετά|μετα|ακόμα|ακομα|ακόμη|ακομη|συν|and|also)\s/iu;

// Άρνηση πριν από υλικό («δεν χρειάζεται θερμοσίφωνας», «εκτός από την μπανιέρα»).
const NEG = new Set(['δεν','χωρισ','εκτοσ','οχι','μην','μη','without','no']);
// Διόρθωση («όχι, συγγνώμη, 15 μέτρα»): η επόμενη αναφορά στο ίδιο υλικό ΑΝΤΙΚΑΘΙΣΤΑ την ποσότητα.
const CORR = new Set(['οχι','συγγνωμη','συγνωμη','λαθοσ','τελικα','διορθωση','ενοω','δηλαδη']);
// Ρητές λέξεις διόρθωσης για ποσότητα ΧΩΡΙΣ επανάληψη υλικού («όχι, τελικά 15 μέτρα»).
const CORR_EXPLICIT = new Set(['οχι','τελικα','συγγνωμη','συγνωμη','διορθωση']);
// Λέξεις γεμίσματος — μια φράση μόνο από αυτές δεν είναι υλικό.
const FILLER = new Set(['λοιπον','εεε','εε','εμ','οκ','οκει','ναι','καλα','και','ρε','που','λεμε','ας','πουμε','τελοσ','παντων','αυτα','αυτο','ετσι']);

function numberWord(t){
  if(UNITS[t] ?? TEENS[t] ?? TENS[t] ?? HUNDREDS[t] ?? FRAC[t] ?? EN_NUM[t]) return UNITS[t] ?? TEENS[t] ?? TENS[t] ?? HUNDREDS[t] ?? FRAC[t] ?? EN_NUM[t];
  // «δυόμισι», «τρεισήμισι», «εναμισι» → +0.5
  const m = t.match(/^(.+?)η?μισ[ιηυ]$/);
  if(m){ const base = UNITS[m[1]] ?? TEENS[m[1]]; if(base) return base + 0.5; }
  return null;
}

/** Αριθμός από token· null για ό,τι δεν είναι ποσότητα (τιμές €, ώρες, τηλέφωνα). */
function toNumber(tok, next = ''){
  if(/[€%:]/.test(tok) || /^(€|ευρω|eur|%)/.test(next)) return null;            // τιμή / ποσοστό / ώρα
  const d = tok.match(/^(\d+(?:[.,]\d+)?)/);
  if(d){
    if(d[1].replace(/\D/g, '').length >= 5) return null;                         // τηλέφωνο, κωδικός
    return parseFloat(d[1].replace(',', '.'));
  }
  return numberWord(tok) ?? (isLatin(tok) ? numberWord(greek(tok)) : null);
}
const isWordNumber = t => !/\d/.test(t) && numberWord(t) != null;

/** Αριθμός που ξεκινά στο i, και σύνθετος από διαδοχικές λέξεις («είκοσι πέντε») → {n, end}· null αν δεν είναι αριθμός. */
function numAt(tokens, i, {money = false} = {}){
  if(tokens[i] == null) return null;                                         // «30 επί» στο τέλος (ήταν εξαίρεση)
  let n = toNumber(tokens[i], money ? '' : tokens[i + 1]), end = i;
  if(n == null) return null;
  if(isWordNumber(tokens[i]) && /^χιλιαδ/.test(tokens[i + 1] || '') && n < 1000){ n *= 1000; end++; }   // «δύο χιλιάδες»
  while((isWordNumber(tokens[end]) || /^χιλιαδ/.test(tokens[end])) && isWordNumber(tokens[end + 1] || '')){
    const m = numberWord(tokens[end + 1]);
    if(n % 1000 === 0 && m < 1000 && m >= 100) n += m;                       // «χίλια διακόσια»
    else if(n % 100 === 0 && m < 100) n += m;
    else if(n >= 20 && n % 10 === 0 && m < 10) n += m;
    else break;
    end++;
  }
  return {n, end};
}

// Αριθμοί που περιγράφουν το προϊόν, όχι ποσότητα: διάσταση («30 επί 60», «30x60») ή μέγεθος («80 λίτρα», «60 εκ.»).
// Τα «μέτρα», «τετραγωνικά», «τεμάχια», «σακιά» είναι μονάδες ποσότητας και δεν ανήκουν εδώ.
const DIM_SEP = new Set(['επι', 'x', 'χ', '×', '*']);
// Μονάδα μεγέθους → [είδος, εμφάνιση, συντελεστής προς λίτρα/εκατοστά]. Διαβάζει και τις ετικέτες τύπων του καταλόγου.
const SIZE_UNIT = {λιτρα:['vol','λ.',1], λιτρων:['vol','λ.',1], λ:['vol','λ.',1], εκατοστα:['len','εκ.',1], εκ:['len','εκ.',1], ποντουσ:['len','εκ.',1],
  χιλιοστα:['len','χιλ.',0.1], χιλ:['len','χιλ.',0.1], ιντσα:['inch','"',1], ιντσεσ:['inch','"',1], ιντσασ:['inch','"',1], χερι:['coat','χέρι',1], χερια:['coat','χέρια',1],
  εξοδων:['out','εξόδων',1], εξοδουσ:['out','εξόδων',1], εξοδοι:['out','εξόδων',1], γουρνα:['bowl','γούρνα',1], γουρνεσ:['bowl','γούρνες',1], γουρνων:['bowl','γούρνες',1]};
const fmtNum = n => String(n).replace('.', ',');
const dimSize = (at, a, b) => ({at, kind:'dim', v:[a, b].sort((x, y) => x - y), label:`${fmtNum(a)}×${fmtNum(b)}`});

/** Θέσεις των tokens που είναι χαρακτηριστικά (δεν γίνονται ποσότητα) και τα μεγέθη που ειπώθηκαν. */
function attributes(tokens){
  const at = new Set(), sizes = [];
  for(let i = 0; i < tokens.length; i++){
    const x = tokens[i].match(/^(\d+(?:[.,]\d+)?)(?:[xχ×*]|επι)(\d+(?:[.,]\d+)?)$/);   // και «30επί60» (ήταν 30 τ.μ.)
    if(x){ at.add(i); sizes.push(dimSize(i, ...[x[1], x[2]].map(v => parseFloat(v.replace(',', '.'))))); continue; }
    // Ίντσες: «1/2», «3/4"», «1"» (σπείρωμα βάνας/διακόπτη).
    const f = tokens[i].match(/^(\d)\/(\d{1,2})"?$/) ?? tokens[i].match(/^(\d+)()"$/);
    if(f){ const v = f[2] ? +f[1] / +f[2] : +f[1]; at.add(i); sizes.push({at: i, kind: 'inch', v: [v], label: `${f[0].replace(/"$/, '')}"`}); continue; }
    const a = numAt(tokens, i);
    if(!a) continue;
    const b = DIM_SEP.has(tokens[a.end + 1]) ? numAt(tokens, a.end + 2) : null;
    const u = SIZE_UNIT[(tokens[a.end + 1] || '').replace(/\.$/, '')];
    // «30 επί» χωρίς δεύτερο αριθμό: ημιτελής διάσταση — ούτε διάσταση ούτε ποσότητα (θα ζητηθεί).
    const half = !b && DIM_SEP.has(tokens[a.end + 1]);
    const last = b ? b.end : u ? a.end + 1 : half ? a.end + 1 : -1;
    if(last < 0) continue;
    for(let k = i; k <= last; k++) at.add(k);
    if(!half) sizes.push(b ? dimSize(i, a.n, b.n) : {at: i, kind: u[0], v: [Math.round(a.n * u[2] * 100) / 100], label: u[0] === 'inch' ? `${fmtNum(a.n)}"` : `${fmtNum(a.n)} ${u[1]}`});
    i = last;
  }
  return {at, sizes};
}

/** Μεγέθη ενός τύπου του καταλόγου, από την ετικέτα του («100 λ.», «80×120», «4 εξόδων», «1½ γούρνα») και τη διατομή (sec). */
const OPT_SIZES = new Map();
function optSizes(o){
  if(!OPT_SIZES.has(o)) OPT_SIZES.set(o, [...attributes(norm(o.label.replace('½', ',5')).split(/\s+/)).sizes,
    ...(o.sec ? [{kind: 'sec', v: [o.sec]}] : [])]);
  return OPT_SIZES.get(o);
}
const sameSize = (a, b) => a.kind === b.kind && a.v.join() === b.v.join();
const sizeDist = (a, b) => a.kind !== b.kind || a.v.length !== b.v.length ? Infinity : a.v.reduce((d, x, k) => d + Math.abs(x - b.v[k]), 0);

/** Οι δύο τύποι με το πιο κοντινό μέγεθος σε αυτό που ειπώθηκε (με τη σειρά του καταλόγου)· αλλιώς ο συνηθισμένος. */
function nearest(item, said){
  const d = o => Math.min(Infinity, ...optSizes(o).map(s => sizeDist(s, said)));
  const near = item.options.filter(o => d(o) < Infinity).sort((a, b) => d(a) - d(b)).slice(0, 2);
  return near.length ? near.sort((a, b) => item.options.indexOf(a) - item.options.indexOf(b)) : [item.options[item.def ?? 0]];
}

// Keywords σε φωνητική μορφή (υπολογίζονται μία φορά).
const PH = new Map(CATALOG.map(c => [c, {
  kw: c.keywords.map(k => phon(k).split('+')), not: (c.notWords || []).map(phon), after: (c.notAfter || []).map(phon), before: (c.notBefore || []).map(phon),
}]));
// Keywords δύο λέξεων («σετ ντους»): η δεύτερη λέξη ανήκει στο ίδιο υλικό και δεν πιάνει δικό της.
const PAIRS = [...PH.values()].flatMap(p => p.kw.filter(k => k.length > 1));

function findItem(tokens, i){
  const tok = phon(g(tokens[i])), prev = phon(g(tokens[i-1] || '')), next = [tokens[i+1], tokens[i+2]].filter(Boolean).map(t => phon(g(t)));
  const en = isLatin(tokens[i]) ? tokens[i] : null;
  if(PAIRS.some(([a, b]) => prev.startsWith(a) && tok.startsWith(b))) return undefined;
  return CATALOG.find(c => {
    const p = PH.get(c);
    const hit = (en && c.en?.includes(en)) || p.kw.some(([a, b]) => tok.startsWith(a) && (!b || (next[0] || '').startsWith(b)));
    return hit && !p.not.some(w => tok.startsWith(w)) && !p.after.some(k => prev.startsWith(k)) &&
      !p.before.some(k => next.some(n => n.startsWith(k)));
  });
}

const hasAny = (tokens, kws) => tokens.some(t => kws.some(k => t.startsWith(k) || phon(g(t)).startsWith(phon(k))));

// Λογικά όρια ποσότητας ανά μονάδα· πάνω από αυτά η γραμμή ζητάει επιβεβαίωση.
const QTY_LIMIT = {'τεμ.':30, 'μ.':300, 'τ.μ.':200, 'σακί':60, 'κάδος':10, 'κατ.':3, 'kg':500, 'λ.':500};
// Μονάδες όπου η ποσότητα δεν «εννοείται» 1 — αν δεν ειπώθηκε, τη ζητάμε.
const MEASURED = new Set(['μ.', 'τ.μ.', 'σακί', 'kg', 'λ.', 'κάδος']);

function checkQty(line){
  line.qtyCheck = line.qty > (QTY_LIMIT[line.unit] ?? 100);
  return line;
}

function makeLine(item, qty, tokens, qtyMissing, {dim, said} = {}){
  const line = {id:item.id, name:item.name, code:item.code || '', unit:item.unit, qty,
                mat:item.mat || 0, lab:item.lab || 0};
  const q = (item.qualifiers || []).find(q => hasAny(tokens, q.kw));
  if(q) line.name = q.name;
  if(dim) line.name += ' ' + dim;
  if(item.options){
    // Αν δεν ειπώθηκε τύπος και το υλικό έχει συνηθισμένη επιλογή (def), την παίρνουμε χωρίς ερώτηση.
    // Τύπος με άλλη διάσταση από αυτή που ειπώθηκε δεν μπαίνει σιωπηλά — ρωτάμε.
    const sameDim = o => o.label.startsWith(dim + ' ');
    const fits = o => !dim || !/^\d+×\d+/.test(o.label) || sameDim(o);
    const said0 = item.options.find(o => hasAny(tokens, o.kw));
    let picked = said0 ?? item.options[item.def];
    line.typeSaid = !!said0;
    if(picked && !fits(picked)) picked = undefined;
    // Μέγεθος που ειπώθηκε: μπαίνει ο τύπος με αυτό το μέγεθος, χωρίς ερώτηση. Αν δεν υπάρχει στον κατάλογο,
    // η γραμμή ρωτάει (τα δύο πιο κοντινά ή «Άλλο μέγεθος») — όχι σιωπηλά άλλο είδος.
    if(said && item.options.some(o => optSizes(o).length)){
      const hits = item.options.filter(o => optSizes(o).some(s => sameSize(s, said)));
      if(hits.length === 1){ picked = hits[0]; line.typeSaid = true; }
      else if(hits.length > 1) picked = undefined;
      else line.sizeCheck = {said: said.label, near: nearest(item, said)};
    }
    const base = line.base = line.name;
    line.options = item.options;
    line.pick = o => ({name:`${base} ${dim && sameDim(o) ? o.label.slice(dim.length + 1) : o.label}`, code:o.code, mat:o.mat, lab:o.lab ?? item.lab ?? 0, use:o.use});
    if(picked){ Object.assign(line, line.pick(picked)); }
    else line.flag = true;
  }
  if(item.choose){
    // Αμφίσημη λέξη («ντους»): η γραμμή ρωτάει ποιο υλικό — και γίνεται εκείνο (lineFor).
    Object.assign(line, {flag: true, choose: item.choose.map(id => CATALOG.find(c => c.id === id))});
  }
  if(qtyMissing && MEASURED.has(line.unit)) line.qtyMissing = true;
  return checkQty(line);
}

// Συντομογραφίες σημειώσεων («12 μ.», «τ.μ.», «τεμ.») — η τελεία τους δεν κλείνει φράση.
const ABBR = /(^|[\s\d])(τ\.\s?μ|τμ|μ|τεμ|τεμαχ|μετ|κιλ|λιτ|σακ|κουτ|εκ|χιλ|κ)\./gi;   // «κ. Νικολάου»: όχι τέλος φράσης

// Μονάδες που μπορεί να ακολουθούν την ποσότητα (κανονικοποιημένες ρίζες → εμφάνιση).
const UNIT_WORDS = [[/^(μ|μετρ|μετ|m|meters?|metres?)$|^μετρ/, 'μ.'], [/^(τμ|τετραγων|sqm|m2)/, 'τ.μ.'], [/^(τεμ|pcs|pieces?)/, 'τεμ.'], [/^σακ/, 'σακί'],
  [/^(κιλ|kg)/, 'kg'], [/^λιτ/, 'λ.'], [/^κουτ/, 'κουτί'], [/^(ζευγ|ζευγαρ)/, 'ζεύγος']];
const unitOf = tok => UNIT_WORDS.find(([re]) => re.test(tok))?.[1];
const wordTok = w => norm(w).replace(/[«»"'().,;:!?]/g, '');

// Λέξεις που δεν κάνουν μια φράση υλικό: άρθρα/προθέσεις, και ό,τι δείχνει ώρα, ημέρα, ποσό, τηλέφωνο, διεύθυνση,
// πρόσωπο («στις 10 το πρωί», «σε 3 μέρες», «οδός Ερμού 25», «κύριος Νικολάου»).
const STOP = new Set(['για','τον','την','τη','το','τα','του','τησ','των','στο','στη','στην','στον','στα','στουσ','στισ','σε','με','απο',
  'ο','η','οι','ενα','ενασ','μια','θα','να','πιο','ακομα','ακομη','ολα','ολο','αλλο','αλλα','που','πωσ','οτι','κι']);
const NOISE = /^(ωρα|ωρεσ|ωρων|πρωι|απογευμ|βραδ|μεσημερ|λεπτ|μερα|μερεσ|ημερ|εβδομαδ|μηνα|μηνεσ|τηλ|κινητ|οδοσ|οδο$|λεωφ|οροφ|κυρ|ευρω|eur|φπα|ποσοστ|εργασ|αυριο|σημερα|μεθαυριο|χθεσ|δευτερ|τριτη|τεταρτη|πεμπτ|παρασκευ|σαββατ|κυριακ|ιανουαρ|φεβρουαρ|μαρτ|απριλ|μαιου|μαιοσ|ιουν|ιουλ|αυγουστ|σεπτεμβρ|οκτωβρ|νοεμβρ|δεκεμβρ)/;
// Λέξεις που δεν είναι μέρος του ονόματος υλικού («θέλω ροπ» → «Ροπ», «επίσης σιφόνι»).
const ASK_WORDS = new Set(['θελω','θελουμε','θελει','βαλε','βαλτε','βαζουμε','βαλουμε','βαζω','χρειαζεται','χρειαζονται','χρειαζομαι',
  'χρειαζομαστε','επισησ','ακομα','ακομη','λοιπον','ε','εε','εμ','παρε','παρτε','φερε','φερτε','και','μου','μασ']);

// Προσωπικά στοιχεία και τοποθεσίες βγαίνουν από τη φράση ΠΡΙΝ γίνει τίτλος ή υλικό — ποτέ στο PDF:
// τηλέφωνα, «κύριο/κυρία/κ. Όνομα», «για τον/την Όνομα», «στο/στη Χαλάνδρι» (κεφαλαίο = κύριο όνομα).
const PERSON = /^(κυρ(ιο|ια|ιοσ|ιου|ιασ|ιε)|κ)$/;
const PLACE_PREP = new Set(['στο','στη','στην','στον','στα','στισ','στουσ','σε','απο','προσ']);
const ARTICLE = new Set(['τον','την','τη','το','τουσ','τισ']);
const isCap = w => /^\p{Lu}/u.test(w || '');
const isPhone = w => /^\+?[\d().-]+$/.test(w) && w.replace(/\D/g, '').length >= 5;
export function scrub(seg){
  const w = seg.split(/\s+/).filter(Boolean), n = w.map(wordTok), drop = new Set();
  for(let i = 0; i < w.length; i++){
    if(isPhone(w[i])){                                                   // «6912345678», «210 1234567»
      drop.add(i);
      for(const k of [i - 1, i + 1]) if(/^\+?\d{2,4}$/.test(w[k] || '')) drop.add(k);
    }
    if(PERSON.test(n[i]) && w[i + 1]){                                   // «κύριο Παπαδόπουλο», «κ. Νικολάου Γιώργο»
      drop.add(i); drop.add(i + 1);
      if(isCap(w[i + 2])) drop.add(i + 2);
    }
  }
  for(let i = 0; i < w.length; i++){
    const next = i + 2 < w.length ? i + 2 : -1;
    if(n[i] === 'για' && ARTICLE.has(n[i + 1]) && next > 0 && (drop.has(next) || isCap(w[next]))){   // «για τον (κύριο) Γιώργο»
      drop.add(i); drop.add(i + 1);
      for(let k = next; k < w.length && (drop.has(k) || isCap(w[k])); k++) drop.add(k);
    }
    if(PLACE_PREP.has(n[i]) && i + 1 < w.length && (drop.has(i + 1) || isCap(w[i + 1]))){     // «στο Χαλάνδρι», «στο 69…»
      drop.add(i);
      for(let k = i + 1; k < w.length && (drop.has(k) || isCap(w[k])); k++) drop.add(k);
    }
  }
  return w.filter((_, i) => !drop.has(i)).join(' ');
}

// Υλικό εκτός καταλόγου: κρατάμε ποσότητα/μονάδα και ό,τι απομένει ως όνομα.
// keep: φράση με ουσιαστικό (όχι μόνο γεμίσματα, όχι ώρα/ημερομηνία/ποσό/τηλέφωνο/πρόσωπο/τόπος) → γραμμή προϊόντος
// χωρίς τιμή, για να τη συμπληρώσει ή να τη σβήσει ο χρήστης (ποτέ σιωπηλά χαμένο). Ποσότητα που δεν ειπώθηκε = 1.
function unknownLine(raw){
  const seg = scrub(raw);
  let qty = null, unit = '';
  const words = seg.split(/\s+/), toks = words.map(wordTok);
  const rest = words.filter((w, k) => {
    const t = toks[k];
    const n = /^\d+(?:[.,]\d+)?$/.test(t) || isWordNumber(t) || isLatin(t) ? toNumber(t, toks[k + 1]) : null;
    if(n != null && qty == null){ qty = n; return false; }
    const u = t.length <= 12 && unitOf(t);
    if(u && !unit && qty != null){ unit = u; return false; }
    return true;
  });
  while(rest.length && (ASK_WORDS.has(wordTok(rest[0])) || FILLER.has(wordTok(rest[0])) || STOP.has(wordTok(rest[0])))) rest.shift();
  const name = rest.join(' ').replace(/^[\s,.:-]+|[\s,.:;-]+$/g, '');
  const nouns = rest.map(wordTok).filter(t => /\p{L}{2,}/u.test(t) && !STOP.has(t) && !FILLER.has(t) && !CORR.has(t) && !NEG.has(t) && !ASK_WORDS.has(t));
  const keep = nouns.length > 0 && !toks.some(t => NOISE.test(t));
  return checkQty({id:'unknown', name: name ? name[0].toUpperCase() + name.slice(1) : seg, said: seg.replace(/[.,;:!?]+$/, ''),
    unit: unit || (keep ? 'τεμ.' : ''), qty: qty ?? 1, mat:0, lab:0, unknown:true, keep});
}

/** Ποσό εργασίας από φράση με «εργασία»: {cents} ή {ask} όταν ο αριθμός είναι ασαφής· null αν δεν ειπώθηκε ποσό.
 *  ΜΟΝΟ εδώ (φωνή + «ευρώ/€»): τελεία και ακριβώς 3 ψηφία = χιλιάδες («1.200 ευρώ» → 1200). Αλλού αυστηρά όπως number.js. */
function laborAmount(tokens){
  for(let i = 0; i < tokens.length; i++){
    const t = tokens[i].replace(/€$/, ''), euro = /€$/.test(tokens[i]) || /^(€|ευρω|eur)/.test(tokens[i + 1] || '');
    if(/^\d[\d.,]*$/.test(t)){
      const r = parseAmount(euro && /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t);
      return r.error ? {ask: `${t}${euro ? ' ευρώ' : ''}`} : {cents: toCents(r.value)};
    }
    const a = isWordNumber(tokens[i]) && numAt(tokens, i, {money: true});
    if(a) return {cents: Math.round(a.n * 100)};
  }
  return null;
}

/** Γραμμή για υλικό του καταλόγου (π.χ. όταν ο χρήστης διάλεξε «Ντουζιέρα» αντί για «σετ ντους»). */
export const lineFor = (id, qty) => makeLine(CATALOG.find(c => c.id === id), qty, []);

// ── Καθάρισμα εξόδου LLM / σημειώσεων πριν την ανάλυση ──
const HEADER_WORDS = new Set(['υλικο','υλικα','ποσοτητα','ποσοτ','μοναδα','περιγραφη','τιμη','κωδικοσ','ποσο','αα','item','items','qty','quantity','description','unit','price']);
const PREAMBLE = /(οριστε|ακολουθ|παρακατω|διαβασα|μεταγραφ|σημειωσεισ που|here (are|is)|following|below)/;

function cleanText(text){
  return text.split('\n').map(line => {
    if(/^\s*\|?\s*:?-{2,}/.test(line)) return '';                                // γραμμή διαχωρισμού markdown πίνακα
    line = line.replace(/\|/g, ' ').replace(/[*_#`]+/g, ' ')                       // κελιά πίνακα, **έντονα**, # τίτλοι
               .replace(/^[ \t]*(?:\d{1,2}[.)]|[-•–·])[ \t]+/, '');                 // αρίθμηση/κουκκίδες λίστας
    const n = norm(line).trim();
    if(/^καμια σημειωση\.?$/.test(n)) return '';
    const words = n.split(/\s+/).filter(Boolean);
    if(words.length && words.every(w => HEADER_WORDS.has(w.replace(/[^\p{L}]/gu, '')))) return '';   // επικεφαλίδα πίνακα
    if(/:\s*$/.test(n) && !/\d/.test(n) && PREAMBLE.test(n)) return '';           // «Ορίστε οι σημειώσεις:»
    return line;
  }).join('\n').replace(ABBR, (_, pre, ab) => pre + ab.replace(/[.\s]/g, '') + ' ');
}

/**
 * Υλικό από υπολογισμό (catalog per): πηγή × κατανάλωση + φύρα, σε ολόκληρες συσκευασίες.
 * Κατανάλωση: αυτή που έγραψε ο χρήστης (calc.rate), αλλιώς του τύπου κάθε γραμμής-πηγής (use) σταθμισμένη με τις
 * ποσότητες, αλλιώς του καταλόγου. Πηγές που περιμένουν ποσότητα (δεν ειπώθηκε / φαίνεται λάθος) δεν μετράνε.
 * @returns {{src, srcUnit, rate, waste, pack, unit, qty}}
 */
export function calcParts(line, lines){
  const c = line.calc;
  const src = lines.filter(l => l.id === c.from && !l.qtyMissing && !l.qtyCheck && l.qty > 0);
  const total = src.reduce((s, l) => s + l.qty, 0);
  const rate = c.rate ?? (total ? Math.round(src.reduce((s, l) => s + l.qty * (l.use?.[line.id] ?? c.defRate), 0) / total * 100) / 100 : c.defRate);
  const need = total * rate * (1 + c.waste / 100) / c.pack;
  const qty = total > 0 ? Math.max(1, Math.ceil(Math.round(need * 1e6) / 1e6)) : 0;
  return {src: total, srcUnit: c.srcUnit, rate, waste: c.waste, pack: c.pack, unit: c.unit, qty};
}

export function parse(text){
  text = cleanText(text);
  const lines = [], unknown = [];
  let title = '', correcting = false, lastLine = null, prevCorr = false, labor = null;
  for(const rawSeg of text.split(SPLIT)){
    const seg = rawSeg.trim();
    if(!seg) continue;
    // Η κάθετος χωρίζει λέξεις, εκτός από ίντσες («3/4»).
    const tokens = norm(seg).split(/[\s\-–—]+/).flatMap(t => /^\d\/\d{1,2}"?$/.test(t) ? [t] : t.split('/'))
      .map(t => t.replace(/[«»'()]/g, '').replace(/"(?!$)/g, '')).filter(Boolean);
    // «Εργασία 1.200 ευρώ»: ποσό για την εργασία της δουλειάς — όχι γραμμή υλικού.
    if(tokens.some(t => t.startsWith('εργασ')) && !tokens.some((_, k) => findItem(tokens, k))){
      const a = laborAmount(tokens);
      if(a){ labor = a; continue; }
    }
    let pending = null, pendingAt = -1, found = 0, lastNum = -2;
    const attr = attributes(tokens);
    const used = new Set(attr.at), seen = new Set(), saidQty = new Map(), inclQty = new Set();
    const items = tokens.map((_, k) => used.has(k) ? null : findItem(tokens, k));
    // Υλικό που το περιέχει ήδη άλλο υλικό της ίδιας φράσης («νιπτήρας με έπιπλο») δεν χρεώνεται χωριστά.
    const included = new Set(items.flatMap((it, k) =>
      it && !tokens.slice(Math.max(0, k - 3), k).some(t => NEG.has(t)) ? it.includes || [] : []));
    // Μέγεθος για το υλικό στη θέση i: όσα ειπώθηκαν μέχρι το επόμενο υλικό, αλλιώς από το προηγούμενο ως εδώ.
    const sizeFor = (i, list) => {
      const prev = items.findLastIndex((it, k) => it && k < i), next = items.findIndex((it, k) => it && k > i);
      return list.find(d => d.at > i && (next < 0 || d.at < next)) ?? list.findLast(d => d.at < i && d.at > prev);
    };
    if(tokens.some(t => CORR.has(t))) correcting = true;
    const corrHere = tokens.some(t => CORR_EXPLICIT.has(t)), corrNear = corrHere || prevCorr;
    prevCorr = corrHere;
    for(let i = 0; i < tokens.length; i++){
      if(used.has(i)) continue;
      const n = toNumber(tokens[i], tokens[i + 1]);
      if(n != null){
        // Σύνθετοι αριθμοί μόνο από διαδοχικές λέξεις: «εκατόν είκοσι πέντε» → 125 (όχι «12 5»).
        const joinable = lastNum === i - 1 && isWordNumber(tokens[i]) && isWordNumber(tokens[i - 1]) && pending != null;
        if(joinable && pending % 1000 === 0 && n >= 100 && n < 1000) pending += n;     // «χίλια διακόσια» (ήταν σιωπηλά 200)
        else if(joinable && pending % 100 === 0 && n < 100) pending += n;
        else if(joinable && pending >= 20 && pending % 10 === 0 && n < 10) pending += n;
        else { pending = n; pendingAt = i; }
        lastNum = i;
        continue;
      }
      const item = findItem(tokens, i);
      if(!item) continue;
      // Άρνηση λίγο πριν το υλικό, χωρίς αριθμό ανάμεσα → το υλικό ΔΕΝ μπαίνει (και βγαίνει αν είχε μπει).
      const negated = pending == null && tokens.slice(Math.max(0, i - 3), i).some(t => NEG.has(t));
      if(negated){
        found++;
        for(let k = lines.length - 1; k >= 0; k--) if(lines[k].id === item.id){ if(lines[k] === lastLine) lastLine = null; lines.splice(k, 1); }
        continue;
      }
      if(included.has(item.id)){
        // «δύο νιπτήρες με έπιπλο»: η ποσότητα δεν μεταφέρεται σιωπηλά στο έπιπλο — θα ζητηθεί.
        if(pending != null) inclQty.add(item.id);
        found++; pending = null; continue;
      }
      // Δεύτερη λέξη για το ίδιο υλικό στην ίδια φράση («2 κάδοι μπάζα») — όχι νέα γραμμή.
      if(pending == null && seen.has(item.id)) continue;
      seen.add(item.id);
      found++;
      // Διατομή που λέγεται σκέτη αμέσως μετά («καλώδιο 2,5»): τύπος, όχι ποσότητα — μόνο αν υπάρχει ακριβώς στον κατάλογο
      // και δεν ακολουθεί μονάδα ποσότητας («καλώδιο 4 μέτρα» = 4 μ.).
      let bare;
      const bn = used.has(i + 1) || !tokens[i + 1] ? null : toNumber(tokens[i + 1], tokens[i + 2]);
      if(bn != null && !unitOf(tokens[i + 2] || '') && item.options?.some(o => o.sec === bn)){
        bare = {kind: 'sec', v: [bn], label: fmtNum(bn)};
        used.add(i + 1);
      }
      // Ποσότητα μετά το υλικό («σωλήνας 12 μέτρα»): ψάχνουμε μέχρι το επόμενο υλικό.
      if(pending == null){
        for(let j = i + 1; j < tokens.length && !findItem(tokens, j); j++){
          if(used.has(j)) continue;
          // Και σύνθετος αριθμός από λέξεις («αρμόστοκος είκοσι εννέα σακιά» = 29· ήταν σιωπηλά 20).
          const a = numAt(tokens, j);
          if(a){ pending = a.n; for(let k = j; k <= a.end; k++) used.add(k); break; }
        }
      }
      const qtyMissing = pending == null;
      saidQty.set(item, saidQty.get(item) || !qtyMissing);
      const mention = qtyMissing ? null : pending;
      const qty = pending ?? 1;
      pending = null;
      const line = makeLine(item, qty, tokens, qtyMissing, item.sizeInName
        ? {dim: sizeFor(i, attr.sizes.filter(d => d.kind === 'dim'))?.label}
        : {said: bare ?? sizeFor(i, attr.sizes)});
      line.mentions = [mention];
      const same = lines.find(l => l.id === line.id && (l.name === line.name || correcting) && !l.flag && !line.flag &&
        (correcting || (!l.sizeCheck && !line.sizeCheck)));
      if(same && correcting){
        // Διόρθωση: η νέα αναφορά αντικαθιστά την παλιά (ποσότητα και τύπο).
        Object.assign(same, {...line, qtyMissing: line.qtyMissing, sizeCheck: line.sizeCheck});
        correcting = false;
        lastLine = same;
      } else if(same){
        // Ίδιο υλικό ξανά: αθροίζεται, αλλά η γραμμή θα ρωτήσει (dupAsk) — όχι σιωπηλά διπλό.
        // Ποσότητα που έλειπε (προσωρινό 1) δεν μπαίνει στο άθροισμα.
        same.qty = same.qtyMissing && MEASURED.has(same.unit) ? qty : same.qty + qty;
        same.mentions.push(mention);
        if(!qtyMissing) same.qtyMissing = false;
        checkQty(same);
        lastLine = same;
      } else {
        lines.push(line);
        if(correcting) correcting = false;
        lastLine = line;
      }
    }
    for(const [item, said] of saidQty) if(!said && item.includes?.some(id => inclQty.has(id))){
      const l = lines.find(l => l.id === item.id);
      if(l) l.qtyMissing = true;
    }
    // Διόρθωση χωρίς επανάληψη υλικού («12 μέτρα σωλήνα, όχι, τελικά 15 μέτρα»): η νέα ποσότητα αντικαθιστά
    // εκείνη του ΑΜΕΣΩΣ προηγούμενου υλικού μόνο αν (α) υπάρχει ρητή λέξη διόρθωσης σε αυτή ή την προηγούμενη
    // φράση, (β) η φράση έχει μόνο ποσότητα/μονάδα/λέξεις διόρθωσης, (γ) η μονάδα είναι ρητά ίδια — χωρίς μονάδα
    // μόνο για τεμάχια. Αλλιώς ισχύει ό,τι πριν (η ποσότητα φαίνεται ως γραμμή για έλεγχο).
    // Ίδιοι κανόνες χωρίς λέξη διόρθωσης όταν η ποσότητα ΕΛΕΙΠΕ («πλακάκι 30 επί 60, δεκαπέντε τετραγωνικά»),
    // αλλά τότε μόνο με ρητά ίδια μονάδα.
    if(!found && pending != null && lastLine && (corrNear || lastLine.qtyMissing)){
      const numIdx = tokens.map((t, k) => toNumber(t) != null ? k : -1).filter(k => k >= 0);
      const units = tokens.map(unitOf).filter(Boolean);
      const onlyCorrection = tokens.every(t => toNumber(t) != null || unitOf(t) || CORR.has(t) || FILLER.has(t));
      const oneNumber = numIdx.length && numIdx[numIdx.length - 1] - numIdx[0] + 1 === numIdx.length;
      const unitOk = units.length ? units.every(u => u === lastLine.unit) : corrNear && lastLine.unit === 'τεμ.';
      if(onlyCorrection && oneNumber && unitOk){
        lastLine.qty = pending; lastLine.qtyMissing = false; checkQty(lastLine);
        continue;
      }
    }
    if(found) continue;
    if(tokens.every(t => FILLER.has(t) || CORR.has(t) || NEG.has(t))) continue;   // «όχι, συγγνώμη», «λοιπόν»
    const onlyQty = tokens.every(t => toNumber(t) != null || unitOf(t));
    if(!title && pending == null && hasAny(tokens, TITLE_WORDS)) title = scrub(seg).replace(/[.,;:!?]+$/, '');
    else if(!onlyQty && (tokens.length >= 2 || pending != null || tokens[0].length >= 2)) unknown.push(seg);
  }

  // Υλικά που βγαίνουν από υπολογισμό (κόλλα, αρμόστοκος από τα πλακάκια), αν δεν ειπώθηκαν: προτείνονται για έλεγχο.
  for(const item of CATALOG.filter(c => c.per && !lines.some(l => l.id === c.id) && lines.some(l => l.id === c.per.from))){
    const {from, rate, unit, waste, pack} = item.per;
    const line = {...makeLine(item, 0, []), suggest: true,
      calc: {from, defRate: rate, rate: null, unit, waste, pack, srcUnit: CATALOG.find(c => c.id === from).unit}};
    line.qty = calcParts(line, lines).qty;
    lines.push(line);
  }
  // Εξαρτήματα χωρίς διάμετρο: του σωλήνα της προσφοράς, αν είναι ένας (αλλιώς η προεπιλογή — ορατή στην κάρτα).
  for(const l of lines){
    const item = CATALOG.find(c => c.id === l.id);
    if(!item?.sameAs || l.typeSaid || l.flag) continue;
    const [from, kind] = item.sameAs;
    const dia = [...new Set(lines.filter(x => x.id === from && x.name.includes(kind)).map(x => x.name.match(/Φ\d+/)?.[0]).filter(Boolean))];
    const o = dia.length === 1 && item.options.find(o => o.label === dia[0]);
    if(o) Object.assign(l, l.pick(o));
  }
  // Το ίδιο υλικό ειπώθηκε πάνω από μία φορά: «Το είπες δύο φορές: 1 ή 2;» (επιλογές: κάθε αναφορά και το σύνολο).
  for(const l of lines){
    const said = (l.mentions || []).map(m => m ?? (l.unit === 'τεμ.' ? 1 : null)).filter(m => m != null);
    if(said.length < 2) continue;
    const sum = Math.round(said.reduce((a, b) => a + b, 0) * 1000) / 1000;
    l.dupAsk = {times: l.mentions.length, opts: [...new Set([...said, sum])].sort((a, b) => a - b)};
    l.qty = sum;
  }
  for(const u of unknown) lines.push(unknownLine(u));

  return {title: title ? title[0].toLowerCase() + title.slice(1) : '', lines, labor};
}
