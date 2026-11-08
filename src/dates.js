// Ημερομηνίες σε ώρα Ελλάδας. Μια ημερομηνία είναι πάντα κείμενο «YYYY-MM-DD» (ποτέ timestamp), ώστε μια δουλειά
// για Τρίτη να μένει Τρίτη, όποια ζώνη ώρας κι αν έχει το κινητό και όποια μέρα κι αν αλλάζει η ώρα (θερινή/χειμερινή).
// Η «σημερινή» μέρα βγαίνει από το Intl με timeZone Europe/Athens· οι πράξεις (± μέρες, μέρα της εβδομάδας) γίνονται
// σε UTC πάνω στο κείμενο, όπου κάθε μέρα έχει πάντα 24 ώρες.

export const TZ = 'Europe/Athens';
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_DAYS = 60;     // διάρκεια δουλειάς: όριο για ό,τι γράφεται με το χέρι

const ymdFmt = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'});
const longFmt = new Intl.DateTimeFormat('el-GR', {timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long'});
const longYearFmt = new Intl.DateTimeFormat('el-GR', {timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});

const utc = s => { const [, y, m, d] = YMD.exec(s); return Date.UTC(+y, +m - 1, +d); };
const fromUtc = ms => new Date(ms).toISOString().slice(0, 10);

/** Υπαρκτή ημερομηνία «YYYY-MM-DD» (όχι 2026-02-30), από το 1900 ως το 2199. */
export function isDate(s){
  if(typeof s !== 'string' || !YMD.test(s)) return false;
  const y = +s.slice(0, 4);
  return y >= 1900 && y <= 2199 && fromUtc(utc(s)) === s;
}
/** Ώρα «HH:MM» (00:00–23:59). */
export const isTime = s => typeof s === 'string' && HM.test(s);
/** Διάρκεια σε μέρες: ακέραιος 1…MAX_DAYS. */
export const isDays = n => Number.isInteger(n) && n >= 1 && n <= MAX_DAYS;

/** Η ημερομηνία στην Ελλάδα τη στιγμή ms (π.χ. 2026-10-24T21:30Z → «2026-10-25», γιατί εκεί είναι ήδη 00:30). */
export function athensDate(ms = Date.now()){
  const p = Object.fromEntries(ymdFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** Σήμερα στην Ελλάδα. */
export const today = (now = Date.now()) => athensDate(now);
/** ± μέρες πάνω σε ημερομηνία («2026-02-28» + 1 → «2026-03-01»). */
export const addDays = (s, n) => fromUtc(utc(s) + n * 86400000);
/** Πόσες μέρες από το a ως το b (b − a). */
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
/** Μέρα της εβδομάδας με Δευτέρα = 0 … Κυριακή = 6. */
export const weekday = s => (new Date(utc(s)).getUTCDay() + 6) % 7;

/** Ολογράφως: «Τρίτη 10 Νοεμβρίου» (με έτος, αν δεν είναι φετινή: «Τρίτη 10 Νοεμβρίου 2027»). */
export function longDate(s, now = Date.now()){
  const sameYear = s.slice(0, 4) === today(now).slice(0, 4);
  return (sameYear ? longFmt : longYearFmt).format(utc(s)).replace(',', '');
}

/** «Σήμερα», «Αύριο», «Μεθαύριο» → μέρες από σήμερα. */
export const RELATIVE = {today: 0, tomorrow: 1, after: 2};
