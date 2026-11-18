// Μέρος 2: τα κείμενα των περιπτώσεων. Πηγή: data/cases/texts/<υλικό>.mjs (σημεία με κανονική/απλή/σύντομη εκδοχή,
// σύνθεση κάθε περίπτωσης από σημεία, επιπλέον βήματα) και οι σημερινές αναλύσεις (data/analyses, ΑΘΙΚΤΕΣ).
// Ελέγχει κάθε περίπτωση με τους κανόνες της Φάσης 4, και σε τις τρεις εκδοχές λόγου, γράφει το
// data/cases/compiled/<υλικό>.json (με τα reviewed από το data/cases/reviews.json) και τις σελίδες ελέγχου docs/review/.
//
// Χρήση:  node tools/catalog/case-texts.mjs           (έλεγχος + compiled + σελίδες ελέγχου)
//         node tools/catalog/case-texts.mjs --check
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SECTIONS, validateAnalysis, LICENSED_NOTE } from '../../src/analysis-schema.js';
import { cases, caseLabel } from '../../src/case-map.js';
import { loadMap } from './analysis-map.mjs';
import { CATALOG } from '../../src/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEXTS = path.join(root, 'data/cases/texts');
export const REVIEWS = path.join(root, 'data/cases/reviews.json');
const KEYS = SECTIONS.map(s => s.key);
const PLACEHOLDER = /\{([^}]*)\}/g, ALLOWED = new Set(['ποσότητα']);

export const written = () => Object.assign({}, ...fs.readdirSync(path.join(root, 'data/analyses')).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(root, 'data/analyses', f), 'utf8')).analyses));
export const loadReviews = () => fs.existsSync(REVIEWS) ? JSON.parse(fs.readFileSync(REVIEWS, 'utf8')) : {};
export const hash = v => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
const nums = s => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).sort().join(' ');

/** Οι συνταγές που έχουν γραφτεί: {υλικό: module}. */
export async function loadRecipes(){
  const out = {};
  if(!fs.existsSync(TEXTS)) return out;
  for(const f of fs.readdirSync(TEXTS).filter(f => f.endsWith('.mjs')).sort()){
    const mod = (await import(pathToFileURL(path.join(TEXTS, f)).href + `?t=${Date.now()}`)).default;
    out[mod.material] = mod;
  }
  return out;
}

