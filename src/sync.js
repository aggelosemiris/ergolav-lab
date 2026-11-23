// Συγχρονισμός των προσφορών με τον λογαριασμό (Supabase, πίνακας quotes). Βλ. docs/sync.md.
//
// Πρώτα τοπικά: η οθόνη διαβάζει ΠΑΝΤΑ το localStorage (src/history.js). Εδώ, στο παρασκήνιο:
// - pull: ό,τι άλλαξε στον λογαριασμό μετά τον τελευταίο γύρο (με βάση το synced_at του server), και
// - push: ό,τι άλλαξε στη συσκευή (updated) ή σβήστηκε (deleted_at — ποτέ πραγματική διαγραφή).
// Σύγκρουση: κερδίζει το νεότερο updated_at (και στη συσκευή, applyRemote, και στον server, με trigger).
// Χωρίς σήμα: τίποτα (καμία κλήση, κανένα μήνυμα σφάλματος)· ξαναδοκιμάζει στο άνοιγμα, όταν γυρίσει το σήμα και όταν
// ο τεχνίτης ξαναγυρίσει στην εφαρμογή. Ό,τι έρχεται από τον server είναι μη αξιόπιστο: περνά από το clean().
//
// Κάθε προσφορά ανήκει σε έναν λογαριασμό (OWNERS): προσφορές άλλου χρήστη της ίδιας συσκευής δεν ανεβαίνουν ποτέ
// σε λάθος λογαριασμό. Όσες δεν ανήκουν σε κανέναν (φτιάχτηκαν πριν από τον συγχρονισμό) τις παίρνει ο πρώτος που
// συγχρονίζει σε αυτή τη συσκευή: «πρώτη σύνδεση με τοπικές προσφορές → ανεβαίνουν», χωρίς διπλότυπα (ίδιο id).
import { listQuotes, listDeleted, clearDeleted, applyRemote, UUID, STORE, DELETED } from './history.js';
import { lastQuoteNo, COUNTER } from './profile.js';

