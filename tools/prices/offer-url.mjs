// Ίδιο όριο με supplier_offers.url. Δεν κόβουμε URL: μπορεί να αλλάξει ο προορισμός.
export const OFFER_URL_MAX = 600;
const length = s => [...s].length;  // char_length της PostgreSQL: χαρακτήρες, όχι UTF-16 μονάδες

/** Πλήρες HTTPS URL, που χωρά στη βάση. Τα σύντομα URL μένουν αυτούσια.
 * Ελληνικά URL μπορεί να είναι >600 με %CE… αλλά να χωρούν ως Unicode. Δεκτή μετατροπή ΜΟΝΟ αν το URL API
 * επαναφέρει ακριβώς την ίδια διεύθυνση. Προστατεύει και από διπλή αποκωδικοποίηση (%252F → %2F).
 */
export function offerUrl(value){
  let original;
  try { original = new URL(value); } catch { throw new Error('supplier_offers.url: μη έγκυρο HTTPS URL'); }
  if(typeof value !== 'string' || !value.startsWith('https://') || original.protocol !== 'https:')
    throw new Error('supplier_offers.url: απαιτείται HTTPS URL');
  if(length(value) <= OFFER_URL_MAX) return value;
  let readable;
  try { readable = decodeURI(value); } catch {}
  if(readable && length(readable) <= OFFER_URL_MAX && new URL(readable).href === original.href) return readable;
  throw new Error(`supplier_offers.url: ${length(value)} χαρακτήρες (όριο ${OFFER_URL_MAX}), χωρίς ασφαλή ισοδύναμη μορφή`);
}
