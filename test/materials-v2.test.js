// MATERIALS_V2 (νέες λίστες υλικών): ΚΛΕΙΣΤΟ εξ ορισμού — με false όλα μένουν όπως πριν (προμηθευτές, κανόνες, οθόνη).
// Με true / --v2: Vrontinos με τη διαγραμμένη τιμή ως κανονική, «τιμή από …»/«έλεγξέ την», η δική σου τιμή προτείνεται.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MATERIALS_V2_ENABLED } from '../src/config.js';
import { SUPPLIERS, ALTERNATES, activeSuppliers, V2_OVERRIDES } from '../tools/prices/suppliers.mjs';
import { parseVrontinos, vrontinosNetIsStruck, vrontinosItems } from '../tools/prices/adapters/html.mjs';
import { catalogProducts } from '../src/price-rules.js';
import { priceDate, ownPrice, pullOwn, registerCustom, createPriceSync, CUSTOM, CHECK_DAYS } from '../src/price-watch.js';

let data;
beforeEach(() => {
  data = {};
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, writable: true, value: {
    getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }}});
});

test('το flag είναι κλειστό και χωρίς αυτό οι προμηθευτές και οι κανόνες είναι ακριβώς οι σημερινοί', () => {
  assert.equal(MATERIALS_V2_ENABLED, false);
  assert.deepEqual(activeSuppliers(), [...SUPPLIERS, ...ALTERNATES]);
  assert.deepEqual(activeSuppliers({v2: false}), [...SUPPLIERS, ...ALTERNATES]);
  assert.deepEqual(catalogProducts(undefined, {v2: false}), catalogProducts());
  // το run.mjs διαβάζει το flag· το --v2 δεν επιτρέπεται με τη βάση
  const run = fs.readFileSync(new URL('../tools/prices/run.mjs', import.meta.url), 'utf8');
  assert.match(run, /MATERIALS_V2_ENABLED \|\| args\.includes\('--v2'\)/);
  assert.match(run, /--v2: μόνο για δοκιμή με --store file:/);
  // η εφαρμογή διαβάζει το flag με namespace import: ένα μερικό/παλιό config.js (π.χ. από cache) δεν σπάει τη φόρτωση
  for(const f of ['../src/price-watch.js', '../src/app.js'])
    assert.doesNotMatch(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /import \{[^}]*MATERIALS_V2_ENABLED[^}]*\} from '\.\/config\.js'/, f);
  // ο parser της εφαρμογής δεν ξέρει τίποτα για τις νέες λίστες
  assert.doesNotMatch(fs.readFileSync(new URL('../src/parse.js', import.meta.url), 'utf8'), /MATERIALS_V2|materials\.json/);
});

const TILE = (id, name, net, fin) => `<div class="product-tile"><div class="product-tile-title text-left eqcol"> <a href="/el/Product/${id}.aspx">${name}</a> </div>` +
  (net ? `<span class="product-tile-net-price">${net}</span> ` : '') + `<span class="product-tile-final-price">${fin}</span></div>`;

test('Vrontinos: διαγραμμένη «net» = κανονική ΜΟΝΟ αν το λέει το stylesheet του site, και μόνο αν είναι μεγαλύτερη', () => {
  const html = TILE('0001ABCD', 'ΣΙΦΩΝΙ', null, '9,00 €') + TILE('0001ABCE', 'ΒΑΝΑ', '19,00 €', '15,00 €') + TILE('0001ABCF', 'ΣΩΛΗΝΑΣ', '10,00 €', '12,00 €');
  assert.deepEqual(parseVrontinos(html).map(i => [i.verification, i.regularCents]), [['verified', 900], ['unverified', null], ['unverified', null]]);
  const v2 = parseVrontinos(html, {struckNetIsRegular: true});
  assert.deepEqual(v2.map(i => [i.verification, i.regularCents, i.currentCents, i.promo]),
    [['verified', 900, 900, false], ['verified', 1900, 1500, true], ['unverified', null, 1200, true]]);
  assert.equal(vrontinosNetIsStruck('.product-tile-net-price {\n font-size: 20px;\n text-decoration: line-through;\n}'), true);
  assert.equal(vrontinosNetIsStruck('.product-tile-net-price { font-size: 20px; }'), false);
  assert.equal(vrontinosNetIsStruck(''), false);
});

