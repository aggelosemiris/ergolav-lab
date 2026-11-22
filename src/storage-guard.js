// Αποθήκευση στη συσκευή (localStorage): γεμάτη μνήμη, μέτρηση χώρου, μόνιμη αποθήκευση. Βλ. docs/offline.md.
//
// - guardStorage(): ΚΑΘΕ αποθήκευση της εφαρμογής που αποτυγχάνει επειδή γέμισε η μνήμη (QuotaExceededError) το λέει
//   στον τεχνίτη (onFull). Τα modules συνεχίζουν όπως πριν (το σφάλμα ξαναρίχνεται): τίποτα δεν χάνεται σιωπηλά.
// - usage(): πόσο χώρο πιάνουν προσφορές, λογότυπα, αντίγραφα και τα υπόλοιπα (σε χαρακτήρες).
// - askPersist(): μία φορά, μετά την πρώτη αποθηκευμένη προσφορά, ζητά από τον browser να μη σβήνει τα δεδομένα.

export const FULL_MSG = 'Η μνήμη του κινητού γέμισε: η τελευταία αλλαγή δεν αποθηκεύτηκε. Η προσφορά μένει ανοιχτή μέχρι να τη στείλεις.';
export const PERSIST_ASKED = 'ergolav.persistAsked';

export const isQuota = e => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

/** Μία φορά, στο άνοιγμα. onFull(key) σε κάθε αποθήκευση που δεν χώρεσε. */
export function guardStorage({win = globalThis, onFull = () => {}} = {}){
  const proto = win.Storage?.prototype;
  if(!proto || proto.setItem.__ergolav) return false;
  const orig = proto.setItem;
  const setItem = function(key, value){
    try { return orig.call(this, key, value); }
    catch(e) { if(isQuota(e)) { try { onFull(String(key)); } catch {} } throw e; }
  };
  setItem.__ergolav = true;
  proto.setItem = setItem;
  return true;
}

// Ομάδες κλειδιών για τη μέτρηση. Το aggelosemiris.github.io είναι κοινό: «άλλα» = κλειδιά άλλων repos.
const GROUPS = [
  ['quotes', k => k === 'ergolav.quotes'],
  ['quoteBackups', k => k.startsWith('ergolav.quotes.backup.')],
  ['logos', k => k === 'ergolav.logos'],
  ['profileBackups', k => k.startsWith('ergolav.profile.backup.')],
  ['session', k => /^sb-.+-auth-token/.test(k)],
  ['ergolav', k => k.startsWith('ergolav.') || k.startsWith('sb-')],
  ['other', () => true],
];
/** {quotes, quoteBackups, logos, profileBackups, session, ergolav, other, total}: χαρακτήρες (κλειδί + τιμή). */
export function usage(storage = globalThis.localStorage){
  const out = Object.fromEntries(GROUPS.map(([g]) => [g, 0]));
  out.total = 0;
  try {
    for(let i = 0; i < storage.length; i++){
      const k = storage.key(i), n = k.length + (storage.getItem(k) || '').length;
      out[GROUPS.find(([, f]) => f(k))[0]] += n;
      out.total += n;
    }
  } catch {}
  return out;
}

/** Μία φορά ανά συσκευή: navigator.storage.persist(). Επιστρέφει Promise<boolean|null> (null = δεν ζητήθηκε). */
export async function askPersist({win = globalThis} = {}){
  let s;
  try { s = win.localStorage; if(s.getItem(PERSIST_ASKED)) return null; } catch { return null; }
  const p = win.navigator?.storage?.persist;
  if(typeof p !== 'function') return null;
  try { s.setItem(PERSIST_ASKED, String(Date.now())); } catch {}
  try { return await p.call(win.navigator.storage); } catch { return false; }
}
