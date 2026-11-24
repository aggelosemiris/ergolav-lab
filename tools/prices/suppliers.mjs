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
import { wooHtmlItems, journalItems, prestaItems, eshopItems } from './adapters/shops.mjs';

const woo = (path) => ({method: 'woo-store-api', items: ({fetcher, supplier, log}) => wooItems({base: supplier.base_url, path, fetcher, log})});

/** Μέτρηση ενός προμηθευτή (robots.txt, ροή, όροι). */
const m = (checked, robots, feed, terms, note = '') => ({checked, robots, feed, terms, note});
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
  // ── Από τους προμηθευτές ειδικοτήτων, ενεργοί από 24/11/2026 (έγκριση): ίδιος bot, ίδιος ρυθμός (ένα αίτημα κάθε 2″ ανά site),
  // robots.txt. Μέτρηση 24/11: kaxirismonotika 1.430/1.433, oikeiaoikia 3.956/3.957, palousis 1.232/1.258 με ρητή κανονική τιμή.
  {id: 'kaxirismonotika', name: 'Kaxiris Monotika', base_url: 'https://kaxirismonotika.gr', vat: 'retail-law', trades: ['monoseis', 'gypsosanida', 'plakakia'],
    method: 'presta-category-pages', items: ({fetcher, supplier, log}) => prestaItems({fetcher, log, base: supplier.base_url, categories: [
      '/153-γυψοσανιδες-ψευδοροφες', '/110-thermomonosi', '/157-συγχρονα-δομικα-και-διακοσμητικα-υλικα', '/834-domika-proionta', '/231-χρωματα']}),
    measured: m('2026-11-23', 'επιτρέπει σελίδες· κλειστές οι παράμετροι ?order= ?n= ?tag= (PrestaShop)', 'χωρίς Store API (PrestaShop) → adapter σελίδων',
      'σελίδα όρων δεν βρέθηκε από την αρχική· 17/11: ρήτρα πν. ιδιοκτησίας', 'μονωτικά, στεγανωτικά, γυψοσανίδες, κόλλες')},
  {id: 'oikeiaoikia', name: 'Οικεία Οικία', base_url: 'https://www.oikeiaoikia.gr', vat: 'retail-law', trades: ['ydravlika', 'plakakia'],
    method: 'woo-html-category-pages', items: ({fetcher, supplier, log}) => wooHtmlItems({fetcher, log, base: supplier.base_url, categories: [
      '/product-category/niptires/', '/product-category/ntouzieres-kampines/', '/product-category/mpanieres/', '/product-category/eidi-ygieinis/',
      '/product-category/mpataries/', '/product-category/thermansi-ydraulika/']}),
    measured: m('2026-11-24', 'επιτρέπει (κλειστά ?filter_, ?per_page=, ?orderby=, ?min/max_price=)', 'WooCommerce χωρίς Store API (404) → σελίδες· /page/N/ επιτρέπεται· δείγμα: 24/24 με ρητή τιμή (<del>/<ins>)',
      'ρήτρα πν. ιδιοκτησίας (/oroi-proipotheseis/)· τίποτα για bots', 'νιπτήρες, ντουζιέρες/καμπίνες (Gloria), μπανιέρες, μπαταρίες')},
  {id: 'palousis', name: 'Palousis', base_url: 'https://www.palousis.gr', vat: 'retail-law', trades: ['ydravlika', 'plakakia'],
    method: 'journal-category-pages', items: ({fetcher, supplier, log}) => journalItems({fetcher, log, base: supplier.base_url, categories: [
      '/νιπτήρες', '/ντουζιέρες', '/καμπίνες', '/μπανιέρες', '/λεκάνες', '/καζανάκια', '/νεροχύτες', '/μπαταρίες-μπάνιου', '/μπαταρίες-κουζίνας',
      '/θερμοσίφωνες-boiler', '/κόλλες', '/αρμοί']}),
    measured: m('2026-11-24', 'επιτρέπει (κλειστά search, tag, &sort, &order, &limit)', 'OpenCart/Journal3 → σελίδες· ?page=N επιτρέπεται· δείγμα: 12/12 με ρητή τιμή (price-normal ή price-old/new)· γράφει και «Προ ΦΠΑ»',
      'ρήτρα πν. ιδιοκτησίας (/όροι-χρήσης)· τίποτα για bots', 'είδη μπάνιου (Karag, Sanitec, Gloria…), πλακάκια, κόλλες')},
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
  {id: 'tehnothermiki', name: 'Τεχνοθερμική', base_url: 'https://tehnothermiki.gr', vat: 'retail-law', enabled: false, trades: ['thermansi'], method: 'html',
    measured: m('2026-11-23', 'δεν έχει robots.txt (404 → τίποτα κλειστό)', 'χωρίς Store API (404) → adapter σελίδων',
      'δεν διαβάστηκαν (ο σύνδεσμος οδηγεί σε http χωρίς DNS)· 17/11: ρήτρα πν. ιδιοκτησίας', 'αντλίες θερμότητας, θέρμανση')},
  {id: 'e-papasideris', name: 'e-Papasideris', base_url: 'https://e-papasideris.gr', vat: 'retail-law', enabled: false, trades: ['oikodomika', 'sovades', 'vafes', 'gypsosanida'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει σελίδες· κλειστά ?page=, sort, order, limit, filter_*', 'χωρίς Store API (OpenCart) → adapter σελίδων',
      '17/11: ρήτρα πν. ιδιοκτησίας', 'χρώματα, δόμηση, γυψοσανίδες, τσιμεντοσανίδες· σελιδοποίηση κλειστή → μόνο 1η σελίδα κατηγορίας')},
  // Β (24/11): adapter OpenCart/Journal3 (ίδιο θέμα με το palousis, όπου ελέγχθηκε). ΔΕΝ μετρήθηκε ζωντανά: σερβίρει από το
  // www.e-plakakia.com, που δεν είναι στο δίκτυο του περιβάλλοντος ελέγχου. ?page= κλειστό → μόνο 1η σελίδα κάθε κατηγορίας.
  {id: 'e-plakakia', name: 'e-Plakakia', base_url: 'https://www.e-plakakia.com', vat: 'retail-law', enabled: false, trades: ['plakakia'],
    method: 'journal-category-pages', items: ({fetcher, supplier, log}) => journalItems({fetcher, log, base: supplier.base_url, maxPages: 1, categories: [
      '/index.php?route=product/category&path=119', '/index.php?route=product/category&path=159',
      '/index.php?route=product/category&path=178', '/index.php?route=product/category&path=179']}),
    measured: m('2026-11-23', 'επιτρέπει σελίδες· κλειστά ?page=, sort, order, limit, filter_*', 'χωρίς Store API (OpenCart/Journal3) → adapter σελίδων· 24/11: www εκτός δικτύου ελέγχου',
      'δεν βρέθηκε σελίδα όρων (ίδιο και 17/11)', 'πλακάκια· σελιδοποίηση κλειστή → μόνο 1η σελίδα κατηγορίας')},
  // Β (24/11): adapter λίστας (ISO-8859-7). «ΠΤΛ» = προτεινόμενη τιμή λιανικής του κατασκευαστή, όχι κανονική του
  // καταστήματος → τα προϊόντα σε προσφορά μένουν μη επαληθευμένα. Κυρίως λάμπες/φωτιστικά· όχι υλικά εγκατάστασης (ΝΥΜ, πρίζες).
  {id: 'e-shop', name: 'e-shop.gr', base_url: 'https://www.e-shop.gr', vat: 'retail-law', enabled: false, trades: ['ilektrologika', 'klimatismos'],
    method: 'eshop-category-pages', items: ({fetcher, log}) => eshopItems({fetcher, log, categories: ['/lampes-fotismou', '/fotistika', '/fotismos']}),
    measured: m('2026-11-23', 'επιτρέπει σελίδες προϊόντων· κλειστά φίλτρα, αναζήτηση, offset (2.447 κανόνες)· κλειστό το Amazonbot',
      'χωρίς Store API → adapter σελίδων (ISO-8859-7)', '17/11: ρήτρα πν. ιδιοκτησίας (/protection)', 'γενικό· ηλεκτρολογικά, κλιματιστικά')},
  // ── Δεύτερος γύρος (23/11/2026, βράδυ): οι 16 που δεν είχαν ελεγχθεί λόγω δικτύου ──
  {id: 'strati', name: 'Strati', base_url: 'https://strati.gr', vat: 'retail-law', enabled: false, trades: ['dapeda'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει', 'Store API: 1.384 προϊόντα· 100/100 με regular_price',
      'ρήτρα πν. ιδιοκτησίας (/oroi-proypotheseis/)· τίποτα για bots', 'χαλιά, σοβατεπί PVC, δάπεδα')},
  {id: 'dapeda-net', name: 'Dapeda.net', base_url: 'https://dapeda.net', vat: 'retail-law', enabled: false, trades: ['dapeda'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει σελίδες· ΚΛΕΙΣΤΟ το /wp-json/ → όχι Store API', 'Store API υπάρχει (385) αλλά το robots το κλείνει → μόνο adapter σελίδων',
      'ρήτρα πν. ιδιοκτησίας (/terms/)· τίποτα για bots', 'laminate, SPC, ξύλινα δάπεδα')},
  {id: 'kouremenos', name: 'Kouremenos', base_url: 'https://kouremenos.net', vat: 'retail-law', enabled: false, trades: ['vafes', 'oikodomika'], ...woo(),
    measured: m('2026-11-23', 'χωρίς κανόνες (τίποτα κλειστό)', 'Store API: 751 προϊόντα· 85/100 με regular_price',
      'ρήτρα πν. ιδιοκτησίας· τίποτα για bots', 'πλαστικά/ακρυλικά χρώματα, εργαλεία βαφής')},
  {id: 'marmara-billis', name: 'Marmara Billis', base_url: 'https://www.marmara-billis.gr', vat: 'retail-law', enabled: false, trades: ['marmara'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει', 'χωρίς Store API (404) → adapter σελίδων',
      'ρήτρα πν. ιδιοκτησίας (/content/22/oroi-xrisis-/)· τίποτα για bots', 'μάρμαρα, πάγκοι, σκαλοπάτια')},
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

