// Εβδομαδιαία ενημέρωση τιμών (tools/prices/engine.mjs) με ψεύτικους προμηθευτές και αποθήκευση στη μνήμη:
// οι 12 περιπτώσεις της προδιαγραφής (κατάλογος, προϊόντα χρηστών, νέα προϊόντα, ίδιο όνομα/άλλη προδιαγραφή,
// προσφορές, χωρίς κανονική τιμή, κανένας προμηθευτής, πολλοί προμηθευτές, διπλά σε χρήστες, διακοπές, μεγάλη βάση,
// επαναλήψεις/διακομμένη εκτέλεση) και ότι η τιμή του χρήστη δεν αλλάζει ποτέ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOnce, buildInventory } from '../tools/prices/engine.mjs';
import { createMemoryStore } from '../tools/prices/stores/memory.mjs';
import { Blocked } from '../tools/prices/fetch.mjs';
import { catalogProducts } from '../src/price-rules.js';
import { parseListing } from '../tools/prices/adapters/praktiker.mjs';
import { wooItem } from '../tools/prices/adapters/woo.mjs';
import { parseVrontinos, parseMagento } from '../tools/prices/adapters/html.mjs';

const V = (id, name, cents, extra = {}) => ({id, sku: null, name, url: `https://x.example/${id}`, regularCents: cents, currentCents: cents,
  promo: false, verification: 'verified', reason: null, unit: null, ...extra});
const sup = (id, items, extra = {}) => ({id, name: id, base_url: `https://${id}.example`, method: 'test', vat: 'retail-law',
  items: async function*(){ if(typeof items === 'function') yield* items(); else yield* items; }, ...extra});
const USER_A = '00000000-0000-4000-8000-00000000000a', USER_B = '00000000-0000-4000-8000-00000000000b';
const up = (user_id, key, name, unit, cents) => ({user_id, key, name, unit, user_price_cents: cents, user_labor_cents: 0, deleted: false,
  updated_at: '2026-11-01T00:00:00Z', price_product_id: null});
const clock = start => { let t = Date.parse(start); return {now: () => new Date(t), add: ms => { t += ms; }}; };
const heaterRef = 'heater|ΚΩΔ. 30080';

function world({users = [], suppliers, at = '2026-11-20T03:00:00Z'} = {}){
  const c = clock(at), store = createMemoryStore({now: c.now});
  store.db.user_products.push(...users);
  return {store, c, run: (s = suppliers) => runOnce({store, suppliers: s, fetcher: {}, now: c.now})};
}
const product = (store, ref) => store.db.price_products.find(p => p.catalog_ref === ref);

test('1–2. όλος ο κατάλογος και όλα τα προϊόντα χρηστών μπαίνουν στον έλεγχο, χωρίς καταχώριση με το χέρι', async () => {
  const {store, run} = world({users: [up(USER_A, '|κλιματιστικο 12000 btu', 'Κλιματιστικό 12000 BTU', 'τεμ.', 45000)], suppliers: []});
  const {stats} = await run([]);
  assert.equal(stats.products.catalog, catalogProducts().length);
  assert.equal(store.db.price_products.filter(p => p.catalog_ref).length, catalogProducts().length);
  assert.equal(stats.products.userRecords, 1);
  assert.ok(store.db.user_products[0].price_product_id > 0, 'το προϊόν του χρήστη συνδέθηκε αυτόματα');
  assert.ok(store.db.price_products.every(p => p.last_checked_run === stats.run), 'ελέγχθηκαν όλα');
});

test('3. προϊόν που προστέθηκε μετά την εκτέλεση μπαίνει στην επόμενη', async () => {
  const items = [V('1', 'Κλιματιστικό inverter 12000 BTU A++', 49600)];
  const {store, run, c} = world({suppliers: [sup('a', items), sup('b', [V('9', 'Κλιματιστικό 12000 btu wifi', 54560)])]});
  await run();
  store.db.user_products.push(up(USER_A, '|κλιματιστικο 12000 btu', 'Κλιματιστικό 12000 BTU', 'τεμ.', 45000));
  c.add(7 * 86400e3);
  await run();
  const p = store.db.price_products.find(x => x.id === store.db.user_products[0].price_product_id);
  assert.equal(p.reference_status, 'verified');
  assert.equal(p.reference_cents, Math.round((40000 + 44000) / 2), 'διάμεσος, χωρίς ΦΠΑ (496,00/1,24 και 545,60/1,24)');
  assert.equal(store.db.user_products[0].user_price_cents, 45000, 'η τιμή του χρήστη έμεινε ίδια');
});

