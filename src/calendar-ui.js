// Ημερολόγιο προσφορών (πρώην «Οι προσφορές μου»): κάθε προσφορά στη μέρα που πάει ο τεχνίτης.
// Μήνας (προεπιλογή) ή Λίστα· λίστα ημέρας κάτω από το πλέγμα· «Χωρίς ημερομηνία»· αλλαγή ημερομηνίας και κατάστασης.
// Ό,τι γινόταν από το ιστορικό (το ίδιο PDF, «Στείλε ξανά», σβήσιμο) γίνεται κι από εδώ. Όλα τοπικά, και χωρίς σύνδεση.
import { listQuotes, updateQuote, deleteQuote } from './history.js';
import { today, addDays, longDate, daysBetween } from './dates.js';
import { monthGrid, shiftMonth, monthOf, byDay, pickDay, listOrder, undated, splitClient, endOf } from './calendar.js';
import { mountWhen, nativeDatePicker, dateChip } from './when-ui.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const eur = c => (c / 100).toLocaleString('el-GR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €';
export const STATUS = {draft: 'Πρόχειρη', sent: 'Στάλθηκε', won: 'Κλείστηκε', lost: 'Χάθηκε'};
const CHOICES = ['sent', 'won', 'lost'];        // «Άλλαξε κατάσταση»· η «Πρόχειρη» μπαίνει μόνο από την εφαρμογή
const monthFmt = new Intl.DateTimeFormat('el-GR', {timeZone: 'UTC', month: 'long', year: 'numeric'});
const wdFmt = new Intl.DateTimeFormat('el-GR', {timeZone: 'UTC', weekday: 'short'});
const WEEKDAYS = Array.from({length: 7}, (_, i) => wdFmt.format(Date.UTC(2026, 10, 9 + i)));   // 9/11/2026 = Δευτέρα
const VIEW = 'ergolav.calView';                 // Μήνας ή Λίστα: όπως το άφησε ο τεχνίτης σε αυτή τη συσκευή
const count = n => n === 1 ? '1 προσφορά' : `${n} προσφορές`;

/**
 * show/cta: της εφαρμογής. onOpen(no): άνοιγμα του PDF της προσφοράς (ίδιο με το ιστορικό). onNew(): νέα προσφορά.
 * onChange(): άλλαξε κάτι (σβήσιμο, ημερομηνία, κατάσταση). now(): η ώρα (για τα τεστ).
 */
