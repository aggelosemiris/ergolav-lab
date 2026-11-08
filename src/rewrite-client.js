// «Άλλαξέ το»: ξαναγράφεται ένα σημείο της ανάλυσης μέσω της υπηρεσίας ergolav (worker/, POST /rewrite-section).
// Το κλειδί του AI μένει στην υπηρεσία. Από εδώ φεύγουν μόνο το κείμενο της ανάλυσης, το σημείο που διαλέχτηκε,
// οι δύο απαντήσεις του τεχνίτη, οι γρήγορες επιλογές και οι κανόνες ύφους του, χωρίς ονόματα, τηλέφωνα και email
// (stripPersonal). Τους κανόνες της Φάσης 4 (prompts/analysis.md) τους βάζει η υπηρεσία στο αίτημα προς το AI.
import { REWRITE_URL } from './config.js';
import { TRADES, validateAnalysis } from './analysis-schema.js';

export const QUICK = ['Πιο σύντομο', 'Πιο απλά λόγια', 'Πιο τεχνικό', 'Λάθος σειρά', 'Λείπει βήμα'];
// Η σειρά και το βήμα που λείπει αφορούν όλη την ενότητα: η αλλαγή γίνεται εκεί, με εστίαση στο στοιχείο.
export const WHOLE_SECTION = new Set(['Λάθος σειρά', 'Λείπει βήμα']);
export const LIMITS = {answer: 500, rules: 20, rule: 200, items: 3};
const TIMEOUT_MS = 40000;

export const MESSAGES = {
  config: 'Η υπηρεσία «Άλλαξέ το» δεν έχει ρυθμιστεί ακόμα σε αυτή την έκδοση.',
  offline: 'Χρειάζεται σύνδεση για να ξαναγραφτεί. Το PDF με τις αναλύσεις που έχεις βγαίνει και χωρίς σύνδεση.',
  timeout: 'Η απάντηση άργησε πολύ. Δοκίμασε ξανά σε λίγο.',
  network: 'Δεν βρέθηκε η υπηρεσία. Έλεγξε τη σύνδεση και δοκίμασε ξανά.',
  busy: 'Έκανες πολλές αλλαγές σε λίγη ώρα. Δοκίμασε ξανά αργότερα.',
  big: 'Το κείμενο είναι πολύ μεγάλο. Γράψε πιο σύντομα τι θέλεις.',
  bad: 'Η νέα εκδοχή δεν πέρασε τον έλεγχο. Πάτα «Ξαναγράψ’ το» για νέα προσπάθεια.',
  failed: 'Δεν έγινε η αλλαγή. Δοκίμασε ξανά.',
  aborted: 'Η αλλαγή ακυρώθηκε.',
};
export class RewriteError extends Error {
  constructor(message, code){ super(message); this.name = 'RewriteError'; this.code = code; }
}

// ── Προσωπικά δεδομένα: αφαιρούνται εδώ, πριν φύγει οτιδήποτε προς το AI.
const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
const stem = w => w.replace(/[αεηιουωσ]+$/, '');
const WORD = /[\p{L}\p{M}]+/gu;
// Καταλήξεις για σύντομες ρίζες ονομάτων (Νίκος → Νίκο, Νίκου, Νίκε).
const ENDINGS = ['', 'α', 'ασ', 'ε', 'η', 'ησ', 'ι', 'ια', 'ιασ', 'ιε', 'ιο', 'ιοσ', 'ιου', 'ισ', 'ο', 'οσ', 'ου', 'ων'];
// Λέξεις του ονόματος της επιχείρησης που δεν είναι ονόματα (δεν σβήνονται από τις απαντήσεις).
const COMMON = new Set(['εργασίες', 'εργασιών', 'τεχνική', 'τεχνικές', 'τεχνικός', 'υπηρεσίες', 'κατασκευές', 'ανακαινίσεις',
  'συνεργείο', 'εταιρεία', 'αδελφοί', 'υιοί', 'και', 'ΟΕ', 'ΕΕ', 'ΙΚΕ', 'ΕΠΕ', 'ΑΕ', ...TRADES].map(w => stem(plain(w))));
