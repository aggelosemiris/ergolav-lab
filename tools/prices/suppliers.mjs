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
