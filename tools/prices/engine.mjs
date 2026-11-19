// Ο πυρήνας της εβδομαδιαίας ενημέρωσης τιμών. Χωρίς AI: κανόνες αντιστοίχισης (src/price-match.js), κανόνες
// καταλόγου (src/price-rules.js) και οι adapters των προμηθευτών (suppliers.mjs).
//
// Μία εκτέλεση:
//  1. Κλείδωμα (store.startRun): δεύτερη ταυτόχρονη εκτέλεση δεν ξεκινά.
//  2. Απογραφή: ΟΛΑ τα είδη του καταλόγου (διαβάζονται από τον κατάλογο κάθε φορά) + ΟΛΑ τα προϊόντα των χρηστών.
//     Ίδια προδιαγραφή = μία εγγραφή (price_products) για όλους· οι εγγραφές των χρηστών μένουν χωριστές και συνδέονται.
//  3. Κάθε προμηθευτής διαβάζεται ΜΙΑ φορά (όχι ανά προϊόν ή ανά χρήστη). Αποτυχία ενός δεν σταματά τους άλλους.
//  4. Αντιστοίχιση τοπικά, τιμή ανά μονάδα χωρίς ΦΠΑ, αποθήκευση (upsert: ξανατρέχει χωρίς διπλοεγγραφές),
//     ιστορικό μόνο σε αλλαγή, τιμή αναφοράς = διάμεσος. Η τιμή του χρήστη δεν αγγίζεται.
import { catalogProducts } from '../../src/price-rules.js';
import { specFor, specific, matchItem, unitPrice, reference, median, wordsOf, gtin, codesIn, modelCode } from '../../src/price-match.js';
import { stripPersonal } from '../../src/rewrite-client.js';

export const FRESH_DAYS = 21;          // τιμή προμηθευτή παλαιότερη από τόσο δεν μετρά στην τιμή αναφοράς
// Έλεγχος αληθοφάνειας: τιμή ανά μονάδα που απέχει πάνω από τόσες φορές από τη γνωστή τιμή (ενδεικτική του καταλόγου ή
// αυτή που έγραψαν οι χρήστες) ΔΕΝ μετρά (π.χ. σακί κόλλας «0,48 €» = τιμή ανά κιλό που το site δεν δηλώνει, ή «τάπα για
// καζανάκι» αντί για καζανάκι). Η γνωστή τιμή χρησιμοποιείται μόνο για αποκλεισμό, ποτέ για τον υπολογισμό της τιμής.
export const PLAUSIBLE = 5;
const DAY = 86400e3;

/** Η απογραφή: [{key, name, unit, kind, spec, catalogRef, source, users: [{user_id, key}]}] */
export function buildInventory({catalog = catalogProducts(), userProducts = []} = {}){
  const byKey = new Map();
  const put = e => { byKey.set(e.key, e); return e; };
  for(const p of catalog){
    const spec = specFor(p, p.rule || {});
    const key = p.kind === 'product' ? spec.key : `${p.kind};${p.ref}`;
    const had = byKey.get(key);
    if(had){ had.alsoRefs = [...(had.alsoRefs || []), p.ref]; continue; }
    put({key, name: p.name, unit: spec.unit, kind: p.kind, spec, catalogRef: p.ref, source: 'catalog', users: [], anchorCents: p.catalogCents > 0 ? p.catalogCents : null});
  }
  for(const u of userProducts){
    if(u.deleted) continue;
    // Αυστηρά για προϊόντα χρηστών: τα μεγέθη από τη φράση που ειπώθηκε, και κανένα «άγνωστο» μέγεθος στο προϊόν του προμηθευτή.
    const spec = specFor({name: stripPersonal(u.name), said: u.said ? stripPersonal(u.said) : null, unit: u.unit, brand: u.brand, mpn: u.mpn, gtin: u.gtin, strict: true});
    const kind = specific(spec) ? 'product' : 'too-generic';
    const key = kind === 'product' ? spec.key : `too-generic;${spec.key}`;
    const e = byKey.get(key) || put({key, name: stripPersonal(u.name).slice(0, 200) || u.key, unit: spec.unit, kind, spec, catalogRef: null, source: 'user', users: []});
    e.users.push({user_id: u.user_id, key: u.key, linked: u.price_product_id ?? null, cents: u.user_price_cents});
  }
  for(const e of byKey.values()) if(e.anchorCents == null && e.users.length) e.anchorCents = median(e.users.map(u => u.cents)) ?? null;
  return [...byKey.values()];
}

