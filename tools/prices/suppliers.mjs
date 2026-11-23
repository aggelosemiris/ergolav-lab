// Οι 8 προμηθευτές της εβδομαδιαίας ενημέρωσης τιμών και οι εναλλακτικοί. Ένας adapter ανά τύπο πηγής
// (adapters/), ρυθμίσεις ανά προμηθευτή εδώ: αλλαγή ή αντικατάσταση προμηθευτή χωρίς αλλαγή στο engine.mjs.
//
// Επιλογή (μέτρηση 19/11/2026, βλ. docs/PRICE_MONITORING.md): εγκεκριμένα sites του data/sites.md με κάλυψη στα είδη
// ανακαίνισης, που επιτρέπουν (robots.txt) τη δημόσια ροή ή τις σελίδες κατηγοριών και δείχνουν ΡΗΤΑ την κανονική τιμή.
// Προτεραιότητα: 1. επίσημο API (κανένας δεν έχει δημόσιο) · 2. δομημένη ροή (WooCommerce Store API) · 3. δημόσιες σελίδες.
//
// ΦΠΑ: 'explicit' = το site δηλώνει ρητά ότι η τιμή είναι με ΦΠΑ· 'retail-law' = τιμή λιανικής προς καταναλωτή, που
// στην Ελλάδα περιλαμβάνει υποχρεωτικά ΦΠΑ, χωρίς να το γράφει το site. Κάθε τιμή αποθηκεύεται με αυτό το στοιχείο.
import { wooItems } from './adapters/woo.mjs';
import { praktikerItems } from './adapters/praktiker.mjs';
import { vrontinosItems, magentoItems } from './adapters/html.mjs';

const woo = (path) => ({method: 'woo-store-api', items: ({fetcher, supplier, log}) => wooItems({base: supplier.base_url, path, fetcher, log})});

export const SUPPLIERS = [
  {id: 'praktiker', name: 'Praktiker', base_url: 'https://www.praktiker.gr', vat: 'retail-law', method: 'praktiker-category-state',
    // Ομάδες κατηγοριών με είδη ανακαίνισης (οι υπόλοιπες — έπιπλα, κήπος, χριστουγεννιάτικα — δεν διαβάζονται).
    items: ({fetcher, log}) => praktikerItems({fetcher, log, seeds: ['ydraulika-egkatastaseis', 'mpanio-kouzina', 'plakakia-patomata',
      'domika-ylika-monosi', 'xromata-vernikia', 'portes-parathyra-8', 'ilektrologika-fotismos', 'klima-kai-energeia']})},
  {id: 'toolcase', name: 'Toolcase', base_url: 'https://www.toolcase.gr', vat: 'retail-law', ...woo()},
  {id: 'el-shop', name: 'el-Shop', base_url: 'https://el-shop.gr', vat: 'retail-law', ...woo()},
  {id: 'paravalos', name: 'Paravalos', base_url: 'https://paravalos.gr', vat: 'retail-law', ...woo()},
  {id: 'peltekis', name: 'Peltekis Tools', base_url: 'https://peltekis-tools.gr', vat: 'retail-law', ...woo()},
  {id: 'fabricashop', name: 'Fabrica', base_url: 'https://www.fabricashop.gr', vat: 'retail-law', ...woo('/wp-json/wc/store/products')},
  {id: 'vrontinos', name: 'Vrontinos', base_url: 'https://vrontinos.gr', vat: 'retail-law', method: 'vrontinos-category-pages',
    // ΕΙΔΗ ΥΓΙΕΙΝΗΣ-ΥΔΡΑΥΛΙΚΑ · ΔΟΜΗΣΗ-ΧΡΩΜΑΤΑ · ΦΩΣ-ΗΛΕΚΤΡΟΛΟΓΙΚΑ
    items: ({fetcher, log}) => vrontinosItems({fetcher, log, categories: ['0098BDA2', '0098BDA3', '0098BE96']})},
  {id: 'meidanis', name: 'Meidanis', base_url: 'https://www.meidanis.gr', vat: 'explicit', method: 'magento-category-pages',
    items: ({fetcher, log}) => magentoItems({fetcher, log, categories: [
      'https://www.meidanis.gr/el/proionta/kalodia/esoterikon-egkatastaseon',
      'https://www.meidanis.gr/el/proionta/fotistika/esoterikoy-choroy/spot-choneyta']})},
];

