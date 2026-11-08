import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ψεύτικο localStorage ανά test (όπως στο profile.test.js)· broken: κάθε κλήση πετάει· full(k): η εγγραφή του k πετάει.
function env(initial = {}, {broken = false, full = () => false} = {}){
  const data = {...initial};
  const fail = () => { throw new Error('QuotaExceededError'); };
  globalThis.localStorage = broken ? {getItem: fail, setItem: fail, removeItem: fail, key: fail, get length(){ return fail(); }}
    : {getItem: k => data[k] ?? null, setItem: (k, v) => { if(full(k)) fail(); data[k] = String(v); }, removeItem: k => { delete data[k]; },
       key: i => Object.keys(data)[i] ?? null, get length(){ return Object.keys(data).length; }};
  return data;
}
const h = await import('../src/history.js');
// Προσφορά όπως την αποθηκεύει η νέα έκδοση (με ημερομηνία και κατάσταση).
const quote = (no, extra = {}) => ({no, at: Date.UTC(2026, 10, no), title: 'ανακαίνιση μπάνιου', client: `Πελάτης ${no}`, vatRate: 24,
  sum: {mat: 10000, lab: 5000, net: 15000, vat: 3600, total: 18600},
  rows: [{name: 'Λεκάνη κρεμαστή', qty: 1, unit: 'τεμ.', mat: 10000}, {name: 'Αποξήλωση', qty: 1, unit: 'κατ.', mat: 0}],
  profile: {name: 'Νίκος Παπαδάκης', trade: 'Υδραυλικός', phone: '6912345678'},
  scheduled_date: '2026-11-10', scheduled_time: '09:30', duration_days: 2, status: 'sent', ...extra});
// Προσφορά όπως την αποθήκευε η παλιά έκδοση (πριν από το ημερολόγιο): χωρίς τα 4 νέα πεδία.
const old = (no, extra = {}) => {
  const {scheduled_date, scheduled_time, duration_days, status, ...q} = quote(no);
  return {...q, ...extra};
};
const raw = data => JSON.parse(data[h.STORE]);

test('άδειο ιστορικό', () => {
  env();
  assert.deepEqual(h.listQuotes(), []);
  assert.equal(h.getQuote(1), null);
});

test('αποθήκευση, η νεότερη πρώτη, ανάκτηση ακριβώς όπως ήταν', () => {
  env();
  for(const n of [1, 3, 2]) assert.equal(h.saveQuote(quote(n)), true);
  assert.deepEqual(h.listQuotes().map(q => q.no), [3, 2, 1]);
  assert.deepEqual(h.getQuote(2), quote(2));
});

test('ίδιος αριθμός ξανά (ξαναφτιάχτηκε το PDF) → ενημέρωση, όχι διπλή εγγραφή', () => {
  env();
  h.saveQuote(quote(5));
  h.saveQuote(quote(5, {client: 'Άλλος πελάτης'}));
  assert.equal(h.listQuotes().length, 1);
  assert.equal(h.getQuote(5).client, 'Άλλος πελάτης');
});

test('σβήσιμο μίας προσφοράς', () => {
  env();
  [1, 2, 3].forEach(n => h.saveQuote(quote(n)));
  h.deleteQuote(2);
  assert.deepEqual(h.listQuotes().map(q => q.no), [3, 1]);
});

test('όριο 500: κρατιούνται οι νεότερες', () => {
  env();
  assert.equal(h.MAX_QUOTES, 500);
  for(let n = 1; n <= h.MAX_QUOTES + 5; n++) h.saveQuote(quote(n));
  const list = h.listQuotes();
  assert.equal(list.length, h.MAX_QUOTES);
  assert.equal(list.at(-1).no, 6);
});

