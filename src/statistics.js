// Μόνο η τρέχουσα κατάσταση κάθε προσφοράς. Τα πρόχειρα δεν είναι στατιστικά πωλήσεων.
export function quoteStatistics(quotes = []){
  const counts = {sent: 0, won: 0, lost: 0};
  for(const q of quotes){
    if(q && Object.hasOwn(counts, q.status)) counts[q.status]++;
  }
  const total = counts.sent + counts.won + counts.lost;
  const decided = counts.won + counts.lost;
  return {...counts, total, decided, winRate: decided ? counts.won / decided * 100 : null};
}

const number = n => n.toLocaleString('el-GR');
const percent = n => n.toLocaleString('el-GR', {maximumFractionDigits: 1}) + '%';

export function statisticsMarkup(quotes){
  const s = quoteStatistics(quotes);
  return `<p class="privacy">Η εικόνα από τις αποθηκευμένες προσφορές αυτής της συσκευής, για όλο το διάστημα. Τα πρόχειρα δεν μετράνε.</p>
    <div class="stats-total"><span>Προσφορές με κατάσταση</span><strong class="num">${number(s.total)}</strong></div>
    <div class="stats-cards">${[['sent', 'Στάλθηκε', 'Περιμένουν απάντηση'], ['won', 'Κλείστηκε', 'Επιτυχημένες προσφορές'], ['lost', 'Χάθηκε', 'Δεν προχώρησαν']].map(([key, label, hint]) =>
      `<div class="stats-card st-${key}"><span><i class="dot"></i>${label}</span><strong class="num">${number(s[key])}</strong><small>${hint}</small></div>`).join('')}</div>
    <section class="stats-result" aria-labelledby="statsRateTitle">
      <h2 id="statsRateTitle">Ποσοστό επιτυχίας</h2>
      <strong class="stats-rate num">${s.winRate === null ? '—' : percent(s.winRate)}</strong>
      <p>${s.decided ? `${number(s.won)} κλείστηκαν από ${number(s.decided)} που έχουν αποτέλεσμα.` : 'Θα εμφανιστεί όταν μια προσφορά κλείσει ή χαθεί.'}</p>
      <p class="privacy">Κλείστηκε ÷ (Κλείστηκε + Χάθηκε). Όσες γράφουν «Στάλθηκε» δεν έχουν ακόμα αποτέλεσμα και δεν επηρεάζουν το ποσοστό.</p>
    </section>
    ${s.total ? `<section class="stats-distribution" aria-labelledby="statsDistTitle"><h2 id="statsDistTitle">Κατανομή προσφορών</h2>${[['sent', 'Στάλθηκε'], ['won', 'Κλείστηκε'], ['lost', 'Χάθηκε']].map(([key, label]) => {
      const share = s[key] / s.total * 100;
      return `<div class="stats-row st-${key}"><div><span>${label}</span><b class="num">${percent(share)}</b></div><div class="stats-track" aria-hidden="true"><span style="width:${share}%"></span></div></div>`;
    }).join('')}</section>` : '<p class="stats-empty">Δεν υπάρχουν ακόμα προσφορές με αυτές τις καταστάσεις. Άνοιξε μια προσφορά και επίλεξε «Στάλθηκε», «Κλείστηκε» ή «Χάθηκε».</p>'}
    <p class="privacy stats-note">Κάθε προσφορά μετράει μία φορά, με την τελευταία κατάστασή της. Αλλαγές και διαγραφές ενημερώνουν τα στατιστικά. Το «Κλείστηκε» δεν σημαίνει ότι η δουλειά πληρώθηκε.</p>`;
}
