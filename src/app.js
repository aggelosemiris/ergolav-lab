// Να μην τρέχει μέσα σε ξένο iframe (clickjacking — η CSP μέσω <meta> δεν υποστηρίζει frame-ancestors).
if(window.top !== window.self){
  document.body.innerHTML = '<p style="padding:24px;font:17px system-ui">Η εφαρμογή ανοίγει μόνο απευθείας, όχι μέσα σε άλλη σελίδα.</p>';
  throw new Error('framed');
}
import { parse, calcParts, lineFor } from './parse.js';
import { createMic, micSupported } from './mic.js';
import { readNotes, shrink, getKey, setKey, forgetKey, canRememberKey, isKeyRemembered, keyProvider } from './photo.js';
import { makePdf, shareFile, download } from './share.js';
import { parseAmount, toCents, formatEur, formatQty } from './number.js';
import { tiers, priceKey, history, remember, ageLabel, isStale } from './prices.js';
import { loadProfile, saveProfile, initials, takeQuoteNo } from './profile.js';

// Πιλοτικό: δεν στέλνουμε φωτογραφίες σε τρίτους. Με true ξανανοίγει η ροή φωτογραφίας (κουμπί, κάλυψη, key).
const PHOTO_ENABLED = false;

const SAMPLE = 'Ανακαίνιση μπάνιου. Δώδεκα μέτρα σωλήνα πολυστρωματικό, μια μπαταρία νιπτήρα, λεκάνη κρεμαστή με καζανάκι εντοιχισμού, και δώδεκα τετραγωνικά πλακάκι τοίχου.';
const BARS = 18;

let LINES = [], TITLE = 'εργασίες';
// Εργασία: ΜΙΑ τιμή για όλη τη δουλειά (λεπτά). null = αυτόματη πρόταση από τον κατάλογο· αριθμός = ό,τι έγραψε ο τεχνίτης.
let LABOR = null, laborBad = false;
// Εργασία από τη φωνή («εργασία 1.200 ευρώ»): voice = το ποσό που ακούστηκε (λεπτά) για την ένδειξη «από τη φωνή — έλεγξε»·
// ask = ακούστηκε ποσό αλλά είναι ασαφές («1.5 ευρώ») — δεν μπαίνει, το κουμπί κλειδώνει μέχρι να γραφτεί.
let laborVoice = null, laborAsk = null;
const eur = c => (c/100).toLocaleString('el-GR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtQty = formatQty;   // ίδια ακρίβεια (3 δεκαδικά) με την είσοδο της ποσότητας
const $ = id => document.getElementById(id);
let started = 0, checkedCount = 0, lastText = '';

function show(id, step){
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('on', s.id===id));
  // Η «Αναίρεση» αφορά μόνο την οθόνη ελέγχου: σε άλλη οθόνη (π.χ. PDF που ήδη φτιάχτηκε) δεν μένει.
  if(id !== 's-lines') $('toast').hidden = true;
  $('step').textContent = step;
  window.scrollTo({top:0});
}
function cta(label, fn, disabled, note){
  $('cta').hidden = !label;
  if(!label) return;
  const b = $('ctaBtn'); b.textContent = label; b.disabled = !!disabled; b.onclick = fn;
  const n = $('ctaNote'); n.hidden = !note; n.textContent = note||'';
}
function notice(msg){ $('notice').hidden = !msg; $('notice').textContent = msg || ''; }

// ─── 0 : στοιχεία επιχείρησης — μία φορά, μετά από την κεφαλίδα ─────
// Αριθμός προσφοράς: δίνεται στο πρώτο PDF αυτής της προσφοράς (νέο PDF της ίδιας προσφοράς κρατά τον ίδιο).
let PROFILE = loadProfile(), quoteNo = null, profileBack = null;
function renderBrand(){
  $('brandLogo').textContent = PROFILE ? initials(PROFILE.name) : '';
  $('brandLogo').hidden = !PROFILE;
  $('brandName').textContent = PROFILE?.name || 'ergolav';
  $('brandTrade').textContent = PROFILE?.trade || '';
}
// back: τι γίνεται μετά την αποθήκευση (null = αρχική οθόνη).
function openProfile(back){
  profileBack = back;
  const p = PROFILE || {};
  $('pfName').value = p.name || ''; $('pfTrade').value = p.trade || ''; $('pfPhone').value = p.phone || '';
  $('pfError').hidden = true;
  show('s-profile', 'Τα στοιχεία σου');
  cta(null);
}
$('pfSave').onclick = () => {
  const r = saveProfile({name: $('pfName').value, trade: $('pfTrade').value, phone: $('pfPhone').value});
  if(r.error){
    $('pfError').hidden = false; $('pfError').textContent = r.error;
    $({name: 'pfName', phone: 'pfPhone'}[r.field]).focus();
    return;
  }
  PROFILE = r.profile; renderBrand();
  const back = profileBack; profileBack = null;
  if(back) back();
  else { show('s-start', 'Νέα προσφορά'); cta(null); }
  // Η συσκευή δεν τα κράτησε (π.χ. ιδιωτική περιήγηση): ισχύουν τώρα, θα ζητηθούν ξανά — το λέμε, δεν το κρύβουμε.
  if(!r.saved) $('micNote').textContent = 'Τα στοιχεία σου δεν αποθηκεύτηκαν σε αυτή τη συσκευή — ισχύουν μόνο μέχρι να κλείσει η σελίδα.';
};
// Πάτημα στην κεφαλίδα → ίδια φόρμα· μετά επιστροφή εκεί που ήταν (το PDF ξαναφτιάχνεται με τα νέα στοιχεία).
$('brand').onclick = () => {
  const cur = document.querySelector('.screen.on')?.id;
  if(cur === 's-profile' || mic.listening) return;
  const step = $('step').textContent, c = {hidden: $('cta').hidden, label: $('ctaBtn').textContent, fn: $('ctaBtn').onclick,
    disabled: $('ctaBtn').disabled, note: $('ctaNote').hidden ? '' : $('ctaNote').textContent};
  openProfile(() => {
    if(cur === 's-pdf') return buildPdf();
    show(cur, step);
    if(c.hidden) cta(null); else cta(c.label, c.fn, c.disabled, c.note);
  });
};

// ─── 2 : ακρόαση σε πραγματικό χρόνο ────────────────────────
const wave = $('wave'), transcript = $('transcript');
for(let i=0;i<BARS;i++){ const b=document.createElement('i'); b.style.animationDelay=(i*0.06)+'s'; wave.appendChild(b); }

const mic = createMic({
  bars: BARS,
  onText(fin, interim){
    if(!mic.listening && !interim) return;
    transcript.innerHTML = esc(fin) + (interim ? ` <span class="interim">${esc(interim)}</span>` : '') + '<span class="caret"></span>';
    renderChips(fin + ' ' + interim);
  },
  onLevels(levels){
    const bars = wave.children;
    for(let i=0;i<bars.length;i++) bars[i].style.height = (8 + levels[i]*52) + 'px';
  },
  onError(msg){ review(transcript.textContent, msg); },
});