// Λέξεις διεύθυνσης στο πεδίο του πελάτη.
const ADDRESS = new Set(['οδός', 'οδού', 'λεωφόρος', 'λεωφ', 'πλατεία', 'αριθμός', 'όροφος', 'κ', 'κα', 'κος'].map(plain));
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:(?:\+|00)\s?30[\s.-]?)?(?<!\d)(?:69|2\d)(?:[\s.-]?\d){8}(?!\d)|\+\d{1,3}(?:[\s.-]?\d){6,12}(?!\d)/g;
const HONORIFIC = /(^|[^\p{L}])([κΚ]\.|[κΚ]α\.?|[κΚ][υύ]ρ[ιί](?:ος|ου|ο|ε|α|ας))\s+(\p{Lu}[\p{L}\p{M}]*(?:\s+\p{Lu}[\p{L}\p{M}]*)?)/gu;

function nameTest(word){
  const w = plain(word), s = stem(w);
  if(w.length < 3) return null;
  return s.length >= 4 ? x => x.startsWith(s) && x.length - s.length <= 4 : x => x === w || ENDINGS.some(e => x === s + e);
}

/** Τα ονόματα και τα τηλέφωνα που ξέρει η εφαρμογή: πεδίο πελάτη («Όνομα, περιοχή») και στοιχεία της επιχείρησης. */
export function personalFrom({client = '', profile = {}} = {}){
  const words = s => String(s || '').match(WORD) || [];
  const names = [...words(client).filter(w => !ADDRESS.has(plain(w))), ...words(profile?.name).filter(w => !COMMON.has(stem(plain(w))))];
  return {names: [...new Set(names)], phones: [profile?.phone].filter(Boolean)};
}

/** Το κείμενο χωρίς email, τηλέφωνα και ονόματα (γνωστά, και όσα ακολουθούν «κ.», «κυρία» κ.λπ.). */
export function stripPersonal(text, {names = [], phones = []} = {}){
  let t = String(text ?? '').replace(EMAIL, '[email]');
  for(const p of phones){
    const d = String(p).replace(/\D/g, '').slice(-10);
    if(d.length >= 7) t = t.replace(new RegExp(d.split('').join('[\\s.\\-/]?'), 'g'), '[τηλέφωνο]');
  }
  t = t.replace(PHONE, '[τηλέφωνο]').replace(HONORIFIC, (m, pre, title) => `${pre}${title} [όνομα]`);
  const tests = names.map(nameTest).filter(Boolean);
  if(tests.length) t = t.replace(WORD, w => tests.some(f => f(plain(w))) ? '[όνομα]' : w);
  return t.replace(/\[όνομα\](?:\s+\[όνομα\])+/g, '[όνομα]');
}

// ── Το αίτημα και η απάντηση
/**
 * Το αίτημα για την υπηρεσία. section: η ενότητα· index: το στοιχείο (null = όλη η ενότητα).
 * rules: οι κανόνες ύφους του τεχνίτη· μπαίνουν σε κάθε αίτημα. previous: η εκδοχή που δεν του άρεσε (Ξαναδοκίμασε).
 */
export function rewriteRequest({analysis, section, index = null, dislike = '', want = '', quick = [], rules = [], previous = null}, personal = {}){
  const sec = analysis.sections.find(s => s.key === section);
  const item = index == null ? null : sec.items[index];
  const scope = !item || quick.some(q => WHOLE_SECTION.has(q)) ? 'section' : 'item';
  const clip = (s, max) => stripPersonal(String(s ?? '').trim().slice(0, max), personal).trim();
  return {
    analysis: {id: analysis.id, title: analysis.title, trade: analysis.trade,
      requires_licensed_professional: analysis.requires_licensed_professional, typical_duration: analysis.typical_duration,
      sections: analysis.sections.map(s => ({key: s.key, title: s.title, items: s.items.map(i => ({id: i.id, text: i.text}))}))},
    target: {scope, section, item_id: item?.id ?? null},
    selected: item ? [item.text] : sec.items.map(i => i.text),
    dislike: clip(dislike, LIMITS.answer), want: clip(want, LIMITS.answer),
    quick: QUICK.filter(q => quick.includes(q)),
    style_rules: rules.slice(0, LIMITS.rules).map(r => clip(r?.text ?? r, LIMITS.rule)).filter(Boolean),
    ...(previous?.length && {previous: previous.map(String)}),
  };
}

