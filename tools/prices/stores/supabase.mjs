// Αποθήκευση στο Supabase μέσω PostgREST (REST API), με το service_role key — ΜΟΝΟ από τα secrets του GitHub Actions
// (SUPABASE_SERVICE_ROLE_KEY), ποτέ στο repo ή στην εφαρμογή. Χωρίς εξαρτήσεις: σκέτο fetch.
// Τα δικαιώματα και οι κανόνες ακεραιότητας είναι στη βάση (supabase/migrations/20261120000000_price_monitoring.sql):
// μοναδικά κλειδιά, κλείδωμα εκτέλεσης (price_run_start), trigger που απαγορεύει αλλαγή της τιμής του χρήστη.
// Τα πεδία μιας τιμής προμηθευτή, ίδια σε κάθε εγγραφή (το PostgREST θέλει ομοιόμορφες γραμμές σε μαζική εισαγωγή).
import { offerUrl } from '../offer-url.mjs';
export const OFFER_COLS = ['price_product_id', 'supplier_id', 'supplier_product_id', 'url', 'name', 'regular_cents', 'vat_included', 'vat_basis',
  'unit_cents', 'unit_basis', 'promo', 'verification', 'verification_reason', 'match_method', 'retrieved_at', 'last_success_at', 'seen_run'];
