// Γράφει μέσα στο sw.js τη λίστα των αρχείων που κρατά ο service worker (precache) και το VERSION της.
// Εκτέλεση: npm run sw:manifest   (μετά από ΚΑΘΕ αλλαγή σε αρχείο της εφαρμογής· το npm test αποτυγχάνει αλλιώς)
//           node tools/sw-manifest.mjs --check   (μόνο έλεγχος: exit 1 αν το sw.js είναι παλιό)
//
// Η λίστα βγαίνει από το ίδιο το .github/workflows/pages.yml (η γραμμή «cp -r … _site/»), ώστε ό,τι ανεβαίνει να
// είναι και ό,τι κρατιέται. Έξω μένουν: τα αρχεία του hosting (.nojekyll, _headers), το ίδιο το sw.js, ό,τι είναι
// στο EXCLUDE και κάθε αρχείο πάνω από MAX_BYTES (αναφέρονται στην έξοδο).
// VERSION = hash των διαδρομών και των περιεχομένων: αλλάζει ΜΟΝΟ όταν αλλάξει κάποιο αρχείο της λίστας.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_BYTES = 2 * 1024 * 1024;
// Ανεβαίνουν, αλλά δεν τα χρειάζεται η εφαρμογή χωρίς σήμα.
export const EXCLUDE = new Map([
  ['media/ergolav-social-x065.mp4', 'βίντεο για τα social· δεν το χρησιμοποιεί η εφαρμογή'],
  ['src/material-prices.json', 'τιμές λιστών υλικών: μόνο με MATERIALS_V2_ENABLED (αλλιώς δεν το ζητά η εφαρμογή)'],
  ['src/product-catalog.json.gz', 'πλήρης κατάλογος: φορτώνεται μόνο στην αναζήτηση'],
  ['src/material-keys.json', 'αντιστοίχιση γραμμής → παραλλαγή: μόνο με TECH_PRICES_ENABLED (αλλιώς δεν το ζητά η εφαρμογή)'],
]);
const NOT_APP = new Set(['.nojekyll', '_headers', 'sw.js']);
export const BEGIN = '// <precache> — γράφεται από το `npm run sw:manifest`· μην το αλλάζεις με το χέρι.';
export const END = '// </precache>';
// Το sw.js είναι ο διακόπτης ανάγκης (tools/sw-off.js): καμία λίστα, κανένα VERSION.
export const OFF_MARK = '// ergolav-sw: off';
export const isOff = sw => sw.startsWith(OFF_MARK);

/** Τα αρχεία/φάκελοι που αντιγράφει το pages.yml στο _site. */
export function deployed(root = ROOT){
  const yml = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  const m = /cp -r ([^\n&]+?) _site\//.exec(yml);
  if(!m) throw new Error('pages.yml: δεν βρέθηκε η γραμμή «cp -r … _site/»');
  return m[1].trim().split(/\s+/);
}

function walk(root, rel){
  const abs = path.join(root, rel);
  if(!fs.existsSync(abs)) throw new Error(`pages.yml αντιγράφει το ${rel}, που δεν υπάρχει`);
  if(fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).filter(n => !n.startsWith('.')).sort()
    .flatMap(n => walk(root, path.posix.join(rel, n)));
}

/** {version, files, skipped: [{file, bytes, reason}]} από τα αρχεία στον δίσκο. */
export function buildManifest(root = ROOT){
  const files = [], skipped = [], h = crypto.createHash('sha256');
  const all = [...new Set(deployed(root).filter(e => !NOT_APP.has(e)).flatMap(e => walk(root, e)))].sort();
  for(const file of all){
    const buf = fs.readFileSync(path.join(root, file));
    if(EXCLUDE.has(file)){ skipped.push({file, bytes: buf.length, reason: EXCLUDE.get(file)}); continue; }
    if(buf.length > MAX_BYTES){ skipped.push({file, bytes: buf.length, reason: 'πάνω από 2 MB'}); continue; }
    files.push(file);
    h.update(`${file}\0${crypto.createHash('sha256').update(buf).digest('hex')}\n`);
  }
  return {version: h.digest('hex').slice(0, 12), files, skipped};
}

export function block({version, files}){
  return [BEGIN, `const VERSION = '${version}';`, 'const FILES = [', ...files.map(f => `  '${f}',`), '];', END].join('\n');
}

/** Το sw.js με νέο μπλοκ precache. */
export function render(sw, manifest){
  const a = sw.indexOf(BEGIN), b = sw.indexOf(END);
  if(a < 0 || b < a) throw new Error('sw.js: λείπουν οι γραμμές <precache> … </precache>');
  return sw.slice(0, a) + block(manifest) + sw.slice(b + END.length);
}

/** Ό,τι γράφει τώρα το sw.js: {version, files}. */
export function readSw(sw){
  const version = /const VERSION = '([0-9a-f]+)';/.exec(sw)?.[1] ?? null;
  const list = /const FILES = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? '';
  return {version, files: [...list.matchAll(/'([^']+)'/g)].map(m => m[1])};
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const swPath = path.join(ROOT, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  if(isOff(sw)){ console.log('sw.js: ο service worker είναι ΑΠΕΝΕΡΓΟΠΟΙΗΜΕΝΟΣ (tools/sw-off.js)· τίποτα να γραφτεί.'); process.exit(0); }
  const manifest = buildManifest();
  const next = render(sw, manifest);
  for(const s of manifest.skipped) console.log(`έξω: ${s.file} (${(s.bytes / 1024).toFixed(0)} KB) — ${s.reason}`);
  if(process.argv.includes('--check')){
    if(next !== sw){ console.error('Το sw.js είναι παλιό: τρέξε npm run sw:manifest'); process.exit(1); }
    console.log(`sw.js εντάξει · VERSION ${manifest.version} · ${manifest.files.length} αρχεία`);
  } else {
    fs.writeFileSync(swPath, next);
    console.log(`sw.js · VERSION ${manifest.version} · ${manifest.files.length} αρχεία`);
  }
}
