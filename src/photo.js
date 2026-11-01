// Φωτογραφία σημειώσεων → κείμενο (Google Gemini ή Claude, ανάλογα με το key). Το key μένει μόνο σε αυτή τη συσκευή.

// SDK από τον ίδιο τον server της εφαρμογής (όχι από CDN τρίτου): vendor/, MIT, έκδοση κλειδωμένη.
const SDK_URL = new URL('../vendor/anthropic-sdk-0.129.0.mjs', import.meta.url).href;
const KEY_STORE = 'ergolav.apiKey', OLD_KEY_STORE = 'ergolav.anthropicKey';

const PROMPT = `Αυτή είναι φωτογραφία με σημειώσεις τεχνίτη (υδραυλικός / ανακαινίσεις) για τα υλικά μιας δουλειάς — συχνά χειρόγραφες, στα ελληνικά.

Μετάγραψε τι γράφουν, μία γραμμή ανά υλικό, στη μορφή «ποσότητα μονάδα υλικό περιγραφή», π.χ.:
12 μέτρα σωλήνας πολυστρωματικός
1 τεμάχιο μπαταρία νιπτήρα
15 τετραγωνικά πλακάκι δαπέδου γκρι

- Ποσότητες με ψηφία. Μονάδες ολογράφως (μέτρα, τετραγωνικά, τεμάχια, σακιά).
- Κράτα κάθε χαρακτηριστικό που γράφει (χρώμα, διάσταση, «εντοιχισμού», «νιπτήρα» κ.λπ.).
- Αν στην αρχή γράφει τι δουλειά είναι (π.χ. «ανακαίνιση μπάνιου»), γράψ' το σε πρώτη γραμμή.
- Αγνόησε τιμές, τηλέφωνα, ονόματα και μουτζούρες.
- Αν μια λέξη δεν διαβάζεται, γράψε την πιο πιθανή ανάγνωση.
- Αν η φωτογραφία δεν έχει σημειώσεις υλικών, απάντησε μόνο: ΚΑΜΙΑ ΣΗΜΕΙΩΣΗ

Απάντησε μόνο με τις γραμμές, χωρίς τίποτα άλλο.`;

