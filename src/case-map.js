// Δέντρο περιπτώσεων ενός υλικού (data/cases/map.json): ποια ερώτηση ισχύει μετά από ποιες απαντήσεις, όλοι οι
// συνδυασμοί που έχουν νόημα (περιπτώσεις) και ποια περίπτωση καλύπτει η σημερινή ανάλυση (βασική).
// Χωρίς DOM και χωρίς αρχεία: το χρησιμοποιούν το tools/catalog/analysis-map.mjs (αναφορά) και η μηχανή του «Άλλαξέ το».

/** Ταιριάζουν οι απαντήσεις με έναν όρο {ερώτηση: [απαντήσεις]}; Ερώτηση χωρίς απάντηση = δεν ταιριάζει. */
export const meets = (answers, when = {}) => Object.entries(when).every(([q, ok]) => ok.includes(answers[q]));

/** Οι ερωτήσεις που ισχύουν για αυτές τις απαντήσεις, με τη σειρά του χάρτη (ίδιο id με άλλο when = άλλη εκδοχή). */
export const applicable = (material, answers) => material.questions.filter(q => !q.when || meets(answers, q.when));

/** Η επόμενη ερώτηση που ισχύει και δεν έχει απάντηση, ή null όταν η περίπτωση είναι πλήρης. */
export function nextQuestion(material, answers){
  return applicable(material, answers).find(q => !(q.id in answers)) || null;
}

/** Μόνο οι απαντήσεις που ισχύουν ακόμα (π.χ. ο «τοίχος» φεύγει όταν η κρεμαστή γίνει δαπέδου). */
export function prune(material, answers){
  const out = {};
  for(const q of material.questions) if((!q.when || meets(out, q.when)) && q.id in answers && q.answers.some(a => a.id === answers[q.id])) out[q.id] = answers[q.id];
  return out;
}

/** Ταιριάζει μια πλήρης περίπτωση με ένα μερικό σύνολο απαντήσεων {ερώτηση: απάντηση ή [απαντήσεις]};
 *  ερωτήσεις του συνόλου που δεν ισχύουν στην περίπτωση αγνοούνται. */
export function covers(partial, answers){
  return Object.entries(partial).every(([q, v]) => !(q in answers) || (Array.isArray(v) ? v : [v]).includes(answers[q]));
}

export const caseId = (material, answers) =>
  `${material.id}:${applicable(material, answers).filter((q, i, all) => all.findIndex(x => x.id === q.id) === i).map(q => answers[q.id]).join('.')}`;

/** Όλοι οι συνδυασμοί: [{id, answers, excluded: λόγος ή null}]. */
export function enumerate(material){
  const out = [];
  (function walk(answers){
    const q = nextQuestion(material, answers);
    if(!q){
      const ex = (material.exclude || []).find(e => meets(answers, e.when));
      out.push({id: caseId(material, answers), answers, excluded: ex ? ex.why : null});
      return;
    }
    for(const a of q.answers) walk({...answers, [q.id]: a.id});
  })({});
  return out;
}

/** Οι περιπτώσεις που έχουν νόημα, με την πηγή του κειμένου τους: base (η σημερινή ανάλυση), existing (μία από τις
 *  γραμμένες αναλύσεις), ή new (γράφεται στο Μέρος 2). */
export function cases(material){
  return enumerate(material).filter(c => !c.excluded).map(c => {
    const base = (material.base || []).find(b => covers(b.answers, c.answers));
    const existing = !base && (material.existing || []).find(e => covers(e.answers, c.answers));
    return {...c, source: base ? 'base' : existing ? 'existing' : 'new', task: (base || existing || {}).task || null};
  });
}

/** Οι απαντήσεις που δίνει ήδη μια γραμμή της προσφοράς («είδος» ή «είδος:τύπος»). */
export function lineAnswers(material, keys){
  const out = {};
  for(const q of material.questions) for(const k of keys) if(q.line?.[k] && !(q.id in out)) out[q.id] = q.line[k];
  return out;
}

/** Η ετικέτα μιας περίπτωσης στα λόγια του μάστορα: «Αλλαγή παλιάς · Κρεμαστή · Γυψοσανίδα». */
export function caseLabel(material, answers){
  return applicable(material, answers).filter((q, i, all) => all.findIndex(x => x.id === q.id) === i)
    .map(q => q.answers.find(a => a.id === answers[q.id])?.label).filter(Boolean).join(' · ');
}