/** Η ανάλυση με τη νέα εκδοχή μόνο στο σημείο-στόχο· τα ids της ενότητας ξαναμετριούνται. {analysis, errors}. */
export function applyRewrite(analysis, target, texts){
  const items = (Array.isArray(texts) ? texts : []).map(t => String(t ?? '').trim()).filter(Boolean);
  const sec = analysis.sections.find(s => s.key === target.section);
  const at = sec ? sec.items.findIndex(i => i.id === target.item_id) : -1;
  if(!sec || (target.scope === 'item' && at < 0)) return {analysis, errors: ['Δεν βρέθηκε το σημείο που διάλεξες.']};
  if(!items.length) return {analysis, errors: ['Η απάντηση δεν είχε κείμενο.']};
  if(target.scope === 'item' && items.length > LIMITS.items) return {analysis, errors: ['Η απάντηση άλλαξε περισσότερα από το σημείο που διάλεξες.']};
  const sections = analysis.sections.map(s => {
    if(s !== sec) return s;
    const list = s.items.map(i => i.text);
    if(target.scope === 'section') list.splice(0, list.length, ...items); else list.splice(at, 1, ...items);
    return {...s, items: list.map((text, n) => ({id: `${analysis.id}.${s.key}.${n + 1}`, text}))};
  });
  const next = {...analysis, sections};
  return {analysis: next, errors: validateAnalysis(next)};
}

/**
 * Κανόνας ύφους από ό,τι ζήτησε ο τεχνίτης· τον βλέπει και τον αλλάζει πριν κρατηθεί. Παίρνει τις απαντήσεις μετά το
 * stripPersonal: τα κομμάτια με όνομα, τηλέφωνο ή email αφορούν μόνο αυτή την προσφορά και δεν γίνονται κανόνας.
 */
export function ruleFrom({quick = [], want = '', dislike = ''} = {}){
  const pieces = s => s.split(/[,;.]/).map(p => p.trim()).filter(p => p && !/\[(όνομα|τηλέφωνο|email)\]/.test(p));
  const parts = [...quick.filter(q => QUICK.includes(q) && !WHOLE_SECTION.has(q)), ...pieces(want)];
  const avoid = pieces(dislike).join(', ');
  const text = parts.length ? parts.join(', ') : avoid ? `Απόφυγε: ${avoid}` : '';
  return text.slice(0, LIMITS.rule);
}

/** Στέλνει το αίτημα στην υπηρεσία· επιστρέφει {items} ή πετά RewriteError με μήνυμα στα ελληνικά. */
export async function rewriteSection(payload, {deviceId = '', signal, url = REWRITE_URL, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS} = {}){
  if(!url) throw new RewriteError(MESSAGES.config, 'config');
  if(globalThis.navigator?.onLine === false) throw new RewriteError(MESSAGES.offline, 'offline');
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const stop = () => ctrl.abort();
  signal?.addEventListener('abort', stop);
  try {
    const res = await fetchImpl(url, {method: 'POST', credentials: 'omit', signal: ctrl.signal,
      headers: {'Content-Type': 'application/json', 'X-Device-Id': deviceId}, body: JSON.stringify(payload)});
    let data = null;
    try { data = await res.json(); } catch {}
    if(!res.ok){
      const said = typeof data?.error === 'string' && data.error.length <= 200 ? data.error : '';
      throw new RewriteError(said || ({413: MESSAGES.big, 429: MESSAGES.busy, 504: MESSAGES.timeout})[res.status] || MESSAGES.failed, `http-${res.status}`);
    }
    if(!Array.isArray(data?.items) || !data.items.length || !data.items.every(t => typeof t === 'string')) throw new RewriteError(MESSAGES.bad, 'bad');
    return {items: data.items};
  } catch(e){
    if(e instanceof RewriteError) throw e;
    if(signal?.aborted) throw new RewriteError(MESSAGES.aborted, 'aborted');
    if(ctrl.signal.aborted) throw new RewriteError(MESSAGES.timeout, 'timeout');
    throw new RewriteError(globalThis.navigator?.onLine === false ? MESSAGES.offline : MESSAGES.network, 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
