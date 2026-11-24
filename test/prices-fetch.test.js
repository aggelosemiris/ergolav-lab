// Fetcher της ενημέρωσης τιμών (tools/prices/fetch.mjs): μόνιμα σφάλματα δεν ξαναδοκιμάζονται (λιγότερα αιτήματα στο site),
// προσωρινά ναι· το workflow τρέχει με μεγαλύτερο όριο headers (palousis: ~21 KB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFetcher } from '../tools/prices/fetch.mjs';

const robots = () => new Response('User-agent: *\nAllow: /\n', {status: 200, headers: {'content-type': 'text/plain'}});
const fail = code => Object.assign(new TypeError('fetch failed'), {cause: {code}});

test('headers πάνω από το όριο: καμία νέα προσπάθεια (ένα αίτημα, όχι πέντε)', async () => {
  let calls = 0;
  const f = createFetcher({wait: async () => {}, fetchImpl: async url => url.endsWith('/robots.txt') ? robots() : (calls++, Promise.reject(fail('UND_ERR_HEADERS_OVERFLOW')))});
  await assert.rejects(f.get('https://shop.example/c'));
  assert.equal(calls, 1);
  assert.equal(f.stats.retries, 0);
});

test('προσωρινό σφάλμα δικτύου: ξαναδοκιμάζει (με όριο)', async () => {
  let calls = 0;
  const f = createFetcher({wait: async () => {}, retries: 2, fetchImpl: async url => url.endsWith('/robots.txt') ? robots()
    : (++calls < 3 ? Promise.reject(fail('ECONNRESET')) : new Response('<html>ok</html>', {status: 200, headers: {'content-type': 'text/html'}}))});
  const r = await f.get('https://shop.example/c');
  assert.equal(r.status, 200); assert.equal(calls, 3); assert.equal(f.stats.retries, 2);
});

test('το workflow τρέχει με όριο headers 64 KB', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/prices.yml', import.meta.url), 'utf8');
  assert.match(yml, /node --max-http-header-size=65536 tools\/prices\/run\.mjs --store supabase/);
});