/** Όλα τα κείμενα ενός υλικού: σημεία (νέα και σημερινά) με n/s/c, περιπτώσεις σε όλες τις εκδοχές, επιπλέον βήματα. */
export function compileMaterial(m, recipe, all = written(), reviews = loadReviews()){
  const err = [];
  const items = {};      // id → {section, n, s, c, source: 'new'|'current'}
  for(const [id, [section, n, s, c]] of Object.entries(recipe.items || {})){
    if(!KEYS.includes(section)) err.push(`${id}: άγνωστη ενότητα ${section}`);
    if(all[id.split('.')[0]]) err.push(`${id}: τα νέα σημεία δεν παίρνουν id σημερινής ανάλυσης`);
    items[id] = {section, n, s, c, source: 'new'};
  }
  const current = id => {
    const [task, section] = id.split('.');
    const it = all[task]?.sections.find(x => x.key === section)?.items.find(i => i.id === id);
    if(!it) return null;
    const v = recipe.variants?.[id];
    return items[id] ??= {section, n: it.text, s: v?.[0], c: v?.[1], source: 'current'};
  };
  const get = id => items[id] || current(id);
  const trade = all[m.base[0].task].trade;
  const list = cases(m);
  const out = {material: m.id, name: m.name, cases: [], extras: []};

  for(const c of list){
    const label = caseLabel(m, c.answers);
    if(c.source !== 'new'){
      const a = all[c.task];
      for(const s of a.sections) for(const i of s.items) current(i.id);
      out.cases.push({id: c.id, label, answers: c.answers, source: c.source, task: c.task, title: a.title, duration: a.typical_duration,
        licensed: a.requires_licensed_professional, sections: Object.fromEntries(a.sections.map(s => [s.key, s.items.map(i => i.id)]))});
      continue;
    }
    let comp;
    try { comp = recipe.compose(c.answers); } catch(e){ err.push(`${c.id}: η σύνθεση απέτυχε (${e.message})`); continue; }
    const sections = {};
    for(const k of KEYS){
      const ids = comp[k] || [];
      if(new Set(ids).size !== ids.length) err.push(`${c.id}: διπλό σημείο στο «${k}»`);
      for(const id of ids){
        const it = get(id);
        if(!it) err.push(`${c.id}: άγνωστο σημείο ${id}`);
        else if(it.section !== k) err.push(`${c.id}: το ${id} είναι «${it.section}», όχι «${k}»`);
      }
      sections[k] = ids;
    }
    const licensed = comp.licensed ?? all[m.base[0].task].requires_licensed_professional;
    out.cases.push({id: c.id, label, answers: c.answers, source: 'new', title: comp.title, duration: comp.duration, licensed, sections});
  }
  for(const x of recipe.extras || []){
    const id = x.ref || x.id;
    if(x.ref && !get(x.ref)) err.push(`extra ${x.ref}: άγνωστο σημείο`);
    if(!x.ref) items[x.id] = {section: x.section, n: x.n, s: x.s, c: x.c, source: 'new'};
    const sec = get(id)?.section;
    out.extras.push({id, section: sec, when: x.when || null});
  }

  // Έλεγχος κάθε περίπτωσης σε τις τρεις εκδοχές, με τους κανόνες της Φάσης 4.
  for(const c of out.cases) for(const v of ['n', 's', 'c']){
    const a = {id: m.base[0].task, title: c.title, trade, typical_duration: c.duration, related_consumables: [],
      requires_licensed_professional: c.licensed, notes_for_master: '',
      sections: SECTIONS.map(s => ({key: s.key, title: s.title, items: (c.sections[s.key] || []).map(id => get(id)?.[v] ?? '')}))};
    for(const e of validateAnalysis(a, {withIds: false})) err.push(`${c.id} [${v}]: ${e}`);
  }
  // Κάθε σημείο που χρησιμοποιείται: απλή και σύντομη, ίδιοι αριθμοί, σύντομη όχι μεγαλύτερη.
  const used = new Set([...out.cases.flatMap(c => Object.values(c.sections).flat()), ...out.extras.map(x => x.id)]);
  for(const id of used) checkItem(id, get(id), err, ALLOWED);
  for(const id of Object.keys(recipe.items || {})) if(!used.has(id)) err.push(`${id}: δεν χρησιμοποιείται πουθενά`);
  for(const id of Object.keys(recipe.variants || {})) if(!used.has(id)) err.push(`${id}: εκδοχή για σημείο που δεν χρησιμοποιείται`);

  const review = reviewer(reviews);
  for(const c of out.cases) if(c.source !== 'base')
    c.review = review(`case:${c.id}`, {title: c.title, duration: c.duration, sections: Object.fromEntries(Object.entries(c.sections).map(([k, ids]) => [k, ids.map(id => get(id)?.n)]))});
  for(const x of out.extras) x.review = review(`extra:${m.id}:${x.id}`, {n: get(x.id)?.n, when: x.when});
  out.items = Object.fromEntries([...used].sort().map(id => {
    const it = get(id);
    return [id, {...it, review: review(`sc:${id}`, {n: it?.n, s: it?.s, c: it?.c})}];
  }));
  out.licensedNote = LICENSED_NOTE;
  return {out, err};
}

