// Suite A/F/G/H/K: αντιστοίχιση κειμένου → κατάλογος (parse.js), ντετερμινιστικά.
import { parse } from '../../../src/parse.js';
import { CASES, largeInput } from '../cases/catalog.cases.mjs';

// Πού βρίσκεται κυρίως το πρόβλημα, ανά κατηγορία case (για το root cause analysis).
const ROOT = {
  similar: 'retrieval — αντιστοίχιση με πρόθεμα λέξης (keyword prefix), χωρίς έλεγχο νοήματος',
  variation: 'κατάλογος/λεξιλόγιο — λείπουν συνώνυμα, ορθογραφική ανοχή, άλλες γλώσσες/γραφές',
  conflict: 'application logic — δεν υπάρχει χειρισμός διόρθωσης («όχι, …») ή άρνησης («δεν χρειάζεται»)',
  partial: 'application logic — η ποσότητα μπαίνει σιωπηλά 1 όταν λείπει',
  'llm-output': 'application logic — δεν υπάρχει validation/normalization της εξόδου του LLM πριν τον parser',
  noise: 'retrieval — θόρυβος στο κείμενο',
  missing: 'retrieval — υλικά εκτός καταλόγου',
  multi: 'retrieval — σύνθεση πολλών υλικών',
  duplicate: 'application logic — διπλότυπα',
  normal: 'retrieval',
};

const same = (a, b) => Math.abs(a - b) < 1e-9;

export function evaluateCase(c){
  const t0 = performance.now();
  const r = parse(c.input);
  const ms = performance.now() - t0;
  const lines = r.lines;
  const cat = lines.filter(l => !l.unknown && !l.suggest);
  const unknown = lines.filter(l => l.unknown);
  const reasons = [];
  let found = 0, qtyOk = 0, qtyChecked = 0;

  const matched = new Set();
  for(const e of c.expect || []){
    // Ίδιο υλικό σε πολλές γραμμές (π.χ. πλακάκι τοίχου / δαπέδου): ταιριάζουμε και με το όνομα.
    const l = cat.find(x => x.id === e.id && !matched.has(x) && (!e.name || e.name.test(x.name)));
    if(!l){ reasons.push(`δεν βρέθηκε: ${e.id}${e.name ? ` (${e.name.source})` : ''}`); continue; }
    matched.add(l);
    found++;
    if(e.qty != null){ qtyChecked++; if(same(l.qty, e.qty)) qtyOk++; else reasons.push(`${e.id}: ποσότητα ${l.qty}, αναμενόταν ${e.qty}`); }
    if(e.flag != null && !!l.flag !== e.flag) reasons.push(`${e.id}: ${e.flag ? 'έπρεπε να ζητηθεί επιλογή τύπου' : 'δεν έπρεπε να ζητηθεί επιλογή'}`);
    if(e.askQty && l.qtyMissing !== true) reasons.push(`${e.id}: η ποσότητα δεν ειπώθηκε αλλά μπήκε σιωπηλά ${l.qty} ${l.unit} (δεν ζητήθηκε)`);
  }
  const falsePositives = [];
  for(const id of c.forbid || []) if(cat.some(l => l.id === id)){ falsePositives.push(id); reasons.push(`false positive: ${id}`); }
  if(c.exact){
    const allowed = new Set((c.expect || []).map(e => e.id));
    for(const l of cat) if(!allowed.has(l.id) && !falsePositives.includes(l.id)){ falsePositives.push(l.id); reasons.push(`απρόσμενο υλικό: ${l.id} («${l.name}», ${l.qty})`); }
  }
  if(c.unknownMin != null && unknown.length < c.unknownMin) reasons.push(`χάθηκε πληροφορία: ${unknown.length} γραμμές εκτός καταλόγου, αναμένονταν ≥ ${c.unknownMin}`);
  if(c.unknownMax != null && unknown.length > c.unknownMax) reasons.push(`σκουπίδια ως γραμμές προσφοράς: ${unknown.map(u => `«${u.name}»`).join(', ')}`);
  if(c.qtyMax != null){
    // Αποτυχία μόνο αν η παράλογη ποσότητα μπαίνει ΣΙΩΠΗΛΑ (χωρίς σημαία επιβεβαίωσης qtyCheck)
    for(const l of lines) if(l.qty > c.qtyMax && !l.qtyCheck) reasons.push(`παράλογη ποσότητα έγινε δεκτή σιωπηλά: ${l.qty} × ${l.name}`);
  }
  if(c.title != null && r.title !== c.title) reasons.push(`τίτλος «${r.title}», αναμενόταν «${c.title}»`);

  const expected = (c.expect || []).length;
  return {
    test_id: c.id, suite: 'catalog', category: c.category, timestamp: new Date().toISOString(),
    query: c.input, note: c.note,
    retrieved: lines.map(l => ({id: l.id, name: l.name, qty: l.qty, unit: l.unit, flag: !!l.flag, qtyCheck: !!l.qtyCheck, qtyMissing: !!l.qtyMissing, unknown: !!l.unknown, suggest: !!l.suggest})),
    expected_behaviour: {expect: c.expect || [], forbid: c.forbid || [], exact: !!c.exact, unknownMin: c.unknownMin, unknownMax: c.unknownMax, qtyMax: c.qtyMax},
    scores: {
      retrieval: expected ? Math.round(100 * found / expected) : (falsePositives.length ? 0 : 100),
      quantity: qtyChecked ? Math.round(100 * qtyOk / qtyChecked) : null,
    },
    found, expected, falsePositives, qtyOk, qtyChecked, lines,
    hallucination_detected: falsePositives.length > 0 || reasons.some(r => r.startsWith('παράλογη')),
    latency_ms: ms,
    informational: !!c.informational,
    pass: c.informational ? null : reasons.length === 0,
    failure_reason: reasons.join('; ') || null,
    root_cause: reasons.length ? ROOT[c.category] : null,
  };
}

