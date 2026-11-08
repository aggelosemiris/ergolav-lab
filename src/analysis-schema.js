// Μορφή και κανόνες μιας «ανάλυσης εργασίας» (Φάση 4). Το χρησιμοποιούν η παραγωγή (tools/catalog) και η εφαρμογή,
// όταν αποθηκεύει την εκδοχή του τεχνίτη. Οι κανόνες είναι οι ίδιοι με το prompts/analysis.md.

export const SECTIONS = [
  {key: 'prerequisites', title: 'Τι χρειάζεται πριν ξεκινήσουμε', min: 2, max: 4},
  {key: 'preparation',   title: 'Προεργασία',                    min: 2, max: 5},
  {key: 'steps',         title: 'Στάδια τοποθέτησης',            min: 3, max: 8, ordered: true},
  {key: 'checks',        title: 'Έλεγχοι πριν την παράδοση',     min: 3, max: 5},
  {key: 'handover',      title: 'Καθαρισμός και παράδοση',       min: 2, max: 4},
];

export const TRADES = ['υδραυλικός', 'θερμοϋδραυλικός', 'ηλεκτρολόγος', 'πλακάς', 'ελαιοχρωματιστής', 'γυψοσανιδάς',
  'ψυκτικός', 'μονωτής', 'δαπεδοστρώτης', 'σοβατζής', 'ξυλουργός', 'μαρμαράς'];

/** Η μία πρόταση που τυπώνεται στο PDF όταν η εργασία θέλει αδειούχο επαγγελματία. */
export const LICENSED_NOTE = 'Η εργασία αυτή γίνεται, όπως ορίζει ο νόμος, από αδειούχο ή πιστοποιημένο επαγγελματία.';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NUMBERED = /^\s*\d+\s*[.)]/;                                          // «1. …» — η αρίθμηση μπαίνει στο PDF
const WARRANTY = /εγγυ(ηση|ησεισ|ομαστε|ημεν|αται|ησ)|guarantee|warranty/i;   // ελέγχεται σε κείμενο χωρίς τόνους
const PROMISE = /100\s*%|ποτε (ξανα|πια)|σιγουρο αποτελεσμα|απολυτα στεγαν|για παντα|δια βιου/i;
const VAGUE = /με (προσοχη|επαγγελματισμο|μερακι)|ποιοτικα υλικα|αψογ(ο|α) αποτελεσμα/i;
const RANGE = /(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)|μιση εωσ|\d+\s*εωσ\s*\d+/i;
const plain = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
const textOf = item => typeof item === 'string' ? item : item?.text;

/** Έλεγχος μιας ανάλυσης. withIds: τα στοιχεία είναι {id, text} με σταθερά ids. Επιστρέφει λίστα σφαλμάτων (κενή = εντάξει). */
export function validateAnalysis(a, {withIds = true} = {}){
  const err = [];
  if(!a || typeof a !== 'object') return ['Η ανάλυση δεν είναι αντικείμενο.'];
  if(!ID.test(a.id || '')) err.push('Μη έγκυρο id εργασίας.');
  if(typeof a.title !== 'string' || !a.title.trim() || a.title.length > 120) err.push('Λείπει ή είναι πολύ μεγάλος ο τίτλος.');
  if(!TRADES.includes(a.trade)) err.push(`Άγνωστο επάγγελμα «${a.trade}».`);
  if(!Array.isArray(a.sections) || a.sections.length !== SECTIONS.length) err.push(`Χρειάζονται ακριβώς ${SECTIONS.length} ενότητες.`);
  const ids = new Set();
  SECTIONS.forEach((spec, i) => {
    const s = a.sections?.[i];
    if(!s || s.key !== spec.key){ err.push(`Η ενότητα ${i + 1} πρέπει να είναι «${spec.key}».`); return; }
    if(!Array.isArray(s.items) || s.items.length < spec.min || s.items.length > spec.max){ err.push(`«${spec.title}»: ${spec.min}–${spec.max} στοιχεία.`); return; }
    s.items.forEach((item, n) => {
      const t = textOf(item), where = `«${spec.title}» ${n + 1}`;
      if(typeof t !== 'string' || t.trim().length < 8 || t.length > 320) err.push(`${where}: κενό ή πολύ μεγάλο κείμενο.`);
      else {
        if(NUMBERED.test(t)) err.push(`${where}: χωρίς αρίθμηση μέσα στο κείμενο.`);
        if(WARRANTY.test(plain(t))) err.push(`${where}: δεν αναφέρουμε εγγύηση.`);
        if(PROMISE.test(plain(t))) err.push(`${where}: καμία υπόσχεση αποτελέσματος.`);
        if(VAGUE.test(plain(t))) err.push(`${where}: γενικόλογη διατύπωση.`);
      }
      if(withIds){
        if(typeof item !== 'object' || !item.id) err.push(`${where}: λείπει το id.`);
        else if(ids.has(item.id)) err.push(`${where}: διπλό id ${item.id}.`);
        else if(!item.id.startsWith(`${a.id}.${spec.key}.`)) err.push(`${where}: το id πρέπει να ξεκινά με ${a.id}.${spec.key}.`);
        ids.add(item?.id);
      }
    });
  });
  const d = plain(a.typical_duration || '');
  if(!d.includes('ενδεικτικ') || !RANGE.test(d)) err.push('Ο χρόνος πρέπει να είναι εύρος με «ενδεικτικά».');
  if(!Array.isArray(a.related_consumables) || a.related_consumables.length > 12 || a.related_consumables.some(c => typeof c !== 'string' || !c.trim() || c.length > 80)) err.push('Μη έγκυρα αναλώσιμα (έως 12, σύντομα).');
  if(typeof a.requires_licensed_professional !== 'boolean') err.push('Λείπει το requires_licensed_professional.');
  if(typeof a.notes_for_master !== 'string' || a.notes_for_master.length > 400) err.push('Η σημείωση για τον τεχνίτη θέλει έως 400 χαρακτήρες.');
  return err;
}

/** Από απάντηση με απλά strings σε αποθηκευμένη μορφή με σταθερά ids «<εργασία>.<ενότητα>.<α/α>». */
export function withItemIds(raw, {id, trade}){
  return {
    id, title: raw.title.trim(), trade,
    sections: SECTIONS.map(spec => {
      const s = raw.sections.find(x => x.key === spec.key) || {items: []};
      return {key: spec.key, title: spec.title, items: s.items.map((t, n) => ({id: `${id}.${spec.key}.${n + 1}`, text: String(t).trim()}))};
    }),
    typical_duration: raw.typical_duration.trim(),
    related_consumables: raw.related_consumables.map(c => c.trim()),
    requires_licensed_professional: !!raw.requires_licensed_professional,
    notes_for_master: (raw.notes_for_master || '').trim(),
  };
}

/** JSON schema της απάντησης του μοντέλου (structured outputs). Χωρίς ids· τα βάζει ο κώδικας. */
export const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'sections', 'typical_duration', 'related_consumables', 'requires_licensed_professional', 'notes_for_master'],
  properties: {
    title: {type: 'string'},
    sections: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['key', 'items'],
      properties: {key: {type: 'string', enum: SECTIONS.map(s => s.key)}, items: {type: 'array', items: {type: 'string'}}}}},
    typical_duration: {type: 'string'},
    related_consumables: {type: 'array', items: {type: 'string'}},
    requires_licensed_professional: {type: 'boolean'},
    notes_for_master: {type: 'string'},
  },
};