test('μισή ή χαλασμένη προσφορά δεν μπαίνει ποτέ (ούτε από το localStorage)', () => {
  env();
  for(const bad of [null, {}, quote(0), quote(1, {sum: {mat: 1}}), quote(1, {rows: [{name: 'x', qty: NaN, unit: '', mat: 0}]}),
    quote(1, {rows: [{name: 'x', qty: 1, unit: '', mat: -5}]}), quote(1, {at: 'χθες'}), quote(1, {vatRate: 'x'})]){
    assert.equal(h.saveQuote(bad), false, JSON.stringify(bad)?.slice(0, 60));
  }
  assert.deepEqual(h.listQuotes(), []);
  env({[h.STORE]: JSON.stringify([quote(1), {no: 2}, 'σκουπίδια', quote(3)])});
  assert.deepEqual(h.listQuotes().map(q => q.no), [3, 1], 'οι άκυρες αγνοούνται μία-μία');
  for(const raw of ['{χαλασμένο', '{"a":1}', 'null', '42']){ env({[h.STORE]: raw}); assert.deepEqual(h.listQuotes(), [], raw); }
});

test('μπλοκαρισμένο / γεμάτο localStorage: τίποτα δεν σπάει, η αποθήκευση λέει false', () => {
  env({}, {broken: true});
  assert.equal(h.saveQuote(quote(1)), false);
  assert.deepEqual(h.listQuotes(), []);
  assert.equal(h.deleteQuote(1), false);
  assert.equal(h.updateQuote(1, {status: 'won'}), false);
  assert.deepEqual(h.migrateQuotes(), {migrated: 0, total: 0, error: 'read'});
  delete globalThis.localStorage;
  assert.deepEqual(h.listQuotes(), []);
  assert.equal(h.migrateQuotes().migrated, 0);
});

test('το id του λογοτύπου κρατιέται στην προσφορά· οτιδήποτε άλλο όχι', () => {
  env();
  h.saveQuote(quote(1, {profile: {name: 'Ν', trade: '', phone: '', logo: 'a1b2c3d4'}}));
  h.saveQuote(quote(2, {profile: {name: 'Ν', trade: '', phone: '', logo: 'data:image/png;base64,AAAA'}}));
  assert.equal(h.getQuote(1).profile.logo, 'a1b2c3d4');
  assert.equal(h.getQuote(2).profile.logo, undefined, 'εικόνα μέσα στην προσφορά δεν αποθηκεύεται (θα γέμιζε τη μνήμη)');
});

// ── Ημερομηνία και κατάσταση ──

test('scheduled_date αποθηκεύεται και διαβάζεται ως κείμενο, χωρίς μετατόπιση ημέρας', () => {
  const data = env();
  h.saveQuote(quote(1, {scheduled_date: '2026-11-10', scheduled_time: '00:15', duration_days: 1, status: 'draft'}));
  assert.match(data[h.STORE], /"scheduled_date":"2026-11-10","scheduled_time":"00:15","duration_days":1,"status":"draft"/);
  const q = h.getQuote(1);
  assert.equal(q.scheduled_date, '2026-11-10');
  assert.equal(q.scheduled_time, '00:15');
  assert.equal('scheduled_from_created' in q, false, 'νέα προσφορά: χωρίς σήμανση «ημ. δημιουργίας»');
});

test('«Δεν ξέρω ακόμα»: null μένει null (δεν μπαίνει στην ημ. δημιουργίας), ώρα χωρίς μέρα δεν κρατιέται', () => {
  const data = env();
  h.saveQuote(quote(1, {scheduled_date: null, scheduled_time: '09:30', duration_days: 3}));
  assert.deepEqual(raw(data)[0].scheduled_date, null);
  const q = h.getQuote(1);
  assert.equal(q.scheduled_date, null);
  assert.equal(q.scheduled_time, null);
  assert.equal(q.duration_days, 3);
  assert.equal(h.migrateQuotes().migrated, 0, 'η μετάπτωση δεν την αγγίζει');
  assert.equal(h.getQuote(1).scheduled_date, null);
});

test('άκυρα νέα πεδία: ημερομηνία → χωρίς ημερομηνία, ώρα → χωρίς, διάρκεια → 1, κατάσταση → Στάλθηκε', () => {
  env();
  for(const [i, bad] of [{scheduled_date: '2026-02-30'}, {scheduled_date: 1794000000000}, {scheduled_time: '25:00'},
    {duration_days: 0}, {duration_days: 2.5}, {status: 'paid'}].entries()) h.saveQuote(quote(i + 1, bad));
  const q = n => h.getQuote(n);
  assert.equal(q(1).scheduled_date, null);
  assert.equal(q(2).scheduled_date, null);
  assert.equal(q(3).scheduled_time, null);
  assert.equal(q(4).duration_days, 1);
  assert.equal(q(5).duration_days, 1);
  assert.equal(q(6).status, 'sent');
  assert.equal(h.listQuotes().length, 6, 'καμία δεν χάνεται');
});

