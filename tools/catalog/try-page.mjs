// Εργαλείο ανάπτυξης: τρέχει την εξαγωγή σε μία σελίδα κατηγορίας. Χρήση: node tools/catalog/try-page.mjs <url>
import path from 'node:path'; import {fileURLToPath} from 'node:url'; import * as cheerio from 'cheerio';
import {createFetcher} from './fetcher.mjs'; import {extractProducts, breadcrumb, siteTotal, nextPage} from './html-adapters.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const f = createFetcher({cacheDir: path.join(root, 'data/cache/pages')});
const r = await f.get(process.argv[2]); const $ = cheerio.load(r.body); const ps = extractProducts($, r.finalUrl, process.argv[3] ? new RegExp(process.argv[3]) : null);
console.log({status: r.status, crumbs: breadcrumb($), total: siteTotal($), next: nextPage($, r.finalUrl), products: ps.length});
for(const p of ps.slice(0, 3)) console.log('  ', p.name.slice(0, 70), '|', p.price, '|', p.brand, '|', p.url.slice(0, 90));
