// Λειτουργία χωρίς σήμα: εγγραφή του service worker (sw.js), μπάρα «Υπάρχει νέα έκδοση · Ανανέωση» και το πρόχειρο
// που σώζεται πριν από την ανανέωση. Βλ. docs/offline.md.
//
// Κανόνες:
// - Ποτέ αυτόματο reload: η νέα έκδοση μπαίνει ΜΟΝΟ όταν πατήσει ο τεχνίτης «Ανανέωση».
// - Πριν από το reload σώζεται το πρόχειρο (κείμενο, πελάτης, οθόνη) στο sessionStorage· διαβάζεται μία φορά.

export const DRAFT = 'ergolav.draft';
// Διακόπτης ανάγκης (docs/offline.md → «Απενεργοποίηση»): false = καμία εγγραφή· ο service worker αυτού του scope
// απεγγράφεται και οι caches του σβήνονται. Μαζί: cp tools/sw-off.js sw.js.
export const SW_ENABLED = true;
const SCREENS = new Set(['s-listen', 's-lines']);
const MAX_TEXT = 20000;
const UPDATE_EVERY = 3600e3;          // έλεγχος για νέα έκδοση όταν ξαναγυρίζει στην εφαρμογή, το πολύ ανά ώρα
export const REGISTER_DELAY_MS = 2000;

const session = win => { try { return win.sessionStorage ?? null; } catch { return null; } };

/** Εγγραφή μόνο σε https ή localhost (ο browser δεν επιτρέπει αλλού). */
export function canRegister(win = globalThis){
  const loc = win.location, local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc?.hostname || '');
  return !!win.navigator?.serviceWorker && (loc?.protocol === 'https:' || local);
}

/** Το πρόχειρο καθαρισμένο (τα δεδομένα του sessionStorage θεωρούνται μη αξιόπιστα) ή null. */
export function cleanDraft(d){
  if(!d || typeof d !== 'object' || typeof d.text !== 'string' || !d.text.trim()) return null;
  return {text: d.text.slice(0, MAX_TEXT), client: typeof d.client === 'string' ? d.client.slice(0, 200) : '',
    screen: SCREENS.has(d.screen) ? d.screen : 's-listen'};
}
export function saveDraft(d, win = globalThis){
  const c = cleanDraft(d), s = session(win);
  if(!c || !s) return false;
  try { s.setItem(DRAFT, JSON.stringify(c)); return true; } catch { return false; }
}
/** Το πρόχειρο της προηγούμενης φόρτωσης (μία φορά: σβήνεται μόλις διαβαστεί). */
export function takeDraft(win = globalThis){
  const s = session(win);
  if(!s) return null;
  try { const raw = s.getItem(DRAFT); s.removeItem(DRAFT); return raw ? cleanDraft(JSON.parse(raw)) : null; }
  catch { return null; }
}

/**
 * draft(): {text, client, screen} της προσφοράς που γράφεται τώρα, ή null. bar: το στοιχείο της μπάρας με κουμπί
 * [data-update]. onReady(): τέλος της πρώτης εγκατάστασης (η εφαρμογή δουλεύει πλέον και χωρίς σήμα).
 * canLeave(): false = μην ξαναφορτώσεις (π.χ. προσφορά που δεν χώρεσε στη μνήμη και δεν στάλθηκε).
 * Επιστρέφει Promise με το registration (ή null).
 */
export function registerSW({draft = () => null, bar = null, onReady = () => {}, canLeave = () => true, win = globalThis} = {}){
  if(!canRegister(win)) return Promise.resolve(null);
  if(!SW_ENABLED) return unregisterSW(win);
  const sw = win.navigator.serviceWorker, doc = win.document;
  let wanted = false, waiting = null, last = Date.now(), had = !!sw.controller;
  // Η πρώτη εγκατάσταση κάνει «claim» τη σελίδα (controllerchange): εκεί δεν ξαναφορτώνουμε. Νέα έκδοση που μπήκε
  // από άλλη καρτέλα: μόνο η μπάρα — ποτέ reload χωρίς πάτημα.
  sw.addEventListener('controllerchange', () => {
    if(wanted) return win.location.reload();
    if(had) offer(null);
    else { try { onReady(); } catch {} }
    had = true;
  });

  function reload(){
    if(wanted || !canLeave()) return;
    wanted = true;
    saveDraft(draft(), win);
    if(waiting && waiting.state !== 'activated' && waiting.state !== 'redundant'){
      waiting.postMessage('skipWaiting');
      win.setTimeout(() => win.location.reload(), 4000);    // αν δεν έρθει controllerchange
    } else win.location.reload();
  }
  function offer(worker){
    waiting = worker;
    if(!bar) return;
    bar.hidden = false;
    const btn = bar.querySelector('[data-update]');
    if(btn) btn.onclick = reload;
  }

  // Η πρώτη εγκατάσταση κατεβάζει ~3 MB: ξεκινά αφού φορτώσει η σελίδα και ησυχάσει (REGISTER_DELAY_MS), ώστε να μη
  // βαραίνει τα πρώτα πατήματα του τεχνίτη.
  const ready = new Promise(ok => doc?.readyState === 'complete' ? ok() : win.addEventListener('load', () => ok(), {once: true}))
    .then(() => new Promise(ok => win.setTimeout(ok, REGISTER_DELAY_MS)));
  return ready.then(() => sw.register('./sw.js', {scope: './', updateViaCache: 'none'})).then(reg => {
    if(reg.waiting && sw.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if(w.state === 'installed' && sw.controller) offer(w); });
    });
    doc?.addEventListener('visibilitychange', () => {
      if(doc.visibilityState !== 'visible' || Date.now() - last < UPDATE_EVERY) return;
      last = Date.now();
      reg.update().catch(() => {});
    });
    return reg;
  }).catch(() => null);
}

/** Απενεργοποίηση: απεγγραφή του service worker ΑΥΤΟΥ του scope και σβήσιμο των caches του. Τα δεδομένα μένουν. */
export async function unregisterSW(win = globalThis){
  try {
    const scope = new URL('./', win.location.href).href, prefix = `ergolav-${new URL(scope).pathname}-`;
    for(const r of await win.navigator.serviceWorker.getRegistrations()) if(r.scope === scope) await r.unregister();
    for(const name of await win.caches.keys()) if(name.startsWith(prefix)) await win.caches.delete(name);
  } catch {}
  return null;
}
