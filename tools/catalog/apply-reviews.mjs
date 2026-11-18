// Περνά τις αποφάσεις από τις σελίδες ελέγχου (docs/review/*.html → «Εξαγωγή αποφάσεων») στο data/cases/reviews.json.
// «Εγκρίνω» → reviewed: true με όνομα και ημερομηνία. «Θέλει διόρθωση» → μένει false και το σχόλιο γράφεται στο
// data/reviews/fixes.md για να διορθωθεί. Μια απόφαση ισχύει μόνο αν το κείμενο είναι ίδιο με αυτό που είδε ο ελεγκτής
// (ίδιο αποτύπωμα)· αλλιώς αγνοείται και το λέμε.
//
// Χρήση:  node tools/catalog/apply-reviews.mjs <αρχείο.json> [άλλα αρχεία…]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileAll, loadReviews, REVIEWS } from './case-texts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXES = path.join(root, 'data/reviews/fixes.md');

/** Οι αποφάσεις ενός αρχείου πάνω στις τωρινές εγκρίσεις· επιστρέφει {reviews, applied, stale, unknown, fixes}. */
export function applyDecisions(file, current, reviews){
  if(file?.format !== 'ergolav-reviews' || !Array.isArray(file.decisions)) throw new Error('Δεν είναι αρχείο αποφάσεων ελέγχου.');
  const reviewer = String(file.reviewer || '').trim().slice(0, 80);
  if(!reviewer) throw new Error('Το αρχείο δεν έχει όνομα ελεγκτή.');
  const at = file.exported_at && !isNaN(Date.parse(file.exported_at)) ? new Date(file.exported_at).toISOString() : new Date().toISOString();
  const out = {...reviews}, res = {applied: 0, stale: [], unknown: [], fixes: []};
  for(const d of file.decisions){
    const now = current[d.key];
    if(!now){ res.unknown.push(d.key); continue; }
    if(now !== d.hash){ res.stale.push(d.key); continue; }
    if(d.verdict === 'ok') out[d.key] = {reviewed: true, reviewer, reviewed_at: at, hash: d.hash};
    else if(d.verdict === 'fix'){
      out[d.key] = {reviewed: false, reviewer, reviewed_at: at, hash: d.hash, comment: String(d.comment || '').slice(0, 2000)};
      res.fixes.push({key: d.key, comment: String(d.comment || '').trim()});
    } else continue;
    res.applied++;
  }
  return {reviews: out, ...res};
}

if(import.meta.url === pathToFileURL(process.argv[1] || '').href){
  const files = process.argv.slice(2);
  if(!files.length){ console.error('Χρήση: node tools/catalog/apply-reviews.mjs <αρχείο.json> …'); process.exit(1); }
  const {res} = await compileAll();
  const current = {};
  for(const r of Object.values(res)){
    for(const c of r.out.cases) if(c.review) current[c.review.key] = c.review.hash;
    for(const it of Object.values(r.out.items)) current[it.review.key] = it.review.hash;
    for(const x of r.out.extras) current[x.review.key] = x.review.hash;
  }
  let reviews = loadReviews();
  const fixes = [];
  for(const f of files){
    const r = applyDecisions(JSON.parse(fs.readFileSync(f, 'utf8')), current, reviews);
    reviews = r.reviews;
    fixes.push(...r.fixes.map(x => ({...x, file: path.basename(f)})));
    console.log(`${path.basename(f)}: ${r.applied} αποφάσεις${r.stale.length ? ` · ${r.stale.length} για κείμενο που άλλαξε από τότε (αγνοήθηκαν)` : ''}${r.unknown.length ? ` · ${r.unknown.length} άγνωστες` : ''}${r.fixes.length ? ` · ${r.fixes.length} για διόρθωση` : ''}`);
  }
  fs.writeFileSync(REVIEWS, JSON.stringify(Object.fromEntries(Object.entries(reviews).sort()), null, 1) + '\n');
  if(fixes.length){
    fs.mkdirSync(path.dirname(FIXES), {recursive: true});
    const head = fs.existsSync(FIXES) ? '' : '# Κείμενα για διόρθωση\n\nΑπό τις σελίδες ελέγχου. Μετά τη διόρθωση, το κείμενο ξαναπερνά από έλεγχο.\n';
    fs.appendFileSync(FIXES, head + `\n## ${new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Athens'})}\n\n` + fixes.map(x => `- \`${x.key}\` — ${x.comment || '(χωρίς σχόλιο)'} _(${x.file})_`).join('\n') + '\n');
  }
  // Ξαναχτίζονται compiled και σελίδες ελέγχου με τις νέες εγκρίσεις.
  await import('./case-texts.mjs').then(() => import('node:child_process')).then(cp => cp.execFileSync(process.execPath, [path.join(root, 'tools/catalog/case-texts.mjs')], {stdio: 'inherit'}));
}
