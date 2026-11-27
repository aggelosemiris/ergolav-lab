import {withoutUrlDetails} from './fetch.mjs';

// Τα adapters διαβάζουν μια σελίδα και αποδίδουν τις εγγραφές της πριν ζητήσουν την επόμενη.
// Κάθε ανάγνωση κρατά δική της κατάσταση, ακόμη κι όταν ο κοινός fetcher εξυπηρετεί άλλες πηγές.
export async function readSupplier({supplier, fetcher, items: read = supplier.items, at, log = () => {}}){
  const items = [], issues = new Set();
  let page = null, usedCache = false, fatal = false;
  const partial = reason => issues.add(withoutUrlDetails(reason).slice(0, 240));
  const supplierLog = message => log(withoutUrlDetails(message));
  const scoped = {
    ...fetcher,
    async get(url, options){
      try {
        page = await fetcher.get(url, options);
        usedCache ||= page.fromCache === true;
        if(page.status >= 400 && page.status !== 400) partial(`HTTP ${page.status}: ${url}`);
        return page;
      } catch(error){
        partial(error.name === 'Blocked' ? `μπλοκάρει το bot: ${error.message}` : error.message || error);
        throw error;
      }
    },
  };
  try {
    for await(const item of read({fetcher: scoped, supplier, log: supplierLog, partial})){
      items.push({...item, observedAt: page?.date ?? item.observedAt, fromCache: page?.fromCache ?? item.fromCache ?? false});
    }
  } catch(error){
    fatal = error.name === 'Blocked';
    partial(fatal ? `μπλοκάρει το bot: ${error.message}` : error.message || error);
    supplierLog(`${supplier.id}: ${error.message} (κρατήθηκαν ${items.length} εγγραφές)`);
  }
  // Σε αποτυχημένη ανάγνωση κρατάμε μόνο εγγραφές με γνωστή παρατήρηση πηγής.
  const usable = items.filter(item => Number.isFinite(Date.parse(item.observedAt)) || (!issues.size && !item.fromCache && item.observedAt == null))
    .map(item => ({...item, observedAt: item.observedAt ?? at}));
  if(usable.length !== items.length && !issues.size) partial('παρατήρηση χωρίς έγκυρη ημερομηνία');
  const status = usable.length ? (issues.size ? 'partial' : 'available') : 'unavailable';
  return {s: supplier, status, items: usable, usedCache, fatal,
    reason: [...issues].join(' · ').slice(0, 300) || (items.length ? null : 'καμία τιμή προϊόντος δεν διαβάστηκε')};
}