function renderChips(text){
  const box = $('chips');
  // Κρατάμε τα τσιπάκια που υπάρχουν ήδη, ώστε να «σκάνε» μόνο τα καινούρια.
  const old = new Map([...box.children].map(c => [c.textContent, c]));
  // Ό,τι δεν είναι στον κατάλογο φαίνεται κι αυτό, ως «θέλει έλεγχο» (θα χρειαστεί τιμή) — ποτέ σιωπηλά χαμένο.
  let parsed;
  try { parsed = parse(text); } catch { return; }          // τα τσιπάκια είναι βοήθεια· το σφάλμα φαίνεται στο «Βγάλε τιμές»
  const next = parsed.lines.filter(l => (!l.unknown || l.keep) && !l.suggest).map(l => {
    const q = l.flag || l.sizeCheck || l.unknown;
    const label = `${fmtQty(l.qty)} ${l.unit} ${l.name}${q ? ' ?' : ''}`;
    let c = old.get(label);
    if(!c){ c = document.createElement('span'); c.className = 'chip' + (q ? ' q' : ''); c.textContent = label; }
    return c;
  });
  box.replaceChildren(...next);
}

async function startListening(initial = ''){
  if(!started) started = Date.now();
  if(!micSupported){
    review(initial, 'Αυτός ο browser δεν έχει αναγνώριση φωνής. Γράψε τι χρειάζεται — ή άνοιξέ το σε Chrome ή Safari.');
    return;
  }
  show('s-listen','Ακούω');
  notice('');
  $('shot').hidden = true;
  wave.hidden = false; wave.classList.remove('live');
  [...wave.children].forEach(b => b.style.height = '');
  $('listenAlt').hidden = true;
  $('listenLabel').textContent = 'Ακούω… μίλα φυσικά, πάτα «Τέλος» όταν τελειώσεις — ή άγγιξε το κείμενο για να γράψεις';
  transcript.contentEditable = 'false';
  transcript.innerHTML = esc(initial) + '<span class="caret"></span>';
  renderChips(initial);
  cta('Τέλος', finishListening);
  try {
    const live = await mic.start(initial);
    if(mic.listening) wave.classList.toggle('live', live);
  } catch {
    review(initial, 'Δεν μπόρεσα να ξεκινήσω το μικρόφωνο.');
  }
}

// Άγγιγμα στο κείμενο όσο ακούει = θέλει να γράψει ή να διορθώσει: σταματά το μικρόφωνο και δίνει το πληκτρολόγιο.
// (Το κείμενο ξαναγράφεται σε κάθε αποτέλεσμα φωνής, γι' αυτό δεν γίνεται να γράφεις την ώρα που ακούει.)
function focusEnd(el){
  el.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
transcript.addEventListener('pointerdown', async () => { if(mic.listening){ await finishListening(); focusEnd(transcript); } });
$('editText').onclick = () => { review(lastText); focusEnd(transcript); };

async function finishListening(){
  cta('Τελειώνω…', null, true);
  $('listenLabel').textContent = 'Τελειώνω…';
  review(await mic.stop());
}

function review(text, msg){
  if(mic.listening) mic.stop();
  show('s-listen','Διόρθωση');
  notice(msg);
  wave.hidden = true;
  $('listenLabel').textContent = text ? 'Αν κάτι ακούστηκε λάθος, πάτα πάνω στο κείμενο και διόρθωσέ το.' : '';
  transcript.contentEditable = 'true';
  transcript.textContent = (text || '').trim();
  $('listenAlt').hidden = false;
  $('resume').hidden = !micSupported;
  $('sample').hidden = !!text;
  $('changeKey').hidden = true;
  const sync = () => {
    const t = transcript.textContent.trim();
    renderChips(t);
    $('sample').hidden = !!t;
    cta('Βγάλε τιμές', () => buildLines(transcript.textContent), !t);
  };
  transcript.oninput = sync;
  sync();
  if(!text) transcript.focus();
}

$('mic').onclick = () => startListening();
$('resume').onclick = () => startListening(transcript.textContent.trim());
$('sample').onclick = () => { transcript.textContent = SAMPLE; transcript.oninput(); };
if(!micSupported) $('micNote').textContent = 'Ο browser σου δεν έχει αναγνώριση φωνής — θα μπορείς να το γράψεις.';

// Πρώτη φορά (δεν υπάρχουν αποθηκευμένα στοιχεία): «Τα στοιχεία σου» πριν από το μικρόφωνο. Μετά, ποτέ ξανά.
renderBrand();
if(!PROFILE) openProfile(null);

// ─── Φωτογραφία σημειώσεων → κατευθείαν στην προσφορά ──────
const shot = $('shot');
let pendingPhoto = null;

$('photo').hidden = !PHOTO_ENABLED;
$('photo').onclick = () => { if(PHOTO_ENABLED) getKey() ? $('photoInput').click() : openKey(); };
$('photoInput').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if(!file || !PHOTO_ENABLED) return;
  started = Date.now();
  let img;
  try {
    img = await shrink(file);
  } catch {
    review('', 'Δεν μπόρεσα να ανοίξω τη φωτογραφία.');
    return;
  }
  openRedact(img);
};

// ─── Πριν σταλεί: κάλυψη προσωπικών στοιχείων πάνω στη φωτογραφία ──
// Ό,τι καλυφθεί γίνεται μαύρο ΠΑΝΩ στην εικόνα που στέλνεται (δεν στέλνεται το πρωτότυπο).
const rc = $('redactCanvas'), rctx = rc.getContext('2d');
let rImg = null, rects = [], drag = null;
function drawRedact(){
  if(!rImg) return;
  rctx.drawImage(rImg, 0, 0, rc.width, rc.height);
  rctx.fillStyle = '#000';
  for(const r of drag ? [...rects, drag] : rects) rctx.fillRect(r.x, r.y, r.w, r.h);
}
const rPoint = e => { const b = rc.getBoundingClientRect(); return {x: (e.clientX - b.left) * rc.width / b.width, y: (e.clientY - b.top) * rc.height / b.height}; };
rc.addEventListener('pointerdown', e => { rc.setPointerCapture(e.pointerId); const p = rPoint(e); drag = {x0: p.x, y0: p.y, x: p.x, y: p.y, w: 0, h: 0}; });
rc.addEventListener('pointermove', e => {
  if(!drag) return;
  const p = rPoint(e);
  Object.assign(drag, {x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0)});
  drawRedact();
});
const endDrag = () => { if(drag && drag.w > 6 && drag.h > 6) rects.push({x: drag.x, y: drag.y, w: drag.w, h: drag.h}); drag = null; drawRedact(); };
rc.addEventListener('pointerup', endDrag);
rc.addEventListener('pointercancel', endDrag);
$('redactUndo').onclick = () => { rects.pop(); drawRedact(); };
$('redactCancel').onclick = () => { rImg = null; show('s-start', 'Νέα προσφορά'); cta(null); };

