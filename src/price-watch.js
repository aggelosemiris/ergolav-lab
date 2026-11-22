// Τιμές προμηθευτών στην εφαρμογή (εβδομαδιαία ενημέρωση: tools/prices/, βλ. docs/PRICE_MONITORING.md).
// 1. Κάθε προϊόν εκτός καταλόγου που ο τεχνίτης κρατά με δική του τιμή καταγράφεται ΑΥΤΟΜΑΤΑ (customProducts) και,
//    με σύνδεση, ανεβαίνει στον λογαριασμό (user_products) — με την τιμή του ΟΠΩΣ την έγραψε. Από εκεί μπαίνει στον
//    επόμενο εβδομαδιαίο έλεγχο τιμών. Δεν ζητείται EAN ή κωδικός.
// 2. Οι τιμές αναφοράς (διάμεσος επαληθευμένων κανονικών τιμών προμηθευτών, χωρίς ΦΠΑ) έρχονται από τον λογαριασμό και
//    κρατιούνται στη συσκευή (φαίνονται και χωρίς σήμα). Δεν αλλάζουν ποτέ μόνες τους τιμή γραμμής ή προσφοράς:
//    ο τεχνίτης βλέπει και αποφασίζει. Οι αποθηκευμένες προσφορές κρατούν τις τιμές με τις οποίες φτιάχτηκαν.
export const CUSTOM = 'ergolav.customProducts';
export const REFS = 'ergolav.refPrices';
export const MAX_CUSTOM = 500;
const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const read = (k, d) => { try { const v = JSON.parse(storage()?.getItem(k) ?? 'null'); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { storage()?.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};

/** Τα προϊόντα εκτός καταλόγου του τεχνίτη: {priceKey: {name, unit, cents, lab, at}}. */
export const customProducts = () => obj(read(CUSTOM, {}));

/** Καταγραφή μετά το «Κράτα την» σε γραμμή εκτός καταλόγου (added). Η τιμή είναι αυτή που έγραψε ο τεχνίτης. */
export function registerCustom(line, key, at = Date.now()){
  if(!line?.added || !key) return false;
  const all = customProducts();
  all[key] = {name: String(line.desc || line.name || '').trim().slice(0, 200), said: line.said ? String(line.said).slice(0, 300) : null,
    unit: String(line.unit || 'τεμ.').slice(0, 20),
    cents: Number.isInteger(line.mat) && line.mat >= 0 ? line.mat : null, lab: Number.isInteger(line.lab) && line.lab >= 0 ? line.lab : null, at};
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CUSTOM);
  return write(CUSTOM, Object.fromEntries(keep));
}

/**
 * Τα προϊόντα εκτός καταλόγου που υπήρχαν ΠΡΙΝ από αυτή την αλλαγή ζουν μόνο στη μνήμη τιμών (ergolav.prices,
 * κλειδιά «unknown|όνομα»). Μπαίνουν και αυτά, μία φορά, με την τελευταία τιμή τους (η μονάδα δεν είχε κρατηθεί → τεμ.).
 */
export function migrateCustom(prices){
  const all = customProducts(); let n = 0;
  for(const [key, list] of Object.entries(obj(prices))){
    if(!key.startsWith('unknown|') || all[key] || !Array.isArray(list) || !list.length) continue;
    const last = list[0];
    all[key] = {name: key.slice('unknown|'.length).slice(0, 200), unit: 'τεμ.', cents: last.c, lab: null, at: last.at, migrated: true}; n++;
  }
  if(n) write(CUSTOM, all);
  return n;
}

/** Ανεβάζει στον λογαριασμό όσα άλλαξαν στη συσκευή (η πιο πρόσφατη αλλαγή κερδίζει). db: {client, userId}. */
export async function pushCustom({client, userId}){
  const local = customProducts(), keys = Object.keys(local);
  if(!keys.length) return 0;
  const {data, error} = await client.from('user_products').select('key,updated_at');
  if(error) throw error;
  const remote = Object.fromEntries((data || []).map(r => [r.key, Date.parse(r.updated_at) || 0]));
  const rows = keys.filter(k => !(remote[k] >= local[k].at) && local[k].name).map(k => ({user_id: userId, key: k, name: local[k].name,
    said: local[k].said ?? null, unit: local[k].unit, user_price_cents: local[k].cents, user_labor_cents: local[k].lab, updated_at: new Date(local[k].at).toISOString()}));
  if(!rows.length) return 0;
  const {error: e2} = await client.from('user_products').upsert(rows, {onConflict: 'user_id,key'});
  if(e2) throw e2;
  return rows.length;
}

const REF_COLS = 'id,catalog_ref,unit,reference_cents,reference_status,reference_at,reference_suppliers,last_checked_at,last_check_status';
const refRow = p => ({id: p.id, cents: p.reference_cents ?? null, status: p.reference_status, at: p.reference_at ? Date.parse(p.reference_at) : null,
  n: p.reference_suppliers ?? 0, checked: p.last_checked_at ? Date.parse(p.last_checked_at) : null, check: p.last_check_status ?? null});

/** Φέρνει τις τιμές αναφοράς του καταλόγου και των δικών του προϊόντων, και τις κρατά στη συσκευή. */
export async function pullRefs({client}, now = Date.now()){
  const byKey = {};
  const {data: cat, error} = await client.from('price_products').select(REF_COLS).not('catalog_ref', 'is', null);
  if(error) throw error;
  for(const p of cat || []) byKey[p.catalog_ref] = refRow(p);
  const {data: mine, error: e2} = await client.from('user_products').select('key,price_product_id,linked_at').eq('deleted', false);
  if(e2) throw e2;
  const ids = [...new Set((mine || []).map(u => u.price_product_id).filter(Boolean))];
  const byId = {};
  for(let i = 0; i < ids.length; i += 150){
    const {data, error: e3} = await client.from('price_products').select(REF_COLS).in('id', ids.slice(i, i + 150));
    if(e3) throw e3;
    for(const p of data || []) byId[p.id] = refRow(p);
  }
  for(const u of mine || []) byKey[u.key] = u.price_product_id && byId[u.price_product_id] ? byId[u.price_product_id] : {pending: true};
  write(REFS, {at: now, byKey});
  return Object.keys(byKey).length;
}

/** Η τιμή αναφοράς μιας γραμμής από τη συσκευή (null αν δεν έχει έρθει ποτέ τίποτα). */
export function refFor(key){
  const c = read(REFS, null);
  if(!c || typeof c !== 'object') return null;
  const r = obj(c.byKey)[key];
  return r && typeof r === 'object' ? r : null;
}

/** Οι επαληθευμένες τιμές προμηθευτών για μία τιμή αναφοράς (για τη σύγκριση· φορτώνονται όταν ανοίξει). */
export async function offersFor({client}, productId){
  const {data, error} = await client.from('supplier_offers').select('supplier_id,name,url,regular_cents,unit_cents,promo,retrieved_at')
    .eq('price_product_id', productId).eq('verification', 'verified').order('unit_cents', {ascending: true}).limit(40);
  if(error) throw error;
  return data || [];
}

/** Κείμενο κατάστασης για την οθόνη. */
export function refStatus(r, fmtDate = t => new Date(t).toLocaleDateString('el-GR')){
  if(!r) return null;
  if(r.pending) return 'Θα ελεγχθεί στον επόμενο εβδομαδιαίο έλεγχο τιμών.';
  if(r.cents > 0 && r.status === 'verified') return `✓ επαληθευμένη ${fmtDate(r.at)} · ${r.n} ${r.n === 1 ? 'προμηθευτής' : 'προμηθευτές'}`;
  if(r.cents > 0 && r.status === 'stale') return `παλιά τιμή · τελευταία επαλήθευση ${fmtDate(r.at)}`;
  if(r.cents > 0) return `λίγες τιμές στον τελευταίο έλεγχο · τελευταία επαλήθευση ${fmtDate(r.at)}`;
  if(r.check === 'not-applicable') return null;
  if(r.checked) return 'Δεν βρέθηκε ακόμα με βεβαιότητα σε προμηθευτή.';
  return 'Θα ελεγχθεί στον επόμενο εβδομαδιαίο έλεγχο τιμών.';
}

/** Συγχρονισμός στο παρασκήνιο, το πολύ μία φορά ανά every· σφάλματα αγνοούνται (ξαναδοκιμάζει αργότερα). */
export const SYNC_TIMEOUT_MS = 30000;
const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(no, ms); })]).finally(() => clearTimeout(t)); };
export function createPriceSync(getDb, {every = 6 * 3600e3, now = () => Date.now()} = {}){
  let last = -Infinity, running = null;                  // η πρώτη κλήση τρέχει πάντα
  return function run(force = false){
    if(running || (!force && now() - last < every)) return running;
    last = now();
    running = (async () => {
      // Χρονικό όριο: με κακό σήμα ένα αίτημα μπορεί να κρέμεται· τότε ο επόμενος γύρος ξεκινά κανονικά.
      try { const db = await getDb?.(); if(!db) return null; return await withTimeout((async () => ({pushed: await pushCustom(db), refs: await pullRefs(db, now())}))(), SYNC_TIMEOUT_MS); }
      catch { return null; }
      finally { running = null; }
    })();
    return running;
  };
}
