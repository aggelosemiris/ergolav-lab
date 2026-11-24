// Τιμές για όλες τις παραλλαγές των λιστών υλικών (src/material-prices.js, tools/prices/materials-prices.mjs).
// Κανόνας: καλύτερα χωρίς τιμή παρά λάθος τιμή. Κάθε κανόνας αυστηρότητας εδώ προήλθε από πραγματικό λάθος ταίριασμα.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withUnits, variantProducts, unitPriceMaterial, materialReference, compactPrices, materialRefFor } from '../src/material-prices.js';
import { matchItem } from '../src/price-match.js';
import { priceMaterials } from '../tools/prices/materials-prices.mjs';
import { EXCLUDE } from '../tools/sw-manifest.mjs';

const lists = items => ({trades: [{id: 't', name: 'Τ', groups: [{name: 'Ο', items}]}]});
const item = (id, name, unit, synonyms, variants) => ({id, name, unit, synonyms, variants, taxonomy: null});
const prod = (list, key) => variantProducts(lists(list)).find(p => p.key === key);
const ok = (p, name) => matchItem(p.spec, {name}).ok;

test('η μονάδα της τελευταίας παραλλαγής πάει στους σκέτους αριθμούς πριν από αυτή', () => {
  assert.deepEqual(withUnits(['45', '50', '100 εκ.', 'επικρεμάμενος']), ['45 εκ.', '50 εκ.', '100 εκ.', 'επικρεμάμενος']);
  assert.deepEqual(withUnits(['400', '600 Wp', 'bifacial']), ['400 Wp', '600 Wp', 'bifacial']);
  assert.deepEqual(withUnits(['8', '12', 'τριφασικός']), ['8', '12', 'τριφασικός'], 'χωρίς μονάδα στη σειρά → ως έχουν');
});

test('παραλλαγές που δεν λένε ένα προϊόν δεν τιμολογούνται', () => {
  const ps = variantProducts(lists([
    item('heater', 'Θερμοσίφωνας ηλεκτρικός', 'τεμ.', ['θερμοσίφωνας'], ['60', '80 λ.', 'κάθετος']),
    item('mcb', 'Μικροαυτόματος', 'τεμ.', ['MCB'], ['1P 6A–40A', 'καμπύλη B/C']),
    item('brick', 'Τούβλο διάτρητο', 'τεμ.', ['τούβλο'], ['6×9×19']),
    item('sand', 'Άμμος', 'κ.μ.', ['άμμος'], ['0-4']),
    item('led', 'Σποτ LED', 'τεμ.', ['σποτ'], ['LED 6/12/18 W'])]));
  const skip = Object.fromEntries(ps.map(p => [p.key, p.skip]));
  assert.equal(skip['heater|60'], null); assert.equal(skip['heater|80 λ.'], null);
  assert.equal(skip['heater|κάθετος'], 'variant-without-size', 'είδος με μεγέθη: «κάθετος» μόνο του δεν λέει ποιο');
  assert.equal(skip['mcb|1P 6A–40A'], 'range-variant');
  assert.equal(skip['brick|6×9×19'], 'variant-unparsed');
  assert.equal(skip['sand|0-4'], 'not-retail-unit');
  assert.equal(skip['led|LED 6/12/18 W'], 'range-variant');
});

test('συνώνυμα: όχι γενικότερα από το όνομα, όχι λέξεις παραλλαγής, όχι σκέτη σειρά μάρκας', () => {
  const list = [item('pipe-drain', 'Σωλήνας αποχέτευσης PVC', 'μ.', ['σωλήνας αποχέτευσης', 'PVC αποχέτευσης'], ['Φ110']),
    item('wc', 'Λεκάνη δαπέδου', 'τεμ.', ['λεκάνη δαπέδου', 'υψηλής πίεσης', 'floor standing WC'], ['υψηλής πίεσης (με βαλβίδα)']),
    item('sock', 'Πρίζα σούκο χωνευτή', 'τεμ.', ['Schneider Asfora', 'χωνευτή πρίζα'], ['διπλή']),
    item('ml', 'Σωλήνας πολυστρωματικός (PEX-AL-PEX)', 'μ.', ['PEX-AL-PEX'], ['Φ16'])];
  assert.equal(ok(prod(list, 'pipe-drain|Φ110'), 'Σωλήνας Valsir Αποχέτευσης Φ110x300cm'), false, 'PP ≠ PVC (απόφαση 23/11)');
  assert.equal(ok(prod(list, 'pipe-drain|Φ110'), 'Σωλήνας αποχέτευσης PVC Φ110 ανα μέτρο'), true);
  assert.equal(ok(prod(list, 'wc|υψηλής πίεσης (με βαλβίδα)'), 'Total Πλυστικό Υψηλής Πίεσης με βαλβίδα'), false);
  assert.equal(ok(prod(list, 'sock|διπλή'), 'Πρίζα Δικτύου Schneider Asfora RJ45 Διπλή'), false);
  assert.equal(ok(prod(list, 'ml|Φ16'), 'Pex-Al-Pex σωλήνας Φ16x2 κουλούρα 100m'), true, 'ό,τι γράφει το ίδιο το όνομα σε παρένθεση');
});

