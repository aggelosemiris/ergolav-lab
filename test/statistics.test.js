import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteStatistics, statisticsMarkup } from '../src/statistics.js';

test('μόνο οι τρεις καταστάσεις, ανεξάρτητα από χρήματα και ημερομηνίες', () => {
  const result = quoteStatistics([{status:'sent'}, {status:'won'}, {status:'won', sum:{total:999999}}, {status:'lost'}, {status:'draft'}, {status:'unknown'}, null, {}]);
  const {winRate, ...counts} = result;
  assert.deepEqual(counts, {sent:1, won:2, lost:1, total:4, decided:3});
  assert.ok(Math.abs(winRate - 200/3) < 1e-10);
});
test('χωρίς αποτέλεσμα δεν υπάρχει ποσοστό· οι εκκρεμείς δεν αλλάζουν την επιτυχία', () => {
  assert.equal(quoteStatistics().winRate, null);
  assert.equal(quoteStatistics([{status:'sent'}]).winRate, null);
  assert.equal(quoteStatistics([{status:'lost'}]).winRate, 0);
  assert.equal(quoteStatistics([{status:'won'}, ...Array.from({length:100}, () => ({status:'sent'}))]).winRate, 100);
});
test('η αλλαγή κατάστασης και η διαγραφή υπολογίζονται από την αρχή, μία φορά ανά προσφορά', () => {
  const quotes = [{status:'sent'}, {status:'lost'}];
  quotes[0].status = 'won';
  assert.equal(quoteStatistics(quotes).winRate, 50);
  quotes.pop();
  assert.equal(quoteStatistics(quotes).winRate, 100);
  assert.equal(quoteStatistics([{status:'won', duration_days:30}]).total, 1);
});
test('κενή οθόνη και μόνο πρόχειρα: εξήγηση, χωρίς NaN ή ψευδές 0% επιτυχίας', () => {
  const html = statisticsMarkup([{status:'draft'}]);
  assert.match(html, /Δεν υπάρχουν ακόμα/);
  assert.match(html, /stats-rate num">—/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(statisticsMarkup([{status:'won'}, {status:'lost'}]), /50%/);
});