test('4–5–6. ίδιο όνομα/άλλο βάρος δεν μετρά· προσφορά: μόνο η ρητή κανονική· χωρίς κανονική: μη επαληθευμένη', async () => {
  const a = [V('g25', 'Κόλλα πλακιδίων λευκή 25kg', 1240), V('g50', 'Κόλλα πλακιδίων λευκή 50kg', 2480),
    V('h80', 'Θερμοσίφωνας 80 λίτρα', 31000, {currentCents: 24800, promo: true})];
  const b = [V('h80b', 'Θερμοσίφωνας 80lt επιτοίχιος', 29760), V('g25b', 'Κόλλα πλακιδίων γκρι 25 κιλά', 1488),
    {...V('h80c', 'Θερμοσίφωνας 80 λ.', null), verification: 'unverified', reason: 'promo-without-original', currentCents: 9900, promo: true, regularCents: null}];
  const {store, run} = world({suppliers: [sup('a', a), sup('b', b)]});
  await run();
  const glue = product(store, 'glue|ΚΩΔ. 95020');
  assert.equal(glue.reference_cents, Math.round((1000 + 1200) / 2), 'μόνο τα 25 kg (12,40/1,24 και 14,88/1,24)');
  const heater = product(store, heaterRef);
  assert.equal(heater.reference_cents, Math.round((25000 + 24000) / 2), 'κανονικές 310,00 και 297,60 — όχι η προσφορά 248,00 ούτε τα 99,00');
  const offers = store.db.supplier_offers.filter(o => o.price_product_id === heater.id);
  assert.equal(offers.find(o => o.supplier_product_id === 'h80').promo, true);
  assert.equal(offers.find(o => o.supplier_product_id === 'h80').regular_cents, 31000);
  assert.equal(offers.find(o => o.supplier_product_id === 'h80c').verification, 'unverified');
  assert.ok(!store.db.supplier_offers.some(o => o.supplier_product_id === 'g50' && o.price_product_id === glue.id));
});

test('7–8. κανένας προμηθευτής: χωρίς τιμή (ποτέ 0)· ένας προμηθευτής με προδιαγραφή: ανεπαρκές· δύο: επαληθευμένο', async () => {
  const {store, run} = world({suppliers: [sup('a', [V('1', 'Θερμοσίφωνας 80 λίτρα', 31000)])]});
  await run();
  const h = product(store, heaterRef);
  assert.equal(h.reference_status, 'insufficient'); assert.equal(h.reference_cents ?? null, null);
  const none = product(store, 'sink|ΚΩΔ. 25120');
  assert.equal(none.reference_status, 'none'); assert.equal(none.last_check_status, 'unmatched');
  assert.ok(store.db.price_products.every(p => p.reference_cents == null || p.reference_cents > 0));
});

test('9. ίδιο προϊόν σε δύο χρήστες: μία αναζήτηση, δύο ξεχωριστές εγγραφές, τιμές χρηστών ανέπαφες', async () => {
  const users = [up(USER_A, '|κλιματιστικο 12000 btu', 'Κλιματιστικό 12000 BTU', 'τεμ.', 45000),
    up(USER_B, '|κλιματιστικο 12000 btu', 'κλιματιστικό  12000 btu', 'τεμάχιο', 39000)];
  const {store, run} = world({users, suppliers: [sup('a', [V('1', 'Κλιματιστικό 12000 BTU', 49600)])]});
  const before = store.userFieldsSnapshot();
  await run();
  assert.equal(store.db.user_products.length, 2);
  assert.equal(store.db.user_products[0].price_product_id, store.db.user_products[1].price_product_id);
  assert.equal(store.db.price_products.filter(p => p.source === 'user').length, 1);
  assert.equal(store.userFieldsSnapshot(), before, 'κανένα πεδίο χρήστη δεν άλλαξε');
});

test('10. προμηθευτής πέφτει: οι άλλοι συνεχίζουν, οι παλιές του τιμές μένουν, η εκτέλεση είναι «partial»', async () => {
  const good = sup('a', [V('1', 'Θερμοσίφωνας 80 λίτρα', 31000)]), other = sup('b', [V('2', 'Θερμοσίφωνας 80lt', 29760)]);
  const {store, run, c} = world({suppliers: [good, other]});
  await run();
  const h = product(store, heaterRef); assert.equal(h.reference_status, 'verified');
  c.add(7 * 86400e3);
  const down = sup('b', async function*(){ yield V('2', 'Θερμοσίφωνας 80lt', 29760); throw new Blocked('b.example', 'HTTP 403'); });
  const {stats} = await run([good, down]);
  assert.equal(stats.suppliers.b.status, 'unavailable');
  assert.match(stats.suppliers.b.reason, /μπλοκάρει/);
  assert.equal(store.db.price_runs.at(-1).status, 'partial');
  const offerB = store.db.supplier_offers.find(o => o.supplier_id === 'b' && o.price_product_id === h.id);
  assert.equal(offerB.verification, 'verified', 'η τιμή του b δεν σβήστηκε επειδή έπεσε');
  assert.equal(product(store, heaterRef).reference_status, 'verified', 'η τιμή του b είναι ακόμα φρέσκια (7 ημέρες)');
  c.add(21 * 86400e3);
  await run([good, down]);
  const after = product(store, heaterRef);
  assert.equal(after.reference_status, 'insufficient', 'μετά από 3 εβδομάδες μένει μόνο ένας: κρατιέται η παλιά τιμή');
  assert.equal(after.reference_cents, h.reference_cents);
});

