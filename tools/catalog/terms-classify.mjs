// Δεύτερο πέρασμα στους όρους χρήσης: κατατάσσει κάθε site σε
//   ban     — ρητή απαγόρευση bots / scraping / συστηματικής εξαγωγής
//   ip      — μόνο η συνηθισμένη ρήτρα πνευματικής ιδιοκτησίας (όχι αναπαραγωγή περιεχομένου)
//   clear   — τίποτα σχετικό
//   unknown — δεν βρέθηκε σελίδα όρων
// Οι σελίδες κρατιούνται σε cache (φάκελος, 1ο όρισμα) για να μη ζητηθούν ξανά.
// Χρήση: node tools/catalog/terms-classify.mjs <cacheDir> <terms.json> > out.json
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import {UA} from './robots-check.mjs';
const [cacheDir, prevFile] = process.argv.slice(2);
const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<header[\s\S]*?<\/header>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#8211;/g, '–').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
fs.mkdirSync(cacheDir, {recursive: true});
async function cached(url){
  const f = path.join(cacheDir, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  if(fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  let row;
  try{ const r = await fetch(url, {headers: {'User-Agent': UA, 'Accept-Language': 'el'}, redirect: 'follow', signal: AbortSignal.timeout(20000)});
       row = {url, final: r.url, status: r.status, text: r.ok ? text(await r.text()) : ''}; }
  catch(e){ row = {url, status: 0, error: e.cause?.code || e.name, text: ''}; }
  fs.writeFileSync(f, JSON.stringify(row)); await sleep(2000);
  return row;
}
const BAN = /(robot|ρομπότ|crawler|spider|scrap|\bbots?\b|εξόρυξ\S* δεδομένων|data.?mining|αυτοματοποιημέν\S* (μέσ|συστήμ|εργαλεί|διαδικασ|λογισμικ|προγράμμ)|συστηματικ\S* (συλλογ|εξαγωγ|ανάκτησ|αντιγραφ|λήψ)|μαζικ\S* (λήψ|συλλογ|εξαγωγ)|εργαλεία ΤΝ)/i;
const IP = /(απαγορεύεται\S*\s[^.]{0,120}(αναπαραγωγ|αντιγραφ|αναδημοσί)|πνευματικ\S* ιδιοκτησ)/i;
const GUESS = ['/oroi-xrisis/', '/oroi-chrisis/', '/terms/', '/terms-of-use/', '/oroi-xrhshs/', '/policies/terms-of-service', '/oroi-kai-proypotheseis/', '/oroi-xrisis', '/terms'];
const sentences = (t, re) => t.split(/(?<=[.;·])\s+/).filter(s => re.test(s) && s.length < 700).slice(0, 3);
const out = [];
for(const p of prev){
  const urls = p.pages.filter(x => x.status === 200 && x.chars > 2000 && !/policies\.google/.test(x.url) && /όρ|ορ|oro|term|χρήσ|xris|xrhs|proypoth|προϋπ/i.test(decodeURIComponent(x.url) + x.label) && !/product-category|ProductCategory|catalog|categories|proionta|kinita|apothikeusi/i.test(x.url)).map(x => x.url);
  const row = {domain: p.domain, checked: []};
  let pages = [];
  for(const u of urls) pages.push(await cached(u));
  if(!pages.some(x => x.status === 200 && x.text.length > 2000)){
    for(const g of GUESS){ const r = await cached(`https://${p.domain}${g}`); if(r.status === 200 && r.text.length > 2000 && /όρ|χρήσ|terms/i.test(r.text.slice(0, 4000))){ pages.push(r); break; } if(r.status === 403 || r.status === 429){ row.blocked = r.status; break; } }
  }
  pages = pages.filter(x => x.status === 200 && x.text.length > 2000);
  row.checked = pages.map(x => x.final || x.url);
  const all = pages.map(x => x.text).join(' ');
  row.ban = sentences(all, BAN).filter(s => !/αυτοματοποιημένο (e-?mail|μήνυμα)|cookies|BestPrice 360|προσωπικ\S* δεδομέν|GDPR|λογική της αυτοματοποιημένης/i.test(s));
  row.ip = sentences(all, IP);
  row.verdict = row.blocked ? 'blocked' : !pages.length ? 'unknown' : row.ban.length ? 'ban' : row.ip.length ? 'ip' : 'clear';
  out.push(row);
}
console.log(JSON.stringify(out, null, 1));