test('ταίριασμα: «για/με», σύνθετες λέξεις, λέξη είδους στην αρχή, αριθμοί παραλλαγής', () => {
  const list = [item('pipe', 'Σωλήνας PEX', 'μ.', [], ['Φ16']), item('cement', 'Τσιμέντο', 'σακί', ['τσιμέντο Portland'], ['25 κιλά']),
    item('tray', 'Ντουζιέρα', 'τεμ.', ['ντουζιέρα πορσελάνης'], ['80×80']), item('track', 'Στρωτήρας γυψοσανίδας', 'μ.', ['στρωτήρας UW'], ['UW 75']),
    item('cable', 'Καλώδιο εύκαμπτο', 'μ.', [], ['3×1,5']), item('utp', 'Καλώδιο δικτύου', 'μ.', [], ['Cat5e'])];
  assert.equal(ok(prod(list, 'pipe|Φ16'), 'Γωνία θηλυκή για σωλήνα PEX Φ16'), false, 'το προϊόν είναι ΓΙΑ σωλήνα');
  assert.equal(ok(prod(list, 'pipe|Φ16'), 'Σωλήνας PEX Φ16 κουλούρα 100m'), true);
  assert.equal(ok(prod(list, 'cement|25 κιλά'), 'Ρητινούχο τσιμεντοκονίαμα λευκό 25kg'), false, 'τσιμέντο ≠ τσιμεντοκονίαμα');
  assert.equal(ok(prod(list, 'tray|80×80'), 'Σωλήνας αλουμινίου κουρτίνας ντουζιέρας 80x80cm'), false, 'η ντουζιέρα είναι περιγραφή, όχι το προϊόν');
  assert.equal(ok(prod(list, 'tray|80×80'), 'Gloria ΝΤΟΥΖΙΕΡΑ 80x80cm ΗΜΙΚΥΚΛΙΚΗ'), true);
  assert.equal(ok(prod(list, 'tray|80×80'), 'ΚΑΜΠΙΝΑ ΝΤΟΥΖΙΕΡΑΣ ΤΕΤΡΑΓΩΝΗ 80x80x185cm'), false, 'καμπίνα ≠ ντουζιέρα');
  assert.equal(ok(prod(list, 'track|UW 75'), 'Στρωτήρας Knauf UW Μ300xΠ10xΥ4cm'), false, 'UW 75 ≠ UW 100');
  assert.equal(ok(prod(list, 'track|UW 75'), 'Στρωτήρας γυψοσανίδας UW 75 3m'), true);
  assert.equal(ok(prod(list, 'cable|3×1,5'), 'Μπαλαντέζα 5m με καλώδιο εύκαμπτο 3x1.5'), false, 'μπαλαντέζα ΜΕ καλώδιο ≠ καλώδιο');
  assert.equal(prod(list, 'utp|Cat5e').skip, 'variant-unparsed', 'το «Cat5e» δεν είναι αριθμός 5');
});

