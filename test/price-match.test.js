// Ντετερμινιστική αντιστοίχιση προϊόντων (src/price-match.js) και κανόνες του καταλόγου (src/price-rules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributes, specFor, matchItem, unitPrice, reference, median, gtin, modelCode, packLength, packCount, specific, unitOf }
  from '../src/price-match.js';
import { catalogProducts } from '../src/price-rules.js';

const CAT = catalogProducts();
const cat = ref => { const p = CAT.find(x => x.ref === ref); assert.ok(p, ref); return specFor(p, p.rule); };
const ok = (spec, name, extra = {}) => matchItem(spec, {name, ...extra}).ok;

test('χαρακτηριστικά: κιλά, λίτρα, διαστάσεις, διατομή, ίντσες, αμπέρ, πόλοι, γούρνες (και με ελληνικές μονάδες)', () => {
  assert.deepEqual(attributes('Κόλλα πλακιδίων 25 κιλά'), {kg: ['25']});
  assert.deepEqual(attributes('Θερμοσίφωνας 80lt δαπέδου'), {l: ['80']});
  assert.deepEqual(attributes('Πλακάκι 30χ60 λευκό'), {size: ['30x60']});
  assert.deepEqual(attributes('Καλώδιο ΝΥΜ 3Χ2,5'), {sec: ['3x2.5']});
  assert.deepEqual(attributes('Βάνα σφαιρική 3/4"'), {inch: ['3/4']});
  assert.deepEqual(attributes('Μικροαυτόματος 1P 16A'), {poles: ['1'], a: ['16']});
  assert.deepEqual(attributes('Νεροχύτης 1½ γούρνα'), {trough: ['1.5']});
  assert.deepEqual(attributes('Σωλήνας πολυστρωματικός 16x2mm'), {diam: ['16']});
  assert.deepEqual(attributes('Πολυστρωματική Σωλήνας Pex-Al-Pex Φ.16mm-10M'), {diam: ['16']}, 'Φ.16mm (Praktiker)');
  assert.deepEqual(attributes('Νιπτήρας 60 εκ.'), {cm: ['60']});
});

test('ίδιο όνομα, άλλη προδιαγραφή: ΔΕΝ ταιριάζει (25 kg ≠ 50 kg, 80 λ. ≠ 100 λ., Φ16 ≠ Φ20)', () => {
  const glue = cat('glue|ΚΩΔ. 95020');
  assert.equal(ok(glue, 'Κόλλα πλακιδίων λευκή 25kg'), true);
  assert.equal(ok(glue, 'Κόλλα πλακιδίων λευκή 50kg'), false);
  assert.equal(ok(glue, 'Κόλλα πλακιδίων λευκή'), false, 'χωρίς βάρος δεν επιβεβαιώνεται');
  assert.equal(ok(glue, 'Κόλλα πλακιδίων 5kg + 25kg'), false, 'δύο βάρη: αμφίσημο');
  const heater = cat('heater|ΚΩΔ. 30080');
  assert.equal(ok(heater, 'Θερμοσίφωνας 80 λίτρα επιτοίχιος'), true);
  assert.equal(ok(heater, 'Θερμοσίφωνας 100 λίτρα επιτοίχιος'), false);
  const pipe = cat('pipe|ΚΩΔ. 40216');
  assert.equal(ok(pipe, 'Σωλήνας πολυστρωματικός Φ16 κουλούρα 100m'), true);
  assert.equal(ok(pipe, 'Σωλήνας πολυστρωματικός Φ20 κουλούρα 100m'), false);
  assert.equal(ok(pipe, 'Σωλήνας PPR Φ16'), false, 'άλλο υλικό');
});

