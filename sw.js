// Service worker του ergolav: η εφαρμογή ανοίγει και δουλεύει χωρίς σήμα (βλ. docs/offline.md).
//
// Κανόνες:
// - Πιάνει ΜΟΝΟ αιτήματα GET του ίδιου origin, μέσα στο scope του. Supabase, Turnstile, AI και ό,τι δεν είναι GET
//   πάνε στο δίκτυο όπως πριν, χωρίς να τα αγγίξει.
// - Στην cache μπαίνουν ΜΟΝΟ τα αρχεία της λίστας FILES, όπως ανεβαίνουν· ποτέ απαντήσεις με προσωπικά δεδομένα.
// - Το aggelosemiris.github.io είναι κοινό για όλα τα repos: κάθε cache λέγεται «ergolav-<scope>-<VERSION>» και
//   σβήνονται μόνο οι παλιές ΑΥΤΟΥ του scope.
// - Νέα έκδοση: περιμένει μέχρι να πατήσει ο τεχνίτης «Ανανέωση» (μήνυμα 'skipWaiting' από το src/offline.js).

// <precache> — γράφεται από το `npm run sw:manifest`· μην το αλλάζεις με το χέρι.
const VERSION = 'b9ed69370017';
const FILES = [
  'icons/apple-touch-icon.png',
  'icons/ergolav-logo.jpg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'legal/privacy.html',
  'legal/terms.html',
  'manifest.webmanifest',
  'src/account-ui.js',
  'src/account.js',
  'src/allaxe-engine.js',
  'src/allaxe-store.js',
  'src/allaxe-sync.js',
  'src/allaxe-ui.js',
  'src/analyses-data.js',
  'src/analysis-edits.js',
  'src/analysis-schema.js',
  'src/analysis-store.js',
  'src/analysis-ui.js',
  'src/app.js',
  'src/article.js',
  'src/calendar-ui.js',
  'src/calendar.js',
  'src/case-map.js',
  'src/case-pick.js',
  'src/cases-data.js',
  'src/catalog-tasks.js',
  'src/catalog.js',
  'src/config.js',
  'src/dates.js',
  'src/history.js',
  'src/image.js',
  'src/installation-ui.js',
  'src/installation.js',
  'src/mic.js',
  'src/net.js',
  'src/number.js',
  'src/offline-ui.js',
  'src/offline.js',
  'src/parse.js',
  'src/photo.js',
  'src/price-match.js',
  'src/price-rules.js',
  'src/price-watch.js',
  'src/prices.js',
  'src/profile.js',
  'src/rewrite-client.js',
  'src/service-client.js',
  'src/share.js',
  'src/similar.js',
  'src/statistics.js',
  'src/storage-guard.js',
  'src/sync.js',
  'src/tasks.js',
  'src/turnstile.js',
  'src/when-ui.js',
  'vendor/anthropic-sdk-0.129.0.mjs',
  'vendor/anthropic-sdk.LICENSE',
  'vendor/fonts/Commissioner-OFL.txt',
  'vendor/fonts/commissioner-greek-wght-normal.woff2',
  'vendor/fonts/commissioner-latin-wght-normal.woff2',
  'vendor/html2pdf.bundle.min.js',
  'vendor/html2pdf.bundle.min.js.LICENSE.txt',
  'vendor/supabase-2.118.0.js',
  'vendor/supabase.LICENSE',
];
// </precache>

const SCOPE = new URL(self.registration.scope);
const PREFIX = `ergolav-${SCOPE.pathname}-`;
const CACHE = PREFIX + VERSION;
const KNOWN = new Set(FILES);
const INDEX = 'index.html';

self.addEventListener('install', event => {
  // cache:'reload': το GitHub Pages κρατά HTTP cache 10 λεπτών· χωρίς αυτό θα μπορούσαν να μπουν παλιά αρχεία.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new Request(f, {cache: 'reload'})))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for(const name of await caches.keys()) if(name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if(event.data === 'skipWaiting') self.skipWaiting();
});

async function cached(file){
  const cache = await caches.open(CACHE);
  return cache.match(new URL(file, SCOPE).href, {ignoreSearch: true});
}

// Σελίδα: η ρίζα (και με ?code= της σύνδεσης Google) και το index.html από την cache· άλλο αρχείο της λίστας (π.χ.
// legal/terms.html) από την cache· οτιδήποτε άλλο από το δίκτυο, και χωρίς σήμα το index.html.
async function page(request, file){
  if(file === '' || file === INDEX) return (await cached(INDEX)) || fetch(request);
  if(KNOWN.has(file)) return (await cached(file)) || fetch(request);
  try { return await fetch(request); }
  catch(e) { return (await cached(INDEX)) || Promise.reject(e); }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);
  if(url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const file = decodeURIComponent(url.pathname.slice(SCOPE.pathname.length));
  if(request.mode === 'navigate') return event.respondWith(page(request, file));
  // Στατικά αρχεία της λίστας: πρώτα η cache. Τα ?v= αφορούν μόνο την HTTP cache, γι' αυτό ignoreSearch.
  if(KNOWN.has(file)) return event.respondWith(cached(file).then(r => r || fetch(request)));
  // Οτιδήποτε άλλο (π.χ. /api/ του server δοκιμών, το βίντεο): ο browser το φέρνει όπως πριν.
});
