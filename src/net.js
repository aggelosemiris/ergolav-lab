// Υπάρχει σήμα; «Όχι» όταν το λέει ο browser (navigator.onLine) Ή όταν αποτύχει ένα αίτημα δικτύου — το onLine λέει
// συχνά «ναι» σε υπόγεια με μία γραμμή σήματος που δεν περνά τίποτα. Βλ. docs/offline.md.
//
// - watchNet(): παρακολουθεί κάθε fetch της σελίδας (Supabase, AI): σφάλμα δικτύου → χωρίς σήμα· απάντηση από άλλο
//   origin → υπάρχει σήμα. Τα αρχεία της εφαρμογής δεν μετρούν (τα δίνει ο service worker και χωρίς σήμα).
// - Χωρίς σήμα, μικρός έλεγχος (HEAD στο sw.js, χωρίς cache) όταν ο browser πει «online», όταν ξαναγυρίσει ο τεχνίτης
//   στην εφαρμογή, και κάθε PROBE_EVERY_MS.

export const NO_NET = 'Χρειάζεται σύνδεση στο internet';
export const PROBE_TIMEOUT_MS = 6000;
export const PROBE_EVERY_MS = 20000;

let failed = false, last = true, probing = null;
const subs = new Set();
const nav = () => globalThis.navigator;

/** true = υπάρχει (ή δεν ξέρουμε ότι λείπει) σήμα. */
export function online(){ return !failed && nav()?.onLine !== false; }

function emit(){
  const now = online();
  if(now === last) return;
  last = now;
  subs.forEach(f => { try { f(now); } catch {} });
}
/** Σήμα από τον κώδικα (π.χ. σφάλμα «network» της φωνής). */
export function markOffline(){ failed = true; emit(); }
export function markOnline(){ failed = false; emit(); }
/** f(online) σε κάθε αλλαγή. Επιστρέφει «σταμάτα». */
export function onNet(f){ subs.add(f); return () => subs.delete(f); }

const isNetworkError = e => e?.name === 'TypeError';

/** Μικρός έλεγχος με το δίκτυο: true αν απάντησε κάτι (οποιοσδήποτε κωδικός). */
export function probe({win = globalThis, url = './sw.js', fetchImpl = win.__ergolavFetch || win.fetch?.bind(win)} = {}){
  if(probing) return probing;
  if(win.navigator?.onLine === false){ emit(); return Promise.resolve(false); }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = win.setTimeout?.(() => ctl?.abort(), PROBE_TIMEOUT_MS);
  probing = Promise.resolve().then(() => fetchImpl(url, {method: 'HEAD', cache: 'no-store', signal: ctl?.signal}))
    .then(() => { markOnline(); return true; }, () => { markOffline(); return false; })
    .finally(() => { win.clearTimeout?.(t); probing = null; });
  return probing;
}

/** Μία φορά, στο άνοιγμα της εφαρμογής. */
export function watchNet({win = globalThis} = {}){
  if(win.__ergolavFetch || typeof win.fetch !== 'function') return;
  const orig = win.__ergolavFetch = win.fetch.bind(win);
  const own = u => { try { return new URL(u, win.location?.href).origin === win.location?.origin; } catch { return true; } };
  win.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : input?.url;
    try {
      const r = await orig(input, init);
      if(!own(url)) markOnline();
      return r;
    } catch(e) {
      if(isNetworkError(e)) markOffline();
      throw e;
    }
  };
  win.addEventListener?.('offline', () => emit());
  win.addEventListener?.('online', () => { emit(); probe({win}); });
  win.document?.addEventListener?.('visibilitychange', () => { if(win.document.visibilityState === 'visible' && !online()) probe({win}); });
  win.setInterval?.(() => { if(!online()) probe({win}); }, PROBE_EVERY_MS);
  win.setTimeout?.(() => probe({win}), 3000);      // στο άνοιγμα: «σήμα» που δεν περνά τίποτα φαίνεται σε ≤ 9″
  emit();
}

/** Μόνο για τα τεστ. */
export function _reset(){ failed = false; last = true; probing = null; subs.clear(); }
