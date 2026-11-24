// «Τιμές από τεχνικούς» (σχέδιο: docs/technician-prices.md) — μόνο με TECH_PRICES_ENABLED. Χωρίς AI.
// Στέλνεται ΜΟΝΟ: παραλλαγή της λίστας υλικών, μονάδα, τιμή ανά μονάδα (χωρίς ΦΠΑ). Ο μήνας, η περιφέρεια (αν τη δήλωσε) και το
// ψευδώνυμο μπαίνουν στον server (submit_tech_price). Ποτέ πελάτης, όνομα, προσφορά ή user id από την εφαρμογή.
// Τίποτα δεν φεύγει χωρίς ρητή συγκατάθεση· η ανάκληση σβήνει όλες τις τιμές του τεχνικού (set_tech_prices_consent(false)).
import { clean, stemsOf, attributes } from './price-match.js';

export const STORE = 'ergolav.techPrices';
export const CONSENT_VERSION = 1;
export const ASK_AFTER_KEEPS = 2;           // ρωτάμε τη 2η φορά που κρατά δική του τιμή σε υλικό της λίστας
export const ASK_AGAIN_DAYS = 90;           // «Όχι τώρα» → ξανά το νωρίτερο μετά από τόσες ημέρες
export const MAX_QUEUE = 200;
const DAY = 86400e3;

/** Οι 13 περιφέρειες (ISO 3166-2:GR). */
export const REGIONS = [['GR-I', 'Αττική'], ['GR-B', 'Κεντρική Μακεδονία'], ['GR-A', 'Ανατολική Μακεδονία και Θράκη'],
  ['GR-C', 'Δυτική Μακεδονία'], ['GR-D', 'Ήπειρος'], ['GR-E', 'Θεσσαλία'], ['GR-F', 'Ιόνια Νησιά'], ['GR-G', 'Δυτική Ελλάδα'],
  ['GR-H', 'Στερεά Ελλάδα'], ['GR-J', 'Πελοπόννησος'], ['GR-K', 'Βόρειο Αιγαίο'], ['GR-L', 'Νότιο Αιγαίο'], ['GR-M', 'Κρήτη']];
export const regionName = code => REGIONS.find(r => r[0] === code)?.[1] ?? null;
export const BAND_TEXT = {'5-9': '5–9 τεχνικοί', '10-19': '10–19 τεχνικοί', '20+': '20+ τεχνικοί'};

export const CONSENT_TEXT = {
  title: 'Μοιράσου ανώνυμα τις τιμές σου;',
  body: 'Όταν βάζεις δική σου τιμή σε υλικό της λίστας, στέλνουμε μόνο το υλικό, την τιμή ανά μονάδα, τον μήνα και — αν θέλεις — ' +
    'την περιφέρειά σου. Ποτέ πελάτη, όνομα ή προσφορά. Οι τιμές φαίνονται μόνο ως μέση τιμή από 5 ή περισσότερους τεχνικούς. ' +
    'Το αλλάζεις όποτε θέλεις στον λογαριασμό σου· αν το κλείσεις, σβήνονται όλες οι τιμές που έστειλες.',
};