test('παλιά εγγραφή (χωρίς μετάπτωση ακόμα): φαίνεται στη μέρα δημιουργίας με σήμανση, χωρίς να γραφτεί τίποτα', () => {
  const before = JSON.stringify([old(1)]), data = env({[h.STORE]: before});
  const q = h.getQuote(1);
  assert.equal(q.scheduled_date, '2026-11-01');
  assert.equal(q.scheduled_from_created, true);
  assert.equal(q.status, 'sent');
  assert.equal(data[h.STORE], before, 'η ανάγνωση δεν γράφει');
});

test('η μέρα δημιουργίας είναι σε ώρα Ελλάδας (23:30 UTC της 9/11 = 01:30 της 10/11 στην Ελλάδα)', () => {
  env({[h.STORE]: JSON.stringify([old(1, {at: Date.parse('2026-11-09T23:30:00Z')}), old(2, {at: Date.parse('2026-11-09T21:30:00Z')})])});
  h.migrateQuotes(Date.parse('2026-11-12T10:00:00Z'));
  assert.equal(h.getQuote(1).scheduled_date, '2026-11-10');
  assert.equal(h.getQuote(2).scheduled_date, '2026-11-09');
});

test('μετάπτωση: καμία δεν χάνεται, κανένα άλλο πεδίο δεν αλλάζει, αντίγραφο πριν', () => {
  // 300 παλιές (όσες χωρούσε η παλιά έκδοση), μερικές με πεδία που δεν ξέρουμε, και σκουπίδια που δεν πειράζονται.
  const olds = Array.from({length: 300}, (_, i) => old(i + 1, {at: Date.parse('2026-01-01T00:00:00Z') + i * 26 * 3600e3}));
  olds[7].note = 'πεδίο από άλλη έκδοση';
  const data0 = [...olds, {no: 999}, 'σκουπίδια', null];
  const before = JSON.stringify(data0), now = Date.parse('2026-11-08T10:00:00Z');
  const data = env({[h.STORE]: before});
  const r = h.migrateQuotes(now);
  assert.deepEqual(r, {migrated: 300, total: 303, backup: 'ergolav.quotes.backup.2026-11-08'});
  assert.equal(data['ergolav.quotes.backup.2026-11-08'], before, 'το αντίγραφο είναι ακριβώς τα δεδομένα πριν');
  const after = raw(data);
  assert.equal(after.length, data0.length, 'ίδιος αριθμός εγγραφών');
  assert.deepEqual(after.slice(300), [{no: 999}, 'σκουπίδια', null], 'ό,τι δεν είναι προσφορά μένει όπως ήταν');
  after.slice(0, 300).forEach((q, i) => {
    const {scheduled_date, scheduled_time, duration_days, status, scheduled_from_created, ...rest} = q;
    assert.deepEqual(rest, data0[i], `προσφορά ${i + 1}: τα παλιά πεδία ίδια`);
    assert.deepEqual(Object.keys(rest), Object.keys(data0[i]), 'και στην ίδια σειρά');
    assert.deepEqual({scheduled_time, duration_days, status, scheduled_from_created}, {scheduled_time: null, duration_days: 1, status: 'sent', scheduled_from_created: true});
    assert.match(scheduled_date, /^2026-\d\d-\d\d$/);
  });
  assert.equal(after[7].note, 'πεδίο από άλλη έκδοση');
  assert.equal(h.listQuotes().length, 300, 'όλες φαίνονται');
  assert.ok(h.listQuotes().every(q => q.scheduled_from_created && q.scheduled_date));
});

test('μετάπτωση δεύτερη φορά: δεν αλλάζει τίποτα (ούτε νέο αντίγραφο)', () => {
  const data = env({[h.STORE]: JSON.stringify([old(1), old(2)])});
  const now = Date.parse('2026-11-08T10:00:00Z');
  assert.equal(h.migrateQuotes(now).migrated, 2);
  const snapshot = JSON.stringify(data);
  assert.deepEqual(h.migrateQuotes(now), {migrated: 0, total: 2});
  assert.deepEqual(h.migrateQuotes(now + 86400e3 * 30), {migrated: 0, total: 2});
  assert.equal(JSON.stringify(data), snapshot);
});

