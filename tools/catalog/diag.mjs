// Εργαλείο ανάπτυξης: για μια σελίδα κατηγορίας δείχνει τα σχήματα των συνδέσμων (για να βρεθεί ποιοι είναι προϊόντα).
import path from 'node:path'; import {fileURLToPath} from 'node:url'; import * as cheerio from 'cheerio';
import {createFetcher} from './fetcher.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const f = createFetcher({cacheDir: path.join(root, 'data/cache/pages')});
const r = await f.get(process.argv[2]); const $ = cheerio.load(r.body);
const shapes = new Map();
$('a[href]').each((_, a) => { let u; try { u = new URL($(a).attr('href'), r.finalUrl); } catch { return; } if(u.hostname !== new URL(r.finalUrl).hostname) return;
  const shape = u.pathname.split('/').map(p => /\d{3,}/.test(p) ? (p.match(/\.html?$/) ? '#.html' : '#') : p.length > 25 ? '<slug>' : p).join('/') + (u.search ? '?' + [...u.searchParams.keys()].join('&') : '');
  const e = shapes.get(shape) || {n: 0, ex: u.href, txt: $(a).text().replace(/\s+/g, ' ').trim().slice(0, 40)}; e.n++; shapes.set(shape, e); });
console.log({bytes: r.body.length, euro: (r.body.match(/€/g) || []).length, ld: $('script[type="application/ld+json"]').length, final: r.finalUrl});
for(const [s, e] of [...shapes].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) console.log(String(e.n).padStart(4), s.slice(0, 60).padEnd(60), e.txt);
