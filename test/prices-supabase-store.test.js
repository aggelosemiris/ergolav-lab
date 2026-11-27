// Το κλειδί της εβδομαδιαίας εργασίας: νέα κλειδιά sb_secret_… ΜΟΝΟ στο «apikey», παλιό JWT και ως Bearer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore, authHeaders } from '../tools/prices/stores/supabase.mjs';

function fakeFetch(){
  const calls = [];
  const f = async (url, init) => { calls.push({url, headers: init.headers}); return {ok: true, status: 200, text: async () => '7'}; };
  f.calls = calls;
  return f;
}

test('κλειδί sb_secret_…: μόνο apikey, ΚΑΝΕΝΑ Authorization', async () => {
  const fetchImpl = fakeFetch(), key = 'sb_secret_' + 'x'.repeat(30);
  const store = createSupabaseStore({url: 'https://abc.supabase.co/', serviceKey: key, fetchImpl});
  assert.equal(await store.startRun(), 7);
  const {url, headers} = fetchImpl.calls[0];
  assert.equal(url, 'https://abc.supabase.co/rest/v1/rpc/price_run_start');
  assert.equal(headers.apikey, key);
  assert.ok(!('Authorization' in headers) && !('authorization' in headers), 'όχι Bearer');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('παλιό service_role JWT (eyJ…): apikey ΚΑΙ Authorization: Bearer', async () => {
  const fetchImpl = fakeFetch(), key = 'eyJhbGciOiJIUzI1NiJ9.' + 'y'.repeat(20) + '.sig';
  const store = createSupabaseStore({url: 'https://abc.supabase.co', serviceKey: key, fetchImpl});
  await store.heartbeat(3);
  const {headers} = fetchImpl.calls[0];
  assert.equal(headers.apikey, key);
  assert.equal(headers.Authorization, `Bearer ${key}`);
});

test('authHeaders: μόνο το πρόθεμα eyJ κάνει Bearer', () => {
  assert.deepEqual(authHeaders('sb_secret_abc'), {apikey: 'sb_secret_abc'});
  assert.deepEqual(authHeaders('sb_publishable_abc'), {apikey: 'sb_publishable_abc'});
  assert.deepEqual(authHeaders('eyJabc'), {apikey: 'eyJabc', Authorization: 'Bearer eyJabc'});
});

test('σφάλμα βάσης: το message με τον κανόνα φαίνεται ακόμα και μετά από μεγάλο details, χωρίς περιεχόμενο εγγραφής', async () => {
  const key = 'fake-secret-not-for-logs';
  const store = createSupabaseStore({url: 'https://abc.supabase.co', serviceKey: key, fetchImpl: async () => ({
    ok: false, status: 400, text: async () => JSON.stringify({code: '23514', details: 'ιδιωτικό-πεδίο'.repeat(100),
      hint: 'ιδιωτικό-hint', message: 'new row violates check constraint "supplier_offers_url_check" private@example.com ' + key})
  })});
  await assert.rejects(store.startRun(), e => {
    assert.match(e.message, /HTTP 400 23514.*supplier_offers_url_check/);
    assert.ok(!e.message.includes('ιδιωτικό-πεδίο') && !e.message.includes('ιδιωτικό-hint') && !e.message.includes(key));
    assert.ok(!e.message.includes('private@example.com'));
    return true;
  });
});

test('απογραφή προηγούμενων τιμών, με σταθερή σειρά και ρητή έλλειψη δικαιώματος', async () => {
  const calls = [];
  const key = 'fake-secret-not-for-logs';
  const store = createSupabaseStore({url: 'https://abc.supabase.co', serviceKey: key, fetchImpl: async (url, opts) => {
    calls.push([new URL(url), opts.method]);
    return calls.length === 1 ? new Response(JSON.stringify(Array.from({length: 1000}, (_, i) => ({product_id: String(i)}))))
      : new Response('[]');
  }});
  assert.equal((await store.loadCatalogPrices()).length, 1000);
  assert.deepEqual(calls.map(([url, method]) => [url.pathname, url.searchParams.get('order'), url.searchParams.get('offset'), method]), [
    ['/rest/v1/product_catalog_prices', 'product_id,supplier_id', '0', 'GET'],
    ['/rest/v1/product_catalog_prices', 'product_id,supplier_id', '1000', 'GET'],
  ]);
  const beforeMigration = createSupabaseStore({url: 'https://abc.supabase.co', serviceKey: key, fetchImpl: async () =>
    new Response('{"code":"42501","message":"permission denied"}', {status: 403})});
  assert.equal(await beforeMigration.loadCatalogPrices(), null);
});

test('μη δομημένο σφάλμα: δεν γράφει HTML, κλειδιά ή άλλα δεδομένα της απάντησης', async () => {
  const store = createSupabaseStore({url: 'https://abc.supabase.co', serviceKey: 'fake-secret', fetchImpl: async () => ({
    ok: false, status: 400, text: async () => '<html>fake-secret ιδιωτικό-πεδίο</html>'
  })});
  await assert.rejects(store.startRun(), /HTTP 400 Μη δομημένη απάντηση σφάλματος$/);
});