test('Vrontinos v2: χωρίς διαγραφή στο skin.css οι δύο τιμές μένουν μη επαληθευμένες· οι υποκατηγορίες μόνο με v2', async () => {
  const page = TILE('0001ABCE', 'ΒΑΝΑ', '19,00 €', '15,00 €');
  const fetcher = css => ({get: async url => ({body: url.endsWith('/skin.css') ? css : page})});
  const read = async css => { const out = []; for await (const it of vrontinosItems({fetcher: fetcher(css), categories: ['A'], labelCheck: true})) out.push(it); return out; };
  assert.equal((await read('.product-tile-net-price{text-decoration:line-through}'))[0].regularCents, 1900);
  assert.equal((await read('.product-tile-net-price{color:red}'))[0].verification, 'unverified');
  const v = activeSuppliers({v2: true}).find(s => s.id === 'vrontinos');
  assert.ok(V2_OVERRIDES.vrontinos && v.items !== SUPPLIERS.find(s => s.id === 'vrontinos').items);
  const urls = []; for await (const _ of v.items({fetcher: {get: async url => (urls.push(url), {body: ''})}, log: () => {}}));
  assert.equal(urls[0], 'https://vrontinos.gr/skin.css');
  assert.equal(new Set(urls).size, urls.length, 'κάθε σελίδα μία φορά');
  assert.ok(urls.length <= 1 + 23 && urls.every(u => !u.includes('?')), 'μόνο 1η σελίδα, χωρίς παραμέτρους');
});

test('«τιμή από …» και «έλεγξέ την» μετά από 30 ημέρες', () => {
  const now = Date.UTC(2026, 10, 23), fmt = t => new Date(t).toISOString().slice(0, 10);
  assert.deepEqual(priceDate(now - 3 * 86400e3, now, fmt), {text: 'τιμή από 2026-11-20', check: false});
  assert.equal(priceDate(now - CHECK_DAYS * 86400e3, now, fmt).check, false);
  assert.equal(priceDate(now - (CHECK_DAYS + 1) * 86400e3, now, fmt).check, true);
  assert.equal(priceDate(null, now), null);
});

test('δική μου τιμή για είδος εκτός καταλόγου: γράφεται μία φορά, προτείνεται μετά, έρχεται και από τον λογαριασμό', async () => {
  assert.equal(ownPrice('unknown|κοιλοδοκός 40x40'), null);
  registerCustom({added: true, name: 'κοιλοδοκός 40x40', unit: 'μ.', mat: 850, lab: 200}, 'unknown|κοιλοδοκός 40x40', 1000);
  assert.deepEqual(ownPrice('unknown|κοιλοδοκός 40x40'), {cents: 850, lab: 200, at: 1000});
  registerCustom({added: true, name: 'λαμαρίνα', unit: 'τ.μ.', mat: 0}, 'unknown|λαμαρίνα', 1000);
  assert.equal(ownPrice('unknown|λαμαρίνα'), null, 'το 0 («στην εργασία») δεν προτείνεται ως τιμή');

  const rows = [{key: 'unknown|κοιλοδοκός 40x40', name: 'κοιλοδοκός 40x40', unit: 'μ.', user_price_cents: 900, user_labor_cents: null, updated_at: new Date(500).toISOString()},
    {key: 'unknown|γωνιά 30x30', name: 'γωνιά 30x30', unit: 'μ.', user_price_cents: 420, user_labor_cents: 50, updated_at: new Date(2000).toISOString()},
    {key: 'unknown|χωρίς τιμή', name: 'χωρίς τιμή', unit: 'τεμ.', user_price_cents: null, updated_at: new Date(3000).toISOString()}];
  const filters = [];
  const client = {from: () => { const b = {select: () => b, eq: (c, v) => (filters.push([c, v]), Promise.resolve({data: rows, error: null}))}; return b; }};
  assert.equal(await pullOwn({client}), 1);
  assert.deepEqual(filters, [['deleted', false]]);
  assert.equal(ownPrice('unknown|κοιλοδοκός 40x40').cents, 850, 'η πιο πρόσφατη (της συσκευής) κερδίζει');
  assert.deepEqual(ownPrice('unknown|γωνιά 30x30'), {cents: 420, lab: 50, at: 2000});
  assert.equal(ownPrice('unknown|χωρίς τιμή'), null);
  assert.ok(JSON.parse(data[CUSTOM]));
});

test('συγχρονισμός: χωρίς v2 δεν διαβάζει τις δικές μου τιμές από τον λογαριασμό· με v2 ναι', async () => {
  const seen = [];
  const client = {from: t => { const b = {select: cols => (seen.push(`${t}:${cols}`), b), not: () => Promise.resolve({data: [], error: null}),
    eq: () => Promise.resolve({data: [], error: null}), in: () => Promise.resolve({data: [], error: null}), upsert: () => Promise.resolve({error: null})}; return b; }};
  await createPriceSync(async () => ({client, userId: 'u'}))(true);
  assert.ok(!seen.some(s => s.includes('user_price_cents')));
  seen.length = 0;
  const r = await createPriceSync(async () => ({client, userId: 'u'}), {v2: true})(true);
  assert.ok(seen.some(s => s.includes('user_price_cents')));
  assert.equal(r.own, 0);
});

