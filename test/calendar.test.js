import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, shiftMonth, daysInMonth, byDay, daysOf, endOf, pickDay, listOrder, undated, splitClient, monthOf } from '../src/calendar.js';
import { weekday } from '../src/dates.js';

const q = (no, scheduled_date, extra = {}) => ({no, scheduled_date, scheduled_time: null, duration_days: 1, status: 'sent', ...extra});
const inMonth = weeks => weeks.flat().filter(c => c.inMonth).map(c => c.date);

test('πλέγμα μήνα: ξεκινά Δευτέρα, τελειώνει Κυριακή, όλες οι μέρες του μήνα μία φορά', () => {
  const w = monthGrid(2026, 11);
  assert.equal(w[0][0].date, '2026-10-26', 'η 1/11/2026 είναι Κυριακή → η πρώτη γραμμή ξεκινά Δευτέρα 26/10');
  assert.equal(w[0][6].date, '2026-11-01');
  assert.equal(w.at(-1)[6].date, '2026-12-06');
  assert.equal(w.length, 6);
  assert.ok(w.every(week => week.length === 7 && weekday(week[0].date) === 0 && weekday(week[6].date) === 6));
  assert.deepEqual(inMonth(w), Array.from({length: 30}, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`));
});

test('Φεβρουάριος δίσεκτου έτους (2028): 29 μέρες, σωστές μέρες της εβδομάδας', () => {
  const w = monthGrid(2028, 2);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(inMonth(w).length, 29);
  assert.equal(inMonth(w).at(-1), '2028-02-29');
  assert.equal(w[0][0].date, '2028-01-31', 'η 1/2/2028 είναι Τρίτη');
  assert.equal(w[0][1].date, '2028-02-01');
  assert.equal(w.at(-1)[1].date, '2028-02-29', 'η 29/2/2028 είναι Τρίτη');
  assert.equal(w.length, 5);
  // Μη δίσεκτα για σύγκριση
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2100, 2), 28, 'το 2100 δεν είναι δίσεκτο');
  assert.equal(daysInMonth(2000, 2), 29, 'το 2000 είναι');
  const feb27 = monthGrid(2027, 2);
  assert.equal(feb27.length, 4, 'Φεβρουάριος 2027: ξεκινά Δευτέρα, τελειώνει Κυριακή → ακριβώς 4 εβδομάδες');
  assert.ok(feb27.flat().every(c => c.inMonth));
});

test('αλλαγή μήνα και έτους', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), [2027, 1]);
  assert.deepEqual(shiftMonth(2026, 1, -1), [2025, 12]);
  assert.deepEqual(shiftMonth(2026, 11, -13), [2025, 10]);
  assert.deepEqual(monthOf('2026-11-10'), [2026, 11]);
});

test('πολυήμερη δουλειά: σε όλες τις μέρες της, και όταν περνά στον επόμενο μήνα (και έτος)', () => {
  const job = q(1, '2026-11-29', {duration_days: 4});
  assert.deepEqual(daysOf(job), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.equal(endOf(job), '2026-12-02');
  const nov = monthGrid(2026, 11), dec = monthGrid(2026, 12);
  const inNov = byDay([job], nov[0][0].date, nov.at(-1)[6].date), inDec = byDay([job], dec[0][0].date, dec.at(-1)[6].date);
  assert.deepEqual([...inNov.keys()], ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'], 'το πλέγμα του Νοεμβρίου δείχνει και τις πρώτες μέρες του Δεκεμβρίου');
  assert.deepEqual([...inDec.keys()], ['2026-11-30', '2026-12-01', '2026-12-02'], 'ο Δεκέμβριος τη δείχνει από την πρώτη του γραμμή');
  const ny = q(2, '2026-12-30', {duration_days: 3});
  assert.deepEqual([...byDay([ny], '2027-01-01', '2027-01-31').keys()], ['2027-01-01']);
  assert.deepEqual(daysOf(q(3, null, {duration_days: 3})), [], 'χωρίς ημερομηνία: σε καμία μέρα');
});

test('ίδια μέρα, πολλές προσφορές: όλες, πρώτα με ώρα, μετά οι υπόλοιπες· η ώρα μετράει μόνο την πρώτη μέρα', () => {
  const list = [q(1, '2026-11-10'), q(2, '2026-11-10', {scheduled_time: '15:00'}), q(3, '2026-11-10', {scheduled_time: '08:30'}),
    q(4, '2026-11-09', {scheduled_time: '07:00', duration_days: 2}), q(5, '2026-11-11')];
  const map = byDay(list, '2026-11-01', '2026-11-30');
  assert.deepEqual(map.get('2026-11-10').map(x => x.no), [3, 2, 1, 4]);
  assert.deepEqual(map.get('2026-11-09').map(x => x.no), [4]);
  assert.equal(map.has('2026-11-12'), false);
});

test('500 προσφορές: ο μήνας βγαίνει χωρίς καθυστέρηση', () => {
  const many = Array.from({length: 500}, (_, i) => q(i + 1, `2026-${String(1 + i % 12).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}`, {duration_days: 1 + i % 5}));
  const t0 = performance.now();
  for(let k = 0; k < 20; k++){ const w = monthGrid(2026, 11); byDay(many, w[0][0].date, w.at(-1)[6].date); }
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 16, `${ms.toFixed(2)} ms ανά μήνα`);
});

test('μέρα που ανοίγει: σήμερα στον τρέχοντα μήνα, αλλιώς η πρώτη με προσφορές, αλλιώς η 1η', () => {
  const list = [q(1, '2026-12-15'), q(2, '2026-12-03'), q(3, '2026-11-28', {duration_days: 5})];
  assert.equal(pickDay(2026, 11, '2026-11-08', list), '2026-11-08');
  assert.equal(pickDay(2026, 12, '2026-11-08', list), '2026-12-01', 'η πολυήμερη από 28/11 φτάνει ως 2/12');
  assert.equal(pickDay(2027, 1, '2026-11-08', list), '2027-01-01');
});

test('Λίστα: πρώτα οι επόμενες (η πιο κοντινή πρώτη), μετά οι προηγούμενες (η πιο πρόσφατη πρώτη)', () => {
  const list = [q(1, '2026-10-01'), q(2, '2026-11-20'), q(3, '2026-11-08', {scheduled_time: '18:00'}), q(4, '2026-11-08', {scheduled_time: '09:00'}),
    q(5, '2026-11-05', {duration_days: 5}), q(6, '2026-11-07'), q(7, null), q(8, '2027-01-02')];
  const {upcoming, past} = listOrder(list, '2026-11-08');
  assert.deepEqual(upcoming.map(x => x.no), [5, 4, 3, 2, 8], 'η 5 (5–9/11) κρατάει ακόμα → στις επόμενες');
  assert.deepEqual(past.map(x => x.no), [6, 1]);
  assert.deepEqual(undated(list).map(x => x.no), [7]);
});

test('πελάτης «Όνομα, περιοχή»', () => {
  assert.deepEqual(splitClient('Γιώργος Αντωνίου, Χαλάνδρι'), {name: 'Γιώργος Αντωνίου', area: 'Χαλάνδρι'});
  assert.deepEqual(splitClient('Ελένη'), {name: 'Ελένη', area: ''});
  assert.deepEqual(splitClient('Κώστας, Νέα Σμύρνη, Αθήνα'), {name: 'Κώστας', area: 'Νέα Σμύρνη, Αθήνα'});
  assert.deepEqual(splitClient(''), {name: '', area: ''});
});
