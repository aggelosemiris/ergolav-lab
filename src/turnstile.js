// Cloudflare Turnstile (δωρεάν CAPTCHA) για εγγραφή, σύνδεση με κωδικό, επαναφορά κωδικού και αποστολή κωδικών email.
// Φορτώνεται ΜΟΝΟ όταν ανοίγει οθόνη που το χρειάζεται και μόνο αν υπάρχει site key (src/config.js).
// Το secret key είναι ΜΟΝΟ στο Supabase.
// Αν δεν φορτώσει (μπλοκαρισμένο, χωρίς ίντερνετ), το «Συνέχεια με Google» δουλεύει κανονικά.
export const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const LOAD_TIMEOUT_MS = 10000;

let loading = null;
/** Το αντικείμενο window.turnstile· απορρίπτεται αν δεν φορτώσει σε LOAD_TIMEOUT_MS. */
export function loadTurnstile(win = globalThis, ms = LOAD_TIMEOUT_MS){
  if(win.turnstile?.render) return Promise.resolve(win.turnstile);
  if(loading) return loading;
  loading = new Promise((ok, fail) => {
    const s = win.document.createElement('script');
    const t = setTimeout(() => done(new Error('timeout')), ms);
    function done(e){ clearTimeout(t); if(e || !win.turnstile?.render){ loading = null; s.remove(); fail(e || new Error('load')); } else ok(win.turnstile); }
    s.src = SCRIPT; s.async = true; s.defer = true;
    s.onload = () => done();
    s.onerror = () => done(new Error('load'));
    win.document.head.appendChild(s);
  });
  return loading;
}

/**
 * Βάζει το widget στο container. onToken(token) σε κάθε νέο token· onReset() όταν το token λήγει ή χαλάει.
 * Επιστρέφει {token(), reset()}: κάθε token ισχύει για ΜΙΑ αποστολή, μετά reset().
 */
export function mountWidget(ts, container, siteKey, {onToken = () => {}, onReset = () => {}, onError = () => {}, action = 'auth'} = {}){
  let token = '';
  const id = ts.render(container, {
    sitekey: siteKey, language: 'el', size: 'flexible', appearance: 'interaction-only', action,
    callback: t => { token = t; onToken(t); },
    'expired-callback': () => { token = ''; onReset(); },
    'error-callback': () => { token = ''; onError(); return true; },
  });
  return {
    token: () => token,
    reset(){ token = ''; try { ts.reset(id); } catch {} onReset(); },
  };
}