// ── Αποθήκευση key ──
// Εξ ορισμού το key μένει ΜΟΝΟ στη μνήμη της σελίδας (χάνεται με το κλείσιμο). Στο localStorage μπαίνει
// μόνο αν ο χρήστης το ζητήσει ρητά — και ποτέ σε κοινόχρηστο domain (π.χ. raw.githack.com), όπου
// οποιαδήποτε άλλη σελίδα του ίδιου domain θα μπορούσε να το διαβάσει.
// Κοινόχρηστα origins: όλα τα project pages ενός λογαριασμού GitHub μοιράζονται το <user>.github.io,
// οπότε κάθε άλλο repo του ίδιου λογαριασμού θα μπορούσε να διαβάσει το localStorage. «Θυμήσου» μόνο σε δικό σου domain.
const SHARED_HOSTS = /(^|\.)(raw\.githack\.com|rawcdn\.githack\.com|raw\.githubusercontent\.com|cdn\.jsdelivr\.net|github\.io|gitlab\.io|pages\.dev|netlify\.app|vercel\.app)$/;
export const canRememberKey = () => { try { return !SHARED_HOSTS.test(location.hostname); } catch { return false; } };
let memKey = '';
const store = {
  get(k){ try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v){ try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
};
// Παλιές εκδόσεις αποθήκευαν πάντα το key: σε κοινόχρηστο domain το σβήνουμε αμέσως.
if(store.get(OLD_KEY_STORE)){
  if(canRememberKey() && !store.get(KEY_STORE)) store.set(KEY_STORE, store.get(OLD_KEY_STORE));
  store.set(OLD_KEY_STORE, '');
}
if(!canRememberKey()) store.set(KEY_STORE, '');

export const getKey = () => memKey || (canRememberKey() ? store.get(KEY_STORE) : '');
export const isKeyRemembered = () => canRememberKey() && !!store.get(KEY_STORE);
// Η επικόλληση στο κινητό φέρνει συχνά κενά, αλλαγές γραμμής ή αόρατους χαρακτήρες.
export const cleanKey = k => (k || '').replace(/[\s\u200B-\u200D\u2060\uFEFF"'«»]/g, '');
export const setKey = (k, {remember = isKeyRemembered()} = {}) => {
  k = cleanKey(k);
  // Αν επικολλήθηκε μαζί με άλλο κείμενο (π.χ. «API key: AIza…»), κρατάμε μόνο το κλειδί.
  k = (k.match(/AIza[0-9A-Za-z_-]{35}/) || k.match(/sk-ant-[0-9A-Za-z_-]+/) || [k])[0];
  memKey = k;
  store.set(KEY_STORE, k && remember && canRememberKey() ? k : '');
};
export const forgetKey = () => { memKey = ''; store.set(KEY_STORE, ''); store.set(OLD_KEY_STORE, ''); };
export const keyProvider = k => !k ? '' : k.startsWith('sk-ant-') ? 'anthropic' : 'google';

/** Μικραίνει τη φωτογραφία (μεγάλη πλευρά ≤ 1568px) και τη δίνει ως base64 JPEG. */
export async function shrink(file){
  const bmp = await createImageBitmap(file, {imageOrientation: 'from-image'}).catch(() => null);
  const img = bmp || await new Promise((ok, fail) => {
    const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = URL.createObjectURL(file);
  });
  const w = img.width, h = img.height, k = Math.min(1, 1568 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return {url, data: url.split(',')[1]};
}

let clientPromise = null;
async function client(apiKey){
  if(!clientPromise) clientPromise = import(SDK_URL).catch(e => { clientPromise = null; throw e; });
  const { default: Anthropic } = await clientPromise;
  // timeout 45s και 2 retries (το SDK τηρεί μόνο του το Retry-After και κάνει εκθετικό backoff)
  return {Anthropic, api: new Anthropic({apiKey, dangerouslyAllowBrowser: true, timeout: 45000, maxRetries: 2})};
}

// Μόνο τα κλειδιά Anthropic έχουν σταθερό πρόθεμα· οτιδήποτε άλλο το δοκιμάζουμε στη Google.
const isGoogleKey = k => !k.startsWith('sk-ant-');

/**
 * Επιστρέφει το κείμενο των σημειώσεων ή ρίχνει Error με ελληνικό μήνυμα.
 * onStatus(msg): πρόοδος (π.χ. «ξαναδοκιμάζω»). onWarning(msg): το κείμενο ήρθε αλλά ίσως ελλιπές.
 */
export async function readNotes(base64, {apiKey = getKey(), onStatus, onWarning} = {}){
  if(!apiKey) throw new Error('NO_KEY');
  const text = isGoogleKey(apiKey) ? await readWithGemini(base64, apiKey, onStatus, onWarning) : await readWithClaude(base64, apiKey, onWarning);
  // «Δεν υπάρχουν σημειώσεις» μόνο αν ΟΛΗ η απάντηση είναι αυτή — όχι αν η φράση εμφανίζεται κάπου μέσα
  // (π.χ. γραμμένη στη φωτογραφία), ώστε κείμενο της φωτογραφίας να μην ακυρώνει την ανάγνωση.
  const lines = (text || '').split('\n').filter(l => !/^\s*ΚΑΜΙΑ ΣΗΜΕΙΩΣΗ\.?\s*$/i.test(l));
  if(!lines.join('').trim()){
    if(/ΚΑΜΙΑ ΣΗΜΕΙΩΣΗ/i.test(text || '')) throw new Error('Δεν βρήκα σημειώσεις υλικών στη φωτογραφία.');
    throw new Error('Η υπηρεσία ανάγνωσης δεν επέστρεψε κείμενο. Δοκίμασε ξανά.');
  }
  return lines.join('\n').trim();
}

// Google Gemini (δωρεάν επίπεδο με όρια — στο δωρεάν επίπεδο η Google μπορεί να κρατά τα δεδομένα για βελτίωση).
// Πολιτική κλήσεων:
//  - timeout 20s ανά κλήση και 45s συνολικά (η οθόνη δεν κολλάει ποτέ)
//  - 404 → το μοντέλο δεν υπάρχει, επόμενο· 5xx / άκυρη απάντηση / timeout → επόμενο μοντέλο
//  - 429 → το μοντέλο «κλειδώνει» μέχρι να περάσει το Retry-After (τα όρια μετράνε ανά μοντέλο)
//  - όταν δεν μένει διαθέσιμο μοντέλο: αναμονή με εκθετικό backoff + jitter, ή όσο λέει το Retry-After
//  - παροδικό σφάλμα δικτύου → 1 επανάληψη· συνολικά το πολύ 10 κλήσεις ανά φωτογραφία
//  - τα «κλειδωμένα» (429) και τα ανύπαρκτα (404) μοντέλα θυμούνται για όλη τη συνεδρία, ώστε η επόμενη
//    φωτογραφία να μην ξαναχτυπήσει μοντέλο που μόλις είπε «όριο»
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const CALL_TIMEOUT = 20000, TOTAL_BUDGET = 45000, MAX_CALLS = 10, MAX_RATE_WAIT = 20000;
const lockedUntil = {}, gone = new Set();           // κοινά για όλες τις αναγνώσεις της συνεδρίας
const BACKOFF = [2000, 5000];                           // ms, ±30% jitter
const jitter = ms => Math.round(ms * (0.7 + Math.random() * 0.6));
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const mask = k => `${k.slice(0, 6)}…${k.slice(-4)} (${k.length} χαρακτήρες)`;

function retryAfterMs(r){
  const v = r.headers?.get?.('retry-after');
  if(!v) return null;
  const sec = Number(v);
  if(Number.isFinite(sec)) return sec * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** Μία κλήση με timeout. Επιστρέφει {kind, status, body, retryAfter} — ποτέ δεν ρίχνει. */
async function callGemini(model, apiKey, base64, timeoutMs){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: ctl.signal,
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
      body: JSON.stringify({contents: [{parts: [
        {inline_data: {mime_type: 'image/jpeg', data: base64}},
        {text: PROMPT},
      ]}]}),
    });
    let body = null;
    try { body = await r.json(); } catch { if(r.ok) return {kind: 'bad', status: r.status}; body = {}; }
    if(r.ok) return {kind: 'ok', status: r.status, body};
    return {kind: 'http', status: r.status, body, retryAfter: retryAfterMs(r)};
  } catch {
    return ctl.signal.aborted ? {kind: 'timeout'} : {kind: 'network'};
  } finally {
    clearTimeout(timer);
  }
}

async function readWithGemini(base64, apiKey, onStatus, onWarning){
  // Κομμένο/κρυμμένο αντίγραφο (π.χ. «AIzaSy…••••Xyz9»): δεν αξίζει να το στείλουμε.
  if(apiKey.length < 30 || /[…•*·]|\.\.\./.test(apiKey)){
    setKey('');
    throw new Error(`Αυτό μοιάζει με κομμένο αντίγραφο του key: ${mask(apiKey)}. Τα κλειδιά Google έχουν ~39 χαρακτήρες ` +
      'και ξεκινούν με AIza. Στο AI Studio πάτα το εικονίδιο αντιγραφής δίπλα στο key — όχι το κείμενο με τις τελείες.');
  }
  const start = Date.now();
  const triedThisRound = new Set();
  let calls = 0, round = 0, netRetries = 0, last = null;

  while(calls < MAX_CALLS){
    const now = Date.now(), remaining = TOTAL_BUDGET - (now - start);
    if(remaining <= 0) break;
    const model = GEMINI_MODELS.find(m => !gone.has(m) && !triedThisRound.has(m) && !((lockedUntil[m] ?? 0) > now));
    if(!model){
      const alive = GEMINI_MODELS.filter(m => !gone.has(m));
      if(!alive.length) break;                                                    // κανένα μοντέλο δεν υπάρχει
      // Αναμονή: μέχρι να ξεκλειδώσει το πρώτο μοντέλο (Retry-After), αλλιώς εκθετικό backoff.
      const unlock = Math.min(...alive.map(m => lockedUntil[m] ?? Infinity)) - now;
      const allLocked = alive.every(m => (lockedUntil[m] ?? 0) > now);
      const wait = allLocked ? unlock : (round < BACKOFF.length ? jitter(BACKOFF[round]) : Infinity);
      if(wait > remaining || (allLocked && wait > MAX_RATE_WAIT)) break;
      onStatus?.(allLocked ? `Όριο της Google — περιμένω ${Math.ceil(wait / 1000)} δευτ.…` : `Η Google είναι φορτωμένη — ξαναδοκιμάζω (${round + 1}/${BACKOFF.length})…`);
      await sleep(wait);
      round++; triedThisRound.clear();
      continue;
    }
    triedThisRound.add(model);
    calls++;
    const res = await callGemini(model, apiKey, base64, Math.min(CALL_TIMEOUT, remaining));
    if(res.kind === 'ok'){
      const out = geminiText(res.body, onWarning);
      if(out != null) return out;
      last = {kind: 'bad'};                                                       // 200 χωρίς χρήσιμο περιεχόμενο → επόμενο μοντέλο
      continue;
    }
    last = res;
    if(res.kind === 'network'){
      if(netRetries++ < 1){ await sleep(jitter(1500)); triedThisRound.delete(model); continue; }
      break;                                                                      // δεύτερη αποτυχία δικτύου: δεν υπάρχει σύνδεση
    }
    if(res.kind === 'timeout' || res.kind === 'bad') continue;
    if(res.status === 404){ gone.add(model); continue; }
    if(res.status === 429){ lockedUntil[model] = Date.now() + (res.retryAfter ?? 20000); continue; }
    if(res.status >= 500) continue;
    break;                                                                        // 400/401/403 κ.λπ.: δεν λύνεται με επανάληψη
  }
  throw geminiError(last, apiKey, lockedUntil);
}

/** Κείμενο από επιτυχημένη απάντηση· null αν η δομή δεν είναι έγκυρη. Ρίχνει μόνο για άρνηση περιεχομένου. */
function geminiText(body, onWarning){
  const cand = Array.isArray(body?.candidates) ? body.candidates[0] : null;
  if(!cand){
    if(body?.promptFeedback?.blockReason) throw new Error('Η φωτογραφία δεν μπόρεσε να διαβαστεί (απορρίφθηκε από την υπηρεσία).');
    return null;
  }
  if(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(cand.finishReason))
    throw new Error('Η φωτογραφία δεν μπόρεσε να διαβαστεί (απορρίφθηκε από την υπηρεσία).');
  const parts = Array.isArray(cand.content?.parts) ? cand.content.parts : [];
  const text = parts.map(p => typeof p?.text === 'string' ? p.text : '').join('\n').trim();
  if(!text) return null;
  if(cand.finishReason === 'MAX_TOKENS') onWarning?.('Η ανάγνωση κόπηκε πριν τελειώσει — μπορεί να λείπουν υλικά από το τέλος της λίστας. Έλεγξε τη φωτογραφία.');
  return text;
}

function geminiError(last, apiKey, lockedUntil){
  if(!last){
    // Δεν έγινε καμία κλήση: όλα τα μοντέλα ήταν ήδη ανύπαρκτα ή κλειδωμένα από προηγούμενη ανάγνωση.
    if(GEMINI_MODELS.every(m => gone.has(m))) return new Error('Κανένα μοντέλο της Google δεν είναι διαθέσιμο αυτή τη στιγμή (404). Δοκίμασε αργότερα.');
    if(GEMINI_MODELS.some(m => (lockedUntil[m] ?? 0) > Date.now())) last = {status: 429, body: {}};
    else return new Error('Η Google άργησε πολύ να απαντήσει. Δοκίμασε ξανά σε λίγο.');
  }
  if(last.kind === 'network') return new Error('Δεν υπάρχει σύνδεση στο internet.');
  if(last.kind === 'timeout') return new Error('Η Google άργησε πολύ να απαντήσει. Δοκίμασε ξανά σε λίγο.');
  if(last.kind === 'bad') return new Error('Η υπηρεσία ανάγνωσης απάντησε κάτι απρόσμενο. Δοκίμασε ξανά σε λίγο.');
  const r = last, err = r.body?.error || {};
  const reason = err.details?.find(d => d.reason)?.reason || err.status || '';
  const google = err.message ? ` Η Google λέει: «${err.message}»` : '';
  if(reason === 'API_KEY_INVALID'){
    setKey('');
    return new Error(`Η Google δεν αναγνωρίζει το key ${mask(apiKey)}. Φτιάξε/αντέγραψε νέο από το aistudio.google.com/apikey.`);
  }
  if(reason === 'SERVICE_DISABLED' || /has not been used|is disabled/i.test(err.message || ''))
    return new Error('Το key είναι από project όπου δεν είναι ενεργό το Gemini API. Φτιάξε key από το aistudio.google.com/apikey.' + google);
  if(reason === 'API_KEY_HTTP_REFERRER_BLOCKED' || reason === 'API_KEY_SERVICE_BLOCKED' || r.status === 403)
    return new Error('Το key έχει περιορισμούς (sites/APIs) που μπλοκάρουν αυτή τη σελίδα. Βγάλε τους περιορισμούς ή φτιάξε νέο key.' + google);
  if(r.status === 429){
    const wait = Math.min(...GEMINI_MODELS.filter(m => !gone.has(m)).map(m => lockedUntil[m] ?? Infinity)) - Date.now();
    const sec = Math.ceil(wait / 1000);
    const when = Number.isFinite(wait) && wait > 0 ? `σε ${sec} ${sec === 1 ? 'δευτερόλεπτο' : 'δευτερόλεπτα'}` : 'σε λίγο';
    return new Error(`Έφτασες το όριο της Google. Δοκίμασε ξανά ${when}.`);
  }
  if(r.status >= 500) return new Error('Οι servers της Google είναι φορτωμένοι αυτή τη στιγμή — δεν φταίει το key σου. Δοκίμασε ξανά σε λίγα λεπτά.');
  if(/location is not supported/i.test(err.message || '')) return new Error('Η Google δεν δίνει το δωρεάν Gemini API σε αυτή τη χώρα.' + google);
  return new Error(`Η ανάγνωση απέτυχε (${r.status}).` + google);
}

// Μεταγραφή σημειώσεων: Sonnet 5.5 (~μισό κόστος από Opus 5.5). Όχι Haiku 4.5: δεν δέχεται «effort»
// και διαβάζει χειρόγραφα λιγότερο καλά. Παράμετροι ελεγμένες με type-check στο SDK 0.129.0.
const CLAUDE_MODEL = 'claude-sonnet-5-5';
async function readWithClaude(base64, apiKey, onWarning){
  let Anthropic, api;
  try { ({Anthropic, api} = await client(apiKey)); }
  catch { throw new Error('Δεν φόρτωσε η υπηρεσία ανάγνωσης. Έλεγξε τη σύνδεση.'); }

  let res;
  try {
    res = await api.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      output_config: {effort: 'low'},
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{role: 'user', content: [
        {type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: base64}},
        {type: 'text', text: PROMPT},
      ]}],
    });
  } catch (e) {
    if(e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError){
      setKey('');
      throw new Error(`Η Anthropic δεν δέχτηκε το key ${mask(apiKey)}. Βάλε το ξανά.`);
    }
    if(e instanceof Anthropic.RateLimitError) throw new Error('Πολλά αιτήματα μαζί. Δοκίμασε σε λίγο.');
    if(e instanceof Anthropic.APIConnectionTimeoutError) throw new Error('Η υπηρεσία άργησε πολύ να απαντήσει. Δοκίμασε ξανά σε λίγο.');
    if(e instanceof Anthropic.APIConnectionError) throw new Error('Δεν υπάρχει σύνδεση στο internet.');
    if(e instanceof Anthropic.APIError) throw new Error(`Η ανάγνωση απέτυχε (${e.status ?? 'σφάλμα'}).`);
    throw new Error('Η ανάγνωση απέτυχε.');
  }

  if(res.stop_reason === 'refusal') throw new Error('Η φωτογραφία δεν μπόρεσε να διαβαστεί.');
  if(res.stop_reason === 'max_tokens') onWarning?.('Η ανάγνωση κόπηκε πριν τελειώσει — μπορεί να λείπουν υλικά από το τέλος της λίστας. Έλεγξε τη φωτογραφία.');
  return (Array.isArray(res.content) ? res.content : []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}
