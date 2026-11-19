// Τιμές προμηθευτών στην εφαρμογή (src/price-watch.js): αυτόματη καταγραφή προϊόντων εκτός καταλόγου, ανέβασμα στον
// λογαριασμό με την τιμή του χρήστη ως έχει, ανάγνωση τιμών αναφοράς, κείμενα κατάστασης.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerCustom, customProducts, migrateCustom, pushCustom, pullRefs, refFor, refStatus, createPriceSync, CUSTOM, REFS }
  from '../src/price-watch.js';

let data;
beforeEach(() => {
  data = {};
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, writable: true, value: {
    getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }}});
});

// Ψεύτικος client του Supabase: καταγράφει κλήσεις, απαντά από πίνακες.
function fakeClient(tables){
  const calls = [];
  const from = table => {
    const q = {table, filters: []};
    const run = () => {
      let rows = [...(tables[table] || [])];
      for(const [op, col, v] of q.filters){
        if(op === 'notnull') rows = rows.filter(r => r[col] != null);
        if(op === 'eq') rows = rows.filter(r => r[col] === v);
        if(op === 'in') rows = rows.filter(r => v.includes(r[col]));
      }
      return Promise.resolve({data: rows, error: null});
    };
    const b = {
      select(){ return b; }, order(){ return b; }, limit(){ return b; },
      not(col){ q.filters.push(['notnull', col]); return b; }, eq(col, v){ q.filters.push(['eq', col, v]); return b; },
      in(col, v){ q.filters.push(['in', col, v]); return b; },
      upsert(rows, opts){ calls.push({table, rows, opts}); return Promise.resolve({error: null}); },
      then(ok, bad){ return run().then(ok, bad); },
    };
    return b;
  };
  return {from, calls};
}

test('«Κράτα την» σε γραμμή εκτός καταλόγου: καταγράφεται αυτόματα με τη δική του τιμή· γραμμή καταλόγου όχι', () => {
  assert.equal(registerCustom({added: true, name: 'Κλιματιστικό 12000 btu', unit: 'τεμ.', mat: 45000, lab: 8000}, 'unknown|Κλιματιστικό 12000 btu', 1000), true);
  assert.equal(registerCustom({added: false, name: 'Λεκάνη', mat: 100}, 'wc|ΚΩΔ. 22051'), false);
  assert.deepEqual(customProducts(), {'unknown|Κλιματιστικό 12000 btu': {name: 'Κλιματιστικό 12000 btu', said: null, unit: 'τεμ.', cents: 45000, lab: 8000, at: 1000}});
  registerCustom({added: true, name: 'Κλιματιστικά btu', said: 'δύο κλιματιστικά 12000 btu', unit: 'τεμ.', mat: 1}, 'unknown|Κλιματιστικά btu', 1500);
  assert.equal(customProducts()['unknown|Κλιματιστικά btu'].said, 'δύο κλιματιστικά 12000 btu', 'κρατά τη φράση με το μέγεθος');
  registerCustom({added: true, name: 'Σιλικόνη', desc: 'Σιλικόνη αντιμουχλική 280ml', unit: 'τεμ.', mat: 650}, 'unknown|Σιλικόνη', 2000);
  assert.equal(customProducts()['unknown|Σιλικόνη'].name, 'Σιλικόνη αντιμουχλική 280ml', 'η πιο συγκεκριμένη περιγραφή του βοηθά την αντιστοίχιση');
});

test('προϊόντα εκτός καταλόγου από πριν (μνήμη τιμών) μπαίνουν μία φορά· τα είδη του καταλόγου όχι', () => {
  const prices = {'unknown|Ροπ': [{c: 500, at: 10}], 'wc|ΚΩΔ. 22051': [{c: 18000, at: 10}], 'unknown|Κόλλα 25kg': [{c: 900, at: 20}, {c: 850, at: 5}]};
  assert.equal(migrateCustom(prices), 2);
  assert.equal(migrateCustom(prices), 0, 'δεύτερη φορά: τίποτα');
  assert.equal(customProducts()['unknown|Κόλλα 25kg'].cents, 900, 'η πιο πρόσφατη τιμή');
  assert.equal(customProducts()['wc|ΚΩΔ. 22051'], undefined);
});