/** Ευρετήριο των προϊόντων ενός προμηθευτή: πρόθεμα 3 γραμμάτων κάθε λέξης, GTIN και κωδικοί μοντέλων. */
export function indexItems(items){
  const byPrefix = new Map(), byGtin = new Map(), byCode = new Map();
  const add = (m, k, i) => { let s = m.get(k); if(!s) m.set(k, s = new Set()); s.add(i); };
  items.forEach((it, i) => {
    for(const w of wordsOf(`${it.name} ${it.brand ?? ''}`)) add(byPrefix, w.slice(0, 3), i);
    const g = gtin(it.gtin) || gtin(it.sku); if(g) add(byGtin, g, i);
    for(const c of [...codesIn(it.name), modelCode(it.sku)].filter(Boolean)) add(byCode, c, i);
  });
  return {byPrefix, byGtin, byCode};
}
function candidates(spec, idx){
  if(spec.gtin) return idx.byGtin.get(spec.gtin) || new Set();
  if(spec.mpn) return idx.byCode.get(spec.mpn) || new Set();
  const roots = spec.all.length ? spec.all : spec.any;
  if(!roots.length) return new Set();
  const r = [...roots].sort((a, b) => b.length - a.length)[0];
  return idx.byPrefix.get(r.slice(0, 3)) || new Set();
}

/** Οι προσφορές ενός προμηθευτή για ένα προϊόν (επαληθευμένες και μη, με τον λόγο). */
export function offersFor(entry, supplier, items, idx){
  if(entry.kind !== 'product') return [];
  const out = [];
  for(const i of candidates(entry.spec, idx)){
    const it = items[i], m = matchItem(entry.spec, it);
    if(!m.ok) continue;
    let verification = 'unverified', reason = it.reason, unit = null;
    if(it.verification === 'verified'){
      unit = unitPrice(entry.spec, {name: it.name, regularCents: it.regularCents, vatIncluded: supplier.vatIncluded,
        unit: it.unit, unitPriceCents: it.unitPriceCents, unitPriceUnit: it.unitPriceUnit});
      if(unit.error){ verification = 'unit-mismatch'; reason = unit.error; unit = null; }
      else if(entry.anchorCents && (unit.cents * PLAUSIBLE < entry.anchorCents || unit.cents > entry.anchorCents * PLAUSIBLE)){ verification = 'unverified'; reason = 'implausible-vs-anchor'; }
      else { verification = 'verified'; reason = null; }
    }
    out.push({supplier_id: supplier.id, supplier_product_id: String(it.id).slice(0, 120), url: it.url, name: it.name.slice(0, 300),
      regular_cents: verification === 'verified' ? it.regularCents : (it.regularCents ?? null), vat_included: supplier.vatIncluded,
      vat_basis: supplier.vat, unit_cents: verification === 'verified' ? unit.cents : null, unit_basis: unit?.basis ?? null, promo: !!it.promo,
      verification, verification_reason: reason ? String(reason).slice(0, 120) : null, match_method: m.method});
  }
  return out;
}

/**
 * Μία εβδομαδιαία εκτέλεση. store: βλ. stores/*.mjs · suppliers: SUPPLIERS · fetcher: fetch.mjs.
 * Επιστρέφει τα στατιστικά (και τα γράφει στο price_runs).
 */
