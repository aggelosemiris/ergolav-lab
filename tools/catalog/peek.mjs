// Εργαλείο ανάπτυξης: δείχνει τι έχει μια σελίδα (από cache ή με τον ευγενικό fetcher) — τίτλο, πλατφόρμα,
// JSON-LD, συνδέσμους κατηγοριών που ταιριάζουν στα επαγγέλματα. Χρήση: node tools/catalog/peek.mjs <url> [regex]
import path from 'node:path'; import {fileURLToPath} from 'node:url'; import * as cheerio from 'cheerio';
import {createFetcher} from './fetcher.mjs'; import {platformOf} from './detect.mjs'; import {TRADES} from './sites.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [url, extra] = process.argv.slice(2);
const f = createFetcher({cacheDir: path.join(root, 'data/cache/pages')});
const r = await f.get(url); const $ = cheerio.load(r.body);
const all = new RegExp(Object.values(TRADES).map(t => t.re.source).join('|'), 'i');
const re = extra ? new RegExp(extra, 'i') : all;
console.log({status: r.status, final: r.finalUrl, bytes: r.body.length, title: $('title').text().trim().slice(0, 80), generator: $('meta[name=generator]').attr('content'), platform: platformOf(r.body)});
console.log('JSON-LD:', $('script[type="application/ld+json"]').map((_, e) => { try { const j = JSON.parse($(e).text()); return [].concat(j['@graph'] || j).map(x => x['@type']).join(','); } catch { return '?'; } }).get().join(' | '));
const links = new Map();
$('a[href]').each((_, a) => { const t = $(a).text().replace(/\s+/g, ' ').trim(); const h = $(a).attr('href'); if(t && t.length < 60 && re.test(t)) { try { links.set(new URL(h, r.finalUrl).href, t); } catch {} } });
console.log(`links (${links.size}):`); for(const [h, t] of [...links].slice(0, Number(process.env.N || 25))) console.log('  ', t.padEnd(40), (()=>{try{return decodeURI(h)}catch{return h}})().slice(0, 110));