/** Εναλλακτικοί: ρυθμισμένοι αλλά εκτός, με τον λόγο (απάντησαν 403/503 στο bot στη μέτρηση). Μπαίνουν με enabled: true. */
export const ALTERNATES = [
  {id: 'mafou', name: 'Mafou', base_url: 'https://mafou.gr', vat: 'retail-law', enabled: false, reason: 'HTTP 403 στο bot (19/11/2026)', ...woo()},
  {id: 'youbath', name: 'YouBath', base_url: 'https://youbath.gr', vat: 'retail-law', enabled: false, reason: 'HTTP 403 στο bot (19/11/2026)', method: 'html'},
  {id: 'e-dimakis', name: 'e-Dimakis', base_url: 'https://e-dimakis.gr', vat: 'retail-law', enabled: false, reason: 'HTTP 403 στο bot (19/11/2026)', method: 'html'},
  {id: 'kostelidis', name: 'Kostelidis', base_url: 'https://kostelidis.gr', vat: 'retail-law', enabled: false, reason: 'HTTP 403 στο robots.txt (19/11/2026)', method: 'html'},
  {id: 'ergo-tel', name: 'Ergo-tel', base_url: 'https://ergo-tel.gr', vat: 'retail-law', enabled: false, reason: 'HTTP 503 στο bot (11/2026)', method: 'html'},
];

/**
 * Οι προμηθευτές της εβδομαδιαίας εκτέλεσης (SUPPLIERS + ALTERNATES). Με v2 (MATERIALS_V2_ENABLED ή --v2 στο run.mjs)
 * ισχύουν οι αλλαγές του V2_OVERRIDES· χωρίς v2 η λίστα είναι ΑΚΡΙΒΩΣ η σημερινή.
 */
export function activeSuppliers({v2 = false} = {}){
  return [...SUPPLIERS.map(s => v2 && V2_OVERRIDES[s.id] ? {...s, ...V2_OVERRIDES[s.id]} : s), ...ALTERNATES];
}
export const V2_OVERRIDES = {
  // Vrontinos: (1) η διαγραμμένη «net» τιμή = ρητή κανονική (ελέγχεται στο skin.css σε κάθε εκτέλεση· βλ. html.mjs)·
  // (2) εκτός από τις 3 γενικές κατηγορίες, η 1η σελίδα 20 υποκατηγοριών με υλικά του καταλόγου (η σελιδοποίηση
  // απαγορεύεται στο bot). +21 αιτήματα την εβδομάδα, με τον ίδιο ρυθμό (ένα κάθε 2″).
  vrontinos: {items: ({fetcher, log}) => vrontinosItems({fetcher, log, labelCheck: true, categories: ['0098BDA2', '0098BDA3', '0098BE96',
    '0098BEC1', '0098BEC0', '0098BEC2',              // μπαταρίες νιπτήρα, κουζίνας, λουτρού
    '0098BEBB', '0098BEBC', '0098BEBF', '0098BF9C', '0098C0D8', '0098BE89',   // λεκάνες, νιπτήρες, καζανάκια, νεροχύτες, θερμοσίφωνες
    '0098C041', '0098C040', '0098C045', '0098C088', '0098C08A', '0098C08E',   // σιφώνια, σπιράλ, βάνες, γωνίες, ρακόρ, εξαρτήματα ύδρευσης
    '0098BE2F', '0098BF0D',                          // κόλλες, αρμόστοκοι πλακιδίων
    '0098C095', '0098C094']})},                      // πρίζες & διακόπτες, υλικά ηλεκτρολογικού πίνακα
};

