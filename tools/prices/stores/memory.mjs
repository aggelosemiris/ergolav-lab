// Αποθήκευση σε μνήμη/αρχείο JSON με την ΙΔΙΑ διεπαφή και τους ΙΔΙΟΥΣ κανόνες με τη βάση (μοναδικά κλειδιά,
// κλείδωμα εκτέλεσης, η τιμή του χρήστη δεν αλλάζει). Για τα τεστ και για τοπική εκτέλεση χωρίς Supabase.
import fs from 'node:fs';
import { offerUrl } from '../offer-url.mjs';

export function createMemoryStore({file = null, data = null, now = () => new Date()} = {}){
  const db = data || (file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null) || {};
  for(const t of ['suppliers', 'price_products', 'user_products', 'supplier_offers', 'supplier_price_history', 'price_reference_history', 'price_runs', 'product_catalog_prices']) db[t] ??= [];
  db.seq ??= {};
  const next = t => (db.seq[t] = (db.seq[t] || 0) + 1);
  const save = () => { if(file){ fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); } };
  const iso = () => now().toISOString();
  const clone = x => JSON.parse(JSON.stringify(x));
  const USER_FIELDS = ['user_price_cents', 'user_labor_cents', 'name', 'unit', 'deleted', 'updated_at', 'user_id', 'key'];

  const catalogKey = row => row.product_id + ':' + row.supplier_id;
  const catalogPrices = new Map(db.product_catalog_prices.map(row => [catalogKey(row), row]));

  return {
    db,
    async loadCatalogPrices(){ return clone(db.product_catalog_prices); },
    async publishCatalogPrices(rows){
      const result = {new: 0, changed: []};
      for(const row of rows){
        const key = catalogKey(row), before = catalogPrices.get(key);
        if(before && Date.parse(before.verified_at) >= Date.parse(row.verified_at)) continue;
        if(!before){
          result.new++;
          const added = clone(row);
          catalogPrices.set(key, added);
          db.product_catalog_prices.push(added);
        } else {
          if(before.cents !== row.cents) result.changed.push(row.product_id);
          Object.assign(before, clone(row));
        }
      }
      save();
      return result;
    },
    async startRun(staleMinutes = 120){
      for(const r of db.price_runs) if(r.status === 'running' && now() - new Date(r.heartbeat_at) > staleMinutes * 60e3)
        Object.assign(r, {status: 'aborted', finished_at: iso(), error: 'χωρίς σημείο ζωής: θεωρήθηκε διακομμένη'});
      if(db.price_runs.some(r => r.status === 'running')) return null;
      const r = {id: next('price_runs'), started_at: iso(), heartbeat_at: iso(), status: 'running'};
      db.price_runs.push(r); save(); return r.id;
    },
    async heartbeat(id){ const r = db.price_runs.find(x => x.id === id); if(r) r.heartbeat_at = iso(); save(); },
    async finishRun(id, status, stats, error = null){ Object.assign(db.price_runs.find(x => x.id === id), {status, stats, error, finished_at: iso()}); save(); },
    async loadUserProducts(){ return clone(db.user_products); },
    async releaseCatalogRefs(pairs){
      const want = new Map(pairs.map(p => [p.catalog_ref, p.match_key]));
      for(const p of db.price_products) if(p.catalog_ref && want.has(p.catalog_ref) && want.get(p.catalog_ref) !== p.match_key) p.catalog_ref = null;
    },
    async upsertProducts(rows){
      const out = new Map();
      for(const r of rows){
        let p = db.price_products.find(x => x.match_key === r.match_key);
        if(r.catalog_ref && db.price_products.some(x => x.catalog_ref === r.catalog_ref && x !== p)) throw new Error('unique catalog_ref ' + r.catalog_ref);
        if(!p){ p = {id: next('price_products'), created_at: iso(), reference_status: 'none', ...clone(r)}; db.price_products.push(p); }
        else Object.assign(p, clone(r), {catalog_ref: r.catalog_ref ?? p.catalog_ref});
        out.set(r.match_key, {id: p.id});
      }
      save(); return out;
    },
    async linkUserProducts(links, at){
      for(const l of links){
        const u = db.user_products.find(x => x.user_id === l.user_id && x.key === l.key);
        if(u){ u.price_product_id = l.price_product_id; u.linked_at = at; }
      }
      save();
    },
    async upsertSuppliers(rows){ for(const r of rows){ const s = db.suppliers.find(x => x.id === r.id); s ? Object.assign(s, r) : db.suppliers.push({status: 'unknown', ...r}); } save(); },
    async setSupplierStatus(r){ Object.assign(db.suppliers.find(x => x.id === r.id), r); save(); },
    async loadOffers(ids){ const s = new Set(ids); return clone(db.supplier_offers.filter(o => s.has(o.price_product_id))); },
    async loadProducts(ids){ const s = new Set(ids); return clone(db.price_products.filter(p => s.has(p.id))); },
    async upsertOffers(rows){
      const out = [];
      const prepared = rows.map(r => ({...r, url: offerUrl(r.url)}));
      for(const r of prepared){
        if(r.verification === 'verified' && !(r.regular_cents > 0 && r.unit_cents > 0)) throw new Error('check: verified χωρίς τιμή');
        let o = db.supplier_offers.find(x => x.price_product_id === r.price_product_id && x.supplier_id === r.supplier_id && x.supplier_product_id === r.supplier_product_id);
        const {id, ...rest} = clone(r);
        if(!o){ o = {id: next('supplier_offers'), ...rest}; db.supplier_offers.push(o); } else Object.assign(o, rest);
        out.push(clone(o));
      }
      save(); return out;
    },
    async insertHistory(rows){ for(const r of rows) db.supplier_price_history.push({id: next('supplier_price_history'), ...r}); save(); },
    async updateProducts(rows){
      for(const r of rows){ const p = db.price_products.find(x => x.id === r.id); if(p) Object.assign(p, clone(r)); }
      save();
    },
    async insertReferenceHistory(rows){ for(const r of rows) db.price_reference_history.push({id: next('price_reference_history'), ...r}); save(); },
    /** Μόνο για τεστ: η εργασία ΔΕΝ πρέπει ποτέ να αλλάξει πεδίο του χρήστη. */
    userFieldsSnapshot(){ return JSON.stringify(db.user_products.map(u => USER_FIELDS.map(f => u[f]))); },
  };
}
