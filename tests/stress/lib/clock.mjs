// Εικονικό ρολόι: επιταχύνει όλες τις αναμονές (setTimeout) κατά SCALE ώστε ένα σενάριο με
// backoff 3s + 8s να τρέχει σε κλάσματα του δευτερολέπτου, και καταγράφει ποιες αναμονές ζήτησε
// ο κώδικας της εφαρμογής. Δεν αλλάζει τον κώδικα της εφαρμογής· αντικαθιστά μόνο το global
// setTimeout όσο τρέχει ένα σενάριο.

const realSetTimeout = globalThis.setTimeout;
const realDateNow = Date.now;

export function installClock(scale){
  const t0 = performance.now(), d0 = realDateNow();
  const now = () => (performance.now() - t0) / scale;
  // Αναμονές ≥ 500ms της εφαρμογής που ΟΛΟΚΛΗΡΩΘΗΚΑΝ (= backoff). Timers που ακυρώθηκαν
  // (π.χ. το timeout μιας κλήσης που απάντησε εγκαίρως) δεν μετράνε.
  const waits = [];
  globalThis.setTimeout = (fn, ms = 0, ...args) => {
    const at = now();
    return realSetTimeout((...a) => { if(ms >= 500) waits.push({at, ms}); fn(...a); }, ms * scale, ...args);
  };
  Date.now = () => d0 + Math.round(now());          // η εφαρμογή μετράει χρόνο με Date.now
  return {
    now, waits, scale,
    /** Αναμονή του ίδιου του harness/mock — δεν καταγράφεται ως backoff της εφαρμογής. */
    sleep: ms => new Promise(ok => realSetTimeout(ok, ms * scale)),
    uninstall(){ globalThis.setTimeout = realSetTimeout; Date.now = realDateNow; },
  };
}

export const realSleep = ms => new Promise(ok => realSetTimeout(ok, ms));