test('12. επανάληψη = ίδιο αποτέλεσμα, χωρίς διπλοεγγραφές· διακομμένη εκτέλεση· δύο ταυτόχρονα: η δεύτερη δεν τρέχει', async () => {
  const s = [sup('a', [V('1', 'Θερμοσίφωνας 80 λίτρα', 31000)]), sup('b', [V('2', 'Θερμοσίφωνας 80lt', 29760)])];
  const {store, run, c} = world({suppliers: s});
  await run();
  const snap = () => [store.db.price_products.length, store.db.supplier_offers.length, store.db.supplier_price_history.length, store.db.price_reference_history.length];
  const first = snap();
  c.add(3600e3); await run();
  assert.deepEqual(snap(), first, 'ίδιες τιμές: καμία νέα εγγραφή ή ιστορικό');
  // αλλαγή τιμής → μία γραμμή ιστορικού
  c.add(7 * 86400e3);
  await run([sup('a', [V('1', 'Θερμοσίφωνας 80 λίτρα', 32240)]), s[1]]);
  assert.equal(store.db.supplier_price_history.length, first[2] + 1);
  // ταυτόχρονη εκτέλεση
  const id = await store.startRun();
  assert.equal((await run()).skipped, true);
  // διακομμένη: χωρίς σημείο ζωής 3 ώρες → η επόμενη ξεκινά
  store.db.price_runs.find(r => r.id === id).heartbeat_at = new Date(c.now() - 3 * 3600e3).toISOString();
  const r = await run();
  assert.ok(!r.skipped);
  assert.equal(store.db.price_runs.find(x => x.id === id).status, 'aborted');
});

test('11. μεγάλη βάση: 3.000 προϊόντα χρηστών × 20.000 προϊόντα προμηθευτών, μέσα σε λίγα δευτερόλεπτα', async () => {
  const users = Array.from({length: 3000}, (_, i) => up(i % 2 ? USER_A : USER_B, `|ειδος ${i}`, `Ρελέ ισχύος ${100 + (i % 1500)}A τύπου κ${i % 7}`, 'τεμ.', 1000 + i));
  const items = Array.from({length: 20000}, (_, i) => V(String(i), `Είδος καταστήματος ${i} ${i % 3 ? 'κουζίνας' : 'μπάνιου'} ${i % 40} λίτρα`, 1000 + i));
  const {store, run} = world({users, suppliers: [sup('a', items), sup('b', items.slice(0, 5000))]});
  const t0 = Date.now();
  const {stats} = await run();
  assert.ok(Date.now() - t0 < 20000, `${Date.now() - t0} ms`);
  assert.equal(stats.products.userRecords, 3000);
  assert.equal(store.db.user_products.filter(u => u.price_product_id).length, 3000);
  assert.ok(stats.products.user < 3000, 'διπλά ονόματα ενώθηκαν σε μία αναζήτηση');
});

test('απογραφή: πολύ γενικά ονόματα χρηστών μένουν, αλλά δεν αναζητούνται· σβησμένα δεν μετρούν', () => {
  const inv = buildInventory({catalog: [], userProducts: [up(USER_A, '|ροπ', 'ροπ', 'τεμ.', 100), {...up(USER_A, '|x', 'Κλιματιστικό 9000 btu', 'τεμ.', 1), deleted: true}]});
  assert.equal(inv.length, 1); assert.equal(inv[0].kind, 'too-generic');
});

