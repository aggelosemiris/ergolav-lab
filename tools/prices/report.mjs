// Αναφορά μιας εκτέλεσης σε Markdown: προμηθευτές (διαθέσιμοι ή όχι και γιατί), κάλυψη, τιμή αναφοράς ανά είδος.
// Μόνο ό,τι επαληθεύτηκε μετρά ως κάλυψη· τα υπόλοιπα γράφονται με τον λόγο τους.
const eur = c => c == null ? '—' : (c / 100).toLocaleString('el-GR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €';

export function report({stats, updates, fetcherStats}){
  const L = [];
  L.push(`# Εβδομαδιαία ενημέρωση τιμών — εκτέλεση ${stats.run}`, '');
  L.push(`Έναρξη ${stats.started} · τέλος ${stats.finished} · αιτήματα ${fetcherStats.requests} (από cache ${fetcherStats.cached}, επαναλήψεις ${fetcherStats.retries}, robots.txt απαγόρευσε ${fetcherStats.disallowed}).`, '');
  L.push('Τιμές αναφοράς: διάμεσος των **επαληθευμένων κανονικών** τιμών (όχι προσφορές), ανά μονάδα, **χωρίς ΦΠΑ**.', '');
  L.push('## Προμηθευτές', '', '| Προμηθευτής | Κατάσταση | Προϊόντα που διαβάστηκαν | Με επαληθευμένη κανονική τιμή | Σε προσφορά | Αντιστοιχίσεις | Λόγος |', '|---|---|---|---|---|---|---|');
  for(const [id, s] of Object.entries(stats.suppliers))
    L.push(`| ${id} | ${s.status === 'available' ? '✅ διαθέσιμος' : s.status === 'partial' ? '⚠️ μερική συλλογή' : '❌ μη διαθέσιμος'} | ${s.items} | ${s.verified} | ${s.promo} | ${s.matched} | ${s.reason || ''} |`);
  const p = stats.products, o = stats.offers;
  L.push('', '## Σύνολα', '',
    `- Προϊόντα στον έλεγχο: **${p.total}** (κατάλογος ${p.catalog}, από χρήστες ${p.user} με ${p.userRecords} εγγραφές χρηστών· νέες συνδέσεις ${p.linkedNow}).`,
    `- Προϊόντα λιανικής: ${p.eligible} · με επαληθευμένη τιμή προμηθευτή αυτή την εβδομάδα: **${p.matched}** · χωρίς: ${p.unmatched} · εκτός (υπηρεσία / ανά τ.μ. / πολύ γενικό): ${p.notApplicable}.`,
    `- Επαληθευμένη τιμή αναφοράς: **${p.verifiedReference}** · ανεπαρκή στοιχεία (κρατήθηκε η προηγούμενη, αν υπήρχε): ${p.insufficient}.`,
    `- Τιμές προμηθευτών: επαληθευμένες ${o.verified} (από αυτές σε προσφορά, με ρητή κανονική: ${o.promoRegular}) · μη επαληθευμένες ${o.unverified} · χωρίς συγκρίσιμη μονάδα ${o.unitMismatch} · διπλές που πετάχτηκαν πριν την αποθήκευση ${o.duplicatesDropped ?? 0}.`,
    `- Αλλαγές ιστορικού: τιμές προμηθευτών ${stats.historyRows}, τιμές αναφοράς ${p.referenceChanges}.`);
  if(stats.productCatalog){
    const c = stats.productCatalog;
    L.push('', '## Ενιαίος κατάλογος αναζήτησης', '',
      `- Μοναδικά προϊόντα: **${c.total}** · εξετάστηκαν: **${c.checked}** · βρέθηκαν σε ροή προμηθευτή: **${c.seen}**.`,
      `- Με νέα επαληθευμένη τιμή λιανικής σε αυτή την εκτέλεση: **${c.verified}** · χωρίς νέα επαλήθευση: **${c.withoutVerified}**.`,
      `- Μόνο επαληθευμένη παρατήρηση από cache: **${c.verifiedFromCache ?? 0}** · απορρίφθηκαν: **${c.rejected ?? 0}** · δεν εντοπίστηκαν: **${c.notFound ?? 0}**.`,
      `- Μόνο προηγούμενη τιμή της βάσης: **${c.previousOnly ?? 'μη διαθέσιμη μέτρηση'}**. Η μέτρηση αυτή περιλαμβάνεται στις απορρίψεις ή στις εγγραφές που δεν εντοπίστηκαν.`,
      `- Με τιμή από εναλλακτικό προμηθευτή: **${c.fromAlternateSource ?? 0}** · με τιμή από ταυτοποιημένη καταχώριση: **${c.fromConfirmedListing ?? 0}**.`,
      `- Προϊόντα με αλλαγή σε υφιστάμενη τιμή: **${c.changed}** · επιμέρους αλλαγές τιμής προμηθευτή: ${c.offersChanged} · πρώτες επαληθεύσεις προμηθευτή: ${c.newOffers}.`,
      '', '| Προμηθευτής | Καταχωρίσεις | Βρέθηκαν | Νέες επαληθεύσεις | Επαληθεύσεις από cache | Κατάσταση | Λόγος |', '|---|---:|---:|---:|---:|---|---|');
    for(const [site, s] of Object.entries(c.suppliers).sort())
      L.push(`| ${site} | ${s.listings} | ${s.seen} | ${s.verified} | ${s.verifiedFromCache ?? 0} | ${s.status ?? "—"} | ${(s.reason || '').replace(/[|\r\n]/g, ' ')} |`);
    if(c.origins){
      L.push('', '### Κάλυψη ανά κύριο αρχικό προμηθευτή', '',
        '| Αρχικός προμηθευτής | Σύνολο | Νέα | Μόνο cache | Απορρίψεις | Δεν βρέθηκαν | Μόνο προηγούμενη τιμή βάσης | Αρχική τιμή | Χωρίς αρχική τιμή | Παρατηρημένος SKU/MPN/EAN | Μάρκα | Προδιαγραφές | Κοινός τίτλος |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
      for(const [site, s] of Object.entries(c.origins).sort())
        L.push(`| ${site} | ${s.total} | ${s.fresh} | ${s.cached} | ${s.rejected} | ${s.notFound} | ${s.previousOnly ?? '—'} | ${s.archived} | ${s.noArchived} | ${s.observedIdentifiers} | ${s.brand} | ${s.specs} | ${s.repeatedTitle} |`);
      L.push('', 'Η αρχική τιμή είναι ξεχωριστό χαρακτηριστικό και μπορεί να συνυπάρχει με οποιαδήποτε κατάσταση κάλυψης.');
    }
  }
  L.push('', '## Είδη', '', '| Είδος | Μονάδα | Αναφορά | Κατάσταση | Προμηθευτές | Σημείωση |', '|---|---|---|---|---|---|');
  const unit = {piece: 'τεμ.', m: 'μ.', m2: 'τ.μ.', bag: 'σακί', other: '—'};
  for(const u of [...updates].sort((a, b) => (a.catalog_ref ? 0 : 1) - (b.catalog_ref ? 0 : 1) || a.name.localeCompare(b.name, 'el'))){
    const det = u.reference_detail ? Object.entries(u.reference_detail).map(([s, c]) => `${s} ${eur(c)}`).join(', ') : '';
    L.push(`| ${u.name.replace(/\|/g, '/')} | ${unit[u.unit] || u.unit} | ${eur(u.reference_cents)} | ${u.reference_status} | ${det} | ${(u.last_check_note || '').replace(/\|/g, '/')} |`);
  }
  return L.join('\n') + '\n';
}