test('μεικτό ιστορικό: μόνο οι παλιές αλλάζουν· νέες (και «Δεν ξέρω ακόμα») μένουν ίδιες', () => {
  const data = env({[h.STORE]: JSON.stringify([quote(3), quote(2, {scheduled_date: null}), old(1)])});
  const before = raw(data);
  assert.equal(h.migrateQuotes().migrated, 1);
  const after = raw(data);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
  assert.equal(after[2].scheduled_from_created, true);
});

test('αν δεν χωράει το αντίγραφο, η μετάπτωση δεν γράφει τίποτα και όλες φαίνονται κανονικά', () => {
  const before = JSON.stringify([old(1), old(2)]);
  const data = env({[h.STORE]: before}, {full: k => k.startsWith(h.BACKUP)});
  assert.deepEqual(h.migrateQuotes(), {migrated: 0, total: 2, pending: 2, error: 'backup'});
  assert.equal(data[h.STORE], before);
  assert.deepEqual(h.listQuotes().map(q => [q.no, q.scheduled_date, q.scheduled_from_created]), [[2, '2026-11-02', true], [1, '2026-11-01', true]]);
});

test('αντίγραφα: ένα ανά μετάπτωση, κρατιούνται τα 2 νεότερα', () => {
  const data = env();
  const run = iso => { data[h.STORE] = JSON.stringify([old(1)]); return h.migrateQuotes(Date.parse(iso)).backup; };
  assert.equal(run('2026-11-08T10:00:00Z'), 'ergolav.quotes.backup.2026-11-08');
  assert.equal(run('2026-11-08T12:00:00Z'), 'ergolav.quotes.backup.2026-11-08.2', 'ίδια μέρα: δεν σβήνει το πρώτο');
  assert.equal(run('2026-11-09T10:00:00Z'), 'ergolav.quotes.backup.2026-11-09');
  assert.deepEqual(h.listBackups(), ['ergolav.quotes.backup.2026-11-09', 'ergolav.quotes.backup.2026-11-08.2']);
});

test('αλλαγή ημερομηνίας/κατάστασης: μόνο αυτά αλλάζουν· η «ημ. δημιουργίας» σβήνει όταν οριστεί ημερομηνία', () => {
  const data = env({[h.STORE]: JSON.stringify([quote(2), old(1)])});
  h.migrateQuotes();
  const q1 = h.getQuote(1);
  assert.equal(h.updateQuote(1, {status: 'won'}), true);
  assert.equal(h.getQuote(1).scheduled_from_created, true, 'αλλαγή μόνο κατάστασης: η μέρα μένει «ημ. δημιουργίας»');
  assert.equal(h.updateQuote(1, {scheduled_date: '2026-12-01', scheduled_time: '08:00', duration_days: 3}), true);
  const {scheduled_from_created, ...base} = q1;
  assert.deepEqual(h.getQuote(1), {...base, status: 'won', scheduled_date: '2026-12-01', scheduled_time: '08:00', duration_days: 3},
    'αλλάζουν μόνο ημερομηνία, ώρα, διάρκεια, κατάσταση· η σήμανση φεύγει');
  assert.equal(h.updateQuote(1, {scheduled_date: null}), true);
  assert.equal(h.getQuote(1).scheduled_date, null, 'και πίσω στο «Χωρίς ημερομηνία»');
  assert.equal(h.updateQuote(1, {client: 'άλλος', sum: {}}), true, 'πεδία εκτός ημερομηνίας/κατάστασης αγνοούνται');
  assert.equal(h.getQuote(1).client, 'Πελάτης 1');
  assert.deepEqual(raw(data)[0], quote(2), 'η άλλη προσφορά δεν αλλάζει');
  assert.equal(h.updateQuote(99, {status: 'won'}), false);
  assert.equal(h.updateQuote(2, {status: 'won', scheduled_date: 'χθες'}), true);
  assert.equal(h.getQuote(2).scheduled_date, null, 'άκυρη ημερομηνία → χωρίς ημερομηνία, ποτέ χαμένη προσφορά');
});