test('adapters: Praktiker, WooCommerce, Vrontinos, Magento — μόνο ρητή κανονική τιμή', () => {
  const pk = parseListing('{id:1,sku:"100",name:"Θερμοσίφωνας 80 λίτρα",url_key:"p/thermo-80",price:190,special_price:129,alternative_price:0,base_unit:"Τεμάχιο",alternative_unit_singular:void 0,misc:{is_killer_price:false,is_strikethrough:true},brand:"X"},' +
    '{id:2,sku:"101",name:"Σιφώνι",url_key:"p/sif",price:20,special_price:null,base_unit:"Τεμάχιο",misc:{is_killer_price:false,is_strikethrough:false},brand:"-"},' +
    '{id:3,sku:"102",name:"Βάνα",url_key:"p/vana",price:15,special_price:9,base_unit:"Τεμάχιο",misc:{is_killer_price:false,is_strikethrough:false},brand:"-"},' +
    '{id:4,sku:"103",name:"Πλακάκι 30x60",url_key:"p/pl",price:20,special_price:null,alternative_price:14.5,base_unit:"Κιβώτιο",alternative_unit_singular:"Τ.Μ.",misc:{is_killer_price:false,is_strikethrough:false},brand:"-"}');
  assert.deepEqual(pk.map(i => [i.verification, i.regularCents, i.promo]), [['verified', 19000, true], ['verified', 2000, false], ['unverified', null, true], ['verified', 2000, false]]);
  assert.equal(pk[2].reason, 'promo-without-original');
  assert.deepEqual([pk[3].unitPriceCents, pk[3].unitPriceUnit], [1450, 'Τ.Μ.']);
  const price = (regular_price, price, extra = {}) => wooItem({id: 1, name: 'Σωλήνας &#8211; Φ16', permalink: 'https://w.example/p', type: 'simple',
    prices: {regular_price, price, sale_price: price, currency_code: 'EUR', currency_minor_unit: 2}, ...extra}, 'https://w.example');
  assert.deepEqual([price('12500', '11000').regularCents, price('12500', '11000').promo], [12500, true]);
  assert.equal(price('', '11000').verification, 'unverified');
  assert.equal(price('100', '100', {type: 'variable'}).reason, 'variable-prices');
  assert.equal(price('100', '100').name, 'Σωλήνας – Φ16');
  const vr = parseVrontinos('<div class="product-tile"><div class="product-tile-title text-left eqcol"> <a href="/el/Product/0001ABCD.aspx">ΣΙΦΩΝΙ</a> </div><span class="product-tile-final-price">9,00 €</span></div>' +
    '<div class="product-tile"><div class="product-tile-title text-left eqcol"> <a href="/el/Product/0001ABCE.aspx">ΒΑΝΑ</a> </div><span class="product-tile-net-price">19,00 €</span> <span class="product-tile-final-price">15,00 €</span></div>');
  assert.deepEqual(vr.map(i => [i.verification, i.regularCents]), [['verified', 900], ['unverified', null]]);
  const mg = parseMagento('<li class="item product product-item"><div class="product-item-info" data-container="product-grid"><a class="product-item-link" href="https://m.example/a.html">Καλώδιο ΝΥΜ 3x1.5</a>' +
    '<span data-price-amount="60.35" data-price-type="oldPrice"></span><span data-price-amount="50.18" data-price-type="finalPrice"></span></div></li>');
  assert.deepEqual([mg[0].regularCents, mg[0].promo, mg[0].verification], [6035, true, 'verified']);
});

test('αληθοφάνεια: τιμή που απέχει πάνω από 5× από τη γνωστή (π.χ. ανά κιλό αντί για σακί) δεν μετρά', async () => {
  const a = [V('g', 'Κόλλα πλακιδίων λευκή 25kg', 60)], b = [V('h', 'Κόλλα πλακιδίων γκρι 25 κιλά', 1240)], c = [V('i', 'Κόλλα πλακιδίων C2TE 25kg', 1364)];
  const {store, run} = world({suppliers: [sup('a', a), sup('b', b), sup('c', c)]});
  await run();
  const glue = product(store, 'glue|ΚΩΔ. 95020');
  const bad = store.db.supplier_offers.find(o => o.supplier_product_id === 'g');
  assert.deepEqual([bad.verification, bad.verification_reason, bad.unit_cents], ['unverified', 'implausible-vs-anchor', null]);
  assert.equal(glue.reference_cents, Math.round((1000 + 1100) / 2), 'μόνο οι αληθοφανείς (12,40 και 13,64 με ΦΠΑ)');
});

test('κανόνας σειράς: «Καζανάκι με μηχανισμό» δεν είναι μηχανισμός· προϊόν χρήστη: η πρώτη του λέξη ορίζει το είδος', async () => {
  const items = [V('1', 'Μηχανισμός για καζανάκι με 2 μπουτόν', 1500), V('2', 'Πλαστικό καζανάκι επικαθήμενο με διπλό μηχανισμό', 4500),
    V('3', 'Μπαταρία νεροχύτη πάγκου χρωμέ', 6000), V('4', 'Σετ νεροχύτης ανοξείδωτος με μπαταρία', 15000)];
  const users = [up(USER_A, 'unknown|Μπαταρία νεροχύτη', 'Μπαταρία νεροχύτη', 'τεμ.', 5500)];
  const {store, run} = world({users, suppliers: [sup('a', items)]});
  await run();
  const ids = id => store.db.supplier_offers.filter(o => o.price_product_id === id).map(o => o.supplier_product_id).sort();
  assert.deepEqual(ids(product(store, 'flush|ΚΩΔ. 22710').id), ['1']);
  assert.deepEqual(ids(store.db.user_products[0].price_product_id), ['3']);
});