/** Απλή και σύντομη εκδοχή ενός σημείου: υπάρχουν, μήκος, ίδιοι αριθμοί, σύντομη όχι μεγαλύτερη, μόνο γνωστές θέσεις. */
function checkItem(id, it, err, allowed){
  if(!it) return;
  if(!it.s || !it.c){ err.push(`${id}: λείπει απλή ή σύντομη εκδοχή`); return; }
  for(const [v, t] of [['s', it.s], ['c', it.c]]){
    if(t.length < 8 || t.length > 320) err.push(`${id} [${v}]: μήκος ${t.length}`);
    if(nums(t) !== nums(it.n)) err.push(`${id} [${v}]: άλλοι αριθμοί από την κανονική (${nums(it.n) || '—'} / ${nums(t) || '—'})`);
  }
  if(it.c.length > it.n.length) err.push(`${id} [c]: η σύντομη είναι μεγαλύτερη από την κανονική`);
  if(it.s === it.n) err.push(`${id} [s]: ίδια με την κανονική`);
  for(const t of [it.n, it.s, it.c]) for(const [, p] of t.matchAll(PLACEHOLDER)) if(!allowed.has(p)) err.push(`${id}: άγνωστη θέση {${p}}`);
}

/** Εγκρίσεις: ισχύουν μόνο για το κείμενο που εγκρίθηκε (ίδιο αποτύπωμα). */
const reviewer = reviews => (key, content) => {
  const h = hash(content), r = reviews[key];
  return {key, hash: h, reviewed: !!(r?.reviewed && r.hash === h), reviewer: r?.hash === h ? r.reviewer ?? null : null, reviewed_at: r?.hash === h ? r.reviewed_at ?? null : null};
};

// Γενικές κατηγορίες (για υλικά εκτός καταλόγου): μία ανάλυση ανά κατηγορία του χάρτη, με τη θέση {είδος}
// = το όνομα που έγραψε ο μάστορας, σε αιτιατική με άρθρο («τις σίτες»). Πηγή: data/cases/generic-texts.mjs.
const GENERIC = path.join(root, 'data/cases/generic-texts.mjs');
const GENERIC_ALLOWED = new Set(['ποσότητα', 'είδος']);
export const GENERIC_SAMPLE = 'το κρεμαστό ντουλάπι';   // για τον έλεγχο μήκους και κανόνων
const count = (t, s) => String(t).split(s).length - 1;

export async function loadGeneric(){
  return fs.existsSync(GENERIC) ? (await import(pathToFileURL(GENERIC).href + `?t=${Date.now()}`)).default : null;
}

export function compileGeneric(map, recipe, reviews = loadReviews()){
  const err = [], items = {};
  const out = {material: 'generic', name: 'Γενικές κατηγορίες', cases: [], extras: [],
    note: '{είδος} = το όνομα που γράφει ο μάστορας, με άρθρο σε αιτιατική, π.χ. «τις σίτες», «το ράφι». Ο μάστορας το βλέπει και το διορθώνει πριν το κρατήσει.'};
  for(const id of Object.keys(recipe.categories)) if(!map.generic.some(g => g.id === id)) err.push(`generic:${id}: δεν υπάρχει στον χάρτη`);
  for(const g of map.generic){
    const cat = recipe.categories[g.id];
    if(!cat){ err.push(`generic:${g.id}: λείπει το κείμενο`); continue; }
    const sections = Object.fromEntries(KEYS.map(k => [k, (cat[k] || []).map(([n, s, c], i) => {
      const id = `generic.${g.id}.${k}.${i + 1}`;
      items[id] = {section: k, n, s, c, source: 'new'};
      return id;
    })]));
    const ids = Object.values(sections).flat();
    if(!ids.some(id => items[id].n.includes('{είδος}'))) err.push(`generic:${g.id}: κανένα σημείο δεν έχει τη θέση {είδος}`);
    if(String(cat.title).includes('{')) err.push(`generic:${g.id}: ο τίτλος δεν παίρνει θέσεις`);
    out.cases.push({id: `generic:${g.id}`, label: `${g.name} · π.χ. ${g.examples.join(', ')}`, answers: {}, source: 'new',
      title: cat.title, duration: cat.duration, licensed: !!cat.licensed, safety: g.safety || null, sections});
  }
  const fill = t => String(t).replaceAll('{είδος}', GENERIC_SAMPLE);
  for(const c of out.cases) for(const v of ['n', 's', 'c']){
    const a = {id: c.id.replace(':', '-'), title: c.title, trade: 'υδραυλικός', typical_duration: c.duration, related_consumables: [],
      requires_licensed_professional: c.licensed, notes_for_master: '',
      sections: SECTIONS.map(s => ({key: s.key, title: s.title, items: (c.sections[s.key] || []).map(id => fill(items[id][v]))}))};
    for(const e of validateAnalysis(a, {withIds: false})) err.push(`${c.id} [${v}]: ${e}`);
  }
  for(const [id, it] of Object.entries(items)){
    checkItem(id, it, err, GENERIC_ALLOWED);
    // Η θέση {είδος}: ίδιες φορές στην απλή, όχι περισσότερες στη σύντομη.
    if(count(it.s, '{είδος}') !== count(it.n, '{είδος}')) err.push(`${id} [s]: άλλες φορές η θέση {είδος} από την κανονική`);
    if(count(it.c, '{είδος}') > count(it.n, '{είδος}')) err.push(`${id} [c]: περισσότερες φορές η θέση {είδος}`);
  }
  const review = reviewer(reviews);
  for(const c of out.cases)
    c.review = review(`case:${c.id}`, {title: c.title, duration: c.duration, sections: Object.fromEntries(Object.entries(c.sections).map(([k, ids]) => [k, ids.map(id => items[id].n)]))});
  out.items = Object.fromEntries(Object.keys(items).sort().map(id => [id, {...items[id], review: review(`sc:${id}`, {n: items[id].n, s: items[id].s, c: items[id].c})}]));
  out.licensedNote = LICENSED_NOTE;
  return {out, err};
}

