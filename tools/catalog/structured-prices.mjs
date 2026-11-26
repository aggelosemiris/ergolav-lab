// Εναλλακτική για εγκεκριμένες σελίδες καταλόγου χωρίς ειδικό adapter.
// Μόνο ρητή τιμή EUR ενός Offer· ποτέ εύρος, προτεινόμενη τιμή κατασκευαστή ή τιμή από κείμενο σελίδας.
import {load} from 'cheerio';
import {nextPage} from './html-adapters.mjs';

const typeIs = (value, type) => [value].flat().some(t => typeof t === 'string' && t.split('/').at(-1) === type);
const hostOf = url => new URL(url).hostname.replace(/^www\./, '');

export function structuredOffers($, base){
  const out = [];
  function visit(value){
    if(!value || typeof value !== 'object') return;
    if(Array.isArray(value)){ value.forEach(visit); return; }
    if(typeIs(value['@type'], 'Product')){
      const [offer, ...others] = [value.offers].flat();
      if(!offer || others.length || !typeIs(offer['@type'], 'Offer') || offer.priceCurrency !== 'EUR') return;
      if(/(?:OutOfStock|Discontinued|SoldOut)$/.test(offer.availability || '')) return;
      const raw = String(offer.price ?? '');
      if(!/^\d+(\.\d{1,2})?$/.test(raw)) return;
      const cents = Math.round(Number(raw) * 100);
      if(!Number.isSafeInteger(cents) || cents <= 0 || cents > 2147483647) return;
      let url;
      try {
        url = new URL(offer.url || value.url || value['@id'], base);
        if(url.protocol !== 'https:' || hostOf(url) !== hostOf(base)) return;
      } catch { return; }
      out.push({url: url.href, listedCents: cents});
      return;
    }
    visit(value['@graph']);
    visit(value.itemListElement);
    visit(value.item);
  }
  $('script[type="application/ld+json"]').each((_, script) => {
    try { visit(JSON.parse($(script).text())); } catch { /* Άκυρο JSON-LD. */ }
  });
  return out;
}

export async function* structuredPriceItems({categories, fetcher, log}){
  const seen = new Set();
  for(const category of categories){
    let page = category;
    for(let n = 0; page && n < 80 && !seen.has(page); n++){
      seen.add(page);
      try {
        const response = await fetcher.get(page);
        if(response.status !== 200 || hostOf(response.finalUrl) !== hostOf(category)) break;
        const $ = load(response.body);
        yield* structuredOffers($, response.finalUrl);
        const next = nextPage($, response.finalUrl);
        page = next && new URL(next).protocol === 'https:' && hostOf(next) === hostOf(category) ? next : null;
      } catch(error){
        if(error.name === 'Blocked') throw error;
        log(`τιμές καταλόγου: ${page}: ${error.message}`);
        break;
      }
    }
  }
}