/**
 * Επιτρέπουν ανάγνωση (robots.txt), αλλά δεν βρέθηκε σελίδα όρων χρήσης. ΜΕΝΟΥΝ ΕΚΤΟΣ μέχρι να ελεγχθούν οι όροι με το χέρι
 * από τον υπεύθυνο (απόφαση 23/11/2026). Δεν τους διαβάζει κανένα εργαλείο.
 */
export const SPECIALISTS_PENDING_TERMS = [
  {id: 'jerotech', name: 'Jerotech', base_url: 'https://jerotech.eu', vat: 'retail-law', enabled: false, trades: ['dapeda'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει', 'Store API: 209 προϊόντα· 100/100 με regular_price',
      'σελίδα όρων δεν βρέθηκε από την αρχική (να ελεγχθεί με το χέρι)', 'SPC, laminate, LVT, σοβατεπί')},
  {id: 'homeville', name: 'Homeville', base_url: 'https://homeville.gr', vat: 'retail-law', enabled: false, trades: ['xylourgika'], ...woo(),
    measured: m('2026-11-23', 'επιτρέπει (κλειστό το /*product_cat=*)', 'Store API: 362.933 προϊόντα (πολύ μεγάλο για πλήρη ανάγνωση)',
      'σελίδα όρων δεν βρέθηκε από την αρχική (να ελεγχθεί με το χέρι)', 'κυρίως έπιπλα· λίγα υλικά ξυλουργού')},
  {id: 'portes-koufomata', name: 'Portes-Koufomata', base_url: 'https://www.portes-koufomata.gr', vat: 'retail-law', enabled: false, trades: ['xylourgika', 'koufomata'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει με Crawl-delay: 10 (ένα αίτημα κάθε 10″, αργό)', 'χωρίς Store API → adapter σελίδων',
      'σελίδα όρων δεν βρέθηκε από την αρχική (να ελεγχθεί με το χέρι)', 'εσωτερικές πόρτες, πόρτες ασφαλείας, κουφώματα')},
  {id: 'balamoti', name: 'Balamoti', base_url: 'https://balamoti.gr', vat: 'retail-law', enabled: false, trades: ['vafes', 'xylourgika'], method: 'html',
    measured: m('2026-11-23', 'επιτρέπει', 'χωρίς Store API → adapter σελίδων',
      'βρέθηκε μόνο πολιτική απορρήτου, όχι όροι χρήσης (να ελεγχθεί με το χέρι)', 'βερνίκια, χρώματα ξύλου, σιδηρικά')},
  {id: 'pylarinos', name: 'Pylarinos', base_url: 'https://pylarinos.gr', vat: 'retail-law', enabled: false, trades: ['ydravlika'], method: 'html',
    measured: m('2026-11-24', 'επιτρέπει (κλειστοί μόνο φάκελοι του Joomla)', 'Joomla/VirtueMart χωρίς ροή → θα χρειαστεί adapter σελίδων',
      'ο σύνδεσμος «Όροι και προϋποθέσεις» οδηγεί σε πολιτική απορρήτου (να ελεγχθεί με το χέρι)', 'υδραυλικά, πολυστρωματικοί σωλήνες')},
];