export async function compileAll(){
  const map = loadMap(), recipes = await loadRecipes(), all = written(), reviews = loadReviews();
  const res = {};
  for(const m of map.materials) if(recipes[m.id]) res[m.id] = compileMaterial(m, recipes[m.id], all, reviews);
  const generic = await loadGeneric();
  if(generic) res.generic = compileGeneric(map, generic, reviews);
  // Το ίδιο σημείο σε πολλά υλικά: παντού ίδια κείμενα (μία έγκριση, ίδιο κλειδί).
  const seen = {};
  for(const [mid, r] of Object.entries(res)) for(const [id, it] of Object.entries(r.out.items)){
    const v = JSON.stringify([it.n, it.s, it.c]);
    if(seen[id] && seen[id].v !== v) r.err.push(`${id}: άλλα κείμενα από το «${seen[id].mid}»`);
    seen[id] ??= {v, mid};
  }
  return {map, res};
}

/**
 * Τα δεδομένα της εφαρμογής (src/cases-data.js): ο χάρτης των υλικών και ΜΟΝΟ ό,τι έχει εγκριθεί — περιπτώσεις,
 * απλές/σύντομες εκδοχές, επιπλέον βήματα, γενικές κατηγορίες. Τα σημερινά κείμενα (κανονική εκδοχή των βασικών)
 * μένουν στο src/analyses-data.js· εδώ μπαίνει μόνο ό,τι προστίθεται δίπλα τους.
 */
