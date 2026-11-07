// Στοιχεία της επιχείρησης του τεχνίτη (μπαίνουν μία φορά) και αριθμός προσφοράς ανά συσκευή.
// Η αποθήκευση δεν σπάει ποτέ την εφαρμογή: ό,τι δεν διαβάζεται σωστά αγνοείται (όπως στο prices.js).

export const PROFILE = 'ergolav.profile';
export const COUNTER = 'ergolav.quoteNo';
// Λογότυπα: αποθηκεύονται ΜΙΑ φορά ({id: data URL}) και τα στοιχεία/το ιστορικό κρατούν μόνο το id, ώστε μια
// παλιά προσφορά να ξαναβγαίνει με το λογότυπο που είχε, χωρίς να γεμίζει η μνήμη της συσκευής.
export const LOGOS = 'ergolav.logos';
export const MAX_LOGOS = 5;
export const MAX_LOGO_CHARS = 400000;
const LOGO_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const LOGO_ID = /^[0-9a-f]{8}$/;

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const clean = (v, max = 80) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const digits = s => s.replace(/\D/g, '');

/** Έλεγχος πριν την αποθήκευση· {profile} ή {error, field}. Υποχρεωτικό μόνο το όνομα.
 *  ΑΦΜ δεν ζητείται ούτε κρατιέται (ούτε γράφεται στο PDF): ό,τι υπήρχε από παλιότερη έκδοση πετιέται. */
export function checkProfile(input){
  const p = {name: clean(input?.name), trade: clean(input?.trade), phone: clean(input?.phone, 30)};
  if(!p.name) return {error: 'Γράψε το όνομα της επιχείρησης ή το ονοματεπώνυμό σου.', field: 'name'};
  // Ό,τι γράφεται στο PDF του πελάτη δεν μπαίνει σιωπηλά λάθος.
  if(p.phone && (!/^[+\d\s().-]+$/.test(p.phone) || digits(p.phone).length < 10 || digits(p.phone).length > 15))
    return {error: 'Το τηλέφωνο θέλει 10 ψηφία (π.χ. 6912345678) — ή άφησέ το κενό.', field: 'phone'};
  // Λογότυπο: νέα εικόνα (data URL, ελέγχεται εδώ) ή id υπάρχοντος· οτιδήποτε άλλο αγνοείται.
  const logo = typeof input?.logo === 'string' ? input.logo : '';
  if(logo.startsWith('data:')){
    if(logo.length > MAX_LOGO_CHARS) return {error: 'Το λογότυπο είναι πολύ μεγάλο. Διάλεξε μικρότερη εικόνα.', field: 'logo'};
    if(!LOGO_URL.test(logo)) return {error: 'Το λογότυπο πρέπει να είναι εικόνα PNG ή JPEG.', field: 'logo'};
    p.logo = logo;
  } else if(LOGO_ID.test(logo)) p.logo = logo;
  return {profile: p};
}

/** Τα αποθηκευμένα στοιχεία, ή null (δεν υπάρχουν / χαλασμένα / χωρίς όνομα). */
export function loadProfile(){
  try {
    const raw = storage()?.getItem(PROFILE);
    if(!raw) return null;
    const r = checkProfile(JSON.parse(raw));
    // Παλιά αποθήκευση με ΑΦΜ: ξαναγράφεται χωρίς αυτό, ώστε να μη μένει στη συσκευή.
    if(r.profile && /"afm"/.test(raw)) try { storage().setItem(PROFILE, JSON.stringify(r.profile)); } catch {}
    // Στα αποθηκευμένα στοιχεία το λογότυπο είναι μόνο id που υπάρχει στη συσκευή.
    if(r.profile?.logo && !getLogo(r.profile.logo)) delete r.profile.logo;
    return r.profile ?? null;
  } catch { return null; }
}

/** Αποθηκεύει· {profile, saved} ή {error, field}. saved=false: δεκτά για αυτή τη χρήση, αλλά η συσκευή δεν τα κράτησε. */
// logoLost: η συσκευή δεν χώρεσε το λογότυπο — τα στοιχεία αποθηκεύτηκαν χωρίς αυτό (το λέει η οθόνη).
export function saveProfile(input){
  const r = checkProfile(input);
  if(r.error) return r;
  let logoLost = false;
  if(r.profile.logo?.startsWith('data:')){
    const id = rememberLogo(r.profile.logo);
    if(id) r.profile.logo = id; else { delete r.profile.logo; logoLost = true; }
  }
  try { storage().setItem(PROFILE, JSON.stringify(r.profile)); return {profile: r.profile, saved: true, ...(logoLost && {logoLost})}; }
  catch { return {profile: r.profile, saved: false, ...(logoLost && {logoLost})}; }
}

// ── Λογότυπα ──
const hash = s => { let h = 0x811c9dc5; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
function loadLogos(){
  try {
    const d = JSON.parse(storage()?.getItem(LOGOS) || '{}');
    if(!d || typeof d !== 'object' || Array.isArray(d)) return {};
    return Object.fromEntries(Object.entries(d).filter(([k, v]) => LOGO_ID.test(k) && typeof v?.url === 'string' && LOGO_URL.test(v.url) && Number.isFinite(v.at)));
  } catch { return {}; }
}
/** Το λογότυπο (data URL) με αυτό το id, ή '' αν δεν υπάρχει. */
export const getLogo = id => (LOGO_ID.test(id || '') && loadLogos()[id]?.url) || '';
/** Κρατά το λογότυπο (έως MAX_LOGOS, τα πιο πρόσφατα)· id, ή null αν η συσκευή δεν το χώρεσε. */
export function rememberLogo(url, now = Date.now()){
  if(typeof url !== 'string' || url.length > MAX_LOGO_CHARS || !LOGO_URL.test(url)) return null;
  const id = hash(url), all = loadLogos();
  all[id] = {url, at: now};
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_LOGOS);
  try { storage().setItem(LOGOS, JSON.stringify(Object.fromEntries(keep))); return id; } catch { return null; }
}

/** Αρχικά από τις δύο πρώτες λέξεις («Νίκος Παπαδάκης» → «ΝΠ»)· μία λέξη → τα δύο πρώτα γράμματα. */
export function initials(name){
  const words = clean(name).split(' ').map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const s = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '').slice(0, 2);
  return s.toLocaleUpperCase('el-GR').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Ο τελευταίος αριθμός που δόθηκε (0 αν κανένας ή χαλασμένος). */
export function lastQuoteNo(){
  try {
    const n = Number(storage()?.getItem(COUNTER));
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/** Δίνει τον επόμενο αριθμό προσφοράς (1, 2, 3…) και τον θυμάται. */
export function takeQuoteNo(){
  const n = lastQuoteNo() + 1;
  try { storage()?.setItem(COUNTER, String(n)); } catch { /* μένει μόνο για αυτή την προσφορά */ }
  return n;
}