async function openRedact(img){
  rImg = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = img.url; });
  rc.width = rImg.width; rc.height = rImg.height; rects = []; drag = null;
  drawRedact();
  const prov = keyProvider(getKey());
  $('privacyNote').textContent = prov === 'anthropic'
    ? 'Θα σταλεί στην Anthropic (Claude) για ανάγνωση. Η Anthropic δεν χρησιμοποιεί τα δεδομένα του API για εκπαίδευση μοντέλων.'
    : 'Θα σταλεί στη Google (Gemini) για ανάγνωση. Στο δωρεάν επίπεδο η Google μπορεί να τη χρησιμοποιήσει για βελτίωση των υπηρεσιών της και να τη δουν άνθρωποι — κάλυψε ό,τι προσωπικό.';
  show('s-redact', 'Απόρρητο');
  cta('Στείλε για ανάγνωση', () => {
    const url = rc.toDataURL('image/jpeg', 0.85);
    pendingPhoto = {url, data: url.split(',')[1]};
    rImg = null;
    readPhoto(pendingPhoto);
  });
}

async function readPhoto(img){
  if(!PHOTO_ENABLED) return;
  show('s-listen','Διαβάζω');
  notice(''); wave.hidden = true; $('listenAlt').hidden = true; $('chips').replaceChildren();
  shot.src = img.url; shot.hidden = false; shot.classList.add('reading');
  transcript.contentEditable = 'false';
  transcript.innerHTML = '<span class="caret"></span>';
  cta('Διαβάζω…', null, true);
  $('listenLabel').textContent = 'Διαβάζω τις σημειώσεις σου…';
  try {
    let warning = '';
    const text = await readNotes(img.data, {onStatus: s => $('listenLabel').textContent = s, onWarning: w => warning = w});
    pendingPhoto = null;
    shot.classList.remove('reading');
    review(text, warning);
    buildLines(text, warning);
  } catch (err) {
    shot.classList.remove('reading');
    const msg = err.message === 'NO_KEY' ? '' : err.message;
    // Κρατάμε τη φωτογραφία: με άλλο key ξαναδιαβάζεται χωρίς νέα λήψη.
    review('', msg && msg + ' Μπορείς και να γράψεις τι λένε οι σημειώσεις.');
    $('changeKey').hidden = false;
    if(!getKey()) openKey(msg);
  }
}

$('changeKey').onclick = () => openKey();
// Πάντα διαθέσιμη πρόσβαση στο key (αλλαγή/διαγραφή), ακόμα κι όταν η φωτογραφία ανοίγει κατευθείαν την κάμερα.
const syncKeyUi = () => { $('keySettings').hidden = !PHOTO_ENABLED || !getKey(); };
$('keySettings').onclick = () => openKey();
syncKeyUi();

function openKey(msg){
  if(!PHOTO_ENABLED) return;
  $('keyError').hidden = !msg; $('keyError').textContent = msg || '';
  $('keyInput').value = '';
  $('keyInput').type = 'password'; $('keyShow').textContent = 'Εμφάνιση'; $('keyShow').setAttribute('aria-pressed', 'false');
  const can = canRememberKey();
  $('keyRemember').checked = can && isKeyRemembered();
  $('keyRemember').disabled = !can;
  $('rememberNote').textContent = can
    ? 'Αν το τσεκάρεις, μένει σε αυτό το κινητό μέχρι να πατήσεις «Ξέχασε το key». Όποιος έχει το κινητό μπορεί να το χρησιμοποιήσει. Αλλιώς ξεχνιέται όταν κλείσει η σελίδα.'
    : 'Σε αυτή τη διεύθυνση δοκιμών το key δεν αποθηκεύεται ποτέ (το domain το μοιράζονται και άλλες σελίδες). Ξεχνιέται όταν κλείσει η σελίδα.';
  $('keyForget').hidden = !getKey();
  $('veil').classList.add('on'); $('keySheet').classList.add('on');
  setTimeout(() => $('keyInput').focus(), 250);
}
function closeKey(){ $('veil').classList.remove('on'); $('keySheet').classList.remove('on'); }
$('keyCancel').onclick = closeKey;
$('keyShow').onclick = () => {
  const show = $('keyInput').type === 'password';
  $('keyInput').type = show ? 'text' : 'password';
  $('keyShow').textContent = show ? 'Απόκρυψη' : 'Εμφάνιση';
  $('keyShow').setAttribute('aria-pressed', String(show));
};
$('keyForget').onclick = () => { forgetKey(); pendingPhoto = null; closeKey(); syncKeyUi(); $('micNote').textContent = 'Το key σβήστηκε από αυτή τη συσκευή.'; };
$('keySave').onclick = () => {
  const k = $('keyInput').value.trim();
  if(!k) return;
  setKey(k, {remember: $('keyRemember').checked}); closeKey(); syncKeyUi();
  // Αν μια φωτογραφία περίμενε το κλειδί, τη διαβάζουμε τώρα· αλλιώς ανοίγει η κάμερα.
  if(pendingPhoto) readPhoto(pendingPhoto);
  else $('photoInput').click();
};

// ─── 3 : γραμμές ─────────────────────────────────────────────
// Πεδίο αριθμού με ζωντανή επιβεβαίωση: κάτω από το πεδίο φαίνεται πώς διαβάστηκε ο αριθμός
// («= 1.234,50 €») ή γιατί δεν διαβάζεται. Επιστρέφει συνάρτηση που δίνει {value} ή {error}.
function numField(el, key, {optional = false, ...opts}, fmt){
  const input = el.querySelector(`[data-p="${key}"]`), out = el.querySelector(`[data-o="${key}"]`);
  const read = () => {
    const raw = input.value.trim();
    if(!raw && optional) return {value: 0, empty: true};
    return parseAmount(raw, opts);
  };
  const show = (force) => {
    const r = read();
    const quiet = !force && !input.value.trim();
    out.textContent = quiet || r.empty ? '' : r.error ? r.error : `= ${fmt(r.value)}`;
    out.classList.toggle('err', !quiet && !!r.error);
  };
  input.addEventListener('input', () => show());
  show();
  return () => { const r = read(); show(true); if(r.error) input.focus(); return r; };
}
function showFieldError(el, key, msg){
  const out = el.querySelector(`[data-o="${key}"]`);
  out.textContent = msg; out.classList.add('err');
  el.querySelector(`[data-p="${key}"]`).focus();
}

// Κάθε γραμμή δείχνει μόνο υλικό (στρογγυλοποιημένο ανά γραμμή, όπως στα σύνολα — το PDF «βγάζει» στο λεπτό).
// Η εργασία είναι μία τιμή για όλη τη δουλειά (LABOR) και δεν ανήκει σε γραμμή.
const matOf = l => Math.round(l.qty * l.mat);
// Γραμμή εκτός καταλόγου χωρίς τιμή (needsPrice): εκκρεμότητα, δεν μπαίνει σε σύνολα/PDF.
const needsPrice = l => l.added && l.tier !== 'custom';
const okLines = () => LINES.filter(l=>!l.flag && !l.suggest && !needsQty(l) && !l.sizeCheck && !l.unknown && !l.dupAsk && !needsPrice(l) && l.qty > 0);
// Πρόταση εργασίας από τον κατάλογο: Σ qty × εργασία του είδους, για τις γραμμές χωρίς εκκρεμότητα.
const autoLabor = () => okLines().reduce((s,l)=>s+Math.round(l.qty*l.lab),0);
const needsQty = l => l.qtyMissing || l.qtyCheck;
// Μονάδες για υλικό εκτός καταλόγου (ό,τι ειπώθηκε, αλλιώς τεμ.).
const UNITS = ['τεμ.', 'μ.', 'τ.μ.', 'σακί', 'kg', 'λ.', 'κουτί', 'ζεύγος', 'κατ.'];
// Ανοιχτό πεδίο (τιμή, ποσότητα, περιγραφή) ή άκυρη κατανάλωση = η γραμμή δεν έχει ελεγχθεί ακόμα.
// Ποσότητα 0 δεν μπαίνει ποτέ στο PDF: κλειδώνει μέχρι να διορθωθεί ή να αφαιρεθεί η γραμμή.
function unresolved(){ return LINES.filter(l=>l.flag || l.suggest || needsQty(l) || l.sizeCheck || l.unknown || l.dupAsk || needsPrice(l) || !(l.qty > 0) || l.customOpen || l.qtyOpen || l.descOpen || l.calcBad).length; }