/** Ελέγχθηκαν και ΔΕΝ προτείνονται, με τον λόγο (μέτρηση 23/11/2026). Σωστά εκτός: καμία παράκαμψη μπλοκαρίσματος ή robots.txt, ποτέ. */
export const SPECIALISTS_REJECTED = [
  {id: 'karag', base_url: 'https://karag.gr', reason: 'το Store API επιστρέφει κενή λίστα: δεν δείχνει τιμές online (κατάλογος χωρίς τιμές)'},
  {id: 'doikas', base_url: 'https://www.doikas.com', reason: 'Store API με 61.681 προϊόντα αλλά 0/100 με τιμή· κυρίως επαγγελματικός εξοπλισμός κουζίνας'},
  {id: 'doukas', base_url: 'https://www.doukas.com.gr', reason: 'Store API με τιμή 0 (κατάλογος χωρίς τιμές)'},
  {id: 'panpower', base_url: 'https://panpower.eu', reason: 'HTTP 403 στο bot (και στο robots.txt)'},
  {id: 'e-metallon', base_url: 'https://e-metallon.gr', reason: 'HTTP 403 στο bot (αρχική και Store API)'},
  {id: 'zalonis', base_url: 'https://zalonis.eu', reason: 'το robots.txt κλείνει ονομαστικά ClaudeBot, CCBot, Amazonbot κ.ά. (θέλουν να μη διαβάζονται από bots)· Store API 403'},
  {id: 'fotovoltaika', base_url: 'https://www.fotovoltaika.gr', reason: 'robots.txt: Disallow: / για όλους· HTTP 403'},
  {id: 'eshops', base_url: 'https://www.eshops.gr', reason: 'HTTP 403· το robots.txt κλείνει ClaudeBot, GPTBot, PerplexityBot'},
  // 24/11/2026
  {id: 'thermogroup', base_url: 'https://thermogroup.gr', reason: 'δεν δείχνει τιμές online: ούτε στις κατηγορίες ούτε στη σελίδα προϊόντος («ζητήστε προσφορά»)'},
  {id: 'paintcity', base_url: 'https://paintcity.gr', reason: 'κρύβει τις τιμές: κενές στις κατηγορίες και στη σελίδα προϊόντος· υπάρχουν μόνο στα δομημένα δεδομένα, χωρίς διάκριση κανονικής/προσφοράς → δεν επαληθεύονται'},
  {id: 'dedegkikas', base_url: 'https://dedegkikas.gr', reason: 'TLS: ο server στέλνει μόνο το δικό του πιστοποιητικό χωρίς το ενδιάμεσο (Sectigo DV R36) → δεν επαληθεύεται· ο έλεγχος TLS δεν απενεργοποιείται. Ξανά, αν διορθώσει την αλυσίδα'},
];

/** Υποψήφιοι που δεν ελέγχθηκαν ακόμη (μετά τον 2ο γύρο της 23/11/2026: κανένας). */
export const SPECIALISTS_UNCHECKED = [];
