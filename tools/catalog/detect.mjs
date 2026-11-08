// Βρίσκει την πλατφόρμα κάθε site (WooCommerce, PrestaShop, OpenCart, Magento…) για να διαλέξει τρόπο συλλογής.
// Χρήση: node tools/catalog/detect.mjs > data/cache/platforms.json
import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {createFetcher, Blocked, Disallowed} from './fetcher.mjs';
import {SITES} from './sites.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const f = createFetcher({cacheDir: path.join(root, 'data/cache/pages'), log: m => console.error(m)});

export function platformOf(html){
  if(/wp-content|wp-json/.test(html)) return /woocommerce/i.test(html) ? 'woocommerce' : 'wordpress';
  if(/prestashop|\/modules\/ps_|var prestashop/i.test(html)) return 'prestashop';
  if(/catalog\/view\/(theme|javascript)|route=product\/|index\.php\?route=/i.test(html)) return 'opencart';
  if(/Magento|mage\/cookies|data-mage-init/i.test(html)) return 'magento';
  if(/cdn\.shopify\.com/i.test(html)) return 'shopify';
  if(/__NEXT_DATA__/.test(html)) return 'nextjs';
  if(/CS-Cart|cscart/i.test(html)) return 'cs-cart';
  if(/\.aspx/i.test(html)) return 'aspnet';
  return 'unknown';
}

if(import.meta.url !== `file://${process.argv[1]}`) { /* imported */ } else {
const out = [];
await Promise.all(SITES.map(async s => {
  const row = {id: s.id, url: s.url};
  try{
    const home = await f.get(s.url);
    row.platform = platformOf(home.body);
    row.jsonld = (home.body.match(/application\/ld\+json/g) || []).length;
    if(row.platform === 'woocommerce' || row.platform === 'wordpress'){
      const base = new URL(s.url).origin;
      try{
        const api = await f.get(`${base}/wp-json/wc/store/v1/products?per_page=1`, {accept: 'application/json'});
        row.storeApi = api.status === 200 && /^\s*\[/.test(api.body);
        row.storeApiTotal = api.wpTotal ? Number(api.wpTotal) : null;
      } catch(e){ row.storeApi = false; row.storeApiError = e.name; }
    }
  } catch(e){ row.error = e instanceof Blocked || e instanceof Disallowed ? e.message : (e.cause?.code || e.message); }
  out.push(row);
}));
out.sort((a, b) => SITES.findIndex(s => s.id === a.id) - SITES.findIndex(s => s.id === b.id));
console.log(JSON.stringify(out, null, 1));
console.error('αιτήματα:', f.stats);
}
