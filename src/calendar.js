// Ημερολόγιο: καθαρές συναρτήσεις (χωρίς DOM) για το πλέγμα του μήνα, τις μέρες κάθε δουλειάς και τη σειρά της λίστας.
// Όλες οι ημερομηνίες είναι κείμενο «YYYY-MM-DD» (βλ. dates.js): καμία ζώνη ώρας, καμία μετατόπιση ημέρας.
import { addDays, weekday } from './dates.js';

const pad = n => String(n).padStart(2, '0');
/** «2026-11-10» → «2026-11». */
export const ym = date => date.slice(0, 7);
/** [έτος, μήνας 1–12] μιας ημερομηνίας. */
export const monthOf = date => [+date.slice(0, 4), +date.slice(5, 7)];
/** Μήνας ± n: shiftMonth(2026, 12, 1) → [2027, 1]. */
export function shiftMonth(y, m, n){ const i = y * 12 + (m - 1) + n; return [Math.floor(i / 12), i % 12 + 1]; }
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Οι εβδομάδες του μήνα, Δευτέρα πρώτη: [[{date, inMonth} ×7], …] — 4 έως 6 εβδομάδες, με τις μέρες των διπλανών μηνών. */
export function monthGrid(y, m){
  const first = `${y}-${pad(m)}-01`, last = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
  const weeks = [];
  for(let d = addDays(first, -weekday(first)), end = addDays(last, 6 - weekday(last)); d <= end; d = addDays(d, 1)){
    if(weekday(d) === 0) weeks.push([]);
    weeks.at(-1).push({date: d, inMonth: ym(d) === ym(first)});
  }
  return weeks;
}

/** Η τελευταία μέρα μιας δουλειάς (πολυήμερη: scheduled_date + duration_days − 1). */
export const endOf = q => addDays(q.scheduled_date, Math.max(1, q.duration_days || 1) - 1);
/** Όλες οι μέρες μιας δουλειάς ([] χωρίς ημερομηνία). */
export function daysOf(q){
  if(!q.scheduled_date) return [];
  return Array.from({length: Math.max(1, q.duration_days || 1)}, (_, i) => addDays(q.scheduled_date, i));
}
// Σειρά μέσα στη μέρα: πρώτα όσες έχουν ώρα (η ώρα ισχύει μόνο την πρώτη μέρα), μετά οι υπόλοιπες, κατά αριθμό.
const timeOn = (q, day) => day === q.scheduled_date && q.scheduled_time || '99:99';

/** Map ημερομηνία → προσφορές της μέρας, για τις μέρες from…to. Οι πολυήμερες μπαίνουν σε κάθε μέρα τους. */
export function byDay(quotes, from, to){
  const map = new Map();
  for(const q of quotes){
    if(!q.scheduled_date) continue;
    const end = endOf(q);
    if(end < from || q.scheduled_date > to) continue;
    for(let d = q.scheduled_date > from ? q.scheduled_date : from; d <= end && d <= to; d = addDays(d, 1)){
      if(!map.has(d)) map.set(d, []);
      map.get(d).push(q);
    }
  }
  for(const [d, list] of map) list.sort((a, b) => timeOn(a, d).localeCompare(timeOn(b, d)) || a.no - b.no);
  return map;
}

/** Η μέρα που ανοίγει σε έναν μήνα: σήμερα αν είναι αυτός ο μήνας, αλλιώς η πρώτη με προσφορές, αλλιώς η 1η. */
export function pickDay(y, m, today, quotes){
  const first = `${y}-${pad(m)}-01`;
  if(ym(today) === ym(first)) return today;
  const days = [...byDay(quotes, first, `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`).keys()].sort();
  return days[0] || first;
}

/** Λίστα: πρώτα οι επόμενες (και όσες κρατάνε ακόμα), από την πιο κοντινή· μετά οι προηγούμενες, από την πιο πρόσφατη. */
export function listOrder(quotes, today){
  const dated = quotes.filter(q => q.scheduled_date);
  const key = q => `${q.scheduled_date} ${q.scheduled_time || '99:99'}`;
  return {
    upcoming: dated.filter(q => endOf(q) >= today).sort((a, b) => key(a).localeCompare(key(b)) || a.no - b.no),
    past: dated.filter(q => endOf(q) < today).sort((a, b) => key(b).localeCompare(key(a)) || b.no - a.no),
  };
}
/** «Δεν ξέρω ακόμα»: χωρίς ημερομηνία, η νεότερη πρώτη. */
export const undated = quotes => quotes.filter(q => !q.scheduled_date).sort((a, b) => b.no - a.no);

/** «Όνομα πελάτη, περιοχή» → {name, area} (το πεδίο είναι ελεύθερο κείμενο· χωρίς κόμμα = μόνο όνομα). */
export function splitClient(s = ''){
  const i = s.indexOf(',');
  return i < 0 ? {name: s.trim(), area: ''} : {name: s.slice(0, i).trim(), area: s.slice(i + 1).trim()};
}
