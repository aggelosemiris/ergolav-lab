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
];

/** Ελέγχθηκαν και ΔΕΝ προτείνονται, με τον λόγο (μέτρηση 23/11/2026). */
export const SPECIALISTS_REJECTED = [
  {id: 'karag', base_url: 'https://karag.gr', reason: 'το Store API επιστρέφει κενή λίστα: δεν δείχνει τιμές online (κατάλογος χωρίς τιμές)'},
  {id: 'doikas', base_url: 'https://www.doikas.com', reason: 'Store API με 61.681 προϊόντα αλλά 0/100 με τιμή· κυρίως επαγγελματικός εξοπλισμός κουζίνας'},
  {id: 'doukas', base_url: 'https://www.doukas.com.gr', reason: 'Store API με τιμή 0 (κατάλογος χωρίς τιμές)'},
  {id: 'panpower', base_url: 'https://panpower.eu', reason: 'HTTP 403 στο bot (και στο robots.txt)'},
];

/** Υποψήφιοι που ΔΕΝ ελέγχθηκαν: το περιβάλλον του ελέγχου δεν είχε πρόσβαση στο δίκτυό τους (23/11/2026). */
export const SPECIALISTS_UNCHECKED = [
  {id: 'jerotech', base_url: 'https://jerotech.eu', trades: ['dapeda']}, {id: 'strati', base_url: 'https://strati.gr', trades: ['dapeda']},
  {id: 'dapeda-net', base_url: 'https://dapeda.net', trades: ['dapeda']}, {id: 'kouremenos', base_url: 'https://kouremenos.net', trades: ['vafes', 'oikodomika']},
  {id: 'e-metallon', base_url: 'https://e-metallon.gr', trades: ['xylourgika', 'sidirourgika']}, {id: 'homeville', base_url: 'https://homeville.gr', trades: ['xylourgika']},
  {id: 'zalonis', base_url: 'https://zalonis.eu', trades: ['xylourgika', 'koufomata']}, {id: 'marmara-billis', base_url: 'https://www.marmara-billis.gr', trades: ['marmara']},
  {id: 'portes-koufomata', base_url: 'https://www.portes-koufomata.gr', trades: ['xylourgika', 'koufomata']}, {id: 'balamoti', base_url: 'https://balamoti.gr', trades: ['vafes', 'xylourgika']},
  {id: 'mykipos', base_url: 'https://mykipos.gr', trades: ['kipos-ardeusi']}, {id: 'e-agro', base_url: 'https://e-agro.gr', trades: ['kipos-ardeusi']},
  {id: 'garafas', base_url: 'https://garafas.gr', trades: ['kipos-ardeusi']}, {id: 'energybatteries', base_url: 'https://energybatteries.gr', trades: ['iliaka-fv']},
  {id: 'fotovoltaika', base_url: 'https://www.fotovoltaika.gr', trades: ['iliaka-fv']}, {id: 'eshops', base_url: 'https://www.eshops.gr', trades: ['iliaka-fv']},
];
