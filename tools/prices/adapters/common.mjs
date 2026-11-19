// Κοινά για τους adapters των προμηθευτών.
//
// Κάθε adapter είναι async generator που δίνει προϊόντα του προμηθευτή σε ΚΟΙΝΗ μορφή:
//   {id, sku, gtin, name, brand, url, unit, regularCents, currentCents, promo, verification, reason, unitPriceCents, unitPriceUnit}
//   - regularCents: η ΚΑΝΟΝΙΚΗ τιμή, μόνο όταν ο προμηθευτής τη δηλώνει ρητά (πεδίο regular_price, oldPrice κ.λπ.).
//   - verification: 'verified' (κανονική τιμή ρητά γνωστή) ή 'unverified' (με τον λόγο στο reason).
//   - promo: true αν το προϊόν ήταν σε προσφορά — η τιμή προσφοράς ΔΕΝ χρησιμοποιείται ποτέ.
// Ο adapter δεν ξέρει τίποτα για τον κατάλογο ή τους χρήστες: η αντιστοίχιση γίνεται στο engine.mjs.

const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—', times: '×', frac12: '½'};
export function decode(s){
  return String(s ?? '').replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}
/** Ελληνική μορφή ποσού («1.234,50 €», «199,00», «12.40») → λεπτά· null αν δεν διαβάζεται με βεβαιότητα. */
export function eurToCents(text){
  const s = String(text ?? '').replace(/[^\d.,]/g, '');
  if(!s) return null;
  let v;
  if(/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) v = Number(s.replace(/\./g, '').replace(',', '.'));
  else if(/^\d+(\.\d{1,2})?$/.test(s)) v = Number(s);
  else if(/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) v = Number(s.replace(/,/g, ''));
  else return null;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}
/** Απόφαση κανονικής τιμής από δύο ρητές τιμές του προμηθευτή (κανονική, τρέχουσα). */
export function decide(regular, current){
  if(!(regular > 0)) return {regularCents: null, currentCents: current ?? null, promo: current > 0, verification: 'unverified', reason: 'no-regular-price'};
  if(current > 0 && current < regular) return {regularCents: regular, currentCents: current, promo: true, verification: 'verified', reason: null};
  if(current > 0 && current > regular) return {regularCents: null, currentCents: current, promo: false, verification: 'unverified', reason: 'price-above-regular'};
  return {regularCents: regular, currentCents: current ?? regular, promo: false, verification: 'verified', reason: null};
}
export const unverified = (reason, extra = {}) => ({regularCents: null, promo: false, verification: 'unverified', reason, ...extra});
