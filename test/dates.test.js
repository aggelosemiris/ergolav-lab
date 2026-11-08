import { test } from 'node:test';
import assert from 'node:assert/strict';
import { athensDate, today, addDays, daysBetween, weekday, longDate, isDate, isTime, isDays, RELATIVE } from '../src/dates.js';

const at = iso => Date.parse(iso);
// «Σήμερα», «Αύριο», «Μεθαύριο» όπως τα βγάζει η φόρμα: σήμερα στην Ελλάδα + 0/1/2 μέρες.
const chips = iso => Object.values(RELATIVE).map(n => addDays(today(at(iso)), n));

test('σήμερα = η μέρα στην Ελλάδα, όχι σε UTC: γύρω από τα μεσάνυχτα (χειμερινή ώρα, UTC+2)', () => {
  assert.equal(athensDate(at('2026-11-09T21:59:59Z')), '2026-11-09');   // 23:59:59 Αθήνα
  assert.equal(athensDate(at('2026-11-09T22:00:00Z')), '2026-11-10');   // 00:00 Αθήνα, ενώ σε UTC είναι ακόμα 9/11
  assert.deepEqual(chips('2026-11-09T21:59:00Z'), ['2026-11-09', '2026-11-10', '2026-11-11']);
  assert.deepEqual(chips('2026-11-09T22:01:00Z'), ['2026-11-10', '2026-11-11', '2026-11-12']);
});

test('θερινή ώρα: τελευταία Κυριακή του Μαρτίου (29/3/2026, 03:00 → 04:00)', () => {
  assert.equal(athensDate(at('2026-03-28T21:59:00Z')), '2026-03-28');   // Σάββατο 23:59 (UTC+2)
  assert.equal(athensDate(at('2026-03-28T22:00:00Z')), '2026-03-29');   // Κυριακή 00:00
  assert.equal(athensDate(at('2026-03-29T00:59:00Z')), '2026-03-29');   // 02:59, λίγο πριν την αλλαγή
  assert.equal(athensDate(at('2026-03-29T01:00:00Z')), '2026-03-29');   // 04:00 (η 03:00 δεν υπάρχει)
  assert.equal(athensDate(at('2026-03-29T20:59:00Z')), '2026-03-29');   // Κυριακή 23:59, πλέον UTC+3
  assert.equal(athensDate(at('2026-03-29T21:00:00Z')), '2026-03-30');   // Δευτέρα 00:00
  assert.deepEqual(chips('2026-03-28T21:30:00Z'), ['2026-03-28', '2026-03-29', '2026-03-30'], 'Σάββατο 23:30');
  assert.deepEqual(chips('2026-03-28T22:30:00Z'), ['2026-03-29', '2026-03-30', '2026-03-31'], 'Κυριακή 00:30');
  assert.deepEqual(chips('2026-03-29T21:30:00Z'), ['2026-03-30', '2026-03-31', '2026-04-01'], 'Δευτέρα 00:30');
});

test('χειμερινή ώρα: τελευταία Κυριακή του Οκτωβρίου (25/10/2026, 04:00 → 03:00)', () => {
  assert.equal(athensDate(at('2026-10-24T20:59:00Z')), '2026-10-24');   // Σάββατο 23:59 (UTC+3)
  assert.equal(athensDate(at('2026-10-24T21:00:00Z')), '2026-10-25');   // Κυριακή 00:00
  assert.equal(athensDate(at('2026-10-25T00:30:00Z')), '2026-10-25');   // 03:30 (πρώτη φορά)
  assert.equal(athensDate(at('2026-10-25T01:30:00Z')), '2026-10-25');   // 03:30 (δεύτερη φορά)
  assert.equal(athensDate(at('2026-10-25T21:59:00Z')), '2026-10-25');   // Κυριακή 23:59, πλέον UTC+2
  assert.equal(athensDate(at('2026-10-25T22:00:00Z')), '2026-10-26');   // Δευτέρα 00:00
  assert.deepEqual(chips('2026-10-24T20:30:00Z'), ['2026-10-24', '2026-10-25', '2026-10-26'], 'Σάββατο 23:30');
  assert.deepEqual(chips('2026-10-24T21:30:00Z'), ['2026-10-25', '2026-10-26', '2026-10-27'], 'Κυριακή 00:30');
  assert.deepEqual(chips('2026-10-25T22:30:00Z'), ['2026-10-26', '2026-10-27', '2026-10-28'], 'Δευτέρα 00:30');
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2, 'η Κυριακή των 25 ωρών μετράει μία μέρα');
});

