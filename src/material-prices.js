// Τιμές για ΟΛΕΣ τις παραλλαγές των λιστών υλικών (data/materials.json) — MATERIALS_V2, κλειστό εξ ορισμού.
// Καθαρές συναρτήσεις: τις χρησιμοποιεί το tools/prices/materials-prices.mjs (παράγει src/material-prices.json) και, ΜΟΝΟ με
// το flag, η εφαρμογή (πρόταση τιμής για γραμμή εκτός καταλόγου). Χωρίς AI: ίδιοι κανόνες με το src/price-match.js.
//
// Ανά παραλλαγή: λέξεις του είδους (ή ΟΛΕΣ οι λέξεις ενός συνωνύμου της λίστας με ≥ 2 λέξεις), λέξεις της παραλλαγής που
// δεν είναι μέγεθος (πρέπει να υπάρχουν) και μεγέθη της παραλλαγής (ίδια ακριβώς τιμή). Παραλλαγή με εύρος («2 έως 12»,
// «6A–40A») δεν τιμολογείται: δεν λέει ένα προϊόν. Τιμή ανά μονάδα της λίστας, χωρίς ΦΠΑ, μόνο όταν η συσκευασία είναι ρητή.
import { stemsOf, withoutAttributes, attributes, unitPrice, median, ACCESSORY, root, clean } from './price-match.js';

/** Μονάδα της λίστας → τρόπος τιμολόγησης. null = δεν τιμολογείται από λιανική (κ.μ., τόνος). */
export const UNIT_KIND = {'τεμ.': 'piece', 'σετ': 'piece', 'ζεύγος': 'piece', 'συσκευασία': 'piece', 'ρολό': 'piece',
  'μ.': 'm', 'τ.μ.': 'm2', 'σακί': 'bag', 'κιλό': 'kg', 'λίτρο': 'l', 'κ.μ.': null, 'τόνος': null};
export const MIN_SUPPLIERS = 2, MIN_PRODUCTS = 3;     // επαληθευμένη: ≥ 2 προμηθευτές ή ≥ 3 διαφορετικά προϊόντα
export const OUTLIER = 3;                             // χωρίς τιμή καταλόγου: εκτός ×3 από τον διάμεσο → δεν μετρά
export const SPREAD = 2;                              // 3ο/1ο τεταρτημόριο > ×2 → η παραλλαγή δεν ορίζει ένα προϊόν → όχι

