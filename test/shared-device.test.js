// Κοινή συσκευή (εύρημα H4 του ελέγχου 25/11): δύο λογαριασμοί στο ίδιο κινητό. Ο Β δεν βλέπει καμία προσφορά του Α,
// ούτε πριν ούτε μετά τον συγχρονισμό· οι προσφορές του Α δεν χάνονται, ξαναφαίνονται όταν ξανασυνδεθεί ο Α.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let data;
function env(initial = {}){
  data = {...initial};
  globalThis.localStorage = {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; },
    key: i => Object.keys(data)[i] ?? null, get length(){ return Object.keys(data).length; }};
}
const h = await import('../src/history.js');
const s = await import('../src/sync.js');

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
const quote = (no, client) => ({no, at: 1793491200000 + no * 86400000, title: 'μπάνιο', client,
  rows: [{name: 'Λεκάνη', qty: 1, unit: 'τεμ.', mat: 12000}], sum: {mat: 12000, lab: 5000, net: 17000, vat: 4080, total: 21080},
  vatRate: 24, profile: {name: 'Νίκος', trade: 'Υδραυλικός', phone: '6912345678'}, scheduled_date: '2026-11-26', status: 'sent'});
const clients = () => h.listQuotes().map(q => q.client).sort();

// Ο «συνδεδεμένος» χρήστης, όπως τον δίνει η εφαρμογή (account.userId()).
let who = null;
beforeEach(() => { env(); who = null; h.setViewer(() => who); });
afterEach(() => h.setViewer(null));

test('ο Β δεν βλέπει τις προσφορές του Α στην ίδια συσκευή· ο Α τις ξαναβρίσκει όταν ξανασυνδεθεί', () => {
  who = A;
  h.saveQuote(quote(1, 'Πελάτης του Α'));
  h.saveQuote(quote(2, 'Δεύτερος του Α'));
  assert.deepEqual(clients(), ['Δεύτερος του Α', 'Πελάτης του Α']);

  who = B;                                                    // αποσύνδεση του Α, σύνδεση του Β
  assert.deepEqual(clients(), []);
  assert.equal(h.getQuote(1), null);
  const idA = JSON.parse(data[h.STORE])[0].id;
  assert.equal(h.getQuote(idA), null);
  h.saveQuote(quote(3, 'Πελάτης του Β'));
  assert.deepEqual(clients(), ['Πελάτης του Β']);

  who = null;                                                 // κανείς συνδεδεμένος: καμία προσφορά λογαριασμού
  assert.deepEqual(clients(), []);

  who = A;
  assert.deepEqual(clients(), ['Δεύτερος του Α', 'Πελάτης του Α']);
});

test('παλιές προσφορές χωρίς ιδιοκτήτη: τις παίρνει ο πρώτος που συνδέεται, όχι και ο επόμενος', () => {
  h.setViewer(null);                                          // πριν από τους λογαριασμούς: καμία ιδιοκτησία
  h.saveQuote(quote(1, 'Παλιός πελάτης'));
  h.setViewer(() => who);
  who = A;
  h.claimUnowned(A);
  assert.deepEqual(clients(), ['Παλιός πελάτης']);
  who = B;
  h.claimUnowned(B);
  assert.deepEqual(clients(), []);
});

test('μετά τον συγχρονισμό: ό,τι κατέβηκε για τον Α δεν φαίνεται στον Β, και ο Β δεν ανεβάζει προσφορές του Α', async () => {
  const rows = new Map();
  const client = uid => ({from: () => ({
    select: () => { const q = {eq: () => q, gte: () => q, order: () => q,
      limit: async () => ({data: [...rows.values()].filter(r => r.user_id === uid), error: null})}; return q; },
    upsert: async list => { for(const r of list){ assert.equal(r.user_id, uid); rows.set(r.id, {...r, synced_at: `2026-11-26T10:00:0${rows.size}+00:00`}); } return {error: null}; },
  })});
  // Ο Α έχει μία προσφορά στον λογαριασμό του, από άλλο κινητό.
  rows.set('11111111-1111-4111-8111-111111111111', {id: '11111111-1111-4111-8111-111111111111', user_id: A,
    data: quote(7, 'Από τον λογαριασμό του Α'), updated_at: '2026-11-25T10:00:00+00:00', deleted_at: null, synced_at: '2026-11-25T10:00:00+00:00'});
  who = A;
  await s.syncQuotes({client: client(A), userId: A});
  assert.deepEqual(clients(), ['Από τον λογαριασμό του Α']);

  who = B;
  assert.deepEqual(clients(), []);
  h.saveQuote(quote(8, 'Πελάτης του Β'));
  await s.syncQuotes({client: client(B), userId: B});
  assert.deepEqual(clients(), ['Πελάτης του Β']);
  assert.deepEqual([...rows.values()].filter(r => r.user_id === B).map(r => r.data.client), ['Πελάτης του Β']);
});

test('χωρίς λογαριασμό στην εφαρμογή (AUTH_ENABLED = false): όλες οι προσφορές της συσκευής, όπως πριν', () => {
  h.setViewer(null);
  h.saveQuote(quote(1, 'Α'));
  h.saveQuote(quote(2, 'Β'));
  assert.deepEqual(clients(), ['Α', 'Β']);
});

test('αποσύνδεση του Α με «σβήσε από τη συσκευή»: φεύγουν μόνο του Α, του Β μένουν', () => {
  who = A;
  h.saveQuote(quote(1, 'Πελάτης του Α'));
  who = B;
  h.saveQuote(quote(2, 'Πελάτης του Β'));
  s.wipeLocalQuotes(A);
  who = A;
  assert.deepEqual(clients(), []);
  who = B;
  assert.deepEqual(clients(), ['Πελάτης του Β']);
  assert.deepEqual(Object.values(h.owners()), [B]);
  s.wipeLocalQuotes(B);                                       // ο τελευταίος: τίποτα δεν μένει
  assert.equal(data[h.STORE], undefined);
  assert.equal(data[h.OWNERS], undefined);
});
