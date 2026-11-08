// Βρίσκει τη σελίδα «Όροι χρήσης» κάθε site και δείχνει τα σημεία που μιλούν για αυτόματη συλλογή/αντιγραφή.
// Χρήση: node tools/catalog/terms-check.mjs domain1 domain2 … > out.json   (2–3 αιτήματα ανά site, με παύση)
import {UA} from './robots-check.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async url => { const r = await fetch(url, {headers: {'User-Agent': UA, 'Accept-Language': 'el'}, redirect: 'follow', signal: AbortSignal.timeout(20000)}); return {status: r.status, url: r.url, html: r.ok ? await r.text() : ''}; };
const text = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const TERMS = /(όροι|ορους|όρους|όρων|oroi|terms|xrhsh|xrisis|χρήσης|χρησης|προϋποθέσεις|conditions)/i;
const HITS = /(αυτοματοποιημ|αυτόματ[ωο]|robot|crawl|spider|scrap|bot\b|data.?mining|εξόρυξ|εξαγωγ|συστηματικ|βάση? δεδομένων|βάσεων δεδομένων|μαζικ)/gi;

export function termLinks(html, base){
  const out = new Map();
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const href = m[1], label = text(m[2]).trim();
    if(TERMS.test(label) || TERMS.test(decodeURIComponent(href))){
      try{ const u = new URL(href, base); if(u.protocol.startsWith('http')) out.set(u.href, label.slice(0, 60)); } catch {}
    }
  }
  // Προτίμηση: «όροι χρήσης» πριν από «όροι αγοράς/αποστολής»
  return [...out].sort(([a, la], [b, lb]) => (/χρήσ|xrhs|use/i.test(lb + b) - /χρήσ|xrhs|use/i.test(la + a))).slice(0, 2);
}

if(import.meta.url === `file://${process.argv[1]}`){
  const out = [];
  for(const d of process.argv.slice(2)){
    const row = {domain: d, pages: []};
    try{
      const home = await get(`https://${d}/`); row.home = home.status;
      for(const [url, label] of termLinks(home.html, home.url)){
        await sleep(2000);
        const p = await get(url), t = text(p.html);
        const hits = [...t.matchAll(HITS)].map(m => t.slice(Math.max(0, m.index - 160), m.index + 200).trim());
        row.pages.push({url: p.url, label, status: p.status, chars: t.length, hits: [...new Set(hits)].slice(0, 6)});
      }
    } catch(e){ row.error = e.cause?.code || e.name; }
    out.push(row);
    await sleep(500);
  }
  console.log(JSON.stringify(out, null, 1));
}