// Αφαίρεση γραμμής με «Αναίρεση» για λίγα δευτερόλεπτα.
let undoTimer = 0;
function removeLine(l){
  const at = LINES.indexOf(l);
  LINES = LINES.filter(x => x !== l); checkedCount++;
  renderLines();
  const t = $('toast');
  t.innerHTML = `Αφαιρέθηκε: ${esc(l.desc || l.name)} <button class="linkbtn" data-a="undo">Αναίρεση</button>`;
  t.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { t.hidden = true; }, 6000);
  t.querySelector('[data-a="undo"]').onclick = () => {
    clearTimeout(undoTimer); t.hidden = true;
    LINES.splice(Math.min(at, LINES.length), 0, l);
    renderLines();
  };
}
// Τύπος που διάλεξε για γραμμή που ρωτούσε: αν υπάρχει ήδη γραμμή με τον ίδιο κωδικό, δεν μένουν σιωπηλά δύο —
// ενώνονται σε μία που ρωτάει «Το είπες δύο φορές».
function mergeSameCode(l){
  const o = l.code && LINES.find(x => x !== l && x.code === l.code && !x.unknown);
  if(!o) return;
  const opts = [...new Set([o.qty, l.qty, o.qty + l.qty])].sort((a, b) => a - b);
  Object.assign(o, {qty: o.qty + l.qty, dupAsk: {times: 2, opts}});
  LINES = LINES.filter(x => x !== l);
}

// Υλικό από υπολογισμό: «15 τ.μ. × 5 kg/τ.μ. + 10% φύρα = 4 σακιά».
const unitTxt = (q, u) => u === 'σακί' && q !== 1 ? 'σακιά' : u;
const calcText = c => `${fmtQty(c.src)} ${c.srcUnit} × ${fmtQty(c.rate)} ${c.unit}/${c.srcUnit} + ${fmtQty(c.waste)}% φύρα = ${fmtQty(c.qty)} ${unitTxt(c.qty, 'σακί')}`;
const numText = v => String(v).replace('.', ',');