const strip = s => String(s ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => [...new Set(stemsOf(withoutAttributes(strip(s), true)))];
const single = a => Object.fromEntries(Object.entries(a).filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
const RANGE = /\d\s*[a-zα-ω%°]{0,3}\s*(?:–|-|έως|εως|ως)\s*\d|\d+\s*\/\s*\d+\s*\/\s*\d|\d{2,}\s*\/\s*\d{2,}/i;   // «2 έως 12», «6A–40A», «6/12/18», «60/80»
const BARE = /^[\d.,×x\/]+$/;                         // «45», «25.000», «16×2»: χωρίς μονάδα
/**
 * Η μονάδα γράφεται συχνά μόνο στην τελευταία παραλλαγή μιας σειράς: «45; 50; 60; 100 εκ.», «400; 450; 600 Wp».
 * Οι σκέτοι αριθμοί παίρνουν τη μονάδα της επόμενης παραλλαγής που την έχει (ίδια σειρά). Αλλιώς μένουν ως έχουν.
 */
export function withUnits(variants){
  const out = [...variants];
  for(let i = 0; i < out.length; i++){
    if(!BARE.test(out[i].trim())) continue;
    const next = out.slice(i + 1).find(v => !BARE.test(v.trim()));
    const m = next?.trim().match(/^[\d.,×x\/]+\s*([^\d\s;][^;]*)$/);
    if(m && out.slice(i + 1, out.indexOf(next)).every(v => BARE.test(v.trim()))) out[i] = `${out[i].trim()} ${m[1].trim()}`;
  }
  return out;
}

/** Οι παραλλαγές ως προϊόντα για αντιστοίχιση: [{key, trade, item, label, unit, kind, spec, skip?}] */
// Λέξεις εξαρτημάτων πέρα από το ACCESSORY (μόνο για τις λίστες): «Κώδωνας ντουζιέρας», «Φίλτρο νεροχύτη», «Καθαριστικό
// πιστολιού αφρού» δεν είναι το είδος. Δεν ισχύουν αν είναι λέξη του ίδιου του είδους (π.χ. «Βαλβίδα αντεπιστροφής»).
export const MATERIAL_NONE = ['κωδων', 'φιλτρ', 'βαλβιδ', 'σιφων', 'καθαριστ', 'αξεσουαρ', 'μεταλλακτ', 'ταπ', 'ασταρ', 'παγκ', 'καμπιν', 'ανεμ', 'φορτιστ', 'κουρτιν'];
// Λίγες εξαιρέσεις ανά είδος, όπου το όνομα της λίστας είναι γενικό αλλά η ειδικότητα όχι (σιδηρουργικά: δίσκοι μετάλλου).
export const ITEM_NONE = {'cutting-disc': ['ξυλ', 'αλυσιδ']};
export function variantProducts(materials){
  const out = [], none = [...ACCESSORY, ...MATERIAL_NONE].map(root);
  for(const trade of materials.trades) for(const g of trade.groups) for(const it of g.items){
    const head = words(it.name);
    // Συνώνυμο = εναλλακτικό ΟΝΟΜΑ του είδους (≥ 2 λέξεις). Όχι αν είναι γενικότερο από το όνομα (όλες του οι λέξεις μέσα
    // σε αυτό): το «σωλήνας αποχέτευσης» θα έφερνε σωλήνες PP στο «Σωλήνας αποχέτευσης PVC».
    // Επίσης όχι αν περιέχει λέξη παραλλαγής («υψηλής πίεσης» είναι παραλλαγή της λεκάνης, όχι όνομά της) ή αν δεν έχει
    // καμία λέξη του ονόματος (σειρά μάρκας: «Schneider Asfora»)· εξαίρεση: ό,τι γράφει το ίδιο το όνομα σε παρένθεση.
    const vwords = new Set(it.variants.flatMap(words)), paren = words((it.name.match(/\(([^)]*)\)/) || [])[1] || '');
    const allAlt = it.synonyms.map(words).filter(p => p.length >= 2 && !p.every(w => head.includes(w)) && !p.some(w => vwords.has(w)) &&
      (p.some(w => head.includes(w)) || (paren.length && p.every(w => paren.includes(w)))));
    // Είδος με παραλλαγές μεγέθους: οι παραλλαγές ΧΩΡΙΣ μέγεθος («κάθετος», «γωνιακή») δεν ορίζουν προϊόν → δεν τιμολογούνται.
    const sized = withUnits(it.variants).some(v => Object.keys(single(attributes(strip(v), true))).length);
    const full = withUnits(it.variants);
    it.variants.forEach((v0, j) => variant(v0, full[j]));
    if(!it.variants.length) variant('', '');
    function variant(v, vfull){
      const kind = UNIT_KIND[it.unit] ?? null, vt = strip(vfull);
      const attrs = single(attributes(vt, true)), must = words(vt).filter(w => !head.includes(w));
      // αριθμοί της παραλλαγής που δεν έγιναν μέγεθος («UW 75», «σειρά 41»): πρέπει να γράφονται αυτούσιοι στο προϊόν
      const nums = [...new Set((clean(withoutAttributes(vt, true)).match(/(?<![\d.,a-zα-ω])\d+(?:[.,]\d+)?(?![\d.,a-zα-ω])/g) || []).map(n => n.replace(',', '.')))];
      const spec = {unit: kind === 'piece' ? 'piece' : kind === 'm' ? 'm' : kind === 'm2' ? 'm2' : kind === 'bag' ? 'bag' : 'other',
        all: head, any: [], order: [], none: [...none, ...(ITEM_NONE[it.id] || []).map(root)].filter(r => !head.includes(r)), attrs, gtin: null, mpn: null, brand: null, strict: false,
        v2: true, alt: {}, first: [], allAlt, must, nums, materials: true};
      // Παραλλαγή με αριθμό που δεν διαβάστηκε ως μέγεθος και χωρίς άλλη λέξη («10×10», «6×9×19», «1,2»): δεν λέει ποιο
      // προϊόν είναι → δεν τιμολογείται (αλλιώς όλες οι παραλλαγές θα έπαιρναν την ίδια τιμή).
      // …και παραλλαγή χωρίς τίποτα αναγνωρίσιμο («Y»), ή είδος μίας λέξης χωρίς κανένα μέγεθος/λέξη παραλλαγής: πολύ γενικό.
      const unparsed = (/\d/.test(vt) || vt) && !Object.keys(attrs).length && !must.length && !nums.length
        || head.length === 1 && !Object.keys(attrs).length && !must.length;
      const noSize = sized && v && !Object.keys(attrs).length;
      const skip = !kind ? 'not-retail-unit' : RANGE.test(v) ? 'range-variant' : !head.length ? 'no-words' : unparsed ? 'variant-unparsed' : noSize ? 'variant-without-size' : null;
      out.push({key: `${it.id}|${v}`, trade: trade.id, item: it.id, label: v, unit: it.unit, kind, spec, skip});
    }
  }
  return out;
}

/**
 * Τιμή ανά μονάδα της λίστας, χωρίς ΦΠΑ (λεπτά). Πέρα από το unitPrice: κιλό/λίτρο από το ρητό βάρος/όγκο της συσκευασίας
 * («Κόλλα 25kg» → /25, «Χρώμα 10lt» → /10). Ποτέ μαντεψιά: χωρίς ένα και μοναδικό μέγεθος → error.
 */
export function unitPriceMaterial(p, offer){
  if(p.kind !== 'kg' && p.kind !== 'l') return unitPrice(p.spec, offer);
  if(!(offer.regularCents > 0)) return {error: 'no-regular-price'};
  const exVat = c => offer.vatIncluded ? Math.round(c / 1.24) : c;
  const a = attributes(offer.name, true)[p.kind === 'kg' ? 'kg' : 'l'];
  if(!a || a.length !== 1 || !(Number(a[0]) > 0)) return {error: `pack-${p.kind}-unknown`};
  return {cents: exVat(Math.round(offer.regularCents / Number(a[0]))), basis: `pack-${a[0]}${p.kind}`};
}

/**
 * Από τις έγκυρες τιμές (ανά μονάδα) → τιμή της παραλλαγής. offers: [{supplier, id, cents}].
 * Χωρίς τιμή καταλόγου για σύγκριση: όσες απέχουν > ×3 από τον διάμεσο δεν μετρούν (π.χ. τιμή ανά κιλό σε σακί).
 * Επαληθευμένη: ≥ 2 προμηθευτές, ή ≥ 3 διαφορετικά προϊόντα. Τιμή: διάμεσος των διαμέσων ανά προμηθευτή.
 */
export function materialReference(offers){
  const m0 = median(offers.map(o => o.cents));
  const ok = m0 ? offers.filter(o => o.cents * OUTLIER >= m0 && o.cents <= m0 * OUTLIER) : [];
  const by = {};
  for(const o of ok) (by[o.supplier] ??= []).push(o.cents);
  const sup = Object.values(by).map(median), products = new Set(ok.map(o => `${o.supplier}|${o.id}`)).size;
  const v = ok.map(o => o.cents).sort((a, b) => a - b), q = f => v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))];
  const wide = v.length >= 4 && q(0.75) > q(0.25) * SPREAD;
  const verified = !wide && (sup.length >= MIN_SUPPLIERS || products >= MIN_PRODUCTS);
  return {verified, wide, cents: sup.length >= MIN_SUPPLIERS ? median(sup) : median(ok.map(o => o.cents)), suppliers: sup.length, products, dropped: offers.length - ok.length};
}