test('εξαρτήματα και ανταλλακτικά δεν περνούν για το ίδιο το είδος', () => {
  assert.equal(ok(cat('wc|ΚΩΔ. 22051'), 'Λεκάνη κρεμαστή rimless'), true);
  assert.equal(ok(cat('wc|ΚΩΔ. 22051'), 'Κάθισμα λεκάνης κρεμαστής soft close'), false);
  assert.equal(ok(cat('wc|ΚΩΔ. 22051'), 'Πλαίσιο εντοιχισμού για κρεμαστή λεκάνη'), false);
  assert.equal(ok(cat('heater|ΚΩΔ. 30080'), 'Θερμοστάτης θερμοσίφωνα 80 λίτρα'), false);
  assert.equal(ok(cat('pipe|ΚΩΔ. 40216'), 'Γωνία σωλήνα πολυστρωματικού Φ16'), false);
  assert.equal(ok(cat('mixer|ΚΩΔ. 71804'), 'Μπαταρία νιπτήρα αναμικτική χρώμιο'), true);
  assert.equal(ok(cat('mixer|ΚΩΔ. 71804'), 'Κεφαλή μπαταρίας νιπτήρα'), false);
});

test('διαστάσεις χωρίς σειρά (80×120 = 120×80), πλάτος νιπτήρα από την πρώτη διάσταση', () => {
  assert.equal(ok(cat('shower|ΚΩΔ. 24120'), 'Ντουζιέρα ακρυλική 120x80'), true);
  assert.equal(ok(cat('shower|ΚΩΔ. 24120'), 'Ντουζιέρα ακρυλική 80x80'), false);
  assert.equal(ok(cat('basin|ΚΩΔ. 23060'), 'Νιπτήρας πορσελάνης 60x46'), true);
  assert.equal(ok(cat('basin|ΚΩΔ. 23060'), 'Νιπτήρας πορσελάνης 46x60'), false, 'το πλάτος γράφεται πρώτο');
});

test('μικροαυτόματος: ίδια αμπέρ αλλά άλλοι πόλοι = άλλο προϊόν', () => {
  const f = cat('fuse|ΚΩΔ. 64016');
  assert.equal(ok(f, 'Μικροαυτόματος 1P 16A C 6kA'), true);
  assert.equal(ok(f, 'Μικροαυτόματος 3P 16A C 6kA'), false);
  assert.equal(ok(f, 'Μικροαυτόματος 16A'), false, 'χωρίς πόλους δεν επιβεβαιώνεται');
});

test('EAN/GTIN: έλεγχος ψηφίου, κωδικοί καταστήματος «2…» δεν μετρούν, ταίριασμα μόνο με ίδιο GTIN', () => {
  assert.equal(gtin('5205909053057'), '05205909053057');
  assert.equal(gtin('5205909053058'), null, 'λάθος ψηφίο ελέγχου');
  assert.equal(gtin('2041010340006'), null, 'εσωτερικός κωδικός');
  const s = specFor({name: 'Κλαδοτεμαχιστής', unit: 'τεμ.', gtin: '5205909053057'});
  assert.deepEqual(matchItem(s, {name: 'ES2510 Κλαδοτεμαχιστής', gtin: '5205909053057'}), {ok: true, method: 'gtin'});
  assert.equal(matchItem(s, {name: 'Κλαδοτεμαχιστής ίδιο όνομα', gtin: '4006825555555'}).ok, false);
});

test('κωδικός μοντέλου: ακριβής, με μάρκα αν δόθηκε', () => {
  assert.equal(modelCode('WT2044'), 'WT2044');
  assert.equal(modelCode('111.300.00.5'), '111300005');
  assert.equal(modelCode('2044'), null, 'σκέτος αριθμός δεν είναι μοντέλο');
  const s = specFor({name: 'Προγραμματιστής ποτίσματος', unit: 'τεμ.', mpn: 'WT-2044', brand: 'Grasher'});
  assert.equal(matchItem(s, {name: 'Προγραμματιστής αυτόματου ποτίσματος GRASHER WT2044', sku: 'X1'}).method, 'mpn');
  assert.equal(matchItem(s, {name: 'Προγραμματιστής ποτίσματος OTHER WT2044'}).ok, false, 'άλλη μάρκα');
  assert.equal(matchItem(s, {name: 'Προγραμματιστής ποτίσματος GRASHER WT2045'}).ok, false);
});