function buildLines(text, warning){
  lastText = text;                         // για «Διόρθωσε το κείμενο» από την οθόνη ελέγχου
  let r;
  try { r = parse(text); }
  catch {
    // Ποτέ σιωπηλό πάγωμα: το κείμενο μένει, ο χρήστης ξέρει τι να κάνει.
    notice('Κάτι πήγε στραβά με την ανάλυση αυτού του κειμένου. Άλλαξε λίγο τη φράση (π.χ. γράψε «30 επί 60») και πάτα ξανά «Βγάλε τιμές».');
    return;
  }
  $('linesNotice').hidden = !warning; $('linesNotice').textContent = warning || '';
  // Υλικά εκτός καταλόγου: φράση με ποσότητα + ουσιαστικό γίνεται κάρτα για απόφαση (ποτέ σιωπηλά χαμένο υλικό).
  // Ό,τι δεν είναι υλικό (τηλέφωνο, όνομα, ώρα, ποσό σε ευρώ, φράση χωρίς ποσότητα) δεν γίνεται κάρτα.
  // Υλικό εκτός καταλόγου = κανονική γραμμή προϊόντος χωρίς τιμή (added): τιμή με το χέρι ή «Σβήσε».
  const found = r.lines.filter(l => !l.unknown || l.keep).map(l => !l.unknown ? l :
    Object.assign(l, {unknown: false, added: true, code: '', mat: 0, lab: 0, customOpen: true}));
  if(!found.length){
    notice('Δεν βρήκα κανένα υλικό. Πες ή γράψε π.χ. «δέκα μέτρα σωλήνα».');
    return;
  }
  LINES = found; TITLE = r.title || 'εργασίες';
  // Νέα ανάλυση = νέα εργασία: ό,τι ειπώθηκε («εργασία 1.200 ευρώ»), αλλιώς η πρόταση του καταλόγου.
  LABOR = r.labor?.cents ?? null; laborVoice = LABOR; laborAsk = r.labor?.ask ?? null; laborBad = false;
  show('s-lines','Έλεγχος');
  renderLines();
}
function renderLines(){
  // Υλικά από υπολογισμό (κόλλα, αρμόστοκος) ακολουθούν την πηγή τους, εκτός αν ο χρήστης έγραψε δική του ποσότητα.
  // Πρόταση που υπήρχε μόνο λόγω της πηγής της (κόλλα για πλακάκια): αν η πηγή σβήστηκε, φεύγει κι αυτή.
  // Αν την είχε κρατήσει ο χρήστης, μένει (με «Ποσότητα 0» θα κλειδώσει, για να την αφαιρέσει ο ίδιος).
  LINES = LINES.filter(l => !(l.suggest && l.calc && !LINES.some(x => x.id === l.calc.from)));
  for(const l of LINES) if(l.calc && !l.manual) l.qty = calcParts(l, LINES).qty;
  const box = $('lines'); box.innerHTML = '';
  LINES.forEach((l,i)=>{
    const el = document.createElement('div');
    // Κάθε γραμμή που περιμένει απόφαση φαίνεται («θέλει έλεγχο»): ό,τι κλειδώνει το κουμπί, χρωματίζεται.
    el.className = 'ln' + ((l.flag||l.suggest||needsQty(l)||l.sizeCheck||l.dupAsk||l.choose||needsPrice(l)||!(l.qty > 0))?' flag':'');
    el.style.animationDelay = (i*0.07)+'s';
    if(l.choose){
      el.innerHTML = `
        <div class="ln-top"><span class="ln-name">${fmtQty(l.qty)} ${esc(l.unit)} — «ντους»</span></div>
        <div class="ask">${esc(l.name)}</div>
        <div class="sug-act">${l.choose.map((c, j) => `<button data-c="${j}">${esc(c.name)}</button>`).join('')}</div>`;
      el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
        const n = lineFor(l.choose[+b.dataset.c].id, l.qty);
        LINES[LINES.indexOf(l)] = n;
        mergeSameCode(n); checkedCount++; renderLines();
      });
    } else if(l.dupAsk){
      const u = esc(l.unit), times = l.dupAsk.times === 2 ? 'δύο' : l.dupAsk.times;
      el.innerHTML = `
        <div class="ln-top"><span class="ln-name">${esc(l.name)}</span></div>
        <div class="ask">Το είπες ${times} φορές: ${l.dupAsk.opts.map(fmtQty).join(' ή ')};</div>
        <div class="sug-act">${l.dupAsk.opts.map((q, j) => `<button data-q="${j}">${fmtQty(q)} ${u}</button>`).join('')}</div>`;
      el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
        Object.assign(l, {qty: l.dupAsk.opts[+b.dataset.q], dupAsk: null}); checkedCount++; renderLines();
      });
    } else if(l.flag){
      el.innerHTML = `
        <div class="ln-top"><span class="ln-name">${fmtQty(l.qty)} ${esc(l.unit)} ${esc(l.name)}</span></div>
        <div class="ask">Δεν είπες ποιο. Διάλεξε:</div>
        <div class="opts">${l.options.map((o,j)=>`
          <button class="opt" data-j="${j}"><span>${esc(o.label)}</span><span class="num">${eur(o.mat)}/${esc(l.unit)}</span></button>`).join('')}
        </div>`;
      el.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{
        Object.assign(l, l.pick(l.options[+b.dataset.j]));
        l.flag = false; checkedCount++;
        mergeSameCode(l);
        renderLines();
      });
    } else if(l.suggest){
      el.innerHTML = `
        <div class="ln-top"><span class="ln-name">${fmtQty(l.qty)} ${esc(l.unit)} ${esc(l.name)}</span><span class="ln-sum num">${eur(matOf(l))}</span></div>
        ${l.calc ? `<div class="calc">${esc(calcText(calcParts(l, LINES)))}</div>` : ''}
        <div class="ask">Δεν το είπες, αλλά χρειάζεται για τα πλακάκια. Το κρατάς;</div>
        <div class="sug-act"><button data-a="keep">Ναι, πρόσθεσέ το</button><button data-a="drop">Όχι</button></div>`;
      el.querySelector('[data-a="keep"]').onclick=()=>{ l.suggest=false; checkedCount++; renderLines(); };
      el.querySelector('[data-a="drop"]').onclick=()=>{ LINES = LINES.filter(x=>x!==l); checkedCount++; renderLines(); };
    } else if(needsQty(l)){
      // Ποσότητα που δεν ειπώθηκε ή φαίνεται παράλογη (π.χ. 999, τιμή που διαβάστηκε ως ποσότητα): επιβεβαίωση.
      el.innerHTML = `
        <div class="ln-top"><span class="ln-name">${esc(l.name)}</span></div>
        <div class="ask">${l.qtyMissing ? `Δεν είπες ποσότητα (${esc(l.unit)}) — γράψε πόσα:` : `${fmtQty(l.qty)} ${esc(l.unit)}; Φαίνεται πολύ — έλεγξε την ποσότητα:`}</div>
        <div class="prices"><label>Ποσότητα (${esc(l.unit)})<input inputmode="decimal" data-p="qty" value="${l.qtyMissing ? '' : String(l.qty).replace('.', ',')}" placeholder="0"><small class="parsed" data-o="qty"></small></label></div>
        <div class="sug-act"><button data-a="ok">Εντάξει</button><button data-a="drop">Βγάλ' το</button></div>`;
      const readQty = numField(el, 'qty', {maxDecimals: 3}, v => `${formatQty(v)} ${l.unit}`);
      el.querySelector('[data-a="ok"]').onclick=()=>{
        const r = readQty();
        if(r.error) return;
        const q = r.value;
        Object.assign(l, {qty: q, qtyMissing: false, qtyCheck: false});
        checkedCount++; renderLines();
      };
      el.querySelector('[data-a="drop"]').onclick=()=>{ LINES = LINES.filter(x=>x!==l); checkedCount++; renderLines(); };
    } else {
      if(l.matBase == null) l.matBase = l.mat;                 // η τιμή καταλόγου μένει σταθερή, ώστε οι προτάσεις να μη μετακινούνται
      const T = tiers(l.matBase), cur = l.customOpen ? 'custom' : (l.tier ?? 'normal');
      const key = priceKey(l), hist = T || l.added ? history(key) : [];
      const per = esc(l.unit);
      const sc = l.sizeCheck, c = l.calc && calcParts(l, LINES);
      el.innerHTML = `
        <div class="ln-top"><span class="ln-name">${esc(l.desc || l.name)}</span><span class="ln-sum num">${l.mat > 0 ? eur(matOf(l)) : 'στην εργασία'}</span></div>
        <div class="ln-meta">${l.desc ? `${esc(l.name)} · ` : ''}${esc(l.code)} <button class="linkbtn" data-a="desc-edit">Άλλαξε περιγραφή</button>${l.added ? ` <button class="linkbtn" data-a="remove-line">Σβήσε</button>` : ''}</div>
        ${needsPrice(l) ? `<div class="ask">Δεν είναι στον κατάλογο — βάλε τιμή ή σβήσ' το</div>` : ''}
        ${l.descOpen ? `
        <div class="prices"><label>Περιγραφή στο PDF<input data-p="desc" maxlength="120" autocomplete="off" value="${esc(l.desc || l.name)}"></label></div>
        <p class="hint">Αλλάζει μόνο το κείμενο· τιμή και κωδικός μένουν ίδια.</p>
        <div class="sug-act"><button data-a="desc-keep">Κράτα την</button><button data-a="desc-cancel">Άκυρο</button></div>` : ''}
        ${sc ? `
        <div class="ask">Είπες ${esc(sc.said)} — ο κατάλογος έχει ${esc(sc.near.map(o => o.label).join(' ή ').replace(/\.$/, ''))}. Διάλεξε:</div>
        <div class="sug-act">${sc.near.map(o => `<button data-near="${l.options.indexOf(o)}">${esc(o.label)}</button>`).join('')}<button data-a="size-other">Άλλο μέγεθος (${esc(sc.said)})</button></div>`
        : l.options ? `
        <div class="types" role="group" aria-label="Τύπος">${l.options.map((o, j) => `
          <button class="tp${o.code === l.code ? ' on' : ''}" data-opt="${j}" aria-pressed="${o.code === l.code}">${esc(o.label)}</button>`).join('')}
        </div>` : ''}
        ${l.qtyOpen ? `
        <div class="prices"><label>Ποσότητα (${per})<input inputmode="decimal" data-p="eqty" value="${numText(l.qty)}"><small class="parsed" data-o="eqty"></small></label></div>
        <div class="sug-act"><button data-a="qty-keep">Κράτα την</button><button data-a="qty-cancel">Άκυρο</button></div>` : `
        <div class="ln-row">
          <div class="qty">${l.qty <= 1 ? `<button class="rm" data-a="remove">Αφαίρεση</button>` : `<button aria-label="Λιγότερα" data-d="-1">−</button>`}<button class="qv num" data-a="qty-edit" aria-label="Γράψε ποσότητα">${fmtQty(l.qty)} ${per}</button><button aria-label="Περισσότερα" data-d="1">+</button></div>
          ${l.added ? `<label class="unit">Μονάδα <select data-p="unit">${UNITS.map(u => `<option${u === l.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></label>` : ''}
        </div>`}
        ${c ? `
        <div class="calc" data-calc>${esc(calcText(c))}</div>
        <div class="prices">
          <label>${esc(c.unit)}/${esc(c.srcUnit)}<input inputmode="decimal" data-p="rate" value="${numText(c.rate)}"><small class="parsed" data-o="rate"></small></label>
          <label>Φύρα %<input inputmode="decimal" data-p="waste" value="${numText(c.waste)}"><small class="parsed" data-o="waste"></small></label>
        </div>
        ${l.manual ? `<p class="hint">Δική σου ποσότητα · <button class="linkbtn" data-a="calc-reset">επαναφορά στον υπολογισμό</button></p>` : ''}` : ''}
        ${l.qty > 0 ? '' : `<div class="ask">Ποσότητα 0 — δεν μπαίνει στο PDF. Γράψε ποσότητα ή αφαίρεσε τη γραμμή.</div>`}
        ${T || l.added ? `
        <div class="tiers" role="group" aria-label="Τιμή υλικού ανά ${per}">
          ${(l.sizeSaid || l.added ? [] : [['eco', 'Οικονομική'], ['normal', 'Κανονική'], ['premium', 'Ακριβή']]).map(([t, n]) => `
          <button class="tier${cur === t ? ' on' : ''}" data-t="${t}" aria-pressed="${cur === t}"><span>${n}</span><span class="num">${eur(T[t])}<small>/${per}</small></span></button>`).join('')}
          <button class="tier${cur === 'custom' || l.tier === 'custom' ? ' on' : ''}" data-t="custom" aria-pressed="${cur === 'custom'}"><span>Άλλη τιμή</span><span class="num">${l.tier === 'custom' && !l.customOpen ? `${eur(l.mat)}<small>/${per}</small>` : '…'}</span></button>
        </div>
        ${l.customOpen ? `
        <div class="custom">
          <div class="prices"><label>Τιμή υλικού € ανά ${per}<input inputmode="decimal" data-p="cmat" placeholder="0,00" value="${esc(l.customDraft || '')}"><small class="parsed" data-o="cmat"></small></label></div>
          <div class="hist" data-hist ${hist.length && !l.customDraft ? '' : 'hidden'}>${hist.map(h => `
            <button class="hi" data-c="${h.c}"><span class="num">${eur(h.c)}</span><span>${ageLabel(h.at)}${isStale(h.at) ? ' · <b>έλεγξε αν άλλαξε</b>' : ''}</span></button>`).join('')}
          </div>
          <div class="sug-act"><button data-a="keep">Κράτα την</button><button data-a="cancel">Άκυρο</button></div>
        </div>` : ''}` : ''}`;
      // Τύπος/μέγεθος: αλλάζει όνομα, κωδικό και τιμή καταλόγου (οι προτάσεις ξαναϋπολογίζονται· η δική του
      // τιμή για αυτόν τον κωδικό φαίνεται στο «Άλλη τιμή», όχι αυτόματα). Η δική του περιγραφή σβήνει: θα έλεγε άλλο είδος.
      const choose = o => {
        Object.assign(l, l.pick(o), {matBase: null, tier: 'normal', customOpen: false, customDraft: '', sizeSaid: null, sizeCheck: null, desc: null});
        checkedCount++; renderLines();
      };
      el.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => choose(l.options[+b.dataset.opt]));
      el.querySelectorAll('[data-near]').forEach(b => b.onclick = () => choose(l.options[+b.dataset.near]));
      // Άλλο μέγεθος = άλλο είδος: παίρνει το μέγεθος που ειπώθηκε, χωρίς κωδικό καταλόγου, και η τιμή γράφεται με το χέρι
      // (οι προτάσεις τιμής του καταλόγου κρύβονται — είναι για άλλο μέγεθος).
      if(sc) el.querySelector('[data-a="size-other"]').onclick = () => {
        Object.assign(l, {sizeSaid: {name: l.name, code: l.code, sizeCheck: sc},
          name: `${l.base} ${sc.said}`, code: '', sizeCheck: null, desc: null, customOpen: true, focusCustom: true});
        checkedCount++; renderLines();
      };
      // Ποσότητα: −/+ ή γραμμένη (ίδια αυστηρή ανάγνωση με τις τιμές). Σε υλικό από υπολογισμό = δική του ποσότητα.
      // Στο ελάχιστο το − γίνεται «Αφαίρεση» (με αναίρεση) — η γραμμή δεν μένει ποτέ σιωπηλά με 0.
      el.querySelector('[data-a="remove"]')?.addEventListener('click', () => removeLine(l));
      el.querySelector('[data-a="remove-line"]')?.addEventListener('click', () => removeLine(l));
      el.querySelector('[data-p="unit"]')?.addEventListener('change', e => { l.unit = e.target.value; renderLines(); });
      el.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{
        l.qty = Math.max(0, Math.round((l.qty + (+b.dataset.d))*100)/100);
        if(l.calc) l.manual = true;
        renderLines();
      });
      if(l.qtyOpen){
        const readQ = numField(el, 'eqty', {maxDecimals: 3}, v => `${formatQty(v)} ${l.unit}`);
        el.querySelector('[data-a="qty-keep"]').onclick = () => {
          const r = readQ();
          if(r.error) return;
          Object.assign(l, {qty: r.value, qtyOpen: false});
          if(l.calc) l.manual = true;
          checkedCount++; renderLines();
        };
        el.querySelector('[data-a="qty-cancel"]').onclick = () => { l.qtyOpen = false; renderLines(); };
        setTimeout(() => el.querySelector('[data-p="eqty"]').focus(), 0);
      } else el.querySelector('[data-a="qty-edit"]').onclick = () => { l.qtyOpen = true; renderLines(); };
      // Περιγραφή: ελεύθερο κείμενο για το PDF (π.χ. μάρκα). Δεν αλλάζει τιμή ούτε κωδικό· κενό = του καταλόγου.
      el.querySelector('[data-a="desc-edit"]').onclick = () => { l.descOpen = true; renderLines(); };
      if(l.descOpen){
        const input = el.querySelector('[data-p="desc"]');
        el.querySelector('[data-a="desc-keep"]').onclick = () => {
          const t = input.value.trim().replace(/\s+/g, ' ');
          Object.assign(l, {desc: t && t !== l.name ? t : null, descOpen: false});
          renderLines();
        };
        el.querySelector('[data-a="desc-cancel"]').onclick = () => { l.descOpen = false; renderLines(); };
        setTimeout(() => input.focus(), 0);
      }
      // Κατανάλωση και φύρα: άκυρη τιμή κλειδώνει το κουμπί (ποτέ σιωπηλά λάθος ποσότητα)· έγκυρη ενημερώνει αμέσως.
      if(c){
        const reads = {rate: numField(el, 'rate', {}, v => `${formatQty(v)} ${c.unit}/${c.srcUnit}`),
                       waste: numField(el, 'waste', {allowZero: true, maxDecimals: 1}, v => `${formatQty(v)}%`)};
        const bad = {};
        for(const k of ['rate', 'waste']) el.querySelector(`[data-p="${k}"]`).addEventListener('input', () => {
          const r = reads[k]();
          bad[k] = !!r.error;
          l.calcBad = bad.rate || bad.waste;
          if(!r.error){
            l.calc[k] = r.value;
            const n = calcParts(l, LINES);
            if(!l.manual) l.qty = n.qty;
            el.querySelector('[data-calc]').textContent = calcText(n);
            el.querySelector('[data-a="qty-edit"]').textContent = `${fmtQty(l.qty)} ${l.unit}`;
            el.querySelector('.ln-sum').textContent = l.mat > 0 ? eur(matOf(l)) : 'στην εργασία';
            renderLabor(); renderTotals();
          }
          refreshCta();
        });
        const reset = el.querySelector('[data-a="calc-reset"]');
        if(reset) reset.onclick = () => { l.manual = false; renderLines(); };
      }
      el.querySelectorAll('.tier').forEach(b=>b.onclick=()=>{
        const t = b.dataset.t;
        if(t === 'custom'){ l.customOpen = true; l.focusCustom = true; renderLines(); return; }
        Object.assign(l, {tier: t, mat: T[t], customOpen: false, customDraft: ''});
        renderLines();
      });
      if(l.customOpen){
        const input = el.querySelector('[data-p="cmat"]'), histBox = el.querySelector('[data-hist]');
        // Εκτός καταλόγου: 0 μόνο αν το γράψει ρητά (= «στην εργασία»).
        const readC = numField(el, 'cmat', {allowZero: !!l.added}, v => v === 0 ? '0,00 € — στην εργασία' : `${formatEur(v)} ανά ${l.unit}`);
        // Οι αποθηκευμένες τιμές φαίνονται μόνο όσο το πεδίο είναι άδειο· ποτέ δεν μπαίνουν μόνες τους.
        input.addEventListener('input', () => { l.customDraft = input.value; histBox.hidden = !!input.value || !hist.length; });
        histBox.querySelectorAll('.hi').forEach(h => h.onclick = () => {
          input.value = centsText(+h.dataset.c);
          input.dispatchEvent(new Event('input', {bubbles: true}));
          input.focus();
        });
        el.querySelector('[data-a="keep"]').onclick = () => {
          const r = readC();
          if(r.error) return;
          const cents = toCents(r.value);
          Object.assign(l, {mat: cents, tier: 'custom', customOpen: false, customDraft: ''});
          remember(key, cents);
          checkedCount++; renderLines();
        };
        el.querySelector('[data-a="cancel"]').onclick = () => {
          Object.assign(l, {customOpen: false, customDraft: ''});
          // «Βάλε 120 λ.» χωρίς δική του τιμή → πίσω στην ερώτηση (ποτέ όνομα 120 λ. με τιμή του 80 λ.).
          if(l.sizeSaid && l.tier !== 'custom'){ Object.assign(l, l.sizeSaid); l.sizeSaid = null; }
          renderLines();
        };
        if(l.focusCustom){ l.focusCustom = false; setTimeout(() => input.focus(), 0); }
      }
    }
    box.appendChild(el);
  });
  renderLabor();
  renderTotals();
  refreshCta();
}
function refreshCta(){
  const left = unresolved();
  cta('Έλεγξα, φτιάξε την προσφορά', buildPdf, left>0 || laborBad,
      left>0 ? (left===1 ? 'Μένει 1 γραμμή να ελέγξεις' : `Μένουν ${left} γραμμές να ελέγξεις`) : laborBad ? (laborAsk ? 'Γράψε το ποσό της εργασίας' : 'Διόρθωσε την εργασία') : '');
}
// Εργασία για όλη τη δουλειά: ΕΝΑ πεδίο, σε δικό του container (το re-render των συνόλων δεν χαλάει το focus την ώρα
// που γράφει). Προσυμπληρωμένο με την πρόταση του καταλόγου· ό,τι γράψει ο τεχνίτης μένει (δεν αλλάζει μόνο του
// όταν αλλάξουν ποσότητες — η πρόταση φαίνεται από κάτω για σύγκριση).
const centsText = c => { const t = (c / 100).toFixed(2).replace('.', ','); return t.replace(/,00$/, ''); };
// ΦΠΑ: τον συντελεστή τον ΕΠΙΛΕΓΕΙ ο τεχνίτης (προτίμηση συσκευής, προεπιλογή 24%). Η εφαρμογή δεν προτείνει
// και δεν ελέγχει ποιος ισχύει (εξαρτάται από τόπο, είδος εργασίας, προϋποθέσεις)· ευθύνη τεχνίτη/λογιστή.
// Πηγές για τους αριθμούς: docs/SOURCES.md.
const VAT_RATES = [24, 17, 13, 9, 6, 4, 0].map(r => [r, `${r}%`]);
let vatRate = (() => { try { const v = Number(localStorage.getItem('ergolav.vat')); return VAT_RATES.some(([r]) => r === v) && localStorage.getItem('ergolav.vat') !== null ? v : 24; } catch { return 24; } })();
// Μόνο συντελεστής της λίστας: οτιδήποτε άλλο (π.χ. 7,25 από πειραγμένο <option>) αγνοείται.
const isVat = v => VAT_RATES.some(([r]) => r === v);
function setVat(v){ if(!isVat(v)) return false; vatRate = v; try { localStorage.setItem('ergolav.vat', String(v)); } catch {} return true; }