const pick = (r, cols) => Object.fromEntries(cols.map(c => [c, r[c] ?? null]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Τα headers του κλειδιού. Νέα κλειδιά της Supabase (sb_secret_…): ΜΟΝΟ «apikey» — δεν είναι JWT, και ως Bearer
// τα απορρίπτει ο server. Παλιό service_role JWT (ξεκινά με «eyJ»): και «Authorization: Bearer».
export function authHeaders(key){
  const k = String(key || '');
  return k.startsWith('eyJ') ? {apikey: k, Authorization: `Bearer ${k}`} : {apikey: k};
}
const chunk = (a, n) => Array.from({length: Math.ceil(a.length / n)}, (_, i) => a.slice(i * n, i * n + n));

export function createSupabaseStore({url, serviceKey, fetchImpl = fetch, retries = 3, log = () => {}}){
  if(!url || !serviceKey) throw new Error('Λείπουν SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  async function req(method, path, body, prefer){
    for(let attempt = 0; ; attempt++){
      let r, err;
      try {
        r = await fetchImpl(base + path, {method, headers: {...authHeaders(serviceKey),
          'Content-Type': 'application/json', ...(prefer ? {Prefer: prefer} : {})}, body: body == null ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60000)});
      } catch(e){ err = e; }
      const temporary = err || r.status >= 500 || r.status === 429;
      if(temporary && attempt < retries){ log(`Supabase: νέα προσπάθεια (${err ? err.name : r.status}) ${method} ${path.split('?')[0]}`); await sleep(1500 * 2 ** attempt); continue; }
      if(err) throw err;
      const text = await r.text();
      if(!r.ok){
        // Το details μπορεί να περιέχει ολόκληρη εγγραφή και να κρύψει το message με το όνομα του κανόνα.
        // Κρατάμε μόνο κωδικό/μήνυμα, χωρίς details ή hint και χωρίς το κλειδί της υπηρεσίας.
        let summary = 'Μη δομημένη απάντηση σφάλματος';
        try {
          const e = JSON.parse(text);
          summary = [typeof e?.code === 'string' ? e.code.slice(0, 20) : '',
            typeof e?.message === 'string' ? e.message : ''].filter(Boolean).join(' ') || summary;
        } catch {}
        summary = summary.replaceAll(serviceKey, '[κρυφό]').slice(0, 600);
        throw new Error(`Supabase ${method} ${path.split('?')[0]}: HTTP ${r.status} ${summary}`);
      }
      return text ? JSON.parse(text) : null;
    }
  }
  async function getAll(path){
    const out = [];
    for(let off = 0; ; off += 1000){
      const page = await req('GET', `${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${off}`);
      out.push(...page); if(page.length < 1000) return out;
    }
  }
  const inList = ids => `in.(${ids.join(',')})`;
  const upsert = (table, rows, conflict) => req('POST', `/${table}?on_conflict=${conflict}`, rows, 'resolution=merge-duplicates,return=representation');

  return {
    async publishCatalogPrices(rows){
      const result = {new: 0, changed: []};
      for(const part of chunk(rows, 500)){
        const published = await req('POST', '/rpc/publish_product_catalog_prices', {p_rows: part});
        result.new += published.new;
        result.changed.push(...published.changed);
      }
      return result;
    },
    async startRun(stale = 120){ return req('POST', '/rpc/price_run_start', {p_stale_minutes: stale}); },
    async heartbeat(id){ await req('PATCH', `/price_runs?id=eq.${id}`, {heartbeat_at: new Date().toISOString()}); },
    async finishRun(id, status, stats, error = null){ await req('PATCH', `/price_runs?id=eq.${id}`, {status, stats, error, finished_at: new Date().toISOString()}); },
    async loadUserProducts(){ return getAll('/user_products?select=user_id,key,name,said,unit,brand,mpn,gtin,deleted,price_product_id&order=user_id,key'); },
    async releaseCatalogRefs(pairs){
      const want = new Map(pairs.map(p => [p.catalog_ref, p.match_key]));
      const rows = await getAll('/price_products?select=id,catalog_ref,match_key&catalog_ref=not.is.null');
      for(const r of rows) if(want.has(r.catalog_ref) && want.get(r.catalog_ref) !== r.match_key)
        await req('PATCH', `/price_products?id=eq.${r.id}`, {catalog_ref: null});
    },
    async upsertProducts(rows){
      const out = new Map();
      for(const part of chunk(rows, 300)) for(const p of await upsert('price_products', part, 'match_key')) out.set(p.match_key, {id: p.id});
      return out;
    },
    // Μόνο τα πεδία σύνδεσης: ο trigger της βάσης απορρίπτει κάθε αλλαγή πεδίου του χρήστη από τον service_role.
    async linkUserProducts(links, at){
      for(const l of links) await req('PATCH', `/user_products?user_id=eq.${l.user_id}&key=eq.${encodeURIComponent(l.key)}`, {price_product_id: l.price_product_id, linked_at: at});
    },
    async upsertSuppliers(rows){ await upsert('suppliers', rows, 'id'); },
    async setSupplierStatus(r){ await req('PATCH', `/suppliers?id=eq.${r.id}`, r); },
    async loadOffers(ids){
      const out = [];
      for(const part of chunk(ids, 150)) out.push(...await getAll(`/supplier_offers?select=*&price_product_id=${inList(part)}&order=id`));
      return out;
    },
    async loadProducts(ids){
      const out = [];
      for(const part of chunk(ids, 150)) out.push(...await getAll(`/price_products?select=id,reference_cents,reference_status,reference_at,reference_suppliers,reference_detail&id=${inList(part)}`));
      return out;
    },
    async upsertOffers(rows){
      const out = [];
      // Όλο το πακέτο ελέγχεται πριν από το πρώτο αίτημα. Το id μένει αυτούσιο, αλλάζει μόνο η αναπαράσταση του URL.
      const prepared = rows.map(r => pick({...r, url: offerUrl(r.url)}, OFFER_COLS));
      for(const part of chunk(prepared, 500)) out.push(...await upsert('supplier_offers', part, 'price_product_id,supplier_id,supplier_product_id'));
      return out;
    },
    async insertHistory(rows){ for(const part of chunk(rows, 500)) await req('POST', '/supplier_price_history', part, 'return=minimal'); },
    async updateProducts(rows){ for(const part of chunk(rows.map(({id, ...r}) => r), 300)) await upsert('price_products', part, 'match_key'); },
    async insertReferenceHistory(rows){ for(const part of chunk(rows, 500)) await req('POST', '/price_reference_history', part, 'return=minimal'); },
  };
}
