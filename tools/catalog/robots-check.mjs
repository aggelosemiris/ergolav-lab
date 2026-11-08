// Ελέγχει το robots.txt κάθε υποψήφιου site για τον ergolav-catalog-bot (ένα αίτημα ανά site).
// Χρήση: node tools/catalog/robots-check.mjs domain1 domain2 … > out.json
export const UA = 'ergolav-catalog-bot/0.1 (+https://github.com/aggelosemiris/ergolav-lab)';
const BOT = 'ergolav-catalog-bot';

/** Ομάδες κανόνων του robots.txt: [{agents:[…], rules:[{allow, path}], delay}] */
export function parseRobots(text){
  const groups = []; let cur = null, lastWasAgent = false; const sitemaps = [];
  for(const raw of text.split(/\r?\n/)){
    const line = raw.replace(/#.*/, '').trim(); if(!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if(!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if(key === 'user-agent'){
      if(!lastWasAgent || !cur){ cur = {agents: [], rules: [], delay: null}; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if(key === 'sitemap'){ sitemaps.push(val); continue; }
    if(!cur) continue;
    if(key === 'allow' || key === 'disallow') cur.rules.push({allow: key === 'allow', path: val});
    if(key === 'crawl-delay') cur.delay = Number(val);
  }
  return {groups, sitemaps};
}

/** Η ομάδα που ισχύει για το bot μας: η δική του αν υπάρχει, αλλιώς η «*». */
export function groupFor({groups}, bot = BOT){
  return groups.find(g => g.agents.some(a => a !== '*' && bot.toLowerCase().startsWith(a))) ?? groups.find(g => g.agents.includes('*')) ?? null;
}

const toRe = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
/** Επιτρέπεται το path; Νικά ο πιο συγκεκριμένος (μακρύτερος) κανόνας, και σε ισοπαλία το Allow. */
export function allowed(group, path){
  if(!group) return true;
  let best = null;
  for(const r of group.rules){
    if(r.path === '') continue;
    if(toRe(r.path).test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

if(import.meta.url === `file://${process.argv[1]}`){
  const out = [];
  for(const d of process.argv.slice(2)){
    const row = {domain: d};
    try{
      const r = await fetch(`https://${d}/robots.txt`, {headers: {'User-Agent': UA}, redirect: 'follow', signal: AbortSignal.timeout(15000)});
      row.status = r.status; row.finalUrl = r.url;
      const text = r.ok ? await r.text() : '';
      if(r.ok && !/<html/i.test(text.slice(0, 500))){
        const parsed = parseRobots(text), g = groupFor(parsed);
        row.group = g ? g.agents.join(',') : null;
        row.rootAllowed = allowed(g, '/');
        row.disallow = g ? g.rules.filter(x => !x.allow).map(x => x.path).slice(0, 40) : [];
        row.delay = g?.delay ?? null;
        row.sitemaps = parsed.sitemaps;
        row.aiBotsBlocked = parsed.groups.filter(x => x.agents.some(a => /gptbot|claudebot|ccbot|anthropic|google-extended|bytespider/.test(a)) && !allowed(x, '/')).flatMap(x => x.agents);
      } else row.note = r.ok ? 'robots.txt είναι σελίδα HTML (δεν υπάρχει)' : 'χωρίς robots.txt';
    } catch(e){ row.error = e.cause?.code || e.name; }
    out.push(row);
    await new Promise(r => setTimeout(r, 300));   // διαφορετικά sites — μικρή παύση για ευγένεια
  }
  console.log(JSON.stringify(out, null, 1));
}