export function appData(map, res){
  const ok = r => !!r?.reviewed;
  const out = {materials: map.materials.map(({id, name, acc, catalog, questions, exclude, base, existing}) =>
      ({id, name, acc, catalog, questions, ...(exclude && {exclude}), base, ...(existing && {existing})})),
    genericCategories: map.generic, cases: {}, items: {}, extras: {}, generic: {}};
  // «Μοιάζει με…»: οι όροι κάθε υλικού και κάθε γενικής κατηγορίας (ονόματα, κατάλογος, τύποι και εργασίες του tools/catalog).
  const tax = JSON.parse(fs.readFileSync(path.join(root, 'data/taxonomy.json'), 'utf8'));
  const types = Object.values(tax.trades).flatMap(c => Object.values(c).flatMap(t => Object.values(t)));
  const forTasks = tasks => [...types.filter(ty => tasks.includes(ty.task)).map(ty => ty.name), ...tasks.map(id => tax.tasks[id]?.title).filter(Boolean)];
  const uniq = a => [...new Set(a.filter(Boolean))];
  out.similar = map.materials.map(m => {
    const items = m.catalog.map(k => k.split(':')).map(([id, label]) => ({item: CATALOG.find(c => c.id === id), label}));
    return {m: m.id, t: uniq([m.name, ...items.flatMap(({item, label}) => item ? [label ? `${item.name} ${label}` : item.name, ...(label ? [] : (item.options || []).map(o => `${item.name} ${o.label}`))] : []),
      ...forTasks([...m.base, ...(m.existing || [])].map(b => b.task))]),
      // Οι απαντήσεις του χάρτη: βοηθούν τις άλλες λέξεις («σιφόνι μπανιέρας»), ποτέ το κεφάλι.
      x: uniq(m.questions.flatMap(q => q.answers.map(a => a.label)))};
  });
  out.genericTerms = map.generic.map(g => ({g: g.id, t: uniq([g.name, ...g.examples, ...forTasks(g.from)])}));
  out.promoted = map.promoted || {};
  const need = new Set();
  for(const [mid, r] of Object.entries(res)){
    for(const c of r.out.cases){
      if(c.source === 'base' || !ok(c.review)) continue;
      const entry = {title: c.title, duration: c.duration, licensed: !!c.licensed, sections: c.sections};
      if(mid === 'generic') out.generic[c.id.slice('generic:'.length)] = entry; else out.cases[c.id] = entry;
      Object.values(c.sections).flat().forEach(id => need.add(id));
    }
    for(const x of r.out.extras) if(ok(x.review)){ (out.extras[mid] ??= []).push({id: x.id, section: x.section, when: x.when}); need.add(x.id); }
    for(const [id, it] of Object.entries(r.out.items)){
      const e = {...(need.has(id) && {section: it.section, n: it.n}), ...(ok(it.review) && {s: it.s, c: it.c})};
      if(Object.keys(e).length) out.items[id] = {...out.items[id], ...e};
    }
  }
  return out;
}
export function appDataSource(data){
  return `// Παράγεται από το tools/catalog/case-texts.mjs (χάρτης + ΜΟΝΟ τα εγκεκριμένα κείμενα)· μην το αλλάζεις με το χέρι.\n` +
    `// Τα σημερινά κείμενα των αναλύσεων είναι στο src/analyses-data.js και δεν αλλάζουν.\n` +
    `export const CASE_DATA = ${JSON.stringify(data)};\n`;
}

if(import.meta.url === pathToFileURL(process.argv[1] || '').href){
  const {map, res} = await compileAll();
  const errors = Object.values(res).flatMap(r => r.err);
  if(errors.length){ console.error(errors.slice(0, 80).map(e => `✗ ${e}`).join('\n') + (errors.length > 80 ? `\n… και ${errors.length - 80} ακόμα` : '')); process.exit(1); }
  if(!process.argv.includes('--check')){
    fs.mkdirSync(path.join(root, 'data/cases/compiled'), {recursive: true});
    for(const [id, r] of Object.entries(res)) fs.writeFileSync(path.join(root, `data/cases/compiled/${id}.json`), JSON.stringify(r.out, null, 1) + '\n');
    const {writeReviewPages} = await import('./review-pages.mjs');
    writeReviewPages(map, res);
    fs.writeFileSync(path.join(root, 'src/cases-data.js'), appDataSource(appData(map, res)));
  }
  for(const [id, r] of Object.entries(res)){
    const o = r.out, n = s => o.cases.filter(c => c.source === s).length, items = Object.values(o.items);
    console.log(`${id.padEnd(14)} περιπτώσεις: ${o.cases.length} (νέες ${n('new')}, έτοιμο κείμενο ${n('existing')}, βασική ${n('base')}) · σημεία: ${items.length} (νέα ${items.filter(i => i.source === 'new').length}) · επιπλέον βήματα: ${o.extras.length}`);
  }
}