export function runCatalogSuite({largeSizes = [10, 100, 1000, 5000]} = {}){
  const results = CASES.map(evaluateCase);

  // H/K: μεγάλη είσοδος — χρόνος και χαμένη πληροφορία (άθροισμα ποσοτήτων ανά υλικό)
  for(const n of largeSizes){
    const {text, totals} = largeInput(n);
    const t0 = performance.now();
    const r = parse(text);
    const ms = performance.now() - t0;
    const got = {};
    for(const l of r.lines) if(!l.unknown && !l.suggest) got[l.id] = (got[l.id] || 0) + l.qty;
    const lost = Object.entries(totals).filter(([id, q]) => !same(got[id] || 0, q)).map(([id, q]) => `${id}: ${got[id] || 0}/${q}`);
    // Η οθόνη ακρόασης ξανατρέχει τον parser σε ΚΑΘΕ ενδιάμεσο αποτέλεσμα φωνής· >50ms = αισθητό κόλλημα.
    // Όριο μόνο για ρεαλιστικά μεγέθη (≤1000 γραμμές)· πάνω από αυτό καταγράφεται μόνο ο χρόνος.
    const tooSlow = n <= 1000 && ms > 50;
    results.push({
      test_id: `large-${n}`, suite: 'catalog', category: 'large', timestamp: new Date().toISOString(),
      query: `${n} γραμμές (${text.length} χαρακτήρες)`, retrieved: Object.entries(got).map(([id, qty]) => ({id, qty})),
      expected_behaviour: {totals, maxMs: 50}, latency_ms: ms, input_chars: text.length,
      scores: {retrieval: lost.length ? 0 : 100},
      pass: !lost.length && !tooSlow,
      failure_reason: [lost.length && `χάθηκαν ποσότητες: ${lost.join(', ')}`, tooSlow && `${ms.toFixed(0)}ms για parse (>50ms) — η οθόνη φωνής τρέχει parse σε κάθε ενδιάμεσο αποτέλεσμα`].filter(Boolean).join('; ') || null,
      root_cause: lost.length ? 'retrieval' : tooSlow ? 'application logic — επανυπολογισμός parse σε κάθε interim αποτέλεσμα' : null,
    });
  }
  return results;
}
