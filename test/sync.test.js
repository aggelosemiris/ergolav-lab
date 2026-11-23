// Συγχρονισμός προσφορών (src/sync.js): συγκρούσεις, σβήσιμο, χωρίς σήμα, διπλότυπα, μη αξιόπιστα δεδομένα.
// Ψεύτικος server με τους ΙΔΙΟΥΣ κανόνες με τη βάση (supabase/migrations/…_quotes.sql): ο καθένας μόνο τα δικά του,
// η νεότερη αλλαγή κερδίζει, synced_at από τον server.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let data;
function env(initial = {}){
  data = {...initial};
  globalThis.localStorage = {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; },
    key: i => Object.keys(data)[i] ?? null, get length(){ return Object.keys(data).length; }};
}
const h = await import('../src/history.js');
const s = await import('../src/sync.js');
const { COUNTER, lastQuoteNo } = await import('../src/profile.js');

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
const quote = (no, extra = {}) => ({no, at: 1793491200000 + no * 86400000, title: 'μπάνιο', client: `Πελάτης ${no}`,
  rows: [{name: 'Λεκάνη', qty: 1, unit: 'τεμ.', mat: 12000}], sum: {mat: 12000, lab: 5000, net: 17000, vat: 4080, total: 21080},
  vatRate: 24, profile: {name: 'Νίκος', trade: 'Υδραυλικός', phone: '6912345678'}, ...extra});

/** Ψεύτικο Supabase: πίνακας quotes με RLS (userId του client) και trigger «νεότερο κερδίζει». */
function server(){
  const rows = new Map();
  let tick = 0;
  const ts = () => `2026-11-23T10:00:00.${String(++tick).padStart(6, '0')}+00:00`;
  const srv = {rows, calls: 0, down: false, client(uid){
    return {from(table){
      assert.equal(table, 'quotes');
      return {
        select(cols){
          const f = {};
          const q = {eq(k, v){ f[k] = v; return q; }, gte(k, v){ f.gte = [k, v]; return q; }, order(){ return q; },
            async limit(n){
              srv.calls++;
              if(srv.down) return {data: null, error: {message: 'Failed to fetch'}};
              const out = [...rows.values()].filter(r => r.user_id === uid && r.user_id === f.user_id && r.synced_at >= f.gte[1])
                .sort((a, b) => a.synced_at.localeCompare(b.synced_at)).slice(0, n);
              return {data: structuredClone(out), error: null};
            }};
          return q;
        },
        async upsert(list, opts){
          srv.calls++;
          assert.equal(opts.onConflict, 'id');
          if(srv.down) return {error: {message: 'Failed to fetch'}};
          for(const r of list){
            assert.equal(r.user_id, uid, 'μόνο γραμμές του ίδιου χρήστη');
            const old = rows.get(r.id);
            if(old && old.user_id !== uid) return {error: {code: '42501'}};
            if(old && Date.parse(r.updated_at) <= Date.parse(old.updated_at)) continue;      // trigger: νεότερο κερδίζει
            rows.set(r.id, {...structuredClone(r), synced_at: ts()});
          }
          return {error: null};
        },
      };
    }};
  }};
  return srv;
}
const db = (srv, uid) => ({client: srv.client(uid), userId: uid});
beforeEach(() => env());

test('πρώτη σύνδεση σε συσκευή με τοπικές προσφορές: ανεβαίνουν όλες, μία φορά (ίδιο id = κανένα διπλότυπο)', async () => {
  h.saveQuote(quote(1)); h.saveQuote(quote(2));
  const srv = server();
  const r = await s.syncQuotes(db(srv, A));
  assert.equal(r.pushed, 2);
  assert.equal(srv.rows.size, 2);
  const ids = h.listQuotes().map(q => q.id).sort();
  assert.deepEqual([...srv.rows.keys()].sort(), ids, 'το id της γραμμής = το id της προσφοράς');
  assert.equal(srv.rows.get(ids[0]).data.id, undefined, 'το data δεν ξαναγράφει το id');
  assert.equal((await s.syncQuotes(db(srv, A))).pushed, 0, 'δεύτερος γύρος: τίποτα');
  // ακόμα κι αν χαθεί η κατάσταση του συγχρονισμού (π.χ. ξανασύνδεση), ξαναστέλνεται με το ίδιο id: όχι διπλότυπο
  delete data[s.STATE];
  await s.syncQuotes(db(srv, A));
  assert.equal(srv.rows.size, 2);
  assert.equal(h.listQuotes().length, 2);
});

