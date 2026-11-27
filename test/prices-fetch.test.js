// Fetcher της ενημέρωσης τιμών (tools/prices/fetch.mjs): μόνιμα σφάλματα δεν ξαναδοκιμάζονται (λιγότερα αιτήματα στο site),
// προσωρινά ναι· το workflow τρέχει με μεγαλύτερο όριο headers (palousis: ~21 KB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
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

test('δύο ταυτόχρονα αιτήματα περιμένουν το robots.txt και δεν διαβάζουν απαγορευμένη σελίδα', async () => {
  let sent = 0;
  const f = createFetcher({wait: async () => {}, fetchImpl: async url => {
    if(url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /closed');
    sent++;
    return new Response('ok');
  }});
  const r = await Promise.allSettled([f.get('https://shop.example/closed'), f.get('https://shop.example/closed/2')]);
  assert.ok(r.every(x => x.status === 'rejected' && x.reason.name === 'Disallowed'));
  assert.equal(sent, 0);
  assert.equal(f.stats.requests, 1);
});

test('ελέγχει τους κανόνες για τον προορισμό ανακατεύθυνσης πριν τον επισκεφθεί', async () => {
  const urls = [];
  const f = createFetcher({wait: async () => {}, fetchImpl: async url => {
    urls.push(url);
    return url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /closed')
      : new Response('', {status: 302, headers: {location: '/closed'}});
  }});
  await assert.rejects(f.get('https://shop.example/open'), {name: 'Disallowed'});
  assert.deepEqual(urls, ['https://shop.example/robots.txt', 'https://shop.example/open']);
});

test('δεν ξαναδοκιμάζει νωρίτερα από το Retry-After του προμηθευτή', async () => {
  let pages = 0;
  const f = createFetcher({wait: async () => {}, fetchImpl: async url => url.endsWith('/robots.txt') ? robots() :
    (++pages, new Response('', {status: 429, headers: {'retry-after': '600'}}))});
  await assert.rejects(f.get('https://shop.example/start'), {name: 'Blocked'});
  assert.equal(pages, 1);
  assert.equal(f.stats.retries, 0);
});

test('σελίδα προστασίας στη θέση του robots.txt σταματά τη συλλογή', async () => {
  const urls = [];
  const f = createFetcher({wait: async () => {}, fetchImpl: async url => {
    urls.push(url);
    return new Response('<!doctype html><title>Just a moment...</title>', {headers: {'content-type': 'text/html'}});
  }});
  await assert.rejects(f.get('https://shop.example/products'), {name: 'Blocked'});
  assert.deepEqual(urls, ['https://shop.example/robots.txt']);
});

test('δεν ακολουθεί ανακατεύθυνση του robots.txt σε άλλο host', async () => {
  const urls = [];
  const f = createFetcher({wait: async () => {}, fetchImpl: async (url, init) => {
    urls.push(url);
    assert.equal(init.redirect, 'manual');
    return new Response('', {status: 302, headers: {location: 'https://other.example/robots.txt'}});
  }});
  await assert.rejects(f.get('https://shop.example/products'), {name: 'Blocked'});
  assert.deepEqual(urls, ['https://shop.example/robots.txt']);
});

test('η cache δεν δίνει σελίδα με απαγορευμένο τελικό URL ούτε εμφανίζει στοιχεία του URL στο μήνυμα', async t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-cache-'));
  t.after(() => fs.rmSync(cacheDir, {recursive: true, force: true}));
  const url = 'https://shop.example/open';
  const now = Date.parse('2026-11-27T10:00:00Z');
  fs.mkdirSync(path.join(cacheDir, 'shop.example'));
  fs.writeFileSync(path.join(cacheDir, 'shop.example', createHash('sha1').update(url).digest('hex') + '.json.gz'), gzipSync(JSON.stringify({
    date: new Date(now).toISOString(), status: 200, body: 'product', finalUrl: 'https://shop.example/closed?key=private-token',
  })));
  const urls = [];
  const f = createFetcher({cacheDir, now: () => now, wait: async () => {}, fetchImpl: async request => {
    urls.push(request);
    return new Response('User-agent: *\nDisallow: /closed');
  }});
  await assert.rejects(f.get(url), {name: 'Disallowed', message: 'robots.txt: https://shop.example'});
  assert.deepEqual(urls, ['https://shop.example/robots.txt']);
  assert.equal(f.stats.cached, 0);
});