function renderLabor(){
  const box = $('laborBox'), auto = autoLabor();
  laborBad = !!laborAsk;                                     // ασαφές ποσό από τη φωνή: κλειδωμένο μέχρι να γραφτεί
  box.innerHTML = `
    <div class="prices"><label>Εργασία για όλη τη δουλειά €<input inputmode="decimal" data-p="labor" value="${laborAsk ? '' : centsText(LABOR ?? auto)}" placeholder="0"><small class="parsed" data-o="labor"></small></label></div>
    <div class="hint" data-hint></div>`;
  const hint = box.querySelector('[data-hint]');
  const syncHint = () => {
    const voice = laborVoice != null && LABOR === laborVoice ? '<span class="voice">από τη φωνή — έλεγξε</span> · ' : '';
    hint.innerHTML = laborAsk ? `<span class="voice">Άκουσα εργασία «${esc(laborAsk)}» — δεν είναι σαφές ποσό. Γράψε το ποσό.</span>`
      : LABOR != null && LABOR !== auto ? `${voice}Πρόταση καταλόγου: ${eur(auto)} <button class="linkbtn" data-a="auto">Χρησιμοποίησέ την</button>` : voice;
    const b = hint.querySelector('[data-a="auto"]');
    if(b) b.onclick = () => { LABOR = null; laborAsk = null; renderLabor(); renderTotals(); refreshCta(); };
  };
  const read = numField(box, 'labor', {allowZero: true}, formatEur);   // αυστηρή ανάγνωση: «1.500» μπλοκάρει
  box.querySelector('[data-p="labor"]').addEventListener('input', () => {
    const r = read();
    if(r.error){ laborBad = true; refreshCta(); return; }   // η τελευταία έγκυρη τιμή μένει, το κουμπί κλειδώνει
    laborBad = false; laborAsk = null; LABOR = toCents(r.value);
    syncHint(); renderTotals(); refreshCta();
  });
  syncHint();
}