test('τιμή ανά μονάδα: χωρίς ΦΠΑ, ανά μέτρο από κουλούρα, ανά τεμάχιο από συσκευασία, ποτέ μαντεψιά', () => {
  const pipe = cat('pipe|ΚΩΔ. 40216');
  assert.deepEqual(unitPrice(pipe, {name: 'Σωλήνας Φ16 κουλούρα 100m', regularCents: 12400, vatIncluded: true}), {cents: 100, basis: 'pack-100m'});
  assert.deepEqual(unitPrice(pipe, {name: 'Σωλήνας Φ16', regularCents: 248, vatIncluded: true, unit: 'Μέτρο'}), {cents: 200, basis: 'sold-per-unit'});
  assert.equal(unitPrice(pipe, {name: 'Σωλήνας Φ16', regularCents: 248, vatIncluded: true}).error, 'pack-length-unknown');
  const elbow = cat('elbow|ΚΩΔ. 42116');
  assert.deepEqual(unitPrice(elbow, {name: 'Γωνία Φ16 σετ 10 τεμ.', regularCents: 3100, vatIncluded: true}), {cents: 250, basis: 'pack-of-10'});
  assert.equal(unitPrice(elbow, {name: 'Γωνία 2 τεμ. ή 4 τεμ.', regularCents: 3100, vatIncluded: true}).error, 'pack-ambiguous');
  assert.equal(unitPrice(elbow, {name: 'Γωνία', regularCents: 0, vatIncluded: true}).error, 'no-regular-price');
  const tile = cat('tile|ΚΩΔ. 80312');
  assert.equal(unitPrice(tile, {name: 'Πλακάκι 30x60 λευκό ματ', regularCents: 2000, vatIncluded: true}).error, 'unit-mismatch');
  assert.deepEqual(unitPrice(tile, {name: 'Πλακάκι', regularCents: 2000, vatIncluded: true, unitPriceCents: 1240, unitPriceUnit: 'τ.μ.'}), {cents: 1000, basis: 'supplier-unit-price'});
});

test('τιμή αναφοράς: διάμεσος ανά προμηθευτή, ≥ 2 προμηθευτές για προδιαγραφή, 1 αρκεί για ίδιο αναγνωριστικό, ποτέ 0', () => {
  assert.equal(median([300, 100, 200]), 200);
  assert.equal(median([100, 200]), 150);
  assert.equal(median([0, null, NaN]), null);
  const r = reference([{supplier: 'a', cents: 100, method: 'spec'}, {supplier: 'a', cents: 900, method: 'spec'}, {supplier: 'a', cents: 120, method: 'spec'},
    {supplier: 'b', cents: 140, method: 'spec'}]);
  assert.deepEqual(r, {status: 'verified', cents: 130, suppliers: {a: 120, b: 140}, n: 2});
  assert.equal(reference([{supplier: 'a', cents: 100, method: 'spec'}]).status, 'insufficient');
  assert.equal(reference([{supplier: 'a', cents: 100, method: 'gtin'}]).status, 'verified');
  assert.deepEqual(reference([]), {status: 'none', cents: null, suppliers: {}, n: 0});
});

test('προϊόντα χρήστη: πολύ γενικό όνομα δεν αναζητείται· ίδια προδιαγραφή = ίδιο κλειδί για όλους', () => {
  assert.equal(specific(specFor({name: 'ροπ', unit: 'τεμ.'})), false);
  assert.equal(specific(specFor({name: 'Κλιματιστικό 12000 btu', unit: 'τεμ.'})), true);
  const a = specFor({name: 'Κλιματιστικό  12000 BTU', unit: 'τεμ.'}), b = specFor({name: 'κλιματιστικό 12000 btu', unit: 'τεμαχιο'});
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, specFor({name: 'Κλιματιστικό 9000 btu', unit: 'τεμ.'}).key);
  assert.equal(unitOf('τ.μ.'), 'm2'); assert.equal(unitOf('μ.'), 'm'); assert.equal(unitOf('σακί'), 'bag');
});