test('κανόνες v2: κάθε συνώνυμο υπάρχει στο είδος της λίστας που δηλώνει (τα «extra» όχι — είναι προτάσεις)', async () => {
  const { V2_RULES } = await import('../src/price-rules.js');
  const json = JSON.parse(fs.readFileSync(new URL('../data/materials.json', import.meta.url), 'utf8'));
  const items = new Map(json.trades.flatMap(t => t.groups.flatMap(g => g.items)).map(i => [i.id, i]));
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for(const [code, r] of Object.entries(V2_RULES)){
    const it = items.get(r.from);
    assert.ok(it, `${code}: άγνωστο είδος λίστας ${r.from}`);
    const words = [it.name, ...it.synonyms].map(norm);
    for(const list of [...Object.values(r.alt || {}), r.any || []]) for(const s of list) assert.ok(words.some(w => w.includes(norm(s))), `${code}: «${s}» δεν είναι στο ${r.from}`);
    for(const list of [...Object.values(r.extra || {}), r.anyExtra || []]) for(const s of list) assert.ok(!words.some(w => w.includes(norm(s))), `${code}: «${s}» είναι ήδη στη λίστα — μετακίνησέ το στο alt`);
  }
});

test('ταίριασμα v2: γραφές προμηθευτών που πριν χάνονταν, και αποκλεισμοί για αυστηρότητα', async () => {
  const { catalogProducts } = await import('../src/price-rules.js');
  const { specFor, matchItem, unitPrice, attributes } = await import('../src/price-match.js');
  const spec = (ref, v2) => { const p = catalogProducts(undefined, {v2}).find(x => x.ref === ref); return specFor(p, p.rule); };
  const ok = (ref, name, v2 = true) => matchItem(spec(ref, v2), {name}).ok;
  // διαστάσεις με κολλητό «cm»
  assert.equal(ok('bathtub|ΚΩΔ. 24170', 'Μπανιέρα Ακρυλική Astra 170x70cm', false), false);
  assert.equal(ok('bathtub|ΚΩΔ. 24170', 'Μπανιέρα Ακρυλική Astra 170x70cm'), true);
  assert.equal(ok('bathtub|ΚΩΔ. 24160', 'Μπανιέρα Ακρυλική Astra 170x70cm'), false);
  // συλλέκτης «4 Παροχών»
  assert.equal(ok('manifold|ΚΩΔ. 27004', 'Συλλέκτης Μπάρα 4 Παροχών 1\'\''), true);
  assert.equal(ok('manifold|ΚΩΔ. 27003', 'Συλλέκτης Μπάρα 4 Παροχών 1\'\''), false);
  assert.equal(ok('manifold|ΚΩΔ. 27004', 'Συλλέκτης ενδοδαπέδιας 4 κυκλωμάτων με ροόμετρα'), false);
  // μικροαυτόματος = MCB, αμπέρ από την καμπύλη· όχι RCBO
  assert.equal(ok('fuse|ΚΩΔ. 64016', 'Mcb 1P C16 4,5Ka 1M'), true);
  assert.equal(ok('fuse|ΚΩΔ. 64010', 'Mcb 1P C16 4,5Ka 1M'), false);
  assert.equal(ok('fuse|ΚΩΔ. 64016', 'Mcb 3P C16 6Ka 3M'), false);
  assert.equal(ok('fuse|ΚΩΔ. 64016', 'Mcb 1P C16 4,5Ka 1M', false), false);
  // ρελέ διαφυγής = «διαρροής», 2 πόλοι από «2x40A» ή «Διπολικό»· όχι συνδυασμός ή τετραπολικό
  assert.equal(ok('fuse|ΚΩΔ. 64140', 'Ρελέ Gacia Διαρροής 2x40A 30mA Type AC'), true);
  assert.equal(ok('fuse|ΚΩΔ. 64140', 'TX3 Ρελέ Διαρροής Legrand Τύπου Ac, Διπολικό, 30Ma, 40A'), true);
  assert.equal(ok('fuse|ΚΩΔ. 64140', 'TX3 Ρελέ Διαρροής Legrand Τύπου Ac, Τετραπολικο, 30Ma, 40A'), false);
  assert.equal(ok('fuse|ΚΩΔ. 64140', 'ΣΥΝΔΥΑΣΜΟΣ ΡΕΛΕ ΔΙΑΡΡΟΗΣ JEL4 C40 2P 40A/30MA'), false);
  // σωλήνες: διάμετρος με πάχος, μήκος σε εκ.· όχι εργαλεία
  assert.equal(ok('pipe|ΚΩΔ. 40325', 'Θερμοκολλητικός σωλήνας PPR Φ25 x 4,2 – 4m'), true);
  assert.equal(ok('pipe|ΚΩΔ. 40325', 'RAIDER Καλούπι για σωλήνες PPR για συγκόλληση Φ25 123109'), false);
  assert.equal(ok('pipe|ΚΩΔ. 40325', 'RAIDER Καλούπι για σωλήνες PPR για συγκόλληση Φ25 123109', false), true, 'σήμερα ταιριάζει (το πιάνει μόνο ο έλεγχος αληθοφάνειας)');
  assert.deepEqual(unitPrice(spec('pipe|ΚΩΔ. 40325', true), {name: 'Θερμοκολλητικός σωλήνας PPR Φ25 x 4,2 – 4m', regularCents: 650, vatIncluded: true}), {cents: 131, basis: 'pack-4m'});
  assert.equal(ok('pipe|ΚΩΔ. 40216', 'Σωλήνας PEX-AL-PEX Φ16x2 κουλούρα 100m'), true);
  assert.equal(ok('pipe|ΚΩΔ. 40216', 'Σωλήνας Pex Φ.16mm-200cm'), false, 'απλό PEX ≠ πολυστρωματικός');
  // καλώδιο: NYMHY (εύκαμπτο) δεν είναι ΝΥΜ
  assert.equal(ok('cable|ΚΩΔ. 61060', 'Καλώδιο Εύκαμπτο NYMHY (A05VV-F) 3Χ6mm2 Λευκό'), false);
  assert.equal(ok('coupling|ΚΩΔ. 42216', 'ΡΑΚΟΡ ΣΕΤ Φ16 x 2″ ΠΟΛΥΣΤΡΩΜΑΤΙΚΟΥ ΣΩΛΗΝΑ'), false);
  // πίνακας: η «πόρτα» του πίνακα δεν αποκλείει, αλλά η «Πόρτα για πίνακα» όχι· «Βρύση μπαλκονιού» = βρύση κήπου
  assert.equal(ok('panel|ΚΩΔ. 63036', 'Πινακεσ N36-Alfa 36 Θεσεων 3 Σειρων Πλαστικοι Επιτοιχοι Με Διαφανη Πλαστικη Πορτα'), true);
  assert.equal(ok('panel|ΚΩΔ. 63036', 'Πινακεσ N36-Alfa 36 Θεσεων 3 Σειρων Πλαστικοι Επιτοιχοι Με Διαφανη Πλαστικη Πορτα', false), false);
  assert.equal(ok('panel|ΚΩΔ. 63036', 'Πόρτα για πίνακα 36 θέσεων πλαστική'), false);
  assert.equal(ok('tap|ΚΩΔ. 71010', 'Βρύση μπαλκονιού αντιπαγωτική 1/2″ σφαιρική με ρακόρ RIDA'), true);
  // PP ≠ PVC: χωριστό είδος, μόνο με ρητό «PP»/«πολυπροπυλένιο»
  const pp = () => { const p = catalogProducts(undefined, {v2: true}).find(x => x.ref === 'materials:pipe-drain-pp|Φ110'); return specFor(p, p.rule); };
  assert.equal(matchItem(pp(), {name: 'Σωλήνας αποχέτευσης PP Φ110 3m'}).ok, true);
  assert.equal(matchItem(pp(), {name: 'Σωλήνας Valsir Αποχέτευσης Φ110x300cm'}).ok, false);
  assert.equal(matchItem(pp(), {name: 'Σωλήνας αποχέτευσης PVC Φ110 ανα μέτρο'}).ok, false);
  assert.equal(ok('pipe|ΚΩΔ. 41110', 'Σωλήνας αποχέτευσης PP Φ110 3m'), false);
  assert.equal(catalogProducts().some(x => x.ref.startsWith('materials:')), false, 'χωρίς v2 δεν προστίθεται');
  // διάμετρος σωλήνα με μήκος δεν γίνεται «διάσταση»
  assert.deepEqual(attributes('Σωλήνας Valsir Αποχέτευσης Φ.110X200cm', true).diam, ['110']);
  assert.equal(attributes('Σωλήνας Valsir Αποχέτευσης Φ.110X200cm', true).size, undefined);
  // τα κλειδιά v2 είναι χωριστά (νέες εγγραφές price_products μόνο όταν ανοίξει το flag)
  assert.match(spec('heater|ΚΩΔ. 30080', true).key, /^v2;/);
  assert.match(spec('heater|ΚΩΔ. 30080', false).key, /^v1;/);
});
