import { test } from 'node:test';
import assert from 'node:assert/strict';
// Η Edge Function «delete-account» με ψεύτικο admin client (χωρίς Supabase, χωρίς δίκτυο).
const { handle, corsHeaders, ALLOWED_ORIGINS, lastAuthAt, REAUTH_MAX_AGE_S } = await import('../supabase/functions/delete-account/handler.ts');
// JWT (μη υπογεγραμμένο: την υπογραφή την ελέγχει το getUser) με amr = σύνδεση πριν από «age» δευτερόλεπτα.
const NOW = 1_800_000_000_000;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtAged = (age, method = 'password') => `${b64({alg: 'HS256'})}.${b64({sub: 'x', amr: [{method, timestamp: NOW / 1000 - age}]})}.sig`;

const A = '00000000-0000-4000-8000-00000000000a';
const FRESH = jwtAged(60), OLD = jwtAged(REAUTH_MAX_AGE_S + 60);
function fakeAdmin({users = {[FRESH]: A, [OLD]: A, 'jwt-a': A}, files = {[A]: ['logo-1.jpg', 'logo-2.png']}, failDelete = false, quotesError = null} = {}){
  const log = {deleted: [], removed: [], quotes: [], order: []};
  return {log, from: table => ({delete: () => ({eq: async (col, val) => {
    log.order.push('quotes');
    if(quotesError) return {error: quotesError};
    log.quotes.push(`${table}:${col}=${val}`); return {error: null};
  }})}), auth: {
    getUser: async jwt => users[jwt] ? {data: {user: {id: users[jwt]}}, error: null} : {data: {user: null}, error: {status: 401}},
    admin: {deleteUser: async id => { log.order.push('user'); if(failDelete) return {error: {status: 500}}; log.deleted.push(id); return {error: null}; }},
  }, storage: {from: bucket => ({
    list: async (prefix, {offset}) => ({data: offset ? [] : (files[prefix] || []).map(name => ({name})), error: null}),
    remove: async paths => { log.order.push('files'); log.removed.push(...paths.map(p => `${bucket}:${p}`)); return {error: null}; },
  })}};
}
const req = (opts = {}) => new Request('https://x.supabase.co/functions/v1/delete-account', {method: 'POST', ...opts,
  headers: {Origin: 'https://aggelosemiris.github.io', ...(opts.headers || {})}});

const handleAt = (r, admin, allowed) => handle(r, admin, allowed, () => NOW);

test('διαγραφή: σβήνει ΜΟΝΟ τον χρήστη του JWT, πρώτα τα λογότυπά του', async () => {
  const admin = fakeAdmin();
  const res = await handleAt(req({headers: {Authorization: `Bearer ${FRESH}`}}), admin);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {deleted: true});
  assert.deepEqual(admin.log.deleted, [A]);
  assert.deepEqual(admin.log.removed, [`logos:${A}/logo-1.jpg`, `logos:${A}/logo-2.png`]);
});

test('διαγραφή: σβήνει και τις προσφορές του (quotes) — ΜΟΝΟ του ίδιου χρήστη, πριν από τον λογαριασμό', async () => {
  const admin = fakeAdmin();
  const res = await handleAt(req({headers: {Authorization: `Bearer ${FRESH}`}, body: JSON.stringify({user_id: 'άλλος'})}), admin);
  assert.equal(res.status, 200);
  assert.deepEqual(admin.log.quotes, [`quotes:user_id=${A}`]);
  assert.deepEqual(admin.log.order, ['files', 'quotes', 'user']);
});

test('προσφορές που δεν σβήνονται → 500 και ο λογαριασμός ΔΕΝ σβήνεται· πίνακας που δεν υπάρχει ακόμα → συνεχίζει', async () => {
  const bad = fakeAdmin({quotesError: {code: '42501', message: 'permission denied'}});
  const res = await handleAt(req({headers: {Authorization: `Bearer ${FRESH}`}}), bad);
  assert.equal(res.status, 500);
  assert.deepEqual(bad.log.deleted, [], 'ο χρήστης μένει: καμία μισή διαγραφή');
  for(const code of ['PGRST205', '42P01']){
    const before = fakeAdmin({quotesError: {code}});
    assert.equal((await handleAt(req({headers: {Authorization: `Bearer ${FRESH}`}}), before)).status, 200, code);
    assert.deepEqual(before.log.deleted, [A]);
  }
});

test('χωρίς JWT ή με άκυρο JWT: 401, τίποτα δεν σβήνεται', async () => {
  for(const headers of [{}, {Authorization: 'Bearer'}, {Authorization: 'Bearer bogus-token'}]){
    const admin = fakeAdmin();
    const res = await handleAt(req({headers}), admin);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.deepEqual(admin.log, {deleted: [], removed: [], quotes: [], order: []});
  }
});

test('το id στο σώμα της αίτησης αγνοείται (μόνο το JWT μετράει)', async () => {
  const admin = fakeAdmin();
  await handleAt(req({headers: {Authorization: `Bearer ${FRESH}`}, body: JSON.stringify({id: 'κάποιος-άλλος'})}), admin);
  assert.deepEqual(admin.log.deleted, [A]);
});

test('CORS: μόνο οι διευθύνσεις της λίστας· OPTIONS → 204· GET → 405', async () => {
  assert.equal(corsHeaders('https://aggelosemiris.github.io')['Access-Control-Allow-Origin'], 'https://aggelosemiris.github.io');
  assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], undefined);
  assert.ok(ALLOWED_ORIGINS.includes('http://localhost:8087'));
  const pre = await handle(new Request('https://x/f', {method: 'OPTIONS', headers: {Origin: 'http://localhost:8087'}}), fakeAdmin());
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8087');
  assert.equal((await handle(new Request('https://x/f', {method: 'GET'}), fakeAdmin())).status, 405);
  // νέο domain = μία γραμμή στη λίστα
  assert.equal(corsHeaders('https://ergolav.gr', [...ALLOWED_ORIGINS, 'https://ergolav.gr'])['Access-Control-Allow-Origin'], 'https://ergolav.gr');
});

test('αποτυχία διαγραφής: 500 χωρίς λεπτομέρειες, το log χωρίς στοιχεία χρήστη', async () => {
  const logged = [], orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const res = await handleAt(req({headers: {Authorization: `Bearer ${FRESH}`}}), fakeAdmin({failDelete: true}));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), {error: 'delete_failed'});
  } finally { console.error = orig; }
  assert.ok(logged.every(l => !l.includes(A) && !l.includes('jwt-a') && !l.includes('@')), logged.join('|'));
});

test('διαγραφή μόνο με ΠΡΟΣΦΑΤΗ επιβεβαίωση ταυτότητας (amr): παλιό token → 403, τίποτα δεν σβήνεται', async () => {
  assert.equal(lastAuthAt(FRESH), NOW / 1000 - 60);
  assert.equal(lastAuthAt('όχι-jwt'), 0);
  const admin = fakeAdmin();
  const res = await handleAt(req({headers: {Authorization: `Bearer ${OLD}`}}), admin);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), {error: 'reauth_required'});
  assert.deepEqual(admin.log, {deleted: [], removed: [], quotes: [], order: []});
  const google = jwtAged(30, 'oauth');
  const a2 = fakeAdmin({users: {[google]: A}});
  assert.equal((await handleAt(req({headers: {Authorization: `Bearer ${google}`}}), a2)).status, 200, 'πρόσφατη σύνδεση Google');
});
