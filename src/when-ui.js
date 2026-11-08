// «Πότε πας;»: η μέρα της δουλειάς, στην ίδια οθόνη με τον πελάτη. Καμία νέα οθόνη, κανένα popup που ανοίγει μόνο του.
// Προεπιλογή «Σήμερα», ήδη επιλεγμένο: όποιος δεν το αγγίξει δεν πατά τίποτα παραπάνω. «Άλλη μέρα» ανοίγει τον
// επιλογέα ημερομηνίας του κινητού (<input type="date">). Ώρα και διάρκεια είναι προαιρετικές και κρυμμένες.
// Η ίδια φόρμα μπαίνει και στο «Άλλαξε ημερομηνία» του ημερολογίου.
import { today, addDays, daysBetween, longDate, isDate, isTime, isDays, RELATIVE, MAX_DAYS } from './dates.js';

const CHIPS = [['today', 'Σήμερα'], ['tomorrow', 'Αύριο'], ['after', 'Μεθαύριο'], ['other', 'Άλλη μέρα'], ['none', 'Δεν ξέρω ακόμα']];
const DAYS = [1, 2, 3, 5];
const daysText = n => n === 1 ? '1 μέρα' : `${n} μέρες`;
// Ο επιλογέας του κινητού ανοίγει με showPicker() (Chrome 99+, Safari 16+). Όπου δεν υπάρχει, το πεδίο ημερομηνίας
// μπαίνει αόρατο πάνω στο «Άλλη μέρα», ώστε το πάτημα να το ανοίγει απευθείας.
const canPick = typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype;
function openPicker(input){
  try { input.showPicker(); return true; } catch { return false; }
}

/**
 * Στήνει το «Πότε πας;» στο root.
 * initial: {scheduled_date, scheduled_time, duration_days} μιας υπάρχουσας προσφοράς· χωρίς initial = «Σήμερα».
 * now(): η ώρα (για τα τεστ). onChange(value): σε κάθε αλλαγή. id: πρόθεμα για τα id (η φόρμα μπαίνει σε δύο σημεία).
 * Επιστρέφει {value(), refresh()}. value() = {scheduled_date: 'YYYY-MM-DD' | null, scheduled_time: 'HH:MM' | null, duration_days}.
 */
