// Εισαγωγή από τον φάκελο raw της συλλογής:
// node tools/catalog/product-catalog.mjs /διαδρομή/προς/raw
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync, gunzipSync} from 'node:zlib';
import {attributes, clean, codesIn, gtin, modelCode} from '../../src/price-match.js';
import {decode} from '../prices/adapters/common.mjs';

const sourceFile = new URL('../../data/product-catalog.json.gz', import.meta.url);
const searchFile = new URL('../../src/product-catalog.json.gz', import.meta.url);
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const slug = s => { try { return decodeURIComponent(s); } catch { return s; } };

export function listingKey(value){
  try {
    const u = new URL(value);
    if(!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    for(const k of [...u.searchParams.keys()]){
      if(/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    }
    u.searchParams.sort();
    // Οι παράμετροι και τα διαχωριστικά της διαδρομής μπορούν να ταυτοποιούν παραλλαγές.
    const pathname = u.pathname.replace(/\/+$/, '').split('/').map(p => encodeURIComponent(slug(p))).join('/');
    return u.hostname.replace(/^www\./, '') + pathname + u.search;
  } catch { return null; }
}

export function supplierListingKey(site, value){
  const normalized = listingKey(value);
  if(!normalized) return null;
  const u = new URL(value);
  const path = u.pathname;
  if(site === 'papasideris' && path.includes('/product/')) u.searchParams.delete('page');
  const codes = {
    ikea: /\/(\d{8})\/?$/,
    praktiker: /\/p\/[^/]+-(\d+)\/?$/,
    kaxiris: /\/(\d+)-[^/]+\.html$/,
    tehnothermiki: /\/(\d+)-[^/]+\.html$/,
    'e-metallon': /\/(\d+)-[^/]+\.html$/,
    billis: /\/product\/(\d+)\//,
    meidanis: /[-_]([0-9]{2,4}-[0-9]{4,})\.html$/,
    papasideris: /\/product\/.*[_-](\d{7,})\/?$/,
  };
  const code = codes[site]?.exec(path)?.[1];
  // Σελίδα κατηγορίας ως παράμετρος πλοήγησης του ίδιου permalink.
  // Κρατάμε παραμέτρους παραλλαγής, ακόμη κι όταν υπάρχει αναγνωριστικό βασικού είδους.
  if(code && !u.search) return u.hostname.replace(/^www\./, '') + '/#' + code;
  return site === 'papasideris' ? listingKey(u) : normalized;
}

function identity(record){
  const ean = gtin(record.gtin || record.ean);
  if(ean) return ['gtin', ean, clean(record.unit)];
  const brand = clean(record.brand);
  const explicitModel = modelCode(record.mpn);
  // Ο κωδικός από τίτλο θέλει μάρκα και διατηρεί όλα τα αριθμητικά χαρακτηριστικά και τη μονάδα.
  // Μόνο κωδικοί με ≥3 ψηφία και ≥2 γράμματα, ώστε π.χ. «IP44» να μη διαβαστεί ως μοντέλο.
  const codes = codesIn(record.name).filter(c => c.replace(/\D/g, '').length >= 3 && c.replace(/[^A-Z]/g, '').length >= 2);
  if(brand && explicitModel)
    return ['model', brand, explicitModel, clean(record.unit), Object.entries(attributes(record.name, true)).sort(([a], [b]) => byText(a, b))];
  const title = clean(record.name);
  if(brand && title.length >= 12 && /\d/.test(title)){
    // Διαφορετική σειρά λέξεων μόνο όταν υπάρχει σαφής κωδικός και όλα τα στοιχεία του τίτλου συμφωνούν.
    const key = codes.length === 1 ? title.split(/\s+/).sort(byText).join(' ') : title;
    return ['title', brand, key, clean(record.unit)];
  }
  return null;
}

function listingRecord(raw){
  const url = listingKey(raw.url);
  const name = decode(raw.name);
  if(!url || !name || !/^[a-z0-9-]+$/.test(raw.site)) throw new Error('Μη έγκυρη εγγραφή προμηθευτή');
  const path = new URL(raw.url).pathname.split('/').filter(Boolean);
  const ref = /^\d{5,}$/.test(path.at(-1)) ? path.at(-1) : (raw.site === 'homeville' ? path.at(-2) : null);
  const ikeaTitle = raw.site === 'ikea' && ref ? slug(path.at(-2)).replace(/-/g, ' ') : '';
  const title = ikeaTitle && /^[aα]π[όο]θεμα καταστημάτων$/iu.test(name) ? ikeaTitle : name;
  const amount = Number(raw.price_eur);
  const cents = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
  return {...raw, name, title, ref, ikeaTitle, cents, url};
}

export function buildProductCatalog(rawRows, sources = {}){
  const listings = new Map();
  for(const raw of rawRows){
    const row = listingRecord(raw);
    const key = JSON.stringify([row.site, supplierListingKey(row.site, raw.url)]);
    const same = listings.get(key);
    if(same){
      same.names.add(row.title);
      same.offers.set(row.url, row);
    } else listings.set(key, {key, row, names: new Set([row.title]), offers: new Map([[row.url, row]])});
  }

  const candidates = new Map();
  // Όταν μία καταχώριση δίνει μάρκα και το ίδιο εμπορικό όνομα την περιέχει ρητά,
  // η άλλη καταχώριση μπορεί να παραλείπει το χωριστό πεδίο μάρκας.
  const brandsByTitle = new Map();
  for(const {row} of listings.values()){
    const title = clean(row.name), brand = clean(row.brand);
    if(brand.length < 3 || !(' ' + title + ' ').includes(' ' + brand + ' ')) continue;
    const known = brandsByTitle.get(title);
    brandsByTitle.set(title, known === undefined || known === brand ? brand : null);
  }
  for(const listing of listings.values()){
    const row = listing.row;
    const id = identity({...row, brand: row.brand || brandsByTitle.get(clean(row.name))});
    if(!id) continue;
    const key = JSON.stringify(id);
    const group = candidates.get(key) ?? [];
    group.push(listing);
    candidates.set(key, group);
  }
  const groups = new Map(listings);
  for(const [key, group] of candidates){
    // Πολλοί κωδικοί του ίδιου καταστήματος για τον ίδιο τίτλο μπορεί να είναι κρυμμένες παραλλαγές.
    if(group.length < 2 || (JSON.parse(key)[0] !== 'gtin' && new Set(group.map(l => l.row.site)).size !== group.length)) continue;
    for(const l of group) groups.delete(l.key);
    groups.set(key, group);
  }

  const products = [];
  for(const [key, value] of groups){
    const group = Array.isArray(value) ? value : [value];
    const rows = group.flatMap(l => [...l.offers.values()]);
    const names = [...new Set(group.flatMap(l => [...l.names]))].sort(byText);
    const [first] = [...rows].sort((a, b) => Number(Boolean(b.brand)) - Number(Boolean(a.brand)) || byText(a.title, b.title) || byText(a.url, b.url));
    const archived = rows.filter(r => r.cents && /^\d{4}-\d{2}-\d{2}$/.test(r.price_date))
      .sort((a, b) => byText(b.price_date, a.price_date) || a.cents - b.cents || byText(a.site, b.site))[0];
    const aliases = [...new Set([...names, ...rows.map(r => r.ikeaTitle)])].filter(n => n && n !== first.title);
    const id = createHash('sha256').update(key).digest('hex').slice(0, 24);
    products.push({
      row: [id, first.title, first.brand || '', first.unit || '', aliases,
        archived ? [archived.cents, archived.price_date, archived.site] : null, ''],
      distinctTitle: first.ikeaTitle && clean(first.ikeaTitle) !== clean(first.title) ? first.ikeaTitle : (first.ref || ''),
      source: first.site,
      offers: rows.map(r => [r.site, r.url, r.cents, r.price_date ?? null]).sort((a, b) => byText(a[0], b[0]) || byText(a[1], b[1])),
    });
  }
  const titleCounts = new Map();
  for(const {row} of products){
    const key = clean(row[1]);
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }
  for(const p of products){
    if(titleCounts.get(clean(p.row[1])) > 1){
      p.row[6] = [p.distinctTitle || slug(p.offers[0][1].split('/').at(-1)).slice(0, 80), p.source].filter(Boolean).join(' · ');
    }
  }
  products.sort((a, b) => byText(clean(a.row[1]), clean(b.row[1])) || byText(a.row[0], b.row[0]));
  return {
    search: {entries: rawRows.length, products: products.map(p => p.row)},
    supply: {sources, products: products.map(p => [p.row[0], p.offers])},
  };
}

export function loadSearchCatalog(){
  return JSON.parse(gunzipSync(readFileSync(searchFile)));
}

export function loadSupplyCatalog(){
  return JSON.parse(gunzipSync(readFileSync(sourceFile)));
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const raw = process.argv[2];
  if(!raw) throw new Error('Χρήση: node tools/catalog/product-catalog.mjs /διαδρομή/προς/raw');
  const names = readdirSync(raw).sort(byText);
  const rows = names.filter(n => n.endsWith('.jsonl')).flatMap(n =>
    readFileSync(resolve(raw, n), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)));
  const sources = {};
  for(const name of names.filter(n => n.endsWith('.report.json'))){
    const r = JSON.parse(readFileSync(resolve(raw, name), 'utf8'));
    sources[r.site] = {origin: new URL(r.url).origin, method: r.method,
      categories: [...new Set(r.categories.filter(c => c.found && c.url).map(c => c.url))]};
  }
  if(!rows.length) throw new Error('Δεν βρέθηκαν εγγραφές JSONL');
  const {search, supply} = buildProductCatalog(rows, sources);
  writeFileSync(searchFile, gzipSync(JSON.stringify(search), {level: 9}));
  writeFileSync(sourceFile, gzipSync(JSON.stringify(supply), {level: 9}));
  console.log(`${rows.length} εγγραφές · ${search.products.length} προϊόντα · ${rows.length - search.products.length} συγχωνευμένες εγγραφές`);
}