export async function runOnce({store, suppliers, fetcher, now = () => new Date(), log = () => {}, catalog}){
  const runId = await store.startRun();
  if(runId == null){ log('Τρέχει ήδη άλλη εκτέλεση: τίποτα δεν έγινε.'); return {skipped: true}; }
  const t0 = now(), iso = () => now().toISOString();
  const stats = {run: runId, started: t0.toISOString(), suppliers: {}, products: {}, offers: {verified: 0, promoRegular: 0, unverified: 0, unitMismatch: 0}};
  const beat = setInterval(() => store.heartbeat(runId).catch(() => {}), 60e3);
  try {
    // ── 2. απογραφή ──
    const userProducts = await store.loadUserProducts();
    const inventory = buildInventory({catalog, userProducts});
    await store.releaseCatalogRefs(inventory.filter(e => e.catalogRef).map(e => ({catalog_ref: e.catalogRef, match_key: e.key})));
    const ids = await store.upsertProducts(inventory.map(e => ({match_key: e.key, catalog_ref: e.catalogRef, source: e.source,
      name: e.name, unit: e.unit, kind: e.kind, spec: e.spec})));
    for(const e of inventory) e.id = ids.get(e.key).id;
    const links = inventory.flatMap(e => e.users.filter(u => u.linked !== e.id).map(u => ({user_id: u.user_id, key: u.key, price_product_id: e.id})));
    await store.linkUserProducts(links, iso());
    stats.products = {total: inventory.length, catalog: inventory.filter(e => e.catalogRef).length,
      user: inventory.filter(e => e.users.length).length, userRecords: userProducts.filter(u => !u.deleted).length, linkedNow: links.length,
      eligible: inventory.filter(e => e.kind === 'product').length};
    await store.upsertSuppliers(suppliers.map(s => ({id: s.id, name: s.name, base_url: s.base_url, method: s.method, enabled: s.enabled !== false})));

    // ── 3. κάθε προμηθευτής μία φορά, παράλληλα (διαφορετικοί hosts), ανεξάρτητα ──
    const results = await Promise.all(suppliers.map(async s => {
      const sup = {...s, vatIncluded: true};
      if(s.enabled === false) return {s: sup, status: 'unavailable', reason: s.reason || 'απενεργοποιημένος', items: []};
      const items = [];
      try {
        for await (const it of s.items({fetcher, supplier: s, log})) items.push(it);
        if(!items.length) return {s: sup, status: 'unavailable', reason: 'καμία τιμή προϊόντος δεν διαβάστηκε', items};
        return {s: sup, status: 'available', items};
      } catch(e){
        const reason = e.name === 'Blocked' ? `μπλοκάρει το bot: ${e.message}` : `σφάλμα: ${e.message}`;
        log(`${s.id}: ${reason} (διαβάστηκαν ${items.length} προϊόντα πριν)`);
        return {s: sup, status: 'unavailable', reason, items: [], partialItems: items.length};
      }
    }));

    // ── 4. αντιστοίχιση και αποθήκευση ──
    const existing = await store.loadOffers(inventory.map(e => e.id));
    const prevByKey = new Map(existing.map(o => [`${o.price_product_id}|${o.supplier_id}|${o.supplier_product_id}`, o]));
    const rows = [], history = [];
    const okSuppliers = new Set();
    for(const {s, status, reason, items, partialItems} of results){
      const st = {status, reason: reason || null, items: items.length, verified: items.filter(i => i.verification === 'verified').length,
        promo: items.filter(i => i.promo).length, partialItems, matched: 0};
      stats.suppliers[s.id] = st;
      await store.setSupplierStatus({id: s.id, status, status_reason: reason || null, last_run_at: iso(),
        ...(status === 'available' ? {last_ok_at: iso(), items_seen: items.length} : {})});
      if(status !== 'available') continue;
      okSuppliers.add(s.id);
      const idx = indexItems(items);
      for(const e of inventory){
        for(const o of offersFor(e, s, items, idx)){
          const prev = prevByKey.get(`${e.id}|${o.supplier_id}|${o.supplier_product_id}`);
          rows.push({...o, price_product_id: e.id, retrieved_at: iso(), seen_run: runId,
            last_success_at: o.verification === 'verified' ? iso() : prev?.last_success_at ?? null});
          st.matched++;
          if(o.verification === 'verified'){ stats.offers.verified++; if(o.promo) stats.offers.promoRegular++; }
          else if(o.verification === 'unit-mismatch') stats.offers.unitMismatch++; else stats.offers.unverified++;
        }
      }
    }
    // Προϊόντα που δεν εμφανίστηκαν πια σε προμηθευτή που διαβάστηκε κανονικά: μένουν, αλλά δεν μετρούν.
    const seen = new Set(rows.map(o => `${o.price_product_id}|${o.supplier_id}|${o.supplier_product_id}`));
    for(const o of existing) if(okSuppliers.has(o.supplier_id) && !seen.has(`${o.price_product_id}|${o.supplier_id}|${o.supplier_product_id}`) && o.verification !== 'unverified')
      rows.push({...o, verification: 'unverified', verification_reason: 'not-listed', seen_run: runId});
    const saved = await store.upsertOffers(rows);
    for(const o of saved){
      if(o.verification !== 'verified' || o.seen_run !== runId) continue;
      const prev = prevByKey.get(`${o.price_product_id}|${o.supplier_id}|${o.supplier_product_id}`);
      if(!prev || prev.regular_cents !== o.regular_cents || prev.unit_cents !== o.unit_cents || prev.verification !== 'verified')
        history.push({offer_id: o.id, price_product_id: o.price_product_id, supplier_id: o.supplier_id, regular_cents: o.regular_cents,
          unit_cents: o.unit_cents, observed_at: o.retrieved_at, run_id: runId});
    }
    await store.insertHistory(history);
    stats.historyRows = history.length;

    // ── τιμή αναφοράς ανά προϊόν ──
    const all = await store.loadOffers(inventory.map(e => e.id));
    const byProduct = new Map();
    for(const o of all) (byProduct.get(o.price_product_id) || byProduct.set(o.price_product_id, []).get(o.price_product_id)).push(o);
    const prevProducts = new Map((await store.loadProducts(inventory.map(e => e.id))).map(p => [p.id, p]));
    const updates = [], refHistory = [], counts = {matched: 0, unmatched: 0, notApplicable: 0, verifiedReference: 0, insufficient: 0};
    for(const e of inventory){
      const prev = prevProducts.get(e.id) || {}, list = byProduct.get(e.id) || [];
      const fresh = list.filter(o => o.verification === 'verified' && o.last_success_at && now() - new Date(o.last_success_at) <= FRESH_DAYS * DAY);
      const ref = reference(fresh.map(o => ({supplier: o.supplier_id, cents: o.unit_cents, method: o.match_method})));
      const u = {id: e.id, match_key: e.key, source: e.source, name: e.name, unit: e.unit, kind: e.kind, spec: e.spec, catalog_ref: e.catalogRef,
        last_checked_at: iso(), last_checked_run: runId};
      if(e.kind !== 'product'){
        Object.assign(u, {last_check_status: 'not-applicable', last_check_note: {service: 'υπηρεσία/εργασία: δεν πωλείται από προμηθευτή υλικών',
          'per-area': 'τιμή ανά τ.μ. εφαρμογής: η απόδοση ανά προϊόν διαφέρει, δεν μετατρέπεται με βεβαιότητα',
          'too-generic': 'πολύ γενικό όνομα για ασφαλή αντιστοίχιση (π.χ. μία λέξη χωρίς μέγεθος ή κωδικό)'}[e.kind]});
        counts.notApplicable++;
      } else {
        const thisRun = list.filter(o => o.seen_run === runId);
        const matched = thisRun.some(o => o.verification === 'verified');
        const why = {}; for(const o of thisRun) if(o.verification !== 'verified') why[o.verification_reason || o.verification] = (why[o.verification_reason || o.verification] || 0) + 1;
        Object.assign(u, {last_check_status: matched ? 'matched' : 'unmatched',
          last_check_note: matched ? null : (thisRun.length ? `βρέθηκαν ${thisRun.length} χωρίς επαληθευμένη τιμή: ${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')}` : 'κανένα προϊόν προμηθευτή δεν ταιριάζει με βεβαιότητα').slice(0, 300)});
        counts[matched ? 'matched' : 'unmatched']++;
      }
      if(ref.status === 'verified'){
        Object.assign(u, {reference_cents: ref.cents, reference_status: 'verified', reference_at: iso(), reference_suppliers: ref.n, reference_detail: ref.suppliers});
        if(prev.reference_cents !== ref.cents || prev.reference_status !== 'verified')
          refHistory.push({price_product_id: e.id, reference_cents: ref.cents, suppliers: ref.n, observed_at: iso(), run_id: runId});
        counts.verifiedReference++;
      } else {
        // Ποτέ 0 και ποτέ μαντεψιά: μένει η τελευταία έγκυρη τιμή, με την ημερομηνία της, και αλλάζει μόνο το status.
        const old = prev.reference_cents > 0 && prev.reference_at;
        Object.assign(u, {reference_cents: prev.reference_cents ?? null, reference_at: prev.reference_at ?? null,
          reference_suppliers: prev.reference_suppliers ?? null, reference_detail: prev.reference_detail ?? null,
          reference_status: old ? (now() - new Date(prev.reference_at) > FRESH_DAYS * DAY ? 'stale' : 'insufficient') : (ref.n ? 'insufficient' : 'none')});
        if(e.kind === 'product') counts.insufficient++;
      }
      updates.push(u);
    }
    await store.updateProducts(updates);
    await store.insertReferenceHistory(refHistory);
    stats.products = {...stats.products, ...counts, referenceChanges: refHistory.length};
    stats.finished = iso();
    const failed = Object.values(stats.suppliers).filter(s => s.status !== 'available').length;
    await store.finishRun(runId, failed ? 'partial' : 'done', stats);
    return {stats, inventory, updates};
  } catch(e){
    await store.finishRun(runId, 'failed', stats, String(e?.stack || e).slice(0, 2000)).catch(() => {});
    throw e;
  } finally { clearInterval(beat); }
}