test('τιμή ανά κιλό / λίτρο μόνο από ρητό μέγεθος συσκευασίας', () => {
  const kg = {kind: 'kg', spec: {}}, l = {kind: 'l', spec: {}};
  assert.deepEqual(unitPriceMaterial(kg, {name: 'Στόκος 20kg', regularCents: 2480, vatIncluded: true}), {cents: 100, basis: 'pack-20kg'});
  assert.deepEqual(unitPriceMaterial(l, {name: 'Υγρό ηλιακού 10lt', regularCents: 3100, vatIncluded: true}), {cents: 250, basis: 'pack-10l'});
  assert.equal(unitPriceMaterial(kg, {name: 'Στόκος σπατουλαρίσματος', regularCents: 990, vatIncluded: true}).error, 'pack-kg-unknown');
  assert.equal(unitPriceMaterial(l, {name: 'Χρώμα 3lt & 9lt', regularCents: 990, vatIncluded: true}).error, 'pack-l-unknown', 'δύο μεγέθη → αμφίσημο');
});

test('επαληθευμένη = ≥ 2 προμηθευτές ή ≥ 3 προϊόντα· ακραίες εκτός· πολύ μεγάλο εύρος → όχι', () => {
  const o = (supplier, id, cents) => ({supplier, id, cents});
  assert.equal(materialReference([o('a', 1, 1000), o('b', 2, 1100)]).verified, true);
  assert.equal(materialReference([o('a', 1, 1000), o('a', 2, 1100)]).verified, false);
  assert.equal(materialReference([o('a', 1, 1000), o('a', 2, 1100), o('a', 3, 1200)]).verified, true);
  const r = materialReference([o('a', 1, 1000), o('b', 2, 1200), o('c', 3, 60)]);
  assert.deepEqual([r.verified, r.cents, r.dropped], [true, 1100, 1], 'τιμή ανά κιλό σε σακί δεν μετρά');
  assert.equal(materialReference([o('a', 1, 1000), o('a', 2, 1400), o('a', 3, 2600), o('a', 4, 2900)]).verified, false, '3ο/1ο τεταρτημόριο > ×2');
});

test('ολόκληρη η ροή + αρχείο για το κινητό + αναζήτηση γραμμής', () => {
  const materials = lists([item('flex-hose', 'Σπιράλ σύνδεσης', 'τεμ.', ['σπιράλ μπαταρίας'], ['30', '40 εκ.'])]);
  const it = (id, name, c) => ({id, name, regularCents: c, verification: 'verified'});
  const rows = priceMaterials({materials, itemsBySupplier: {a: [it(1, 'Σπιράλ σύνδεσης Inox 1/2" 40cm', 310)], b: [it(2, 'Σπιράλ Σύνδεσης Ferro 40cm', 372), it(3, 'Σπιράλ σύνδεσης 30cm', 300)]}});
  assert.deepEqual(rows.map(r => [r.product.key, r.ref?.verified ?? null]), [['flex-hose|30', false], ['flex-hose|40 εκ.', true]]);
  const json = compactPrices(rows, '2026-11-24');
  assert.equal(json.rows.length, 1);
  const ref = materialRefFor(json, 'δύο σπιράλ σύνδεσης 40 εκ.');
  assert.deepEqual([ref.cents, ref.n, ref.unit], [275, 2, 'τεμ.']);
  assert.equal(materialRefFor(json, 'σπιράλ σύνδεσης 50 εκ.'), null, 'άλλο μέγεθος → τίποτα');
  assert.equal(materialRefFor(json, 'κοιλοδοκός 40x40'), null);
});

test('το αρχείο του κινητού: μικρό, μόνο επαληθευμένες, έξω από το precache, φορτώνεται μόνο με το flag', () => {
  const file = new URL('../src/material-prices.json', import.meta.url);
  const raw = fs.readFileSync(file, 'utf8'), json = JSON.parse(raw);
  assert.ok(raw.length < 40000, `${raw.length} bytes`);
  assert.equal(json.v, 1); assert.match(json.at, /^\d{4}-\d\d-\d\d$/);
  for(const r of json.rows) assert.ok(r[3] > 0 && (r[4] >= 2 || r[5] >= 3), r[0]);
  assert.ok(EXCLUDE.has('src/material-prices.json'));
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /^import[^\n]*material-prices/m, 'όχι στατικό import');
  assert.match(app, /if\(CONFIG\.MATERIALS_V2_ENABLED\)\{\n\s*Promise\.all\(\[import\('\.\/material-prices\.js'\), fetch\('src\/material-prices\.json'\)/);
});