export function mountWhen(root, {initial = null, now = Date.now, onChange = () => {}, id = 'when'} = {}){
  let shown = today(now());        // το «σήμερα» που φαίνεται· ό,τι φαίνεται, αυτό αποθηκεύεται
  let choice = 'today', other = null, time = null, timeOpen = false, days = 1, daysOpen = false;
  if(initial){
    const d = initial.scheduled_date;
    if(d === null) choice = 'none';
    else if(isDate(d)){
      const off = daysBetween(shown, d);
      choice = Object.keys(RELATIVE).find(k => RELATIVE[k] === off) || 'other';
      if(choice === 'other') other = d;
    }
    if(isTime(initial.scheduled_time)){ time = initial.scheduled_time; timeOpen = true; }
    if(isDays(initial.duration_days) && initial.duration_days > 1){ days = initial.duration_days; daysOpen = true; }
  }

  root.innerHTML = `
    <span class="flabel" id="${id}-label">Πότε πας;</span>
    <div class="when-chips" role="group" aria-labelledby="${id}-label">${CHIPS.map(([k, t]) => k === 'other'
      ? `<span class="wchip-wrap"><button type="button" class="wchip" data-w="other" aria-pressed="false">${t}</button><input type="date" class="when-date${canPick ? '' : ' overlay'}" data-p="date" aria-label="Διάλεξε μέρα" tabindex="-1"></span>`
      : `<button type="button" class="wchip" data-w="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
    <div class="when-sel">
      <p aria-live="polite"><b data-o="date"></b><small class="when-old" data-o="old" hidden>Παλιά ημερομηνία</small><small class="when-sub" data-o="sub" hidden></small></p>
      <span class="when-more"><button type="button" class="linkbtn" data-a="time">+ ώρα</button><button type="button" class="linkbtn" data-a="days">+ διάρκεια</button></span>
    </div>
    <div class="when-row" data-box="time" hidden>
      <label class="when-rl" for="${id}-time">Ώρα</label><input type="time" id="${id}-time" data-p="time" step="300">
      <button type="button" class="linkbtn when-x" data-a="time-off" aria-label="Χωρίς ώρα">✕</button>
    </div>
    <div class="when-row" data-box="days" hidden>
      <span class="when-rl" id="${id}-days">Διάρκεια σε μέρες</span>
      <button type="button" class="linkbtn when-x" data-a="days-off" aria-label="Χωρίς διάρκεια (μία μέρα)">✕</button>
      <span class="when-chips" role="group" aria-labelledby="${id}-days">${DAYS.map(n => `<button type="button" class="wchip wnum" data-d="${n}" aria-pressed="false" aria-label="${daysText(n)}">${n}</button>`).join('')}<input type="number" inputmode="numeric" min="1" max="${MAX_DAYS}" step="1" data-p="days" placeholder="άλλο" aria-label="Άλλος αριθμός ημερών"></span>
    </div>`;
  const q = s => root.querySelector(s);
  const dateIn = q('[data-p="date"]'), timeIn = q('[data-p="time"]'), daysIn = q('[data-p="days"]');
  if(time) timeIn.value = time;
  if(daysOpen && !DAYS.includes(days)) daysIn.value = String(days);

  const date = () => choice === 'none' ? null : choice === 'other' ? other : addDays(shown, RELATIVE[choice]);
  const value = () => ({scheduled_date: date(), scheduled_time: choice === 'none' ? null : time, duration_days: days});

  function sync(){
    const d = date();
    root.querySelectorAll('[data-w]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.w === choice)));
    root.querySelectorAll('[data-d]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.d === days && !daysIn.value)));
    q('[data-o="date"]').textContent = d ? longDate(d, now()) + (time ? `, ${time}` : '') : 'Χωρίς ημερομηνία';
    q('[data-o="old"]').hidden = !(d && d < shown);
    const sub = q('[data-o="sub"]');
    const sub_ = d && days > 1 ? `${daysText(days)}, ως ${longDate(addDays(d, days - 1), now())}`
      : !d ? `Τη βάζεις αργότερα από το ημερολόγιο${days > 1 ? ` · ${daysText(days)}` : ''}.` : '';
    sub.textContent = sub_; sub.hidden = !sub_;
    // Ώρα χωρίς μέρα δεν έχει νόημα: κρύβεται (και κρατιέται, αν ξαναμπεί μέρα).
    q('[data-a="time"]').hidden = timeOpen || !d;
    q('[data-box="time"]').hidden = !timeOpen || !d;
    q('[data-a="days"]').hidden = daysOpen;
    q('[data-box="days"]').hidden = !daysOpen;
  }
  const changed = () => { sync(); onChange(value()); };

  root.querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
    if(b.dataset.w !== 'other'){ choice = b.dataset.w; return changed(); }
    // Άλλη μέρα: ο επιλογέας ανοίγει στη μέρα που ήδη έχει διαλέξει, αλλιώς άδειος (= σήμερα), ώστε κάθε επιλογή να μετρά.
    dateIn.value = choice === 'other' && other ? other : '';
    if(!openPicker(dateIn)){ dateIn.classList.add('overlay'); dateIn.tabIndex = 0; dateIn.focus(); }
  });
  // Αν κλείσει τον επιλογέα χωρίς να διαλέξει, μένει ό,τι ήταν.
  const pickDate = () => { if(!isDate(dateIn.value)) return; choice = 'other'; other = dateIn.value; changed(); };
  dateIn.addEventListener('change', pickDate);
  dateIn.addEventListener('input', pickDate);

  q('[data-a="time"]').onclick = () => { timeOpen = true; sync(); if(!openPicker(timeIn)) timeIn.focus(); };
  q('[data-a="time-off"]').onclick = () => { time = null; timeIn.value = ''; timeOpen = false; changed(); };
  const pickTime = () => { time = isTime(timeIn.value) ? timeIn.value : null; changed(); };
  timeIn.addEventListener('change', pickTime);
  timeIn.addEventListener('input', pickTime);

  q('[data-a="days"]').onclick = () => { daysOpen = true; sync(); };
  q('[data-a="days-off"]').onclick = () => { days = 1; daysIn.value = ''; daysOpen = false; changed(); };
  root.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { days = +b.dataset.d; daysIn.value = ''; changed(); });
  // Αριθμός με το χέρι: μόνο ακέραιος 1…60 μετράει· ό,τι άλλο δεν αλλάζει τη διάρκεια.
  daysIn.addEventListener('input', () => {
    const n = Number(daysIn.value);
    daysIn.setAttribute('aria-invalid', String(!!daysIn.value && !isDays(n)));
    if(isDays(n)){ days = n; changed(); } else if(!daysIn.value) sync();
  });
  daysIn.addEventListener('blur', () => { if(daysIn.value && !isDays(Number(daysIn.value))){ daysIn.value = ''; daysIn.removeAttribute('aria-invalid'); sync(); } });

  // Τα μεσάνυχτα (ή όταν ξανανοίξει το κινητό την άλλη μέρα) το «Σήμερα» προχωρά — μόνο όσο η φόρμα φαίνεται.
  // Μόλις φύγει από την οθόνη η μέρα «παγώνει»: αποθηκεύεται αυτή που είδε.
  function refresh(){
    if(!root.getClientRects().length) return;
    const t = today(now());
    if(t !== shown){ shown = t; changed(); }
  }
  sync();
  return {value, refresh};
}