// ── Εξειδικευμένοι προμηθευτές ανά ειδικότητα (Βήμα 0, μέτρηση 23/11/2026) ─────────────────────────────────────────
// ΟΛΟΙ απενεργοποιημένοι και ΕΚΤΟΣ της εβδομαδιαίας εκτέλεσης (δεν τους διαβάζει το run.mjs). Ενεργοποίηση: μετακίνηση
// στο SUPPLIERS μετά από έλεγχο. Οι «woo-store-api» ενεργοποιούνται χωρίς νέο κώδικα· οι «html» θέλουν adapter.
// Μέτρηση: robots.txt, WooCommerce Store API (/wp-json/wc/store/v1/products) και όροι χρήσης, με τον δηλωμένο bot
// (ergolav-price-bot), ένα αίτημα κάθε 2″. «Όροι: ρήτρα πν. ιδιοκτησίας» = απαγορεύουν αναπαραγωγή/αναδημοσίευση του
// περιεχομένου, όχι την ανάγνωση· ίδια περίπτωση με τους σημερινούς προμηθευτές (data/sites.md, «⚠️»).
const m = (checked, robots, feed, terms, note = '') => ({checked, robots, feed, terms, note});
export const SPECIALISTS = [
  {id: 'climaver', name: 'Climaver', base_url: 'https://climaver.gr', vat: 'retail-law', enabled: false, trades: ['klimatismos'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει (User-agent: *, μόνο wp-admin και add-to-cart κλειστά)', 'Store API: 126 προϊόντα· 77/100 με regular_price',
      'ρήτρα πν. ιδιοκτησίας· αναπαραγωγή για εμπορικούς σκοπούς μόνο με έγγραφη συναίνεση', 'χαλκοσωλήνες ψύξης, ψυκτικά υγρά, αναλώσιμα ψυκτικών')},
  {id: 'easy-parts', name: 'Easy Parts', base_url: 'https://easy-parts.gr', vat: 'retail-law', enabled: false, trades: ['klimatismos'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει το User-agent: *· κλείνει GPTBot, CCBot, AdsBot', 'Store API: 11.632 προϊόντα· 95/100 με regular_price',
      'ρήτρα πν. ιδιοκτησίας (μόνο)', 'κυρίως ανταλλακτικά ψυγείων/συσκευών· λίγα υλικά εγκατάστασης κλιματισμού')},
  {id: 'mylonasergaleia', name: 'Μυλωνάς Εργαλεία', base_url: 'https://mylonasergaleia.gr', vat: 'retail-law', enabled: false, trades: ['monoseis', 'kipos-ardeusi'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει (μόνο /last/ κλειστό)', 'Store API: 2.354 προϊόντα· 100/100 με regular_price',
      'ρήτρα πν. ιδιοκτησίας', 'κυρίως εργαλεία· κατηγορία «Αγρός-Κήπος»· στεγανωτικά λίγα')},
  {id: 'vogiatzakis', name: 'Vogiatzakis', base_url: 'https://www.vogiatzakis.gr', vat: 'retail-law', enabled: false, trades: ['vafes'], ...woo(),
    measured: m('2026-11-23', 'ΔΕΝ ξαναμετρήθηκε: ανακατεύθυνση στο www (εκτός δικτύου του ελέγχου)· 17/11 (data/sites.md): επιτρέπει',
      'Store API: 1.525 προϊόντα· 79/100 με regular_price', 'ρήτρα πν. ιδιοκτησίας (data/sites.md)', 'χρώματα, εργαλεία οικοδομής, είδη σπιτιού')},
  {id: 'thermogroup', name: 'Thermogroup', base_url: 'https://thermogroup.gr', vat: 'retail-law', enabled: false, trades: ['thermansi'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει (μόνο wp-admin κλειστό)', 'χωρίς Store API (404) → χρειάζεται adapter σελίδων',
      'ρήτρα πν. ιδιοκτησίας· εξαιρείται η μεμονωμένη αποθήκευση για προσωπική χρήση', 'λέβητες, σώματα, ενδοδαπέδια, αντλίες θερμότητας')},
  {id: 'tehnothermiki', name: 'Τεχνοθερμική', base_url: 'https://tehnothermiki.gr', vat: 'retail-law', enabled: false, trades: ['thermansi'], method: 'html',
    measured: m('2026-11-23', 'δεν έχει robots.txt (404 → τίποτα κλειστό)', 'χωρίς Store API (404) → adapter σελίδων',
      'δεν διαβάστηκαν (ο σύνδεσμος οδηγεί σε http χωρίς DNS)· 17/11: ρήτρα πν. ιδιοκτησίας', 'αντλίες θερμότητας, θέρμανση')},
  {id: 'paintcity', name: 'PaintCity', base_url: 'https://paintcity.gr', vat: 'retail-law', enabled: false, trades: ['vafes', 'plakakia', 'oikodomika'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει (μόνο wp-admin κλειστό)', 'χωρίς Store API (404) → adapter σελίδων',
      'σελίδα όρων δεν βρέθηκε από την αρχική· 17/11: ρήτρα πν. ιδιοκτησίας', 'χρώματα, κόλλες, δομικά')},
  {id: 'kaxirismonotika', name: 'Kaxiris Monotika', base_url: 'https://kaxirismonotika.gr', vat: 'retail-law', enabled: false, trades: ['monoseis', 'gypsosanida', 'plakakia'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει σελίδες· κλειστές οι παράμετροι ?order= ?n= ?tag= (PrestaShop)', 'χωρίς Store API (PrestaShop) → adapter σελίδων',
      'σελίδα όρων δεν βρέθηκε από την αρχική· 17/11: ρήτρα πν. ιδιοκτησίας', 'μονωτικά, στεγανωτικά, γυψοσανίδες, κόλλες')},
  {id: 'e-papasideris', name: 'e-Papasideris', base_url: 'https://e-papasideris.gr', vat: 'retail-law', enabled: false, trades: ['oikodomika', 'sovades', 'vafes', 'gypsosanida'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει σελίδες· κλειστά ?page=, sort, order, limit, filter_*', 'χωρίς Store API (OpenCart) → adapter σελίδων',
      '17/11: ρήτρα πν. ιδιοκτησίας', 'χρώματα, δόμηση, γυψοσανίδες, τσιμεντοσανίδες· σελιδοποίηση κλειστή → μόνο 1η σελίδα κατηγορίας')},
  {id: 'e-plakakia', name: 'e-Plakakia', base_url: 'https://e-plakakia.com', vat: 'retail-law', enabled: false, trades: ['plakakia'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει σελίδες· κλειστά ?page=, sort, order, limit, filter_*', 'χωρίς Store API (OpenCart) → adapter σελίδων',
      'δεν βρέθηκε σελίδα όρων (ίδιο και 17/11)', 'πλακάκια· σελιδοποίηση κλειστή → μόνο 1η σελίδα κατηγορίας')},
  {id: 'e-shop', name: 'e-shop.gr', base_url: 'https://www.e-shop.gr', vat: 'retail-law', enabled: false, trades: ['ilektrologika', 'klimatismos'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει σελίδες προϊόντων· κλειστά φίλτρα, αναζήτηση, offset (2.447 κανόνες)· κλειστό το Amazonbot',
      'χωρίς Store API → adapter σελίδων (ISO-8859-7)', '17/11: ρήτρα πν. ιδιοκτησίας (/protection)', 'γενικό· ηλεκτρολογικά, κλιματιστικά')},
  // ── Δεύτερος γύρος (23/11/2026, βράδυ): οι 16 που δεν είχαν ελεγχθεί λόγω δικτύου ──
  {id: 'jerotech', name: 'Jerotech', base_url: 'https://jerotech.eu', vat: 'retail-law', enabled: false, trades: ['dapeda'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει', 'Store API: 209 προϊόντα· 100/100 με regular_price',
      'σελίδα όρων δεν βρέθηκε από την αρχική (να ελεγχθεί με το χέρι)', 'SPC, laminate, LVT, σοβατεπί')},
  {id: 'strati', name: 'Strati', base_url: 'https://strati.gr', vat: 'retail-law', enabled: false, trades: ['dapeda'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει', 'Store API: 1.384 προϊόντα· 100/100 με regular_price',
      'ρήτρα πν. ιδιοκτησίας (/oroi-proypotheseis/)· τίποτα για bots', 'χαλιά, σοβατεπί PVC, δάπεδα')},
  {id: 'dapeda-net', name: 'Dapeda.net', base_url: 'https://dapeda.net', vat: 'retail-law', enabled: false, trades: ['dapeda'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει σελίδες· ΚΛΕΙΣΤΟ το /wp-json/ → όχι Store API', 'Store API υπάρχει (385) αλλά το robots το κλείνει → μόνο adapter σελίδων',
      'ρήτρα πν. ιδιοκτησίας (/terms/)· τίποτα για bots', 'laminate, SPC, ξύλινα δάπεδα')},
  {id: 'kouremenos', name: 'Kouremenos', base_url: 'https://kouremenos.net', vat: 'retail-law', enabled: false, trades: ['vafes', 'oikodomika'], ...woo(),
    measured: m('2026-11-23', 'χωρίς κανόνες (τίποτα κλειστό)', 'Store API: 751 προϊόντα· 85/100 με regular_price',
      'ρήτρα πν. ιδιοκτησίας· τίποτα για bots', 'πλαστικά/ακρυλικά χρώματα, εργαλεία βαφής')},
  {id: 'homeville', name: 'Homeville', base_url: 'https://homeville.gr', vat: 'retail-law', enabled: false, trades: ['xylourgika'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει (κλειστό το /*product_cat=*)', 'Store API: 362.933 προϊόντα (πολύ μεγάλο για πλήρη ανάγνωση)',
      'σελίδα όρων δεν βρέθηκε από την αρχική (να ελεγχθεί με το χέρι)', 'κυρίως έπιπλα· λίγα υλικά ξυλουργού')},
  {id: 'marmara-billis', name: 'Marmara Billis', base_url: 'https://www.marmara-billis.gr', vat: 'retail-law', enabled: false, trades: ['marmara'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει', 'χωρίς Store API (404) → adapter σελίδων',
      'ρήτρα πν. ιδιοκτησίας (/content/22/oroi-xrisis-/)· τίποτα για bots', 'μάρμαρα, πάγκοι, σκαλοπάτια')},
  {id: 'portes-koufomata', name: 'Portes-Koufomata', base_url: 'https://www.portes-koufomata.gr', vat: 'retail-law', enabled: false, trades: ['xylourgika', 'koufomata'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει με Crawl-delay: 10 (ένα αίτημα κάθε 10″, αργό)', 'χωρίς Store API → adapter σελίδων',
      'σελίδα όρων δεν βρέθηκε από την αρχική (να ελεγχθεί με το χέρι)', 'εσωτερικές πόρτες, πόρτες ασφαλείας, κουφώματα')},
  {id: 'balamoti', name: 'Balamoti', base_url: 'https://balamoti.gr', vat: 'retail-law', enabled: false, trades: ['vafes', 'xylourgika'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει', 'χωρίς Store API → adapter σελίδων',
      'βρέθηκε μόνο πολιτική απορρήτου, όχι όροι χρήσης (να ελεγχθεί με το χέρι)', 'βερνίκια, χρώματα ξύλου, σιδηρικά')},
  {id: 'mykipos', name: 'MyKipos', base_url: 'https://mykipos.gr', vat: 'retail-law', enabled: false, trades: ['kipos-ardeusi'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει', 'Store API: 94 προϊόντα· 93 με regular_price',
      'ρήτρα πν. ιδιοκτησίας (/oroi-xrisis/)· τίποτα για bots', 'σπόροι, λάστιχα, ανταλλακτικά· μικρός κατάλογος')},
  {id: 'e-agro', name: 'e-Agro', base_url: 'https://www.e-agro.gr', vat: 'retail-law', enabled: false, trades: ['kipos-ardeusi'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει (κλειστά AhrefsBot, BLEXBot)', 'Store API: 3.908 προϊόντα· 100/100 με regular_price',
      'ρήτρα πν. ιδιοκτησίας (/oroi-chrisis/)· τίποτα για bots', 'άρδευση, εργαλεία, ψεκαστικά, λιπάσματα')},
  {id: 'garafas', name: 'Garafas', base_url: 'https://www.garafas.gr', vat: 'retail-law', enabled: false, trades: ['kipos-ardeusi'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει', 'χωρίς Store API → adapter σελίδων',
      'ρήτρα πν. ιδιοκτησίας (/oroi-xrisis/)· τίποτα για bots', 'άρδευση, γεωργικά')},
  {id: 'energybatteries', name: 'Energy Batteries', base_url: 'https://energybatteries.gr', vat: 'retail-law', enabled: false, trades: ['iliaka-fv'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει', 'Store API: HTTP 403 → adapter σελίδων (η αρχική απαντά 200)',
      'όροι συναλλαγών (/oroi-sinallagon/)· τίποτα για bots ή πν. ιδιοκτησία', 'μπαταρίες, inverter, ΦΒ')},
];

/** Ελέγχθηκαν και ΔΕΝ προτείνονται, με τον λόγο (μέτρηση 23/11/2026). */
export const SPECIALISTS_REJECTED = [
  {id: 'karag', base_url: 'https://karag.gr', reason: 'το Store API επιστρέφει κενή λίστα: δεν δείχνει τιμές online (κατάλογος χωρίς τιμές)'},
  {id: 'doikas', base_url: 'https://www.doikas.com', reason: 'Store API με 61.681 προϊόντα αλλά 0/100 με τιμή· κυρίως επαγγελματικός εξοπλισμός κουζίνας'},
  {id: 'doukas', base_url: 'https://www.doukas.com.gr', reason: 'Store API με τιμή 0 (κατάλογος χωρίς τιμές)'},
  {id: 'panpower', base_url: 'https://panpower.eu', reason: 'HTTP 403 στο bot (και στο robots.txt)'},
  {id: 'e-metallon', base_url: 'https://e-metallon.gr', reason: 'HTTP 403 στο bot (αρχική και Store API)'},
  {id: 'zalonis', base_url: 'https://zalonis.eu', reason: 'το robots.txt κλείνει ονομαστικά ClaudeBot, CCBot, Amazonbot κ.ά. (θέλουν να μη διαβάζονται από bots)· Store API 403'},
  {id: 'fotovoltaika', base_url: 'https://www.fotovoltaika.gr', reason: 'robots.txt: Disallow: / για όλους· HTTP 403'},
  {id: 'eshops', base_url: 'https://www.eshops.gr', reason: 'HTTP 403· το robots.txt κλείνει ClaudeBot, GPTBot, PerplexityBot'},
];

/** Υποψήφιοι που δεν ελέγχθηκαν ακόμη (μετά τον 2ο γύρο της 23/11/2026: κανένας). */
export const SPECIALISTS_UNCHECKED = [];