test('συσκευή Β: ίδιος λογαριασμός → οι προσφορές της Α εμφανίζονται, και ο αριθμός προσφοράς προχωρά', async () => {
  const srv = server();
  h.saveQuote(quote(1)); h.saveQuote(quote(7));
  await s.syncQuotes(db(srv, A));
  const fromA = h.listQuotes();
  env();                                                    // άλλο κινητό
  data[COUNTER] = '2';
  const r = await s.syncQuotes(db(srv, A));
  assert.equal(r.pulled, 2);
  assert.deepEqual(h.listQuotes().map(({updated, ...q}) => q), fromA.map(({updated, ...q}) => q));
  assert.equal(lastQuoteNo(), 7, 'το επόμενο PDF εδώ είναι το 8, όχι δεύτερο 3');
  assert.equal(r.pushed, 0, 'ό,τι ήρθε δεν ξαναγυρίζει πίσω');
});

test('σύγκρουση: κερδίζει το νεότερο updated_at — και στη συσκευή και στον server', async () => {
  const srv = server();
  h.saveQuote(quote(3), 1000);
  await s.syncQuotes(db(srv, A));
  const id = h.getQuote(3).id, devA = structuredClone(data);
  // Συσκευή Β (αντίγραφο): αλλάζει κατάσταση στις 3000
  env(structuredClone(devA));
  h.updateQuote(id, {status: 'won'}, 3000);
  await s.syncQuotes(db(srv, A));
  // Συσκευή Α: παλιότερη αλλαγή στις 2000 → χάνει
  env(devA);
  h.updateQuote(id, {status: 'lost'}, 2000);
  await s.syncQuotes(db(srv, A));
  assert.equal(h.getQuote(id).status, 'won', 'στη συσκευή Α ήρθε η νεότερη');
  assert.equal(srv.rows.get(id).data.status, 'won', 'ο server κράτησε τη νεότερη');
  // Νεότερη τοπική αλλαγή (4000) κερδίζει τη (παλιότερη) του server
  h.updateQuote(id, {status: 'lost'}, 4000);
  await s.syncQuotes(db(srv, A));
  assert.equal(srv.rows.get(id).data.status, 'lost');
});

test('σβήσιμο: deleted_at στον server (όχι διαγραφή)· στην άλλη συσκευή φεύγει· παλιότερη αλλαγή δεν την ξαναφέρνει', async () => {
  const srv = server();
  h.saveQuote(quote(4), 1000);
  await s.syncQuotes(db(srv, A));
  const id = h.getQuote(4).id, other = structuredClone(data);
  h.deleteQuote(id, 5000);
  assert.equal(h.getQuote(id), null);
  const r = await s.syncQuotes(db(srv, A));
  assert.equal(r.deleted, 1);
  const row = srv.rows.get(id);
  assert.ok(row && row.deleted_at && row.data === null, 'η γραμμή μένει, με deleted_at');
  assert.deepEqual(h.listDeleted(), [], 'ο server το έμαθε: η σημείωση φεύγει');
  env(other);                                               // η άλλη συσκευή
  h.updateQuote(id, {status: 'won'}, 3000);                 // παλιότερη από το σβήσιμο
  await s.syncQuotes(db(srv, A));
  assert.equal(h.getQuote(id), null, 'το σβήσιμο (5000) κερδίζει την αλλαγή (3000)');
  assert.ok(srv.rows.get(id).deleted_at, 'και στον server μένει σβησμένη');
});

test('χωρίς σήμα: καμία κλήση, κανένα σφάλμα· «θα συγχρονιστεί» → μόλις γυρίσει το σήμα, «συγχρονίστηκε»', async () => {
  const srv = server(), states = [];
  let net = false;
  const sync = s.createQuoteSync({getDb: async () => net ? db(srv, A) : null, userId: () => A, onState: st => states.push(st), delayMs: 1});
  h.saveQuote(quote(5));
  sync.changed(h.getQuote(5).id);
  assert.equal(await sync.run(), null);
  assert.equal(srv.calls, 0, 'καμία κλήση');
  assert.equal(sync.state, 'waiting');
  net = true;
  const r = await sync.run();
  assert.equal(r.pushed, 1);
  assert.equal(sync.state, 'ok');
  assert.deepEqual(states.filter((x, i) => x !== states[i - 1]), ['waiting', 'ok']);
  // server που δεν απαντά / πέφτει: τίποτα δεν πετάγεται, μένει «θα συγχρονιστεί»
  srv.down = true;
  h.updateQuote(h.getQuote(5).id, {status: 'won'});
  await assert.doesNotReject(sync.run());
  assert.equal(sync.state, 'waiting');
  const hang = s.createQuoteSync({getDb: async () => ({client: {from: () => ({select: () => ({eq(){ return this; }, gte(){ return this; }, order(){ return this; }, limit: () => new Promise(() => {})})})}, userId: A}), userId: () => A, timeoutMs: 20});
  assert.equal(await hang.run(), null, 'κρεμασμένο αίτημα: σταματά στο όριο χρόνου');
});