export const STATE = 'ergolav.sync.quotes';     // {[userId]: {cursor, pushed: {id: updated}}}
export const OWNERS = 'ergolav.sync.owners';    // {id: userId}
export const PAGE = 500;
export const CHUNK = 200;
export const SYNC_TIMEOUT_MS = 30000;
export const EPOCH = '1970-01-01T00:00:00+00:00';

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
function readJson(key){ try { const v = JSON.parse(storage()?.getItem(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
function writeJson(key, v){ try { storage()?.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }

function userState(uid){
  const all = readJson(STATE), s = all[uid] || {};
  return {cursor: typeof s.cursor === 'string' ? s.cursor : EPOCH, pushed: s.pushed && typeof s.pushed === 'object' ? s.pushed : {}};
}
function saveUserState(uid, s){ const all = readJson(STATE); all[uid] = s; writeJson(STATE, all); }
export const owners = () => readJson(OWNERS);
function setOwners(ids, uid){
  if(!ids.length) return;
  const o = owners();
  for(const id of ids) o[id] = uid;
  writeJson(OWNERS, o);
}

/** Η προσφορά (με αυτό το id) ανήκει πλέον σε αυτόν τον λογαριασμό, αν δεν ανήκε σε κανέναν. */
export function claim(id, uid){
  if(!uid || typeof id !== 'string' || !UUID.test(id)) return;
  const o = owners();
  if(!o[id]){ o[id] = uid; writeJson(OWNERS, o); }
}

const iso = ms => new Date(ms).toISOString();
const stamp = q => q.updated || q.at;
// Ό,τι μπαίνει στο data: η προσφορά χωρίς τα πεδία της γραμμής (id, updated).
const payload = ({id, updated, ...q}) => q;

/** Τι περιμένει να ανέβει για αυτόν τον χρήστη: {quotes, deleted}. */
export function pending(uid){
  const {pushed} = userState(uid), o = owners();
  const mine = id => !o[id] || o[id] === uid;
  return {
    quotes: listQuotes().filter(q => q.id && mine(q.id) && !(pushed[q.id] >= stamp(q))),
    deleted: listDeleted().filter(d => o[d.id] === uid && !(pushed[d.id] >= d.at)),
  };
}
export const pendingCount = uid => { const p = pending(uid); return p.quotes.length + p.deleted.length; };

/**
 * Ένας γύρος: πρώτα pull, μετά push. db: {client, userId}. Επιστρέφει {pulled, pushed, deleted};
 * ρίχνει μόνο σφάλματα δικτύου/βάσης (ο καλών τα αγνοεί και ξαναδοκιμάζει αργότερα).
 */
export async function syncQuotes({client, userId}){
  const out = {pulled: 0, pushed: 0, deleted: 0};
  // ── pull ──
  const st = userState(userId);
  for(let guard = 0; guard < 100; guard++){
    const {data, error} = await client.from('quotes').select('id,data,updated_at,deleted_at,synced_at')
      .eq('user_id', userId).gte('synced_at', st.cursor).order('synced_at', {ascending: true}).limit(PAGE);
    if(error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const remote = rows.map(r => ({id: r?.id, data: r?.data, updated: Date.parse(r?.updated_at),
      deleted: r?.deleted_at ? Date.parse(r.deleted_at) || 1 : null}));
    const r = applyRemote(remote);
    if(!r.ok) throw new Error('local write failed');
    out.pulled += r.applied;
    // Ό,τι ήρθε από τον λογαριασμό δεν ξαναπάει πίσω, και ανήκει σε αυτόν.
    const good = remote.filter(x => typeof x.id === 'string' && UUID.test(x.id) && Number.isFinite(x.updated));
    for(const x of good) st.pushed[x.id] = Math.max(st.pushed[x.id] || 0, x.updated);
    setOwners(good.map(x => x.id), userId);
    // Ο αριθμός προσφοράς της συσκευής προχωρά πάνω από ό,τι ήρθε: όχι δεύτερη «Αρ. 5» στα νέα PDF.
    const maxNo = Math.max(0, ...listQuotes().filter(q => r.ids.includes(q.id)).map(q => q.no));
    if(maxNo > lastQuoteNo()) try { storage()?.setItem(COUNTER, String(maxNo)); } catch {}
    const last = rows.at(-1)?.synced_at;
    const moved = typeof last === 'string' && last !== st.cursor;
    if(moved) st.cursor = last;
    saveUserState(userId, st);
    if(rows.length < PAGE || !moved) break;
  }
  // ── push ──
  const {quotes, deleted} = pending(userId);
  const rows = [
    ...quotes.map(q => ({id: q.id, user_id: userId, data: payload(q), updated_at: iso(stamp(q)), deleted_at: null, _at: stamp(q)})),
    ...deleted.map(d => ({id: d.id, user_id: userId, data: null, updated_at: iso(d.at), deleted_at: iso(d.at), _at: d.at, _del: true})),
  ];
  for(let i = 0; i < rows.length; i += CHUNK){
    const part = rows.slice(i, i + CHUNK);
    const {error} = await client.from('quotes').upsert(part.map(({_at, _del, ...r}) => r), {onConflict: 'id'});
    if(error) throw error;
    const s = userState(userId);
    for(const r of part) s.pushed[r.id] = Math.max(s.pushed[r.id] || 0, r._at);
    saveUserState(userId, s);
    setOwners(part.map(r => r.id), userId);
    const tombs = part.filter(r => r._del).map(r => ({id: r.id, at: r._at}));
    if(tombs.length) clearDeleted(tombs);
    out.pushed += part.filter(r => !r._del).length;
    out.deleted += tombs.length;
  }
  // Σβησμένες που δεν ανήκουν σε κανέναν (δεν ανέβηκαν ποτέ από αυτή τη συσκευή): τίποτα να πει στον server.
  const o = owners(), orphans = listDeleted().filter(d => !o[d.id]);
  if(orphans.length) clearDeleted(orphans);
  return out;
}

/** Σβήνει από τη συσκευή τις προσφορές (και ό,τι κρατά ο συγχρονισμός)· για «αποσύνδεση και σβήσε από τη συσκευή». */
export function wipeLocalQuotes(){
  for(const k of [STORE, DELETED, STATE, OWNERS]) try { storage()?.removeItem(k); } catch {}
}

const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error('timeout')), ms); })]).finally(() => clearTimeout(t)); };

/**
 * Συγχρονισμός στο παρασκήνιο. getDb(): {client, userId} ή null (χωρίς λογαριασμό ή χωρίς σήμα).
 * userId(): ο συνδεδεμένος χρήστης, και χωρίς σήμα (για την ένδειξη). onState('ok' | 'waiting' | 'off').
 * onPulled(): ήρθαν αλλαγές (η οθόνη ξαναζωγραφίζει).
 */
export function createQuoteSync({getDb, userId = () => null, onState = () => {}, onPulled = () => {}, delayMs = 1500, timeoutMs = SYNC_TIMEOUT_MS} = {}){
  let running = null, again = false, timer = 0, state = '';
  const set = s => { if(s !== state){ state = s; try { onState(s); } catch {} } };
  const settle = () => { const uid = userId(); set(!uid ? 'off' : pendingCount(uid) ? 'waiting' : 'ok'); };

  async function run(){
    if(running){ again = true; return running; }
    running = (async () => {
      let db = null;
      try { db = await getDb?.(); } catch {}
      if(!db){ settle(); return null; }
      try {
        const r = await withTimeout(syncQuotes(db), timeoutMs);
        if(r.pulled) try { onPulled(r); } catch {}
        return r;
      } catch { return null; }
      finally { settle(); }
    })();
    try { return await running; }
    finally { running = null; if(again){ again = false; run(); } }
  }
  return {
    run,
    /** Άλλαξε κάτι στη συσκευή (νέο PDF, ημερολόγιο, σβήσιμο): ανήκει στον συνδεδεμένο χρήστη και ανεβαίνει σε λίγο. */
    changed(id){
      const uid = userId();
      if(id) claim(id, uid);
      settle();
      clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    pending: () => { const uid = userId(); return uid ? pendingCount(uid) : 0; },
    get state(){ return state; },
    settle,
  };
}