function sums(){
  const mat = okLines().reduce((s,l)=>s+matOf(l),0);
  const lab = LABOR ?? autoLabor();
  const net = mat+lab, vat = Math.round(net * (isVat(vatRate) ? vatRate : 24) / 100);
  return {mat,lab,net,vat,total:net+vat};
}
function renderTotals(){
  const s = sums();
  $('totals').innerHTML = `
    <div class="t"><span>Υλικά</span><span class="num">${eur(s.mat)}</span></div>
    <div class="t"><span>Εργασία</span><span class="num">${eur(s.lab)}</span></div>
    <div class="t"><span>ΦΠΑ ${vatRate}%</span><span class="num">${eur(s.vat)}</span></div>
    <div class="t big"><span>Σύνολο</span><span class="num">${eur(s.total)}</span></div>
    <label class="vat">Συντελεστής ΦΠΑ
      <select id="vatRate">${VAT_RATES.map(([r, t]) => `<option value="${r}"${r === vatRate ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <p class="privacy">Η εφαρμογή δεν ελέγχει ποιος συντελεστής ΦΠΑ ισχύει. Τον επιλέγεις εσύ, με ευθύνη δική σου ή του λογιστή σου.</p>`;
  $('vatRate').onchange = e => { setVat(Number(e.target.value)); renderTotals(); };   // άκυρο → ξαναφτιάχνεται με τον ισχύοντα
}

// ─── 4 : PDF ─────────────────────────────────────────────────
function buildPdf(){
  // Χωρίς στοιχεία επιχείρησης δεν βγαίνει PDF: πρώτα η φόρμα, μετά το PDF.
  if(!PROFILE) return openProfile(buildPdf);
  if(quoteNo == null) quoteNo = takeQuoteNo();
  show('s-pdf','Προεπισκόπηση');
  const s = sums();
  const client = $('client').value.trim();
  const today = new Date().toLocaleDateString('el-GR');
  const contact = PROFILE.phone ? `Τηλ. ${PROFILE.phone}` : '';
  $('pdf').innerHTML = `
    <div class="pdf-head">
      <div style="display:flex;gap:10px;align-items:center"><div class="logo">${esc(initials(PROFILE.name))}</div>
        <div><b>${esc(PROFILE.name)}</b>${PROFILE.trade ? `<div style="color:#5E646B;font-size:12px">${esc(PROFILE.trade)}</div>` : ''}${contact ? `<div style="color:#5E646B;font-size:12px">${esc(contact)}</div>` : ''}</div></div>
      <div style="text-align:right;color:#5E646B;font-size:12px">Αρ. <span class="qno">${quoteNo}</span><br>${today}</div>
    </div>
    <h2>Προσφορά: ${esc(TITLE)}</h2>
    <div class="who">Προς: ${client ? esc(client) : '—'}</div>
    <table>
      <tr><th>Περιγραφή</th><th class="r">Υλικό</th></tr>
      ${okLines().map(l=>`<tr><td>${esc(l.desc || l.name)}<div class="q">${fmtQty(l.qty)} ${esc(l.unit)}</div></td><td class="num">${l.mat > 0 ? eur(matOf(l)) : 'στην εργασία'}</td></tr>`).join('')}
    </table>
    <div class="sum num">
      <div><span>Υλικά</span><span>${eur(s.mat)}</span></div>
      <div><span>Εργασία</span><span>${eur(s.lab)}</span></div>
      <div><span>Καθαρή αξία</span><span>${eur(s.net)}</span></div>
      <div><span>ΦΠΑ ${vatRate}%</span><span>${eur(s.vat)}</span></div>
      <div class="g"><span>Σύνολο</span><span>${eur(s.total)}</span></div>
    </div>
    <p class="foot">Η προσφορά ισχύει για 15 ημέρες. Περιλαμβάνει υλικά και εργασία τοποθέτησης.</p>`;
  preparePdf();
}

// ─── 5 : αποστολή ────────────────────────────────────────────
// Το PDF φτιάχνεται μόλις ανοίξει η προεπισκόπηση, ώστε το «Στείλε» να ανοίγει αμέσως το μενού
// κοινοποίησης (οι browsers το επιτρέπουν μόνο αμέσως μετά από πάτημα).
let pdfFile = null;
// Όνομα αρχείου με λατινικούς: κάποιοι browsers απορρίπτουν ελληνικά ονόματα στο κατέβασμα.
const GR = {α:'a',β:'v',γ:'g',δ:'d',ε:'e',ζ:'z',η:'i',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',
  ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',φ:'f',χ:'ch',ψ:'ps',ω:'o'};
const greeklish = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ου/g, 'ou').replace(/Ου/g, 'Ou').replace(/ΟΥ/g, 'OU')
  .replace(/./g, c => { const l = c.toLowerCase(), t = GR[l]; return t ? (c === l ? t : t[0].toUpperCase() + t.slice(1)) : c; });
const clientName = () => $('client').value.split(',')[0].trim() || 'Πελάτης';
const shareText = () =>
  `Καλησπέρα σας, σας στέλνω την προσφορά για ${TITLE}. Σύνολο ${eur(sums().total)} με ΦΠΑ.`;

async function preparePdf(){
  pdfFile = null;
  cta('Ετοιμάζω το PDF…', null, true);
  const name = `Prosfora-${quoteNo}-${greeklish(clientName())}`.replace(/[^\w.-]+/g, '-').replace(/-+$/, '') + '.pdf';
  try {
    pdfFile = await makePdf($('pdf'), name);
    cta('Στείλε στον πελάτη', sendPdf);
  } catch (e) {
    cta('Δοκίμασε ξανά', preparePdf, false, e.message || 'Δεν έγινε το PDF.');
  }
}

async function sendPdf(){
  const res = await shareFile(pdfFile, {title: `Προσφορά ${quoteNo} — ${clientName()}`, text: shareText()});
  if(res === 'shared') done('Στάλθηκε', `Η προσφορά έφυγε για ${clientName()}.`);
  else if(res === 'unsupported') openSheet();
  // 'cancelled': ο χρήστης έκλεισε το μενού — μένουμε στην προεπισκόπηση
}

function openSheet(){ $('veil').classList.add('on'); $('sheet').classList.add('on'); }
function closeSheet(){ $('veil').classList.remove('on'); $('sheet').classList.remove('on'); }
$('veil').onclick = () => { closeSheet(); closeKey(); };
document.querySelectorAll('[data-send]').forEach(b => b.onclick = () => {
  closeSheet();
  const how = b.dataset.send, text = encodeURIComponent(shareText());
  download(pdfFile);
  if(how === 'whatsapp') window.open(`https://wa.me/?text=${text}`, '_blank');
  if(how === 'viber') location.href = `viber://forward?text=${text}`;
  if(how === 'email') location.href = `mailto:?subject=${encodeURIComponent(pdfFile.name.replace(/\.pdf$/, ''))}&body=${text}`;
  done('Το PDF κατέβηκε', how === 'download'
    ? 'Βρίσκεται στις Λήψεις. Στείλε το στον πελάτη από όποια εφαρμογή θέλεις.'
    : 'Επισύναψε το PDF από τις Λήψεις στο μήνυμα που άνοιξε.');
});

function done(title, text){
  $('doneTitle').textContent = title;
  $('sentTo').textContent = text;
  const secs = Math.max(1, Math.round((Date.now()-started)/1000));
  $('elapsed').textContent = secs < 60 ? `${secs} δευτ.` : `${Math.floor(secs/60)}′ ${secs%60}″`;
  $('checked').textContent = checkedCount;
  show('s-done','Έτοιμο');
  cta(null);
}
$('resend').onclick = () => { if(pdfFile) sendPdf(); };
$('again').onclick = ()=> location.reload();