// ── αρχείο για το κινητό (src/material-prices.json) ──
/**
 * Μόνο οι επαληθευμένες παραλλαγές, με ό,τι χρειάζεται η αναζήτηση (το data/materials.json δεν δημοσιεύεται):
 * {v, at, vat, rows: [[είδος, παραλλαγή, μονάδα, λεπτά, προμηθευτές, προϊόντα, λέξεις, συνώνυμα, λέξεις παραλλαγής, μεγέθη, αριθμοί]]}
 */
export function compactPrices(rows, at){
  return {v: 1, at, vat: 'χωρίς ΦΠΑ', rows: rows.filter(r => r.ref?.verified).map(({product: p, ref}) =>
    [p.item, p.label, p.unit, ref.cents, ref.suppliers, ref.products, p.spec.all, p.spec.allAlt, p.spec.must, p.spec.attrs, p.spec.nums])};
}

// ── εφαρμογή (μόνο με MATERIALS_V2): πρόταση τιμής για γραμμή εκτός καταλόγου ──
/**
 * Τιμή από το src/material-prices.json για το κείμενο μιας γραμμής («κοιλοδοκός 40x40», «σπιράλ 40 εκ.»).
 * Ίδιοι κανόνες με το ταίριασμα των προμηθευτών: όλες οι λέξεις του είδους (ή ενός συνωνύμου), οι λέξεις, οι αριθμοί και τα
 * μεγέθη της παραλλαγής. Η πιο συγκεκριμένη κερδίζει· δύο εξίσου συγκεκριμένες με διαφορετική τιμή → καμία (όχι μαντεψιά).
 */
export function materialRefFor(prices, text){
  if(!Array.isArray(prices?.rows) || !text) return null;
  const t = clean(text), w = stemsOf(t), at = attributes(t, true);
  const has = r => w.some(s => s === r || (r.length >= 3 && s.startsWith(r) && s.length - r.length <= 3));
  const hits = [];
  for(const row of prices.rows){
    const [item, label, unit, cents, n, products, all, allAlt, must, attrs, nums] = row;
    if(!(all.every(has) || allAlt.some(a => a.every(has)))) continue;
    if(!must.every(has)) continue;
    if(!Object.entries(attrs).every(([k, v]) => at[k]?.length === 1 && at[k][0] === v)) continue;
    if(!(nums || []).every(x => new RegExp(`(?<![\\d.a-zα-ω])${x.replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(t))) continue;
    hits.push({item, label, unit, cents, n, products, score: Object.keys(attrs).length * 10 + must.length + (nums || []).length});
  }
  if(!hits.length) return null;
  hits.sort((a, b) => b.score - a.score);
  if(hits.length > 1 && hits[1].score === hits[0].score && hits[1].cents !== hits[0].cents) return null;
  const h = hits[0];
  return {cents: h.cents, status: 'verified', n: h.n, products: h.products, at: Date.parse(prices.at), unit: h.unit, label: h.label ? `${h.item} · ${h.label}` : h.item};
}
