// Service worker: η λίστα και το VERSION μέσα στο sw.js πρέπει να ταιριάζουν ΑΚΡΙΒΩΣ με τα αρχεία στον δίσκο.
// Αν αποτύχει: τρέξε `npm run sw:manifest` και κάνε commit το sw.js. Με cache-first, ένα παλιό VERSION σημαίνει ότι
// οι τεχνίτες μένουν στην παλιά έκδοση χωρίς να το καταλάβει κανείς (βλ. docs/offline.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, MAX_BYTES, buildManifest, readSw, render, deployed } from '../tools/sw-manifest.mjs';

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FIX = 'τρέξε `npm run sw:manifest` και κάνε commit το sw.js';

test('sw.js: η λίστα του precache ταιριάζει με τα αρχεία στον δίσκο', () => {
  const now = buildManifest(), sw = readSw(read('sw.js'));
  assert.deepEqual(sw.files, now.files, `η λίστα του sw.js είναι παλιά — ${FIX}`);
});

test('sw.js: το VERSION ταιριάζει με τα περιεχόμενα (αλλαγή σε οποιοδήποτε αρχείο = νέο VERSION)', () => {
  const now = buildManifest(), sw = readSw(read('sw.js'));
  assert.equal(sw.version, now.version, `το VERSION του sw.js είναι παλιό — ${FIX}`);
  assert.equal(render(read('sw.js'), now), read('sw.js'), `το sw.js δεν είναι όπως το γράφει το εργαλείο — ${FIX}`);
});

test('precache: ό,τι ανεβαίνει (pages.yml), εκτός από βίντεο και αρχεία του hosting', () => {
  const {files, skipped} = buildManifest();
  for(const f of ['index.html', 'src/app.js', 'src/offline.js', 'vendor/supabase-2.118.0.js', 'vendor/html2pdf.bundle.min.js',
    'legal/terms.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
    'vendor/fonts/commissioner-greek-wght-normal.woff2']) assert.ok(files.includes(f), f);
  for(const f of ['sw.js', '_headers', '.nojekyll', 'media/ergolav-social-x065.mp4']) assert.ok(!files.includes(f), f);
  assert.ok(skipped.some(s => s.file === 'media/ergolav-social-x065.mp4'));
  for(const e of ['sw.js', 'manifest.webmanifest', 'icons']) assert.ok(deployed().includes(e), `το pages.yml ανεβάζει το ${e}`);
  for(const f of files) assert.ok(fs.statSync(path.join(ROOT, f)).size <= MAX_BYTES, f);
});

test('sw-manifest: αρχεία πάνω από 2 MB και dotfiles μένουν έξω· κάθε αλλαγή περιεχομένου αλλάζει το VERSION', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-'));
  fs.mkdirSync(path.join(dir, '.github/workflows'), {recursive: true});
  fs.writeFileSync(path.join(dir, '.github/workflows/pages.yml'), 'run: mkdir _site && cp -r index.html src sw.js .nojekyll _site/\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>1</p>');
  fs.writeFileSync(path.join(dir, 'sw.js'), '');
  fs.writeFileSync(path.join(dir, '.nojekyll'), '');
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'a');
  fs.writeFileSync(path.join(dir, 'src/.DS_Store'), 'x');
  fs.writeFileSync(path.join(dir, 'src/big.js'), Buffer.alloc(MAX_BYTES + 1));
  const one = buildManifest(dir);
  assert.deepEqual(one.files, ['index.html', 'src/a.js']);
  assert.deepEqual(one.skipped.map(s => s.file), ['src/big.js']);
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'b');
  assert.notEqual(buildManifest(dir).version, one.version, 'άλλαξε περιεχόμενο → νέο VERSION');
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'a');
  assert.equal(buildManifest(dir).version, one.version, 'ίδια αρχεία → ίδιο VERSION');
  fs.rmSync(dir, {recursive: true});
});

test('sw.js: μόνο GET του ίδιου origin/scope, caches μόνο «ergolav-» του scope, κανένα reload χωρίς πάτημα', () => {
  const sw = read('sw.js');
  assert.match(sw, /request\.method !== 'GET'\) return;/);
  assert.match(sw, /url\.origin !== SCOPE\.origin \|\| !url\.pathname\.startsWith\(SCOPE\.pathname\)\) return;/);
  assert.match(sw, /const PREFIX = `ergolav-\$\{SCOPE\.pathname\}-`;/);
  assert.match(sw, /name\.startsWith\(PREFIX\) && name !== CACHE/);
  assert.match(sw, /cache:\s*'reload'/);
  assert.match(sw, /ignoreSearch: true/);
  assert.ok(!/\.put\(/.test(sw), 'καμία αποθήκευση απαντήσεων την ώρα της χρήσης: μόνο τα αρχεία της λίστας');
  assert.deepEqual(sw.match(/.*skipWaiting\(\).*/g), ["  if(event.data === 'skipWaiting') self.skipWaiting();"],
    'skipWaiting μόνο όταν το ζητήσει η σελίδα (πάτημα «Ανανέωση»)');
  assert.ok(!/supabase|cloudflare|googleapis|anthropic|openai|https?:/i.test(sw.replace(/^\s*\/\/.*$/gm, '').replace(/const FILES = \[[^]*?\];/, '')), 'ο service worker δεν ξέρει άλλα origins');
});

test('manifest.webmanifest: ergolav, el, standalone, εικονίδια που υπάρχουν', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'ergolav'); assert.equal(m.short_name, 'ergolav'); assert.equal(m.lang, 'el');
  assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.equal(m.display, 'standalone');
  const sizes = m.icons.map(i => `${i.sizes} ${i.purpose}`);
  assert.deepEqual(sizes, ['192x192 any', '512x512 any', '512x512 maskable']);
  for(const i of m.icons){
    const png = fs.readFileSync(path.join(ROOT, i.src));
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
  const apple = fs.readFileSync(path.join(ROOT, 'icons/apple-touch-icon.png'));
  assert.equal(apple.readUInt32BE(16), 180);
});

test('index.html: CSP χωρίς Google Fonts, με worker-src/manifest-src, και τα meta για iPhone', () => {
  const html = read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), 'καμία αναφορά σε Google Fonts');
  const dir = n => (csp.match(new RegExp(`(?:^|; )${n} ([^;]+)`)) || [])[1];
  assert.equal(dir('font-src'), "'self'");
  assert.equal(dir('worker-src'), "'self'");
  assert.equal(dir('manifest-src'), "'self'");
  assert.ok(!csp.includes('*'), 'κανένα wildcard');
  assert.equal((csp.match(/'unsafe-[a-z-]+'/g) || []).join(), "'unsafe-inline'", "μόνο το παλιό 'unsafe-inline' του style-src");
  for(const s of ['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon" href="icons/apple-touch-icon.png"',
    'name="apple-mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-title" content="ergolav"'])
    assert.ok(html.includes(s), s);
  assert.match(read('_headers'), /\/sw\.js\n\s+Cache-Control: no-cache/);
  assert.match(read('_headers'), /\/index\.html\n\s+Cache-Control: no-cache/);
});