export function mountCalendar({show, cta, onOpen, onNew, onChange = () => {}, now = Date.now}){
  const root = $('s-history');
  let view = (() => { try { return localStorage.getItem(VIEW) === 'list' ? 'list' : 'month'; } catch { return 'month'; } })();
  let y, m, sel, quotes = [], msgTimer = 0, swipedAt = 0, lastFocus = null;
  const find = no => quotes.find(q => q.no === no);
  const t = () => today(now());

  // ── Σχεδίαση
  function render(){
    quotes = listQuotes();
    const empty = !quotes.length;
    $('calEmpty').hidden = !empty;
    for(const id of ['calViews', 'calMonth', 'calList', 'calUndated', 'calNewWrap']) $(id).hidden = empty;
    if(empty) return;
    root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    $('calMonth').hidden = view !== 'month';
    $('calList').hidden = view !== 'list';
    if(view === 'month') renderMonth(); else renderList();
    renderUndated();
  }

  function renderMonth(){
    const weeks = monthGrid(y, m), from = weeks[0][0].date, to = weeks.at(-1)[6].date, td = t();
    const map = byDay(quotes, from, to);
    const title = monthFmt.format(Date.UTC(y, m - 1, 1));
    $('calTitle').textContent = title[0].toLocaleUpperCase('el-GR') + title.slice(1);
    $('calGrid').innerHTML = WEEKDAYS.map(w => `<span class="cal-wd" aria-hidden="true">${esc(w)}</span>`).join('') +
      weeks.flat().map(c => cell(c, map.get(c.date) || [], td)).join('');
    const day = sel >= from && sel <= to ? map.get(sel) || [] : byDay(quotes, sel, sel).get(sel) || [];
    $('calDay').innerHTML = `<h2 class="cal-dh"><span>${esc(longDate(sel, now()))}${sel === td ? ' · σήμερα' : ''}</span>${day.length ? `<small>${count(day.length)}</small>` : ''}</h2>` +
      (day.length ? `<div class="quotes">${day.map(q => item(q, {day: sel})).join('')}</div>`
        : `<p class="privacy">Καμία προσφορά αυτή τη μέρα.</p>`);
  }
  // Μέρα του πλέγματος: αριθμός, κουκκίδες με το χρώμα της κατάστασης (έως 3, μετά «+2»). Σήμερα τονισμένη.
  function cell(c, list, td){
    const cls = ['cal-d', !c.inMonth && 'out', c.date === td && 'today', c.date === sel && 'sel'].filter(Boolean).join(' ');
    const dots = list.slice(0, 3).map(q => `<i class="dot st-${q.status}${q.scheduled_from_created ? ' faint' : ''}"></i>`).join('') +
      (list.length > 3 ? `<small>+${list.length - 3}</small>` : '');
    const label = `${longDate(c.date, now())}${c.date === td ? ', σήμερα' : ''}${list.length ? `, ${count(list.length)}` : ''}`;
    return `<button type="button" class="${cls}" data-day="${c.date}" aria-label="${esc(label)}" aria-pressed="${c.date === sel}">` +
      `<span class="cal-n">${+c.date.slice(8)}</span><span class="cal-dots">${dots}</span></button>`;
  }

  // Λίστα: όπως το παλιό ιστορικό, αλλά κατά ημερομηνία — πρώτα οι επόμενες, μετά οι προηγούμενες, ανά μέρα.
  function renderList(){
    const td = t(), {upcoming, past} = listOrder(quotes, td);
    const days = list => {
      let html = '', cur = null;
      for(const q of list){
        if(q.scheduled_date !== cur){
          html += `${cur ? '</div>' : ''}<h3 class="cal-lh">${esc(longDate(q.scheduled_date, now()))}${q.scheduled_date === td ? ' · σήμερα' : ''}</h3><div class="quotes">`;
          cur = q.scheduled_date;
        }
        html += item(q, {list: true});
      }
      return html + (cur ? '</div>' : '');
    };
    const group = (title, list) => list.length ? `<h2 class="cal-gh">${title} <span>(${list.length})</span></h2>${days(list)}` : '';
    $('calList').innerHTML = group('Επόμενες', upcoming) + group('Προηγούμενες', past) ||
      '<p class="privacy" style="margin-top:18px">Καμία προσφορά με ημερομηνία.</p>';
  }

  function renderUndated(){
    const list = undated(quotes);
    $('calUndated').hidden = !list.length;
    $('calUndated').innerHTML = list.length ? `<h2 class="cal-gh">Χωρίς ημερομηνία <span>(${list.length})</span></h2>
      <p class="privacy">Πάτα μια μέρα και μπαίνει στο ημερολόγιο.</p>
      <div class="quotes">${list.map(q => item(q, {undated: true})).join('')}</div>` : '';
    // «Άλλη μέρα»: το πάτημα ανοίγει απευθείας τον επιλογέα ημερομηνίας του κινητού (βλ. when-ui.js).
    $('calUndated').querySelectorAll('[data-pick]').forEach(i => nativeDatePicker(i));
  }

  // Μία προσφορά: ώρα, πελάτης, περιοχή, σύνολο, κατάσταση. Πάτημα = το ίδιο PDF (όπως στο ιστορικό).
  // Από κάτω: «Άλλαξε ημερομηνία», «Άλλαξε κατάσταση», «Σβήσε» (ή, χωρίς ημερομηνία, οι μέρες με ένα πάτημα).
  // day: η μέρα της λίστας ημέρας (πολυήμερη: «μέρα 2 από 3», η ώρα μόνο την πρώτη)· list: στη Λίστα (με τον τίτλο).
  function item(q, {day = null, list = false, undated: none = false} = {}){
    const {name, area} = splitClient(q.client);
    const multi = q.duration_days > 1;
    const time = q.scheduled_time && (list || day === q.scheduled_date) ? q.scheduled_time : '';
    const span = !multi ? '' : day ? `μέρα ${daysBetween(q.scheduled_date, day) + 1} από ${q.duration_days}`
      : q.scheduled_date ? `${q.duration_days} μέρες, ως ${longDate(endOf(q), now())}` : `${q.duration_days} μέρες`;
    const acts = none ? `
      <div class="cal-quick" role="group" aria-label="Βάλε μέρα"><span>Βάλε μέρα:</span>
        <button type="button" class="wchip" data-quick="0" data-no="${q.no}">Σήμερα</button>
        <button type="button" class="wchip" data-quick="1" data-no="${q.no}">Αύριο</button>
        ${dateChip('Άλλη μέρα', `data-pick="${q.no}"`)}
      </div>` : '';
    return `<div class="q-item cal-q st-${q.status}${q.scheduled_from_created ? ' faint' : ''}">
      <button type="button" class="q-open" data-a="open" data-no="${q.no}">
        ${time ? `<span class="cal-time num">${time}</span>` : ''}
        <span class="cal-main"><b>${name ? esc(name) : 'Χωρίς όνομα πελάτη'}</b>
          <small>${[area && esc(area), `Αρ. ${q.no}`, list && q.title && esc(q.title)].filter(Boolean).join(' · ')}</small>
          <small class="cal-st"><i class="dot"></i>${STATUS[q.status]}${span ? ` · <span class="nw">${esc(span)}</span>` : ''}${q.scheduled_from_created ? ' · <em class="cal-created nw">ημ. δημιουργίας</em>' : ''}</small></span>
        <span class="num cal-sum">${eur(q.sum.total)}</span></button>${acts}
      <div class="cal-acts">
        ${none ? '' : `<button type="button" data-a="date" data-no="${q.no}" aria-label="Άλλαξε ημερομηνία">📅 Ημερομηνία</button>`}
        <button type="button" data-a="status" data-no="${q.no}" aria-label="Άλλαξε κατάσταση"><i class="dot"></i>Κατάσταση</button>
        <button type="button" class="q-del" data-a="del" data-no="${q.no}" aria-label="Σβήσε την προσφορά ${q.no}">Σβήσε</button>
      </div></div>`;
  }

  // ── Κινήσεις
  function message(text){
    const el = $('calMsg');
    el.textContent = text; el.hidden = !text;
    clearTimeout(msgTimer);
    if(text) msgTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }
  function goTo(date){ sel = date; [y, m] = monthOf(date); }
  function move(n){
    [y, m] = shiftMonth(y, m, n);
    sel = pickDay(y, m, t(), quotes);
    renderMonth();
    $('calGrid').classList.remove('anim'); void $('calGrid').offsetWidth; $('calGrid').classList.add('anim');
  }
  // Ημερομηνία/ώρα/διάρκεια μιας προσφοράς: αποθηκεύεται και το ημερολόγιο πάει στη νέα μέρα.
  function setSchedule(no, patch){
    if(!updateQuote(no, patch)) return message('Δεν αποθηκεύτηκε σε αυτή τη συσκευή.');
    if(patch.scheduled_date){ goTo(patch.scheduled_date); message(`Μπήκε ${longDate(patch.scheduled_date, now())}.`); }
    else message('Μπήκε στο «Χωρίς ημερομηνία».');
    render(); onChange();
  }
  function setStatus(no, status){
    if(!updateQuote(no, {status})) return message('Δεν αποθηκεύτηκε σε αυτή τη συσκευή.');
    message(`Κατάσταση: ${STATUS[status]}.`);
    render(); onChange();
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b || !root.contains(b)) return;
    const no = +b.dataset.no, a = b.dataset.a;
    if(b.dataset.day){
      if(Date.now() - swipedAt < 400) return;          // το δάχτυλο σηκώθηκε σε μέρα μετά από swipe: όχι πάτημα
      goTo(b.dataset.day); return renderMonth();
    }
    if(b.dataset.view){
      view = b.dataset.view;
      try { localStorage.setItem(VIEW, view); } catch {}
      return render();
    }
    if(b.dataset.quick) return setSchedule(no, {scheduled_date: addDays(t(), +b.dataset.quick)});
    if(a === 'prev' || a === 'next') return move(a === 'next' ? 1 : -1);
    if(a === 'today'){ goTo(t()); return renderMonth(); }
    if(a === 'open') return onOpen(no);
    if(a === 'new') return onNew();
    if(a === 'date') return openDate(no);
    if(a === 'status') return openStatus(no);
    if(a === 'del'){
      // Σβήσιμο σε δύο πατήματα (χωρίς παράθυρο): το πρώτο ρωτάει «Σίγουρα;».
      if(!b.classList.contains('sure')){ b.classList.add('sure'); b.textContent = 'Σίγουρα;'; return; }
      deleteQuote(no); message(`Η προσφορά ${no} σβήστηκε.`); render(); onChange();
    }
  });
  // «Άλλη μέρα» σε προσφορά χωρίς ημερομηνία: ό,τι διαλέξει στον επιλογέα του κινητού.
  root.addEventListener('change', e => {
    const no = +e.target.dataset?.pick;
    if(no && /^\d{4}-\d\d-\d\d$/.test(e.target.value)) setSchedule(no, {scheduled_date: e.target.value});
  });

  // Οριζόντιο swipe στο πλέγμα: προηγούμενος / επόμενος μήνας (το κάθετο κύλισμα μένει στη σελίδα: touch-action: pan-y).
  let sx = null, sy = 0;
  const grid = $('calGrid');
  grid.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
  grid.addEventListener('pointercancel', () => { sx = null; });
  grid.addEventListener('pointerup', e => {
    if(sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if(Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)){ swipedAt = Date.now(); move(dx < 0 ? 1 : -1); }
  });

  // ── Φύλλα: «Άλλαξε ημερομηνία» (ίδια φόρμα με τη νέα προσφορά) και «Άλλαξε κατάσταση»
  const sheetEl = $('calSheet');
  function sheet(title, q, html){
    lastFocus = document.activeElement;
    const {name} = splitClient(q.client);
    $('calSheetTitle').textContent = title;
    $('calSheetBody').innerHTML = `<p>${name ? esc(name) : 'Χωρίς όνομα πελάτη'} · Αρ. ${q.no}</p>${html}`;
    $('calSheetBody').querySelector('[data-a="close"]').onclick = closeSheet;
    $('veil').classList.add('on'); sheetEl.classList.add('on'); sheetEl.inert = false;
    setTimeout(() => ($('calSheetBody').querySelector('[aria-pressed="true"]') || $('calSheetBody').querySelector('button'))?.focus(), 60);
    return $('calSheetBody');
  }
  function closeSheet(){
    if(!sheetEl.classList.contains('on')) return;
    sheetEl.classList.remove('on'); sheetEl.inert = true;
    if(!document.querySelector('.sheet.on')) $('veil').classList.remove('on');
    if(lastFocus?.isConnected) lastFocus.focus();
  }
  sheetEl.inert = true;
  $('veil').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeSheet(); });

  function openDate(no){
    const q = find(no);
    if(!q) return;
    const body = sheet('Άλλαξε ημερομηνία', q, `<div class="when" data-when></div>
      <div class="sheet-btns"><button type="button" class="ghost" data-a="close">Άκυρο</button><button type="button" class="primary" data-a="save">Αποθήκευση</button></div>`);
    const when = mountWhen(body.querySelector('[data-when]'), {initial: q, id: 'whenEdit', now});
    body.querySelector('[data-a="save"]').onclick = () => { closeSheet(); setSchedule(no, when.value()); };
  }
  function openStatus(no){
    const q = find(no);
    if(!q) return;
    const body = sheet('Άλλαξε κατάσταση', q, `<div class="cal-sts">${CHOICES.map(s =>
      `<button type="button" class="cal-stb st-${s}" data-set="${s}" aria-pressed="${q.status === s}"><i class="dot"></i>${STATUS[s]}</button>`).join('')}</div>
      <div class="sheet-btns"><button type="button" class="ghost" data-a="close">Άκυρο</button></div>`);
    body.querySelectorAll('[data-set]').forEach(b => b.onclick = () => { closeSheet(); setStatus(no, b.dataset.set); });
  }

  return {
    /** Ανοίγει το ημερολόγιο· reset: στον τρέχοντα μήνα με επιλεγμένη τη σημερινή μέρα (αλλιώς εκεί που ήταν). */
    open({reset = true} = {}){
      if(reset || !sel) goTo(t());
      message('');
      render();
      show('s-history', 'Ημερολόγιο');
      cta(null);
    },
  };
}