test('ανέβασμα: η τιμή του χρήστη ως έχει, μόνο ό,τι είναι πιο πρόσφατο από τον λογαριασμό', async () => {
  registerCustom({added: true, name: 'Α', unit: 'τεμ.', mat: 100}, 'unknown|Α', Date.parse('2026-11-10'));
  registerCustom({added: true, name: 'Β', unit: 'μ.', mat: 250, lab: 0}, 'unknown|Β', Date.parse('2026-11-12'));
  const c = fakeClient({user_products: [{key: 'unknown|Α', updated_at: '2026-11-11T00:00:00Z'}]});
  assert.equal(await pushCustom({client: c, userId: 'u1'}), 1);
  assert.deepEqual(c.calls[0].rows, [{user_id: 'u1', key: 'unknown|Β', name: 'Β', said: null, unit: 'μ.', user_price_cents: 250, user_labor_cents: 0,
    updated_at: '2026-11-12T00:00:00.000Z'}]);
  assert.equal(c.calls[0].opts.onConflict, 'user_id,key');
  assert.ok(!('price_product_id' in c.calls[0].rows[0]), 'ο χρήστης δεν στέλνει σύνδεση με τιμή');
});

test('τιμές αναφοράς: καταλόγου και δικών του προϊόντων, κρατιούνται στη συσκευή', async () => {
  const c = fakeClient({
    price_products: [
      {id: 1, catalog_ref: 'heater|ΚΩΔ. 30080', unit: 'piece', reference_cents: 24500, reference_status: 'verified', reference_at: '2026-11-16T03:00:00Z', reference_suppliers: 3, last_checked_at: '2026-11-16T03:00:00Z', last_check_status: 'matched'},
      {id: 2, catalog_ref: null, unit: 'piece', reference_cents: 41000, reference_status: 'insufficient', reference_at: '2026-11-02T03:00:00Z', reference_suppliers: 1, last_checked_at: '2026-11-16T03:00:00Z', last_check_status: 'matched'}],
    user_products: [{key: 'unknown|Κλιματιστικό', price_product_id: 2, deleted: false}, {key: 'unknown|Νέο', price_product_id: null, deleted: false}]});
  assert.equal(await pullRefs({client: c}), 3);
  assert.equal(refFor('heater|ΚΩΔ. 30080').cents, 24500);
  assert.equal(refFor('unknown|Κλιματιστικό').status, 'insufficient');
  assert.deepEqual(refFor('unknown|Νέο'), {pending: true});
  assert.equal(refFor('δεν υπάρχει'), null);
  assert.ok(JSON.parse(data[REFS]).at > 0);
});

test('κείμενα κατάστασης', () => {
  const d = () => '16/11/2026';
  assert.equal(refStatus({cents: 100, status: 'verified', at: 1, n: 3}, d), '✓ επαληθευμένη 16/11/2026 · 3 προμηθευτές');
  assert.equal(refStatus({cents: 100, status: 'insufficient', at: 1, n: 1}, d), 'λίγες τιμές στον τελευταίο έλεγχο · τελευταία επαλήθευση 16/11/2026');
  assert.equal(refStatus({cents: 100, status: 'stale', at: 1}, d), 'παλιά τιμή · τελευταία επαλήθευση 16/11/2026');
  assert.equal(refStatus({pending: true}), 'Θα ελεγχθεί στον επόμενο εβδομαδιαίο έλεγχο τιμών.');
  assert.equal(refStatus({cents: null, status: 'none', checked: 5, check: 'unmatched'}), 'Δεν βρέθηκε ακόμα με βεβαιότητα σε προμηθευτή.');
  assert.equal(refStatus({cents: null, status: 'none', checked: 5, check: 'not-applicable'}), null);
  assert.equal(refStatus(null), null);
});

test('συγχρονισμός: χωρίς λογαριασμό τίποτα· με λογαριασμό ανεβάζει και φέρνει· σφάλμα δεν σπάει την εφαρμογή', async () => {
  let t = 0;
  const none = createPriceSync(() => null, {now: () => t});
  assert.equal(await none(), null);
  const c = fakeClient({price_products: [], user_products: []});
  const sync = createPriceSync(async () => ({client: c, userId: 'u'}), {now: () => t});
  assert.deepEqual(await sync(), {pushed: 0, refs: 0});
  assert.equal(await sync(), null, 'μέσα στο διάστημα: δεν ξανατρέχει');
  const broken = createPriceSync(async () => ({client: {from(){ throw new Error('δίκτυο'); }}, userId: 'u'}), {now: () => t});
  assert.equal(await broken(), null);
  assert.equal(data[CUSTOM], undefined);
});
