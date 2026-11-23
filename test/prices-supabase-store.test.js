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