test('δεδομένα από τον server = μη αξιόπιστα: καθαρίζονται, το id μένει σταθερό, άκυρα αγνοούνται', async () => {
  const srv = server(), id = '11111111-2222-4333-8444-555555555555';
  const at = Date.parse('2026-11-20T10:00:00Z');
  srv.rows.set(id, {id, user_id: A, updated_at: '2026-11-20T10:00:00Z', deleted_at: null, synced_at: '2026-11-23T09:00:00.000001+00:00',
    data: {...quote(9), id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', client: 'Χ'.repeat(5000), evil: '<script>', profile: {name: 'Ν', logo: '../../x'}}});
  srv.rows.set('bad', {id: 'όχι-uuid', user_id: A, updated_at: '2026-11-20T10:00:00Z', synced_at: '2026-11-23T09:00:00.000002+00:00', data: quote(10)});
  const broken = '99999999-2222-4333-8444-555555555555';
  srv.rows.set(broken, {id: broken, user_id: A, updated_at: '2026-11-20T10:00:00Z', synced_at: '2026-11-23T09:00:00.000003+00:00', data: {no: 'x'}});
  await s.syncQuotes(db(srv, A));
  const list = h.listQuotes();
  assert.equal(list.length, 1, 'μόνο η έγκυρη');
  const q = list[0];
  assert.equal(q.id, id, 'το id της γραμμής, όχι του data');
  assert.equal(q.updated, at);
  assert.equal(q.client.length, 200, 'κομμένο όπως στο clean()');
  assert.equal(q.evil, undefined);
  assert.equal(q.profile.logo, undefined, 'άκυρο λογότυπο αγνοείται');
});

test('δύο χρήστες στην ίδια συσκευή: οι προσφορές του Α δεν ανεβαίνουν ΠΟΤΕ στον Β', async () => {
  const srv = server();
  h.saveQuote(quote(1));
  await s.syncQuotes(db(srv, A));                           // ανήκει πλέον στον Α
  h.saveQuote(quote(2));
  s.claim(h.getQuote(2).id, A);                             // φτιάχτηκε όσο ήταν συνδεδεμένος ο Α
  const rB = await s.syncQuotes(db(srv, B));
  assert.equal(rB.pushed, 0);
  assert.ok([...srv.rows.values()].every(r => r.user_id === A));
  assert.equal(s.pendingCount(A), 1, 'η 2 περιμένει τον Α');
  assert.equal(s.pendingCount(B), 0);
});

test('αποσύνδεση με «σβήσε από τη συσκευή»: φεύγουν προσφορές και κατάσταση συγχρονισμού, τίποτα άλλο', async () => {
  const srv = server();
  data['ergolav.profile'] = '{"name":"Ν"}'; data['ergolav.prices'] = '{}';
  h.saveQuote(quote(1));
  await s.syncQuotes(db(srv, A));
  s.wipeLocalQuotes();
  assert.deepEqual(Object.keys(data).sort(), ['ergolav.prices', 'ergolav.profile']);
  await s.syncQuotes(db(srv, A));
  assert.equal(h.listQuotes().length, 1, 'ξανασύνδεση: ξανάρχονται από τον λογαριασμό');
});

test('history: ensureIds δίνει id σε παλιές προσφορές μία φορά· ίδιο no από δύο κινητά = δύο προσφορές', () => {
  env({[h.STORE]: JSON.stringify([quote(2), quote(1)])});
  assert.equal(h.ensureIds(), 2);
  const ids = h.listQuotes().map(q => q.id);
  assert.ok(ids.every(id => h.UUID.test(id)));
  assert.equal(h.ensureIds(), 0, 'δεύτερη φορά: τίποτα');
  assert.deepEqual(h.listQuotes().map(q => q.id), ids, 'σταθερά');
  const other = '11111111-2222-4333-8444-555555555555';
  h.applyRemote([{id: other, updated: Date.now(), data: quote(2, {client: 'Από το άλλο κινητό'})}]);
  assert.equal(h.listQuotes().length, 3, 'και οι δύο «Αρ. 2» μένουν');
  assert.equal(h.getQuote(other).client, 'Από το άλλο κινητό');
  assert.equal(h.updateQuote(other, {status: 'won'}), true, 'αλλαγή με id: μόνο αυτή');
  assert.equal(h.listQuotes().filter(q => q.no === 2 && q.status === 'won').length, 1);
});
