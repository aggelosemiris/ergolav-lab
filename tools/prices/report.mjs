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
    L.push(`| ${id} | ${s.status === 'available' ? '✅ διαθέσιμος' : '❌ μη διαθέσιμος'} | ${s.items} | ${s.verified} | ${s.promo} | ${s.matched} | ${s.reason || ''} |`);
  const p = stats.products, o = stats.offers;
  L.push('', '## Σύνολα', '',
    `- Προϊόντα στον έλεγχο: **${p.total}** (κατάλογος ${p.catalog}, από χρήστες ${p.user} με ${p.userRecords} εγγραφές χρηστών· νέες συνδέσεις ${p.linkedNow}).`,
    `- Προϊόντα λιανικής: ${p.eligible} · με επαληθευμένη τιμή προμηθευτή αυτή την εβδομάδα: **${p.matched}** · χωρίς: ${p.unmatched} · εκτός (υπηρεσία / ανά τ.μ. / πολύ γενικό): ${p.notApplicable}.`,
    `- Επαληθευμένη τιμή αναφοράς: **${p.verifiedReference}** · ανεπαρκή στοιχεία (κρατήθηκε η προηγούμενη, αν υπήρχε): ${p.insufficient}.`,
    `- Τιμές προμηθευτών: επαληθευμένες ${o.verified} (από αυτές σε προσφορά, με ρητή κανονική: ${o.promoRegular}) · μη επαληθευμένες ${o.unverified} · χωρίς συγκρίσιμη μονάδα ${o.unitMismatch} · διπλές που πετάχτηκαν πριν την αποθήκευση ${o.duplicatesDropped ?? 0}.`,
    `- Αλλαγές ιστορικού: τιμές προμηθευτών ${stats.historyRows}, τιμές αναφοράς ${p.referenceChanges}.`);
  L.push('', '## Είδη', '', '| Είδος | Μονάδα | Αναφορά | Κατάσταση | Προμηθευτές | Σημείωση |', '|---|---|---|---|---|---|');
  const unit = {piece: 'τεμ.', m: 'μ.', m2: 'τ.μ.', bag: 'σακί', other: '—'};
  for(const u of [...updates].sort((a, b) => (a.catalog_ref ? 0 : 1) - (b.catalog_ref ? 0 : 1) || a.name.localeCompare(b.name, 'el'))){
    const det = u.reference_detail ? Object.entries(u.reference_detail).map(([s, c]) => `${s} ${eur(c)}`).join(', ') : '';
    L.push(`| ${u.name.replace(/\|/g, '/')} | ${unit[u.unit] || u.unit} | ${eur(u.reference_cents)} | ${u.reference_status} | ${det} | ${(u.last_check_note || '').replace(/\|/g, '/')} |`);
  }
  return L.join('\n') + '\n';
}
