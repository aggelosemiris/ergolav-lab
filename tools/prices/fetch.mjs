// Ευγενικός fetcher για την εβδομαδιαία ενημέρωση τιμών (βασισμένος στο tools/catalog/fetcher.mjs).
// - Σέβεται το robots.txt κάθε host και το Crawl-delay (τουλάχιστον minDelayMs ανάμεσα σε αιτήματα, ένα τη φορά ανά host).
// - Δηλώνει ποιος είναι (User-Agent ergolav-price-bot) — καμία μεταμφίεση σε browser.
// - Cache στον δίσκο ΜΕ ΛΗΞΗ (ttlMs, εξ ορισμού 6 ημέρες): μια διακομμένη εκτέλεση συνεχίζει χωρίς να ξαναζητά σελίδες,
//   η επόμενη εβδομάδα παίρνει φρέσκες τιμές.
// - Προσωρινά σφάλματα (δίκτυο, 500/502/504, 429/503 με Retry-After): νέα προσπάθεια με αυξανόμενη αναμονή.
// - 401/403, σελίδα CAPTCHA/Cloudflare, ή 429/503 που επιμένει: ο host σταματά για αυτή την εκτέλεση. ΚΑΜΙΑ παράκαμψη.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import zlib from 'node:zlib';
import {parseRobots, groupFor, allowed} from '../catalog/robots-check.mjs';

export const BOT = 'ergolav-price-bot';
export const UA = `${BOT}/1.0 (+https://github.com/aggelosemiris/ergolav-lab)`;
export class Disallowed extends Error { constructor(url){ super('robots.txt: ' + url); this.name = 'Disallowed'; } }
export class Blocked extends Error { constructor(host, why){ super(`${host}: ${why}`); this.name = 'Blocked'; this.host = host; } }

const CHALLENGE = /(cf-chl|challenge-platform|__cf_chl|Just a moment\.\.\.|g-recaptcha|hcaptcha|captcha-delivery|Access Denied)/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createFetcher({cacheDir, ttlMs = 6 * 86400e3, minDelayMs = 2000, timeoutMs = 30000, retries = 4, backoffMs = 2000,
  log = () => {}, fetchImpl = fetch, now = Date.now, wait = sleep} = {}){
  const hosts = new Map();
  const stats = {requests: 0, cached: 0, disallowed: 0, retries: 0, blocked: 0};

  const cacheFile = url => path.join(cacheDir, new URL(url).hostname, crypto.createHash('sha1').update(url).digest('hex') + '.json.gz');
  function readCache(url){
    if(!cacheDir) return null;
    const f = cacheFile(url);
    try {
      const row = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
      return now() - Date.parse(row.date) < ttlMs ? row : null;
    } catch { return null; }
  }
  function writeCache(url, row){
    if(!cacheDir) return;
    const f = cacheFile(url); fs.mkdirSync(path.dirname(f), {recursive: true});
    fs.writeFileSync(f + '.tmp', zlib.gzipSync(JSON.stringify(row))); fs.renameSync(f + '.tmp', f);
  }

  async function raw(url, accept){
    const r = await fetchImpl(url, {headers: {'User-Agent': UA, Accept: accept, 'Accept-Language': 'el-GR,el;q=0.9'}, redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)});
    const buf = Buffer.from(await r.arrayBuffer()), ct = r.headers.get('content-type') || '';
    const cs = (ct.match(/charset=["']?([\w-]+)/i) || buf.subarray(0, 4096).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
    let body; try { body = new TextDecoder(cs || 'utf-8').decode(buf); } catch { body = buf.toString('utf8'); }
    return {status: r.status, finalUrl: r.url || url, contentType: ct, body, date: new Date(now()).toISOString(),
      retryAfter: r.headers.get('retry-after'), wpTotalPages: r.headers.get('x-wp-totalpages')};
  }

  async function host(h){
    if(hosts.has(h)) return hosts.get(h);
    const state = {robots: null, delay: minDelayMs, chain: Promise.resolve(), last: 0, blocked: null, robotsStatus: null};
    hosts.set(h, state);
    let row = readCache(`https://${h}/robots.txt`);
    if(!row){
      try { row = await raw(`https://${h}/robots.txt`, 'text/plain'); stats.requests++; state.last = now(); }
      catch(e){ row = {status: 0, body: '', error: e.name}; }
      if(row.status) writeCache(`https://${h}/robots.txt`, row);
    }
    state.robotsStatus = row.status;
    if([401, 403].includes(row.status)) state.blocked = `HTTP ${row.status} στο robots.txt`;
    else if(row.status === 200 && !/<html/i.test(row.body.slice(0, 500))){
      state.robots = groupFor(parseRobots(row.body), BOT);
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
    const run = s.chain.then(async () => {
      for(let attempt = 0; ; attempt++){
        if(s.blocked) throw new Blocked(h, s.blocked);
        const gap = s.last + s.delay - now(); if(gap > 0) await wait(gap);
        let row, err;
        try { row = await raw(url, accept); } catch(e){ err = e; } finally { s.last = now(); stats.requests++; }
        const temporary = err || [500, 502, 504, 429, 503].includes(row.status);
        if(temporary && attempt < retries){
          const ra = Number(row?.retryAfter);
          const ms = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120000) : backoffMs * 2 ** attempt;
          stats.retries++; log(`νέα προσπάθεια σε ${Math.round(ms / 1000)}″: ${url} (${err ? err.name : 'HTTP ' + row.status})`);
          await wait(ms); continue;
        }
        if(err) throw err;
        if([401, 403, 429, 503].includes(row.status) ||
           (row.status === 200 && CHALLENGE.test(row.body.slice(0, 20000)) && !/application\/json/.test(row.contentType))){
          s.blocked = row.status === 200 ? 'σελίδα CAPTCHA/προστασίας' : `HTTP ${row.status}`; stats.blocked++;
          log(`ΣΤΑΜΑΤΑ ${h}: ${s.blocked} στο ${url}`);
          throw new Blocked(h, s.blocked);
        }
        if(!allowStatus.includes(row.status)) throw new Error(`HTTP ${row.status} ${url}`);
        if(row.status === 200) writeCache(url, row);
        return {...row, fromCache: false};
      }
    });
    s.chain = run.catch(() => {});
    return run;
  }

  return {get, stats, blockedReason: h => hosts.get(h)?.blocked ?? null,
    robotsAllows: async url => { const u = new URL(url); const s = await host(u.hostname); return !s.blocked && allowed(s.robots, u.pathname + u.search); }};
}
