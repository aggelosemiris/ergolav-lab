// Ευγενικός fetcher για τη συλλογή υλικών.
// - Σέβεται το robots.txt κάθε host (και το Crawl-delay).
// - Το πολύ 1 αίτημα ανά host κάθε minDelayMs (2 δευτ.), ένα τη φορά· διαφορετικά hosts τρέχουν παράλληλα.
// - Δηλώνει ποιος είναι (User-Agent ergolav-catalog-bot).
// - Cache στον δίσκο (gzip): η ίδια σελίδα δεν ζητιέται δεύτερη φορά.
// - Σε 403/429/503 ή σελίδα CAPTCHA/Cloudflare ο host σημειώνεται «μπλοκαρισμένος» και δεν ζητιέται τίποτα άλλο από αυτόν.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import zlib from 'node:zlib';
import {UA, parseRobots, groupFor, allowed} from './robots-check.mjs';

export class Disallowed extends Error { constructor(url){ super('robots.txt: ' + url); this.name = 'Disallowed'; } }
export class Blocked extends Error { constructor(host, why){ super(`${host}: ${why}`); this.name = 'Blocked'; this.host = host; } }

const CHALLENGE = /(cf-chl|challenge-platform|__cf_chl|Just a moment\.\.\.|Just a moment…|g-recaptcha|hcaptcha|captcha-delivery|Access Denied)/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createFetcher({cacheDir, minDelayMs = 2000, timeoutMs = 30000, log = () => {}, fetchImpl = fetch} = {}){
  const hosts = new Map();   // host → {robots, delay, chain, last, blocked}
  const stats = {requests: 0, cached: 0, disallowed: 0};

  const cacheFile = url => { const u = new URL(url); return path.join(cacheDir, u.hostname, crypto.createHash('sha1').update(url).digest('hex') + '.json.gz'); };
  function readCache(url){
    const f = cacheFile(url);
    if(!fs.existsSync(f)) return null;
    try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch { return null; }
  }
  function writeCache(url, row){
    const f = cacheFile(url); fs.mkdirSync(path.dirname(f), {recursive: true});
    fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(row)));
  }

  async function raw(url, accept){
    const r = await fetchImpl(url, {headers: {'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'el-GR,el;q=0.9'}, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs)});
    // Κάποια ελληνικά sites στέλνουν ακόμα windows-1253/iso-8859-7: η κωδικοποίηση από header ή <meta charset>.
    const buf = Buffer.from(await r.arrayBuffer()), ct = r.headers.get('content-type') || '';
    const cs = (ct.match(/charset=["']?([\w-]+)/i) || buf.subarray(0, 4096).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
    let body; try { body = new TextDecoder(cs || 'utf-8').decode(buf); } catch { body = buf.toString('utf8'); }
    // Τα X-WP-Total(Pages) δίνουν το σύνολο που δηλώνει το ίδιο το site (WooCommerce Store API).
    return {status: r.status, finalUrl: r.url, contentType: ct, body, date: new Date().toISOString(),
      wpTotal: r.headers.get('x-wp-total'), wpTotalPages: r.headers.get('x-wp-totalpages')};
  }

  async function host(h){
    if(hosts.has(h)) return hosts.get(h);
    const state = {robots: null, delay: minDelayMs, chain: Promise.resolve(), last: 0, blocked: null};
    hosts.set(h, state);
    const cached = readCache(`https://${h}/robots.txt`);
    let row = cached;
    if(!row){ try { row = await raw(`https://${h}/robots.txt`, 'text/plain'); stats.requests++; writeCache(`https://${h}/robots.txt`, row); } catch { row = {status: 0, body: ''}; } state.last = Date.now(); }
    if(row.status === 200 && !/<html/i.test(row.body.slice(0, 500))){
      state.robots = groupFor(parseRobots(row.body));
      if(state.robots?.delay) state.delay = Math.max(minDelayMs, state.robots.delay * 1000);
    }
    return state;
  }

  /** GET με όλους τους κανόνες. Επιστρέφει {status, finalUrl, contentType, body, fromCache}. */
  async function get(url, {accept = 'text/html,application/xhtml+xml', allowStatus = [200, 404, 410]} = {}){
    const u = new URL(url), h = u.hostname, s = await host(h);
    if(s.blocked) throw new Blocked(h, s.blocked);
    if(!allowed(s.robots, u.pathname + u.search)){ stats.disallowed++; throw new Disallowed(url); }
    const cached = readCache(url);
    if(cached){ stats.cached++; return {...cached, fromCache: true}; }
    // Ένα αίτημα τη φορά ανά host, με την καθυστέρηση που ζητήθηκε.
    const run = s.chain.then(async () => {
      if(s.blocked) throw new Blocked(h, s.blocked);
      const wait = s.last + s.delay - Date.now(); if(wait > 0) await sleep(wait);
      let row;
      try { row = await raw(url, accept); }
      finally { s.last = Date.now(); stats.requests++; }
      if([403, 429, 503].includes(row.status) || (row.status === 200 && CHALLENGE.test(row.body.slice(0, 20000)) && !/application\/json/.test(row.contentType))){
        s.blocked = row.status === 200 ? 'σελίδα CAPTCHA/Cloudflare' : `HTTP ${row.status}`;
        log(`ΜΠΛΟΚ ${h}: ${s.blocked} στο ${url}`);
        throw new Blocked(h, s.blocked);
      }
      if(!allowStatus.includes(row.status)) throw new Error(`HTTP ${row.status} ${url}`);
      writeCache(url, row);
      return {...row, fromCache: false};
    });
    s.chain = run.catch(() => {});
    return run;
  }

  return {get, stats, isBlocked: h => hosts.get(h)?.blocked ?? null, robotsAllows: async url => { const u = new URL(url); const s = await host(u.hostname); return allowed(s.robots, u.pathname + u.search); }};
}