test('κατάλογος: κάθε παραλλαγή μπαίνει, με κανόνα ή με λόγο· κάθε προϊόν έχει μοναδικό κλειδί', () => {
  assert.ok(CAT.length >= 100);
  assert.ok(CAT.every(p => p.kind !== 'product' || p.rule), 'κάθε προϊόν λιανικής έχει κανόνα');
  assert.deepEqual([...new Set(CAT.map(p => p.kind))].sort(), ['per-area', 'product', 'service']);
  const keys = CAT.filter(p => p.rule).map(p => specFor(p, p.rule).key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(CAT.map(p => p.ref)).size, CAT.length, 'μοναδικό ref = priceKey της εφαρμογής');
});

test('συσκευασίες: μήκος και πλήθος μόνο όταν γράφονται χωρίς αμφισημία', () => {
  assert.equal(packLength('κουλούρα 100 μέτρα'), 100);
  assert.equal(packLength('3m ή 6m'), null);
  assert.equal(packCount('συσκευασία 10 τεμ.'), 10);
  assert.equal(packCount('Γωνία'), 1);
});

test('προϊόντα χρηστών: μεγέθη από τη φράση που ειπώθηκε, αυστηρά (άγνωστο μέγεθος στον προμηθευτή = όχι)', () => {
  const ac = specFor({name: 'Κλιματιστικά btu', said: 'δύο κλιματιστικά 12000 btu', unit: 'τεμ.', strict: true});
  assert.deepEqual(ac.attrs, {btu: '12000'});
  assert.equal(ok(ac, 'Κλιματιστικό inverter 12.000 BTU A++'), true);
  assert.equal(ok(ac, 'Κλιματιστικό inverter 9000 BTU'), false);
  const sil = specFor({name: 'Σιλικόνη αντιμουχλική', unit: 'τεμ.', strict: true});
  assert.equal(ok(sil, 'Σιλικόνη αντιμουχλική 280ml'), false, 'χωρίς ml στην προδιαγραφή: δεν ανακατεύονται μεγέθη');
  assert.equal(ok(specFor({name: 'Σιλικόνη αντιμουχλική 280ml', unit: 'τεμ.', strict: true}), 'Σιλικόνη αντιμουχλική 280 ml λευκή'), true);
  assert.notEqual(specFor({name: 'Σιλικόνη 280ml', unit: 'τεμ.', strict: true}).key, specFor({name: 'Σιλικόνη 280ml', unit: 'τεμ.'}).key);
});

test('λέξεις μονάδων δεν γίνονται υποχρεωτικές λέξεις· με μέγεθος, επιπλέον στοιχεία (kW) δεν αποκλείουν', () => {
  const glue = specFor({name: 'Κόλλα πλακιδίων 25 κιλά', unit: 'σακί', strict: true});
  assert.deepEqual([glue.all, glue.attrs], [['κολλ', 'πλακιδ'], {kg: '25'}]);
  assert.equal(ok(glue, 'Isomat AK-20 Κόλλα Πλακιδίων Γκρι 25kg C2 TE'), true);
  assert.equal(ok(glue, 'Κόλλα πλακιδίων γκρι 50kg'), false);
  const ac = specFor({name: 'Κλιματιστικό inverter 12000 BTU', unit: 'τεμ.', strict: true});
  assert.equal(ok(ac, 'INVENTOR Κλιματιστικό Inverter 12000 BTU με WiFi 3.5kW R32'), true);
  assert.equal(ok(ac, 'INVENTOR Κλιματιστικό Inverter 18000 BTU 5.2kW'), false);
});