test('η ζώνη ώρας του κινητού δεν αλλάζει τίποτα (π.χ. κινητό ρυθμισμένο σε Λος Άντζελες ή Κιριμπάτι)', () => {
  const before = process.env.TZ;
  const run = () => [athensDate(at('2026-11-09T22:30:00Z')), addDays('2026-11-10', 1), weekday('2026-11-10'), longDate('2026-11-10', at('2026-11-08T10:00:00Z'))];
  const expected = ['2026-11-10', '2026-11-11', 1, 'Τρίτη 10 Νοεμβρίου'];
  try {
    for(const tz of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/Athens', 'UTC']){
      process.env.TZ = tz;
      assert.deepEqual(run(), expected, tz);
    }
  } finally { if(before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

test('πράξεις με μέρες: αλλαγή μήνα, έτους, δίσεκτο', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-11-30', 2), '2026-12-02');
  assert.equal(daysBetween('2026-11-08', '2026-11-10'), 2);
  assert.equal(daysBetween('2026-11-10', '2026-11-08'), -2);
  assert.equal(weekday('2026-11-09'), 0, 'Δευτέρα');
  assert.equal(weekday('2026-11-08'), 6, 'Κυριακή');
  assert.equal(weekday('2028-02-29'), 1, 'Τρίτη');
});

test('ολογράφως στα ελληνικά, με έτος μόνο όταν δεν είναι φετινή', () => {
  const now = at('2026-11-08T10:00:00Z');
  assert.equal(longDate('2026-11-10', now), 'Τρίτη 10 Νοεμβρίου');
  assert.equal(longDate('2026-11-08', now), 'Κυριακή 8 Νοεμβρίου');
  assert.equal(longDate('2026-03-01', now), 'Κυριακή 1 Μαρτίου');
  assert.equal(longDate('2027-01-05', now), 'Τρίτη 5 Ιανουαρίου 2027');
  assert.equal(longDate('2025-12-31', now), 'Τετάρτη 31 Δεκεμβρίου 2025');
});

test('έλεγχος τιμών: ημερομηνία, ώρα, διάρκεια', () => {
  for(const ok of ['2026-11-10', '2028-02-29', '1999-12-31', '2100-01-01']) assert.equal(isDate(ok), true, ok);
  for(const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '26-11-10', '2026-11-10T00:00', '', null, 20261110, '1800-01-01'])
    assert.equal(isDate(bad), false, String(bad));
  for(const ok of ['00:00', '09:30', '23:59']) assert.equal(isTime(ok), true, ok);
  for(const bad of ['24:00', '9:30', '09:60', '09:30:00', '', null]) assert.equal(isTime(bad), false, String(bad));
  for(const ok of [1, 2, 5, 60]) assert.equal(isDays(ok), true, String(ok));
  for(const bad of [0, -1, 1.5, 61, '2', NaN, null]) assert.equal(isDays(bad), false, String(bad));
});

test('η ημερομηνία ως κείμενο περνά από JSON (localStorage) χωρίς καμία μετατόπιση', () => {
  const saved = JSON.parse(JSON.stringify({scheduled_date: '2026-11-10', scheduled_time: '09:30'}));
  assert.equal(saved.scheduled_date, '2026-11-10');
  assert.equal(longDate(saved.scheduled_date, at('2026-11-08T10:00:00Z')), 'Τρίτη 10 Νοεμβρίου');
});