// ── κατάσταση στη συσκευή (καμία προσωπική πληροφορία: μόνο κλειδιά παραλλαγών και τιμές) ──
const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export function load(){
  try { const v = JSON.parse(storage()?.getItem(STORE) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function save(s){ try { storage()?.setItem(STORE, JSON.stringify(s)); return true; } catch { return false; } }

// ── αντιστοίχιση γραμμής → παραλλαγή (ίδιοι κανόνες με src/material-prices.js) ──
/**
 * keys: src/material-keys.json · text: όνομα/φράση της γραμμής · unit: μονάδα της γραμμής (πρέπει να είναι ίδια).
 * Επιστρέφει το κλειδί ή null. Δύο εξίσου πιθανές παραλλαγές → null (καμία αποστολή με αβεβαιότητα).
 */
export function matchVariant(keys, text, unit){
  if(!Array.isArray(keys?.rows) || !text) return null;
  const t = clean(text), w = stemsOf(t), at = attributes(t, true);
  const has = r => w.some(s => s === r || (r.length >= 3 && s.startsWith(r) && s.length - r.length <= 3));
  let best = null, tie = false;
  for(const [key, u, all, allAlt, must, attrs, nums] of keys.rows){
    if(unit && u !== unit) continue;
    if(!(all.every(has) || allAlt.some(a => a.every(has))) || !must.every(has)) continue;
    if(!Object.entries(attrs).every(([k, v]) => at[k]?.length === 1 && at[k][0] === v)) continue;
    if(!(nums || []).every(x => new RegExp(`(?<![\\d.a-zα-ω])${x.replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(t))) continue;
    const score = Object.keys(attrs).length * 10 + must.length + (nums || []).length;
    if(!best || score > best.score){ best = {key, score}; tie = false; } else if(score === best.score) tie = true;
  }
  return best && !tie ? best.key : null;
}

// ── συγκατάθεση ──
/** Πρέπει να ρωτήσουμε τώρα; (συνδεδεμένος, δεν έχει απαντήσει, 2η «δική μου τιμή», όχι «Όχι τώρα» τις τελευταίες 90 ημέρες) */
export function shouldAsk(s, now = Date.now()){
  return s.consent == null && (s.keeps || 0) >= ASK_AFTER_KEEPS && !(s.declinedAt && now - s.declinedAt < ASK_AGAIN_DAYS * DAY);
}
export const decline = (now = Date.now()) => save({...load(), declinedAt: now});
/** Διαβάζει τη συγκατάθεση από τον λογαριασμό (η αλήθεια είναι εκεί· η συσκευή κρατά αντίγραφο). */
export async function pullConsent({client}){
  const {data, error} = await client.from('tech_price_consent').select('version,region').maybeSingle();
  if(error) throw error;
  const s = load();
  save({...s, consent: data ? data.version >= CONSENT_VERSION : (s.consent === false ? false : null), region: data?.region ?? null});
  return data;
}
/** Ναι (με περιφέρεια ή χωρίς) / όχι. Το «όχι» σβήνει στον server ΟΛΕΣ τις τιμές του και αδειάζει την ουρά. */
export async function setConsent({client}, on, region = null){
  const {error} = await client.rpc('set_tech_prices_consent', {p_consent: !!on, p_version: CONSENT_VERSION, p_region: on ? region : null});
  if(error) throw error;
  const s = load();
  save({...s, consent: !!on, region: on ? region : null, queue: on ? (s.queue || []) : []});
}

// ── αποστολή (με ουρά όταν δεν υπάρχει σήμα· μία ανά παραλλαγή, η νεότερη) ──
export function enqueue(key, unit, cents){
  const s = load();
  if(s.consent !== true || !key || !(Number.isInteger(cents) && cents > 0 && cents <= 1e8)) return false;
  const queue = (s.queue || []).filter(q => q.key !== key);
  queue.push({key, unit, cents});
  return save({...s, queue: queue.slice(-MAX_QUEUE)});
}
export const noteKeep = () => { const s = load(); return save({...s, keeps: (s.keeps || 0) + 1}); };
/** Στέλνει την ουρά. Ό,τι απορρίπτεται οριστικά (άγνωστη παραλλαγή, άλλη μονάδα…) φεύγει· σφάλμα δικτύου → μένει. */
export async function flush({client}){
  const s = load();
  if(s.consent !== true) return 0;
  let sent = 0;
  const left = [];
  for(const q of s.queue || []){
    const {data, error} = await client.rpc('submit_tech_price', {p_key: q.key, p_unit: q.unit, p_price_cents: q.cents});
    if(error){ left.push(q); continue; }
    if(data === 'ok') sent++;
    if(data === 'no-consent'){ save({...load(), consent: null, queue: []}); return sent; }
  }
  save({...load(), queue: left});
  return sent;
}

// ── αποτελέσματα: διάμεσοι με ≥ 5 τεχνικούς (μόνο συνδεδεμένοι) ──
export async function pullStats({client}, now = Date.now()){
  const {data, error} = await client.from('tech_price_stats').select('variant_key,region,median_cents,band,period_to').limit(5000);
  if(error) throw error;
  const byKey = {};
  for(const r of data || []) (byKey[r.variant_key] ??= {})[r.region] = [r.median_cents, r.band, r.period_to];
  save({...load(), stats: {at: now, byKey}});
  return (data || []).length;
}
/** Η τιμή για μια παραλλαγή: της περιφέρειάς του αν υπάρχει (≥ 5 εκεί), αλλιώς πανελλαδικά. */
export function statFor(key, s = load()){
  const r = s.stats?.byKey?.[key];
  if(!r) return null;
  const own = s.region && r[s.region], row = own || r.GR;
  if(!row) return null;
  return {cents: row[0], band: row[1], at: Date.parse(row[2]), region: own ? s.region : null};
}
/** Στην αποσύνδεση: τα αποτελέσματα φεύγουν από τη συσκευή (δεν τα βλέπουν όσοι δεν έχουν λογαριασμό). */
export const forgetStats = () => { const s = load(); delete s.stats; return save(s); };
