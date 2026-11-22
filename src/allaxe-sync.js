// Συγχρονισμός του «Άλλαξέ το» με τον λογαριασμό (Supabase), μόνο με ALLAXE_BOT_ENABLED και μόνο όταν υπάρχει
// σύνδεση: κανόνες (user_rules) και βιβλιοθήκη (user_analyses) — η πιο πρόσφατη αλλαγή κερδίζει, και στα σβησίματα —,
// η ουρά της λίστας ομάδας (bump_missing_item) και οι ανώνυμες μετρήσεις (bot_metrics, μόνο εισαγωγή).
// Χωρίς λογαριασμό ή ίντερνετ: τίποτα δεν αλλάζει, όλα μένουν στη συσκευή και στέλνονται αργότερα.
import * as S from './allaxe-store.js';

/** Τα τοπικά, σε μορφή {κλειδί: {value, updated}} ανά πίνακα· value null = σβήστηκε. */
export function localEntries(){
  const del = S.deletedAt(), rules = {}, analyses = {};
  for(const [m, r] of Object.entries(S.caseRules())) rules[`case:${m}`] = {value: {answers: r.answers, label: r.label}, updated: r.created};
  for(const [k, r] of Object.entries(S.editRules())) rules[`edit:${k}`] = {value: {ops: r.ops, label: r.label}, updated: r.created};
  if(S.speechRule()) rules.speech = {value: S.speechRule(), updated: S.speechRuleAt()};
  for(const [k, e] of Object.entries(S.library())) analyses[k] = {value: e, updated: e.updated || 0};
  for(const [k, at] of Object.entries(del)){
    if(k.startsWith('rule:')){ const key = k.slice(5); if(!rules[key] || rules[key].updated < at) rules[key] = {value: null, updated: at}; }
    if(k.startsWith('analysis:')){ const key = k.slice(9); if(!analyses[key] || analyses[key].updated < at) analyses[key] = {value: null, updated: at}; }
  }
  return {user_rules: rules, user_analyses: analyses};
}

/** Η πιο πρόσφατη αλλαγή κερδίζει: ποια πάνε στη συσκευή και ποια στον λογαριασμό. Ίδια ώρα = τίποτα. */
export function mergeEntries(local, remote){
  const toLocal = [], toRemote = [];
  for(const key of new Set([...Object.keys(local), ...Object.keys(remote)])){
    const l = local[key], r = remote[key];
    if(!r || (l && l.updated > r.updated)) toRemote.push([key, l]);
    else if(!l || r.updated > l.updated) toLocal.push([key, r]);
  }
  return {toLocal, toRemote};
}

/** Γράφει στη συσκευή μια αλλαγή που ήρθε από τον λογαριασμό, με την ώρα της. */
export function applyLocal(table, key, {value, updated}){
  if(table === 'user_analyses'){
    if(value === null) return S.removeLibrary(key, updated);
    return S.saveLibrary(value.name, value, updated);
  }
  if(key === 'speech') return value === null ? S.removeSpeechRule(updated) : S.setSpeechRule(value, updated);
  if(key.startsWith('case:')){ const m = key.slice(5); return value === null ? S.removeCaseRule(m, updated) : S.setCaseRule(m, value.answers, value.label, updated); }
  if(key.startsWith('edit:')){ const k = key.slice(5); return value === null ? S.removeEditRule(k, updated) : S.setEditRule(k, value.ops, value.label, updated); }
  return false;
}

export const METRICS_SENT = 'ergolav.botMetricsSent';
const sentCursor = () => { try { return Number(globalThis.localStorage?.getItem(METRICS_SENT)) || 0; } catch { return 0; } };
const setCursor = t => { try { globalThis.localStorage?.setItem(METRICS_SENT, String(t)); } catch {} };

/**
 * Ένας γύρος συγχρονισμού. db: {client, userId} (ο client του Supabase από τον λογαριασμό).
 * Επιστρέφει {pulled, pushed, missing, metrics}· ρίχνει μόνο σφάλματα δικτύου/βάσης (ο καλών τα αγνοεί).
 */
export async function syncAll({client, userId}){
  const out = {pulled: 0, pushed: 0, missing: 0, metrics: 0};
  const local = localEntries();
  for(const table of ['user_rules', 'user_analyses']){
    const {data, error} = await client.from(table).select('key,value,updated_at');
    if(error) throw error;
    const remote = Object.fromEntries((data || []).map(r => [r.key, {value: r.value, updated: Date.parse(r.updated_at) || 0}]));
    const {toLocal, toRemote} = mergeEntries(local[table], remote);
    for(const [key, e] of toLocal){ applyLocal(table, key, e); out.pulled++; }
    if(toRemote.length){
      const rows = toRemote.map(([key, e]) => ({user_id: userId, key, value: e.value, updated_at: new Date(e.updated).toISOString()}));
      const {error: e2} = await client.from(table).upsert(rows, {onConflict: 'user_id,key'});
      if(e2) throw e2;
      out.pushed += rows.length;
    }
  }
  // Λίστα ομάδας: ένα-ένα, με τη σειρά· ό,τι στάλθηκε φεύγει από την ουρά.
  const q = S.missingQueue().slice(0, 50);
  let sent = 0;
  for(const it of q){
    const {error} = await client.rpc('bump_missing_item', {p_name: it.name, p_category: it.category});
    if(error && !/invalid name/.test(error.message || '')) break;
    sent++;
  }
  if(sent) S.dropMissing(sent);
  out.missing = sent;
  // Μετρήσεις: όσες δεν έχουν σταλεί, χωρίς την ώρα της συσκευής πέρα από το πεδίο t.
  const cur = sentCursor(), fresh = S.metrics().filter(m => m.t > cur).slice(0, 200);
  if(fresh.length){
    const {error} = await client.from('bot_metrics').insert(fresh.map(event => ({event})));
    if(error) throw error;
    setCursor(fresh.at(-1).t);
    out.metrics = fresh.length;
  }
  return out;
}

/** Συγχρονισμός στο παρασκήνιο, το πολύ μία φορά το λεπτό· σφάλματα αγνοούνται (ξαναδοκιμάζει την επόμενη φορά). */
export const SYNC_TIMEOUT_MS = 30000;
const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(no, ms); })]).finally(() => clearTimeout(t)); };
export function createSync(getDb, {every = 60000, now = () => Date.now()} = {}){
  let last = 0, running = null;
  return async function run(force = false){
    if(running || (!force && now() - last < every)) return running;
    last = now();
    running = (async () => {
      // Χρονικό όριο: με κακό σήμα ένα αίτημα μπορεί να κρέμεται· τότε ο επόμενος γύρος ξεκινά κανονικά.
      try { const db = await getDb?.(); return db ? await withTimeout(syncAll(db), SYNC_TIMEOUT_MS) : null; }
      catch { return null; }
      finally { running = null; }
    })();
    return running;
  };
}
