// Να μην τρέχει μέσα σε ξένο iframe (clickjacking — η CSP μέσω <meta> δεν υποστηρίζει frame-ancestors).
if(window.top !== window.self){
  document.body.innerHTML = '<p style="padding:24px;font:17px system-ui">Η εφαρμογή ανοίγει μόνο απευθείας, όχι μέσα σε άλλη σελίδα.</p>';
  throw new Error('framed');
}
import { parse, calcParts, lineFor } from './parse.js';
import { createMic, micSupported, VOICE_OFFLINE } from './mic.js';
import { readNotes, shrink, getKey, setKey, forgetKey, canRememberKey, isKeyRemembered, keyProvider } from './photo.js';
import { makePdf, shareFiles, download } from './share.js';
import { mountInstallation } from './installation-ui.js';
let installationPanel=null;
import { mountAnalysis } from './analysis-ui.js';
let analysisPanel = null;
import { parseAmount, toCents, formatEur, formatQty } from './number.js';
import { tiers, priceKey, history, remember, ageLabel, isStale, ageDays, loadAll } from './prices.js';
import { registerCustom, migrateCustom, refFor, refStatus, offersFor, createPriceSync, priceDate, ownPrice, CHECK_DAYS } from './price-watch.js';
import { loadProfile, saveProfile, initials, takeQuoteNo, getLogo } from './profile.js';
import { fitImage } from './image.js';
import { listQuotes, getQuote, saveQuote, updateQuote, migrateQuotes, ensureIds, newId } from './history.js';
import { createQuoteSync, wipeLocalQuotes } from './sync.js';
import { mountWhen } from './when-ui.js';
import { mountCalendar } from './calendar-ui.js';
import { mountAccount } from './account-ui.js';
import { authGate } from './account.js';
import { registerSW, takeDraft } from './offline.js';
import { watchNet, online, probe, onNet, NO_NET } from './net.js';
import * as CONFIG from './config.js';
const QUOTES_SYNC_ENABLED = CONFIG.QUOTES_SYNC_ENABLED === true;
import { guardStorage, askPersist } from './storage-guard.js';
import { mountOfflineUi } from './offline-ui.js';

// ─── Χωρίς σήμα (docs/offline.md): σήμα, γεμάτη μνήμη και ενδείξεις επάνω — πριν από οτιδήποτε άλλο ───
watchNet();
const offlineUi = mountOfflineUi();
guardStorage({onFull: () => offlineUi.full()});

// Πιλοτικό: δεν στέλνουμε φωτογραφίες σε τρίτους. Με true ξανανοίγει η ροή φωτογραφίας (κουμπί, κάλυψη, key).
const PHOTO_ENABLED = false;
// «Περισσότερες λεπτομέρειες για τις εργασίες; / Ανάλυση εργασιών με AI» (με τις φωτογραφίες εργασίας): κρυφή.
// Ο κώδικας (installation-ui.js, server) μένει για μελλοντική χρήση· ανάβει μόνο σε δοκιμές (ergolav.aiAnalysis = '1').
const AI_ANALYSIS_ENABLED = (() => { try { return localStorage.getItem('ergolav.aiAnalysis') === '1'; } catch { return false; } })();

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
let started = 0, checkedCount = 0, lastText = '', listenFrom = 'start';   // listenFrom: από πού ήρθε στο κείμενο

// Υποχρεωτικός λογαριασμός: χωρίς συνεδρία ΚΑΜΙΑ οθόνη εκτός από τη σύνδεση — από οπουδήποτε κι αν ζητηθεί
// (κουμπί, «‹ Πίσω», αλλαγή της διεύθυνσης). Αποφασίζεται αμέσως, χωρίς δίκτυο (account.js · authGate).
let authLocked = authGate().locked, authUi = null;
const AUTH_OPEN = new Set(['s-login']);
function show(id, step){
  if(authLocked && !AUTH_OPEN.has(id)){ id = 's-login'; step = 'Σύνδεση'; }
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('on', s.id===id));
  // Η «Αναίρεση» αφορά μόνο την οθόνη ελέγχου: σε άλλη οθόνη (π.χ. PDF που ήδη φτιάχτηκε) δεν μένει.
  if(id !== 's-lines') $('toast').hidden = true;
  if(id === 's-account') techAccount();
  $('step').textContent = step;
  window.scrollTo({top:0});
  syncBack(id);
}
// «Πίσω» πάνω αριστερά: παντού εκτός από την αρχική — και την πρώτη φόρμα στοιχείων, όταν δεν υπάρχει πού να γυρίσει.
function syncBack(id){
  $('navBack').hidden = id === 's-start' || (id === 's-profile' && !PROFILE && !profileBack) || (authUi ? !authUi.canBack(id) : id === 's-login');
  // Με «‹ Πίσω» η κεφαλίδα στενεύει: σε μικρή οθόνη το κουμπί λογαριασμού γίνεται μόνο εικονίδιο.
  document.querySelector('header').classList.toggle('has-back', !$('navBack').hidden);
}
function cta(label, fn, disabled, note){
  if(authLocked) label = null;            // στην οθόνη σύνδεσης κανένα κουμπί της εφαρμογής
  $('cta').hidden = !label;
  if(!label) return;
  const b = $('ctaBtn'); b.textContent = label; b.disabled = !!disabled; b.onclick = fn;
  const n = $('ctaNote'); n.hidden = !note; n.textContent = note||'';
}
function notice(msg){ $('notice').hidden = !msg; $('notice').textContent = msg || ''; }

// ─── 0 : στοιχεία επιχείρησης — μία φορά, μετά από την κεφαλίδα ─────
// Αριθμός προσφοράς: δίνεται στο πρώτο PDF αυτής της προσφοράς (νέο PDF της ίδιας προσφοράς κρατά τον ίδιο).
// quoteId: το σταθερό id (uuid) της προσφοράς που φτιάχνεται — ίδιο σε κάθε νέο PDF της και σε κάθε κινητό (docs/sync.md).
let PROFILE = loadProfile(), quoteNo = null, quoteId = null, profileBack = null;
let quoteSync = null;      // ο συγχρονισμός των προσφορών· στήνεται μετά τον λογαριασμό (πιο κάτω)
// Λογότυπο: id αποθηκευμένου ή (μόνο στη μνήμη, αν η συσκευή δεν το χώρεσε) data URL· αλλιώς τα αρχικά.
const logoSrc = v => typeof v === 'string' && v.startsWith('data:image/') ? v : getLogo(v);
const logoHtml = (name, logo) => { const src = logoSrc(logo); return src ? `<img src="${esc(src)}" alt="">` : esc(initials(name)); };
function renderBrand(){
  const p = authLocked ? null : PROFILE;      // κλειδωμένη: κανένα στοιχείο της επιχείρησης στην κεφαλίδα
  $('brandLogo').innerHTML = p ? logoHtml(p.name, p.logo) : '';
  $('brandLogo').hidden = !p;
  $('brandName').textContent = p?.name || 'ergolav';
  $('brandTrade').textContent = p?.trade || '';
}
// back: τι γίνεται μετά την αποθήκευση (null = αρχική οθόνη).
function openProfile(back){
  profileBack = back;
  const p = PROFILE || {};
  $('pfName').value = p.name || ''; $('pfTrade').value = p.trade || ''; $('pfPhone').value = p.phone || '';
  pfLogo = p.logo || ''; syncLogoPreview();
  $('pfError').hidden = true;
  $('pfRules').hidden = !PROFILE;
  show('s-profile', 'Τα στοιχεία σου');
  cta(null);
}
// Λογότυπο στη φόρμα: '' = κανένα, id = το αποθηκευμένο, data URL = νέα εικόνα (μικραίνει στο κινητό, χωρίς EXIF).
let pfLogo = '';
function syncLogoPreview(){
  $('pfLogoPreview').innerHTML = logoHtml($('pfName').value || '?', pfLogo);
  $('pfLogoRemove').hidden = !pfLogo;
  $('pfLogoPick').textContent = pfLogo ? 'Άλλαξε εικόνα' : 'Διάλεξε εικόνα';
}
$('pfLogoPick').onclick = () => $('pfLogoInput').click();
$('pfLogoInput').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  try {
    pfLogo = (await fitImage(file, {max: 320, type: file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality: 0.85})).url;
    $('pfError').hidden = true;
  } catch(err) { $('pfError').hidden = false; $('pfError').textContent = err.message; }
  syncLogoPreview();
};
$('pfLogoRemove').onclick = () => { pfLogo = ''; syncLogoPreview(); };
$('pfName').addEventListener('input', () => { if(!pfLogo) syncLogoPreview(); });
$('pfSave').onclick = () => {
  const r = saveProfile({name: $('pfName').value, trade: $('pfTrade').value, phone: $('pfPhone').value, logo: pfLogo});
  if(r.error){
    $('pfError').hidden = false; $('pfError').textContent = r.error;
    $({name: 'pfName', phone: 'pfPhone', logo: 'pfLogoPick'}[r.field]).focus();
    return;
  }
  PROFILE = r.profile;
  account.profileSaved();      // συνδεδεμένος: τα στοιχεία ανεβαίνουν και στον λογαριασμό (χωρίς ίντερνετ: αργότερα)
  // Η συσκευή δεν χώρεσε το λογότυπο: ισχύει τώρα (μόνο στη μνήμη) και το λέμε.
  if(r.logoLost) PROFILE.logo = pfLogo;
  renderBrand();
  const back = profileBack; profileBack = null;
  if(back) back();
  else { show('s-start', 'Νέα προσφορά'); cta(null); }
  // Η συσκευή δεν τα κράτησε (π.χ. ιδιωτική περιήγηση): ισχύουν τώρα, θα ζητηθούν ξανά — το λέμε, δεν το κρύβουμε.
  if(!r.saved) $('micNote').textContent = 'Τα στοιχεία σου δεν αποθηκεύτηκαν σε αυτή τη συσκευή — ισχύουν μόνο μέχρι να κλείσει η σελίδα.';
  else if(r.logoLost) $('micNote').textContent = 'Το λογότυπο δεν χώρεσε στη μνήμη της συσκευής — ισχύει μόνο μέχρι να κλείσει η σελίδα.';
};
// «Θυμήσου πού είμαι»: συνάρτηση που γυρίζει στην τρέχουσα οθόνη, όπως ήταν (κεφαλίδα → στοιχεία, λογαριασμός).
// Το PDF και η ανάλυση ξαναφτιάχνονται, γιατί η κεφαλίδα τους έχει τα στοιχεία της επιχείρησης.
function returnHere(){
  const cur = document.querySelector('.screen.on')?.id;
  // Από τη φόρμα στοιχείων: αν στο μεταξύ ήρθαν στοιχεία (π.χ. από τον λογαριασμό), στην αρχική.
  if(cur === 's-profile'){ const back = profileBack; return () => back ? openProfile(back) : PROFILE ? toStart() : openProfile(null); }
  const step = $('step').textContent, c = {hidden: $('cta').hidden, label: $('ctaBtn').textContent, fn: $('ctaBtn').onclick,
    disabled: $('ctaBtn').disabled, note: $('ctaNote').hidden ? '' : $('ctaNote').textContent};
  return () => {
    if(cur === 's-pdf') return SHOWN?.fromHistory ? openSaved(SHOWN.no) : buildPdf();
    if(cur === 's-analysis'){ buildPdf(); return analysisPanel.open(); }
    show(cur, step);
    if(c.hidden) cta(null); else cta(c.label, c.fn, c.disabled, c.note);
  };
}
// Πάτημα στην κεφαλίδα → ίδια φόρμα· μετά επιστροφή εκεί που ήταν (το PDF ξαναφτιάχνεται με τα νέα στοιχεία).
$('brand').onclick = () => {
  const cur = document.querySelector('.screen.on')?.id;
  if(cur === 's-profile' || mic.listening || authLocked) return;
  openProfile(returnHere());
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
  onError(msg){ if(msg === VOICE_OFFLINE) probe(); review(transcript.textContent, msg); },
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
  // Η αναγνώριση φωνής του browser θέλει συνήθως internet: χωρίς σήμα, κατευθείαν στο κείμενο (ο parser είναι τοπικός).
  if(!online()) return review(initial, VOICE_OFFLINE);
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
$('editText').onclick = () => { listenFrom = 'lines'; review(lastText); focusEnd(transcript); };

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

$('mic').onclick = () => { listenFrom = 'start'; startListening(); };
$('resume').onclick = () => startListening(transcript.textContent.trim());
$('sample').onclick = () => { transcript.textContent = SAMPLE; transcript.oninput(); };
if(!micSupported) $('micNote').textContent = 'Ο browser σου δεν έχει αναγνώριση φωνής — θα μπορείς να το γράψεις.';

// «Πότε πας;» κάτω από τον πελάτη: προεπιλογή «Σήμερα», τίποτα να πατήσει όποιος δεν θέλει. Το «σήμερα» προχωρά τα
// μεσάνυχτα ή όταν ξανανοίξει το κινητό άλλη μέρα (μόνο όσο φαίνεται η αρχική οθόνη).
const when = mountWhen($('when'));
document.addEventListener('visibilitychange', () => { if(!document.hidden) when.refresh(); });
setInterval(() => when.refresh(), 30000);

// Πρώτη φορά (δεν υπάρχουν αποθηκευμένα στοιχεία): «Τα στοιχεία σου» πριν από το μικρόφωνο. Μετά, ποτέ ξανά.
renderBrand();
if(!PROFILE) openProfile(null);
else show('s-start', 'Νέα προσφορά');

// ─── Φωτογραφία σημειώσεων → κατευθείαν στην προσφορά ──────
const shot = $('shot');
let pendingPhoto = null;

$('photo').hidden = !PHOTO_ENABLED;
$('photo').onclick = () => { if(!PHOTO_ENABLED) return; if(!online()){ $('micNote').textContent = NO_NET; return; } getKey() ? $('photoInput').click() : openKey(); };
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
const qtyAsk = l =>
  l.qtyWhy === 'unread' ? `Δεν κατάλαβα την ποσότητα («${esc(l.qtyWord)}») — γράψε πόσα (${esc(l.unit)}):`
  : l.qtyWhy === 'unit' ? `Είπες ${fmtQty(l.qty)} χωρίς μονάδα — είναι ${fmtQty(l.qty)} ${esc(l.unit)};`
  : l.qtyWhy === 'corr' ? `Είπες «${esc(l.qtyWord)}» — έλεγξε την ποσότητα (${esc(l.unit)}):`
  : l.qtyMissing ? `Δεν είπες ποσότητα (${esc(l.unit)}) — γράψε πόσα:` : `${fmtQty(l.qty)} ${esc(l.unit)}; Φαίνεται πολύ — έλεγξε την ποσότητα:`;
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
    ownSuggest(Object.assign(l, {unknown: false, added: true, code: '', mat: 0, lab: 0, customOpen: true})));
  if(!found.length){
    notice('Δεν βρήκα κανένα υλικό. Πες ή γράψε π.χ. «δέκα μέτρα σωλήνα».');
    return;
  }
  LINES = found; TITLE = r.title || 'εργασίες';
  // Νέα ανάλυση = νέα εργασία: ό,τι ειπώθηκε («εργασία 1.200 ευρώ»), αλλιώς η πρόταση του καταλόγου.
  LABOR = r.labor?.cents ?? null; laborVoice = LABOR; laborAsk = r.labor?.ask ?? null; laborBad = false;
  show('s-lines','Έλεγχος');
  priceSync()?.then(r => { if(r && $('s-lines').classList.contains('on')) renderLines(); });
  techSync(); techAskShow();
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
      // Ο λόγος του ελέγχου, με τα λόγια του τεχνίτη: αριθμός χωρίς μονάδα, ποσότητα που δεν διαβάστηκε, διόρθωση με άλλη μονάδα.
      // Ποσότητα που δεν ειπώθηκε ή φαίνεται παράλογη (π.χ. 999, τιμή που διαβάστηκε ως ποσότητα): επιβεβαίωση.
      el.innerHTML = `
        <div class="ln-top"><span class="ln-name">${esc(l.name)}</span></div>
        <div class="ask">${qtyAsk(l)}</div>
        <div class="prices"><label>Ποσότητα (${esc(l.unit)})<input inputmode="decimal" data-p="qty" value="${l.qtyMissing ? '' : String(l.qty).replace('.', ',')}" placeholder="0"><small class="parsed" data-o="qty"></small></label></div>
        <div class="sug-act"><button data-a="ok">Εντάξει</button><button data-a="drop">Βγάλ' το</button></div>`;
      const readQty = numField(el, 'qty', {maxDecimals: 3}, v => `${formatQty(v)} ${l.unit}`);
      el.querySelector('[data-a="ok"]').onclick=()=>{
        const r = readQty();
        if(r.error) return;
        const q = r.value;
        Object.assign(l, {qty: q, qtyMissing: false, qtyCheck: false, qtyWhy: null, qtyWord: null});
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
        ${l.ownAt && l.tier === 'custom' && !l.customOpen ? ownHtml(l) : ''}
        ${l.added && l.lab > 0 && !l.customOpen ? `<p class="hint">Εργασία: ${fmtQty(l.qty)} × ${eur(l.lab)} = ${eur(Math.round(l.qty * l.lab))} · μπαίνει στην «Εργασία για όλη τη δουλειά»${LABOR != null ? ' (εκεί έχεις γράψει δικό σου ποσό· δες την πρόταση)' : ''}</p>` : ''}
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
          <div class="prices"><label>Τιμή υλικού € ανά ${per}<input inputmode="decimal" data-p="cmat" placeholder="0,00" value="${esc(l.customDraft || (l.added && l.tier === 'custom' ? centsText(l.mat) : ''))}"><small class="parsed" data-o="cmat"></small></label>
            ${l.added ? `<label>Εργασία € ανά ${per} <span class="for">(προαιρετικό)</span><input inputmode="decimal" data-p="clab" placeholder="0,00" value="${esc(l.labDraft ?? (l.lab ? centsText(l.lab) : ''))}"><small class="parsed" data-o="clab"></small></label>` : ''}</div>
          <div class="hist" data-hist ${hist.length && !l.customDraft ? '' : 'hidden'}>${hist.map(h => `
            <button class="hi" data-c="${h.c}"><span class="num">${eur(h.c)}</span><span>${ageLabel(h.at)}${(CONFIG.MATERIALS_V2_ENABLED ? ageDays(h.at) > CHECK_DAYS : isStale(h.at)) ? ' · <b>έλεγξε αν άλλαξε</b>' : ''}</span></button>`).join('')}
          </div>
          <div class="sug-act"><button data-a="keep">Κράτα την</button><button data-a="cancel">Άκυρο</button></div>
        </div>` : ''}${refHtml(l, key, per)}${techHtml(l, per)}` : ''}`;
      // Τύπος/μέγεθος: αλλάζει όνομα, κωδικό και τιμή καταλόγου (οι προτάσεις ξαναϋπολογίζονται· η δική του
      // τιμή για αυτόν τον κωδικό φαίνεται στο «Άλλη τιμή», όχι αυτόματα). Η δική του περιγραφή σβήνει: θα έλεγε άλλο είδος.
      const choose = o => {
        Object.assign(l, l.pick(o), {matBase: null, tier: 'normal', customOpen: false, customDraft: '', sizeSaid: null, sizeCheck: null, desc: null});
        checkedCount++; renderLines();
      };
      el.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => choose(l.options[+b.dataset.opt]));
      bindRef(el, l, key);
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
        // Εκτός καταλόγου: προαιρετική εργασία ανά μονάδα → × ποσότητα στην πρόταση της «Εργασίας για όλη τη δουλειά»
        // (αλλιώς χρέωνε λιγότερα χωρίς να το καταλάβει). Δικό του χειροκίνητο ποσό εργασίας δεν αλλάζει.
        const readL = l.added && numField(el, 'clab', {optional: true, allowZero: true}, v => `${formatEur(v)} ανά ${l.unit}`);
        el.querySelector('[data-p="clab"]')?.addEventListener('input', e => { l.labDraft = e.target.value; });
        el.querySelector('[data-a="keep"]').onclick = () => {
          const r = readC();
          if(r.error) return;
          const rl = readL ? readL() : {value: 0, empty: true};
          if(rl.error) return;
          const cents = toCents(r.value);
          if(readL) Object.assign(l, {lab: toCents(rl.value), labDraft: undefined});
          Object.assign(l, {mat: cents, tier: 'custom', customOpen: false, customDraft: '', ownAt: null});
          remember(key, cents);
          if(l.added){ registerCustom(l, key); priceSync(true); }   // εκτός καταλόγου → αυτόματα στον εβδομαδιαίο έλεγχο τιμών
          techAfterKeep(l, cents);                                    // TECH_PRICES_ENABLED: μόνο με συγκατάθεση
          checkedCount++; renderLines();
        };
        el.querySelector('[data-a="cancel"]').onclick = () => {
          Object.assign(l, {customOpen: false, customDraft: '', labDraft: undefined});
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
// Η προσφορά που φαίνεται στην προεπισκόπηση (και στέλνεται): στιγμιότυπο, ίδιο με αυτό που μπαίνει στο ιστορικό,
// ώστε από το ιστορικό να ξαναβγαίνει ακριβώς το PDF που πήρε ο πελάτης.
let SHOWN = null;
// Ημερομηνία (δεν τυπώνεται στο PDF): ό,τι έδειχνε το «Πότε πας;» όταν έφυγε από την αρχική οθόνη. Κατάσταση: «Πρόχειρη»
// μέχρι να σταλεί· νέο PDF της ίδιας προσφοράς κρατά την κατάσταση που είχε.
function quoteData(){
  return {id: quoteId, no: quoteNo, at: Date.now(), title: TITLE, client: $('client').value.trim(), vatRate, sum: sums(),
    rows: okLines().map(l => ({name: l.desc || l.name, qty: l.qty, unit: l.unit, mat: matOf(l)})),
    profile: {name: PROFILE.name, trade: PROFILE.trade, phone: PROFILE.phone, ...(PROFILE.logo && {logo: PROFILE.logo})},
    ...when.value(), status: getQuote(quoteId)?.status ?? 'draft'};
}
// Κεφαλίδα του PDF (λογότυπο, στοιχεία, αριθμός, ημερομηνία): ίδια στην προσφορά και στην ανάλυση εργασιών.
function pdfHead(q){
  const p = q.profile;
  const contact = p.phone ? `Τηλ. ${p.phone}` : '';
  return `
    <div class="pdf-head">
      <div style="display:flex;gap:10px;align-items:center"><div class="logo">${logoHtml(p.name, p.logo)}</div>
        <div><b>${esc(p.name)}</b>${p.trade ? `<div style="color:#5E646B;font-size:12px">${esc(p.trade)}</div>` : ''}${contact ? `<div style="color:#5E646B;font-size:12px">${esc(contact)}</div>` : ''}</div></div>
      <div style="text-align:right;color:#5E646B;font-size:12px">Αρ. <span class="qno">${q.no}</span><br>${new Date(q.at).toLocaleDateString('el-GR')}</div>
    </div>`;
}
function renderPdf(q){
  const s = q.sum;
  $('pdf').innerHTML = `${pdfHead(q)}
    <h2>Προσφορά: ${esc(q.title)}</h2>
    <div class="who">Προς: ${q.client ? esc(q.client) : '—'}</div>
    <table>
      <tr><th>Περιγραφή</th><th class="r">Υλικό</th></tr>
      ${q.rows.map(r=>`<tr><td>${esc(r.name)}<div class="q">${fmtQty(r.qty)} ${esc(r.unit)}</div></td><td class="num">${r.mat > 0 ? eur(r.mat) : 'στην εργασία'}</td></tr>`).join('')}
    </table>
    <div class="sum num">
      <div><span>Υλικά</span><span>${eur(s.mat)}</span></div>
      <div><span>Εργασία</span><span>${eur(s.lab)}</span></div>
      <div><span>Καθαρή αξία</span><span>${eur(s.net)}</span></div>
      <div><span>ΦΠΑ ${q.vatRate}%</span><span>${eur(s.vat)}</span></div>
      <div class="g"><span>Σύνολο</span><span>${eur(s.total)}</span></div>
    </div>
    <p class="foot">Η προσφορά ισχύει για 15 ημέρες. Περιλαμβάνει υλικά και εργασία τοποθέτησης.</p>`;
}
// Νέα προσφορά → PDF, και μπαίνει (ή ενημερώνεται, ίδιος αριθμός) στο ιστορικό.
function buildPdf(){
  companionFile=null;shareSelection=[];
  installationPanel?.reset();
  analysisPanel?.reset();
  // Χωρίς στοιχεία επιχείρησης δεν βγαίνει PDF: πρώτα η φόρμα, μετά το PDF.
  if(!PROFILE) return openProfile(buildPdf);
  if(quoteNo == null){ quoteNo = takeQuoteNo(); quoteId = newId(); }
  SHOWN = quoteData();
  SHOWN.unsaved = !saveQuote(SHOWN);
  if(!SHOWN.unsaved) quoteSync?.changed(quoteId);   // ανεβαίνει στον λογαριασμό στο παρασκήνιο
  if(!SHOWN.unsaved) askPersist();           // μία φορά: «μη σβήνεις τα δεδομένα» (docs/offline.md)
  show('s-pdf','Προεπισκόπηση');
  pdfMode(false);
  renderPdf(SHOWN);
  preparePdf();
}
// Προσφορά από το ιστορικό: ίδιο PDF (ίδιος αριθμός, ημερομηνία, στοιχεία), για να το ξαναδεί ή να το ξαναστείλει.
// Η «Ανάλυση εργασιών με AI» αφορά την προσφορά που φτιάχνεται τώρα, γι' αυτό εδώ δεν εμφανίζεται.
// key: το id της προσφοράς (ή ο αριθμός, για ό,τι δεν έχει ακόμα id).
function openSaved(key){
  const q = getQuote(key);
  if(!q) return calendar.open();
  companionFile=null;shareSelection=[];
  installationPanel?.reset();
  analysisPanel?.reset();
  SHOWN = {...q, fromHistory: true};
  show('s-pdf', `Προσφορά ${q.no}`);
  pdfMode(true);
  renderPdf(SHOWN);
  preparePdf();
}
function pdfMode(fromHistory){
  $('histBack').hidden = !fromHistory;
  $('pdfTitle').textContent = fromHistory ? `Προσφορά Αρ. ${SHOWN.no}` : 'Έτοιμη για τον πελάτη';
  document.querySelector('#s-pdf .installation-entry').hidden = fromHistory || !AI_ANALYSIS_ENABLED;
  // Η ανάλυση εργασιών βγαίνει από τις γραμμές της προσφοράς που φτιάχνεται τώρα (το ιστορικό κρατά μόνο το PDF).
  $('anEntry').hidden = fromHistory;
  if(!fromHistory) analysisPanel.refreshEntry();
}

// ─── Ημερολόγιο (πρώην ιστορικό): οι προσφορές της συσκευής στη μέρα που πάει ο τεχνίτης ───
// Οι παλιές προσφορές (πριν από το ημερολόγιο) μπαίνουν στη μέρα δημιουργίας τους· αντίγραφο πρώτα, μία φορά.
// ── Τιμές προμηθευτών (εβδομαδιαίος έλεγχος, src/price-watch.js): μόνο ενημέρωση· ο τεχνίτης αποφασίζει ──
const priceSync = createPriceSync(() => authUi?.db?.() ?? null);
migrateCustom(loadAll());
// MATERIALS_V2: είδος εκτός καταλόγου που έχει ξαναγράψει με δική του τιμή → η τιμή του προτείνεται αυτόματα (με την
// ημερομηνία της)· αλλάζει με «Άλλη τιμή». Χωρίς το flag: όπως πριν (κενό πεδίο, οι παλιές τιμές ως κουμπιά).
function ownSuggest(l){
  if(!CONFIG.MATERIALS_V2_ENABLED) return l;
  const own = ownPrice(priceKey(l));
  return own ? Object.assign(l, {mat: own.cents, lab: own.lab, tier: 'custom', customOpen: false, ownAt: own.at}) : l;
}
function ownHtml(l){
  const d = priceDate(l.ownAt);
  return d ? `<p class="hint">Η δική σου τιμή · ${esc(d.text)}${d.check ? ' · <b class="chk">έλεγξέ την</b>' : ''}</p>` : '';
}
/** Γραμμή κατάστασης της τιμής προμηθευτών· με MATERIALS_V2: «τιμή από …» και «έλεγξέ την» μετά από 30 ημέρες. */
function refLine(r, status){
  const d = CONFIG.MATERIALS_V2_ENABLED && r?.cents > 0 ? priceDate(r.at) : null;
  if(!d) return status ? esc(status) : '';
  const how = r.status === 'verified' ? `${r.n} ${r.n === 1 ? 'προμηθευτής' : 'προμηθευτές'}` : 'λίγες τιμές στον τελευταίο έλεγχο';
  return `${esc(d.text)} · ${esc(how)}${d.check ? ' · <b class="chk">έλεγξέ την</b>' : ''}`;
}
// MATERIALS_V2: τιμές των λιστών υλικών (src/material-prices.json) για γραμμές εκτός καταλόγου. Φορτώνονται ΜΟΝΟ με το flag
// (δυναμικό import + fetch, έξω από το precache)· χωρίς το flag δεν κατεβαίνει τίποτα. Ίδια μονάδα με τη γραμμή, αλλιώς τίποτα.
let materialPrices = null, materialLookup = null;
if(CONFIG.MATERIALS_V2_ENABLED){
  Promise.all([import('./material-prices.js'), fetch('src/material-prices.json').then(r => r.ok ? r.json() : null)])
    .then(([m, data]) => { materialLookup = m.materialRefFor; materialPrices = data; if($('s-lines').classList.contains('on')) renderLines(); })
    .catch(() => {});
}
function refOf(l, key){
  const r = refFor(key);
  if(r || !l.added || !materialLookup || !materialPrices) return r;
  const m = materialLookup(materialPrices, `${l.desc || l.name} ${l.said || ''}`);
  return m && m.unit === l.unit ? m : null;
}
// ── Τιμές από τεχνικούς (TECH_PRICES_ENABLED, docs/technician-prices.md) ──
// Χωρίς το flag: τίποτα δεν φορτώνεται, τίποτα δεν φαίνεται, τίποτα δεν στέλνεται. Με το flag: μόνο συνδεδεμένοι, μόνο με
// ρητή συγκατάθεση (ερώτηση μία φορά, τη 2η «δική μου τιμή» σε υλικό της λίστας· διακόπτης στον λογαριασμό).
var tech = null, techKeys = null, techBusy = null;     // var: η show() μπορεί να κληθεί πριν από αυτή τη γραμμή
if(CONFIG.TECH_PRICES_ENABLED){
  Promise.all([import('./tech-prices.js'), fetch('src/material-keys.json').then(r => r.ok ? r.json() : null)])
    .then(([m, keys]) => { tech = m; techKeys = keys; bindTech(); techSync(); })
    .catch(() => {});
}
const signedIn = () => !!authUi?.userId?.();
const techKeyOf = l => tech && techKeys ? tech.matchVariant(techKeys, `${l.desc || l.name} ${l.said || ''}`, l.unit) : null;
function techStat(l){ if(!tech || !signedIn()) return null; const k = techKeyOf(l); return k ? tech.statFor(k) : null; }
function techSync(){
  if(!tech) return null;
  if(!signedIn()){ tech.forgetStats(); return null; }          // χωρίς λογαριασμό δεν φαίνονται οι μέσες τιμές
  if(techBusy || !online()) return techBusy;
  techBusy = (async () => {
    try { const db = await authUi.db(); if(db){ await tech.pullConsent(db); await tech.flush(db); await tech.pullStats(db); } }
    catch {} finally { techBusy = null; }
    if($('s-lines').classList.contains('on')) renderLines();
  })();
  return techBusy;
}
function techAfterKeep(l, cents){
  if(!tech) return;
  const key = techKeyOf(l);
  if(!key) return;
  tech.noteKeep(); tech.enqueue(key, l.unit, cents);
  techSync(); techAskShow();
}
function techAskShow(){
  if(!tech) return;
  $('techAsk').hidden = !(signedIn() && tech.shouldAsk(tech.load()));
}
function techHtml(l, per){
  const st = techStat(l);
  if(!st) return '';
  const when = st.at ? new Date(st.at).toLocaleDateString('el-GR', {month: 'numeric', year: 'numeric'}) : '';
  return `<div class="refp tech"><div class="refp-top"><span>Μέση τιμή από τεχνικούς</span><span class="num"><b>${eur(st.cents)}</b><small>/${per} χωρίς ΦΠΑ</small></span></div>
    <small class="refp-st">${esc(tech.BAND_TEXT[st.band] || '')}${st.region ? ' · ' + esc(tech.regionName(st.region)) : ''}${when ? ' · τιμή από ' + esc(when) : ''}</small>
    <div class="refp-act">${l.tier === 'custom' && l.mat === st.cents ? '<small>Τη χρησιμοποιείς σε αυτή τη γραμμή.</small>' : '<button class="linkbtn" data-a="tech-use">Βάλ’ αυτή την τιμή</button>'}</div></div>`;
}
function techAccount(){
  const box = $('techBox');
  box.hidden = !(tech && signedIn());
  if(box.hidden) return;
  const s = tech.load(), sel = $('techRegion');
  $('techTitle').textContent = 'Τιμές από τεχνικούς';
  $('techText').textContent = tech.CONSENT_TEXT.body;
  $('techOn').checked = s.consent === true;
  if(sel.options.length === 1) for(const [code, name] of tech.REGIONS) sel.add(new Option(name, code));
  sel.value = s.region || '';
  $('techRegionWrap').hidden = s.consent !== true;
  $('techStatus').textContent = '';
}
let techBound = false;
function bindTech(){
  if(techBound) return; techBound = true;
  $('techAskTitle').textContent = tech.CONSENT_TEXT.title;
  $('techAskText').textContent = tech.CONSENT_TEXT.body;
  const consent = async (on, region) => {
    if(!online()) throw new Error('offline');
    const db = await authUi.db(); if(!db) throw new Error('signed-out');
    await tech.setConsent(db, on, region);
  };
  $('techYes').onclick = async () => {
    try {
      await consent(true, null);
      // οι δικές του τιμές αυτής της προσφοράς (όχι οι «Βάλ’ αυτή την τιμή») μπαίνουν τώρα στην ουρά
      for(const l of LINES) if(l.tier === 'custom' && l.mat > 0 && !l.ownAt){ const k = techKeyOf(l); if(k) tech.enqueue(k, l.unit, l.mat); }
      $('techAsk').hidden = true; techSync();
    } catch { $('techAskText').textContent = 'Δεν αποθηκεύτηκε (χρειάζεται σήμα και σύνδεση). Θα σε ξαναρωτήσουμε.'; }
  };
  $('techNo').onclick = () => { tech.decline(); $('techAsk').hidden = true; };
  $('techOn').onchange = async () => {
    const on = $('techOn').checked;
    $('techStatus').textContent = on ? 'Αποθήκευση…' : 'Σβήνονται οι τιμές που έστειλες…';
    try {
      await consent(on, on ? $('techRegion').value || null : null);
      $('techStatus').textContent = on ? 'Ενεργό. Ευχαριστούμε!' : 'Έκλεισε. Όλες οι τιμές που έστειλες σβήστηκαν.';
      $('techRegionWrap').hidden = !on;
    } catch { $('techOn').checked = !on; $('techStatus').textContent = 'Δεν έγινε: χρειάζεται σήμα και σύνδεση.'; }
  };
  $('techRegion').onchange = async () => {
    try { await consent(true, $('techRegion').value || null); $('techStatus').textContent = 'Η περιφέρεια αποθηκεύτηκε.'; }
    catch { $('techStatus').textContent = 'Δεν έγινε: χρειάζεται σήμα και σύνδεση.'; }
  };
}
function refHtml(l, key, per){
  const r = refOf(l, key), status = refStatus(r), line = refLine(r, status);
  if(!r || (!status && !(r.cents > 0))) return '';
  const using = l.tier === 'custom' && l.mat === r.cents;
  return `<div class="refp">${r.cents > 0 ? `<div class="refp-top"><span>Τιμή αγοράς προμηθευτών${r.label ? ' <small>(λίστα υλικών)</small>' : ''}</span><span class="num"><b>${eur(r.cents)}</b><small>/${per} χωρίς ΦΠΑ</small></span></div>` : ''}
    ${line ? `<small class="refp-st">${line}</small>` : ''}
    ${r.cents > 0 ? `<div class="refp-act">${using ? '<small>Τη χρησιμοποιείς σε αυτή τη γραμμή.</small>' : '<button class="linkbtn" data-a="ref-use">Βάλ’ αυτή την τιμή</button>'}${r.id ? '<button class="linkbtn" data-a="ref-more" aria-expanded="false">Σύγκριση</button>' : ''}</div><div class="refp-list" hidden></div>` : ''}</div>`;
}
function bindRef(el, l, key){
  const tu = el.querySelector('[data-a="tech-use"]'), ts = tu && techStat(l);
  if(tu && ts) tu.onclick = () => {                  // η μέση τιμή ΔΕΝ ξαναστέλνεται ως «δική του» (δεν περνά από το «Κράτα την»)
    Object.assign(l, {mat: ts.cents, tier: 'custom', customOpen: false, customDraft: '', ownAt: null});
    remember(key, ts.cents);
    checkedCount++; renderLines();
  };
  const r = refOf(l, key);
  const use = el.querySelector('[data-a="ref-use"]'), more = el.querySelector('[data-a="ref-more"]');
  if(use) use.onclick = () => {
    Object.assign(l, {mat: r.cents, tier: 'custom', customOpen: false, customDraft: '', ownAt: null});
    remember(key, r.cents);
    if(l.added) registerCustom(l, key);
    checkedCount++; renderLines();
  };
  if(more) more.onclick = async () => {
    const box = el.querySelector('.refp-list'), open = box.hidden;
    box.hidden = !open; more.setAttribute('aria-expanded', String(open));
    if(!open || box.dataset.loaded) return;
    if(!online()){ box.textContent = NO_NET; return; }
    box.textContent = 'Φορτώνω…';
    try {
      const db = await authUi?.db?.();
      const list = db ? await offersFor(db, r.id) : [];
      box.dataset.loaded = '1';
      box.innerHTML = list.length ? `<ul>${list.map(o => `<li><span><b>${esc(o.supplier_id)}</b> · <a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.name)}</a>${o.promo ? ' <small>(ήταν σε προσφορά· μετρά η κανονική τιμή)</small>' : ''}</span><span class="num">${eur(o.unit_cents)}<small>/${esc(l.unit)}</small></span></li>`).join('')}</ul><small>Κανονικές τιμές, ανά μονάδα, χωρίς ΦΠΑ. Η εικόνα κάθε προμηθευτή: ${list[0] ? new Date(list[0].retrieved_at).toLocaleDateString('el-GR') : ''}.</small>`
        : db ? 'Δεν υπάρχουν τιμές για σύγκριση αυτή τη στιγμή.' : 'Η σύγκριση θέλει σύνδεση στον λογαριασμό.';
    } catch { box.textContent = 'Δεν φόρτωσε η σύγκριση. Δοκίμασε ξανά με σήμα.'; delete box.dataset.loaded; }
  };
}
priceSync();
migrateQuotes();
ensureIds();          // σταθερό id σε κάθε αποθηκευμένη προσφορά (μία φορά· docs/sync.md)
const syncHistoryButton = () => {
  const n = listQuotes().length;
  $('startNav').hidden = !n;
  $('quotesOpen').textContent = `📋 Προσφορές (${n})`;
};
const calendar = mountCalendar({show, cta, onOpen: key => { $('histBack').textContent = calendar.view === 'list' ? '← Προσφορές' : '← Ημερολόγιο'; openSaved(key); }, onNew: () => fresh(),
  onChange: () => { syncHistoryButton(); quoteSync?.changed(); }});
$('historyOpen').onclick = () => calendar.open({view: 'month'});
$('quotesOpen').onclick = () => calendar.open({view: 'list'});
$('statsOpen').onclick = () => calendar.open({view: 'stats'});
$('histBack').onclick = () => calendar.open({reset: false});     // πίσω εκεί που ήταν (μήνας, μέρα, προβολή)
$('histNew').onclick = () => fresh();
syncHistoryButton();

// ─── 5 : αποστολή ────────────────────────────────────────────
// Το PDF φτιάχνεται μόλις ανοίξει η προεπισκόπηση, ώστε το «Στείλε» να ανοίγει αμέσως το μενού
// κοινοποίησης (οι browsers το επιτρέπουν μόνο αμέσως μετά από πάτημα).
let pdfFile = null,companionFile=null,shareSelection=[];
// pdfWait: το PDF της προσφοράς που ετοιμάζεται (η ανάλυση εργασιών περιμένει και αυτό πριν το «Στείλε και τα δύο»).
let pdfWait = null;
const quoteFile = () => (pdfWait || Promise.resolve()).then(() => pdfFile, () => null);
// Όνομα αρχείου με λατινικούς: κάποιοι browsers απορρίπτουν ελληνικά ονόματα στο κατέβασμα.
const GR = {α:'a',β:'v',γ:'g',δ:'d',ε:'e',ζ:'z',η:'i',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',
  ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',φ:'f',χ:'ch',ψ:'ps',ω:'o'};
const greeklish = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ου/g, 'ou').replace(/Ου/g, 'Ou').replace(/ΟΥ/g, 'OU')
  .replace(/./g, c => { const l = c.toLowerCase(), t = GR[l]; return t ? (c === l ? t : t[0].toUpperCase() + t.slice(1)) : c; });
// Όνομα, κείμενο και αριθμός από την προσφορά που φαίνεται (νέα ή από το ιστορικό).
const clientName = () => (SHOWN?.client || '').split(',')[0].trim() || 'Πελάτης';
const shareText = () =>
  `Καλησπέρα σας, σας στέλνω την προσφορά για ${SHOWN.title}. Σύνολο ${eur(SHOWN.sum.total)} με ΦΠΑ.`;

async function preparePdf(){
  pdfFile = null;
  cta('Ετοιμάζω το PDF…', null, true);
  const name = `Prosfora-${SHOWN.no}-${greeklish(clientName())}`.replace(/[^\w.-]+/g, '-').replace(/-+$/, '') + '.pdf';
  const job = pdfWait = makePdf($('pdf'), name);
  try {
    const file = await job;
    if(pdfWait !== job) return;
    pdfFile = file;
    if(onPdfScreen()) quoteCta();
  } catch (e) {
    if(pdfWait !== job) return;
    pdfWait = null;
    if(onPdfScreen()) cta('Δοκίμασε ξανά', preparePdf, false, e.message || 'Δεν έγινε το PDF.');
  }
}
const onPdfScreen = () => $('s-pdf').classList.contains('on');
function quoteCta(){
  if(!pdfFile) return pdfWait ? cta('Ετοιμάζω το PDF…', null, true) : preparePdf();
  // Η συσκευή δεν κράτησε την προσφορά (π.χ. ιδιωτική περιήγηση): το λέμε, δεν το κρύβουμε.
  cta(companionFile?'Στείλε και τα δύο PDF':SHOWN.fromHistory?'Στείλε ξανά στον πελάτη':'Στείλε στον πελάτη', sendPdf, false,
    SHOWN.unsaved ? 'Δεν αποθηκεύτηκε στο ιστορικό αυτής της συσκευής.' : '');
}

// Στάλθηκε: η «Πρόχειρη» γίνεται «Στάλθηκε». Ποτέ δεν πειράζει «Κλείστηκε»/«Χάθηκε» (ξαναστάλθηκε μια παλιά).
function markSent(){
  const key = SHOWN?.id ?? SHOWN?.no;
  if(SHOWN?.unsaved || getQuote(key)?.status !== 'draft') return;
  if(updateQuote(key, {status: 'sent'})){ SHOWN.status = 'sent'; quoteSync?.changed(SHOWN.id); }
}
async function sendPdf(){
  if(!pdfFile)return;
  shareSelection=companionFile?[pdfFile,companionFile]:[pdfFile];
  const extra=shareSelection.length===2;
  const res=await shareFiles(shareSelection,{title:`Προσφορά ${SHOWN.no} — ${clientName()}`,text:shareText()+(extra?' Μαζί επισυνάπτεται η αναλυτική περιγραφή εργασιών.':'')});
  if(res==='shared'){SHOWN.sent=true;markSent();done('Στάλθηκε',extra?`Η προσφορά και η ανάλυση εργασιών έφυγαν μαζί για ${clientName()}.`:`Η προσφορά έφυγε για ${clientName()}.`);}
  else if(res==='unsupported')openSheet();
}

function openSheet(){
 const extra=shareSelection.length===2;
 $('shareSheetTitle').textContent=extra?'Αποστολή δύο PDF στον πελάτη':'Αποστολή PDF στον πελάτη';
 $('shareSheetNote').textContent=extra?'Αυτός ο browser δεν στέλνει και τα δύο αρχεία απευθείας. Κατέβασέ τα και επισύναψε και τα δύο στο ίδιο μήνυμα.':'Αυτός ο browser δεν στέλνει αρχεία απευθείας. Κατέβασε το PDF και επισύναψέ το στο μήνυμα.';
 $('shareDownloadLabel').textContent=extra?'Κατέβασμα και των δύο PDF':'Κατέβασμα PDF';
 $('shareSeparateDownloads').hidden=!extra;
 $('veil').classList.add('on');$('sheet').classList.add('on');
}
function closeSheet(){ $('veil').classList.remove('on'); $('sheet').classList.remove('on'); }
$('veil').onclick = () => { closeSheet(); closeKey(); };
document.querySelectorAll('[data-send]').forEach(b => b.onclick = () => {
  closeSheet();
  const files=shareSelection.length?shareSelection:[pdfFile],extra=files.length===2;
  const how = b.dataset.send, text = encodeURIComponent(shareText()+(extra?' Επισυνάπτω και την αναλυτική περιγραφή εργασιών.':''));
  files.forEach(download);
  SHOWN.sent = true;
  markSent();   // κατέβηκε για να σταλεί (Viber, WhatsApp, email ή με το χέρι): δεν μαθαίνουμε αν έφυγε, το θεωρούμε σταλμένο
  // Χωρίς σήμα το wa.me (ιστοσελίδα) δεν ανοίγει: κατευθείαν η εφαρμογή του WhatsApp.
  if(how === 'whatsapp'){ if(online()) window.open(`https://wa.me/?text=${text}`, '_blank'); else location.href = `whatsapp://send?text=${text}`; }
  if(how === 'viber') location.href = `viber://forward?text=${text}`;
  if(how === 'email') location.href = `mailto:?subject=${encodeURIComponent(pdfFile.name.replace(/\.pdf$/, ''))}&body=${text}`;
  done(extra?'Τα δύο PDF ετοιμάστηκαν για λήψη':'Το PDF κατέβηκε',extra?'Επισύναψε την προσφορά και την ανάλυση στο ίδιο μήνυμα. Αν ο browser μπλοκάρει τη δεύτερη λήψη, πάτησε αποστολή ξανά και κατέβασέ τα ένα-ένα.':how==='download'?'Βρίσκεται στις Λήψεις. Στείλε το στον πελάτη από όποια εφαρμογή θέλεις.':'Επισύναψε το PDF από τις Λήψεις στο μήνυμα που άνοιξε.');
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
$('again').onclick = () => fresh();

$('downloadOfferOnly').onclick=()=>{if(pdfFile)download(pdfFile)};
$('downloadAnalysisOnly').onclick=()=>{if(companionFile)download(companionFile)};
installationPanel=mountInstallation(()=>({number:quoteNo,lines:okLines().map(l=>({desc:l.desc,name:l.name,qty:l.qty,unit:l.unit}))}),{onReady:file=>{companionFile=file;analysisPanel?.detach();if(pdfFile)cta('Στείλε και τα δύο PDF',sendPdf)},onDiscard:()=>{companionFile=null;if(pdfFile)cta('Στείλε στον πελάτη',sendPdf)},onShare:sendPdf});

// Ανάλυση εργασιών (δεύτερο PDF) από τις έτοιμες αναλύσεις, με «Άλλαξέ το» και «Οι κανόνες μου».
analysisPanel = mountAnalysis({
  show, cta,
  quote: () => ({no: SHOWN.no, at: SHOWN.at, client: SHOWN.client, profile: SHOWN.profile, lines: okLines(), status: getQuote(SHOWN.id ?? SHOWN.no)?.status ?? SHOWN.status, voice: lastText}),
  head: () => pdfHead(SHOWN),
  fileName: () => `Analysi-Ergasion-${SHOWN.no}-${greeklish(clientName())}`.replace(/[^\w.-]+/g, '-').replace(/-+$/, '') + '.pdf',
  quoteFile,
  onReady: file => { companionFile = file; installationPanel?.reset(); },
  onDiscard: () => { companionFile = null; if(onPdfScreen()) quoteCta(); },
  onSend: sendPdf,
  onBack: () => { show('s-pdf', 'Προεπισκόπηση'); analysisPanel.refreshEntry(); quoteCta(); },
  db: () => authUi?.db?.() ?? null,
});
const syncRulesButton = () => {
  const n = analysisPanel.rulesCount();
  $('rulesOpen').hidden = !n;
  $('rulesOpen').textContent = `Οι κανόνες μου (${n})`;
};
$('rulesOpen').onclick = () => analysisPanel.openRules(() => { show('s-start', 'Νέα προσφορά'); cta(null); syncRulesButton(); });
$('pfRules').onclick = () => analysisPanel.openRules(() => show('s-profile', 'Τα στοιχεία σου'));
syncRulesButton();

// ─── Λογαριασμός (μόνο με AUTH_ENABLED στο src/config.js· αλλιώς τίποτα δεν αλλάζει) ───
const account = authUi = mountAccount({show, cta, here: returnHere, home: () => toStart(), busy: () => mic.listening,
  needProfile: () => openProfile(null),
  onLogin: () => { offlineUi.iosHint(); quoteSync?.run(); },
  quotes: QUOTES_SYNC_ENABLED ? {pending: () => quoteSync?.pending() ?? 0, flush: () => quoteSync?.run(), wipe: () => { wipeLocalQuotes(); syncHistoryButton(); }} : null,
  onLockChange: v => { authLocked = v; renderBrand(); },
  onProfileChange: () => {
    PROFILE = loadProfile();
    renderBrand();
    // Πρώτο άνοιγμα σε νέο κινητό: η φόρμα στοιχείων δεν χρειάζεται πια.
    if(document.querySelector('.screen.on')?.id === 's-profile' && PROFILE && !profileBack) toStart();
  }});

// ─── Συγχρονισμός προσφορών (Φάση 3, μόνο με QUOTES_SYNC_ENABLED· docs/sync.md) ───
// Η οθόνη διαβάζει πάντα το localStorage· εδώ μόνο το παρασκήνιο: στο άνοιγμα, όταν γυρίσει το σήμα, όταν ο τεχνίτης
// ξαναγυρίσει στην εφαρμογή, και λίγο μετά από κάθε αλλαγή. Χωρίς σήμα ή χωρίς σύνδεση: τίποτα.
quoteSync = QUOTES_SYNC_ENABLED && account.enabled ? createQuoteSync({
  getDb: () => account.db(),
  userId: () => account.userId?.() ?? null,
  onState: st => {
    const el = $('syncState');
    el.hidden = st === 'off';
    el.dataset.state = st;
    el.textContent = st === 'ok' ? '✓ Συγχρονίστηκε' : 'Θα συγχρονιστεί όταν έχεις σήμα';
  },
  onPulled: () => {
    syncHistoryButton();
    if(document.querySelector('.screen.on')?.id === 's-history') calendar.open({reset: false});
  },
}) : null;
if(quoteSync){
  quoteSync.settle();
  quoteSync.run();
  onNet(on => { if(on) quoteSync.run(); });
  document.addEventListener('visibilitychange', () => { if(!document.hidden) quoteSync.run(); });
}

// ─── «Πίσω»: μία οθόνη πίσω, χωρίς να χαθεί τίποτα ───────────
// Στις οθόνες που έχουν ήδη δικό τους «← Πίσω» κάνει ακριβώς το ίδιο. Από το PDF πίσω στον έλεγχο, οι γραμμές μένουν
// όπως τις άφησε (καμία νέα ανάλυση). Από το κείμενο πάντα στην αρχική. Κείμενο που θα σβηνόταν: ερώτηση.
function toStart(){ show('s-start', 'Νέα προσφορά'); cta(null); when.refresh(); syncHistoryButton(); }
function toLines(){ show('s-lines', 'Έλεγχος'); renderLines(); }
async function goBack(){
  const cur = document.querySelector('.screen.on')?.id;
  if(account.back()) return;      // οθόνες λογαριασμού
  if(cur === 's-listen'){
    const t = (mic.listening ? await mic.stop() : transcript.textContent || '').trim();
    // Πάντα στην αρχική με το μικρόφωνο — όχι ξανά στον έλεγχο. Αν έχει ήδη βγει PDF (έχει αριθμό, ίσως και στάλθηκε),
    // η αρχική ανοίγει ως ΝΕΑ προσφορά: αλλιώς η επόμενη υπαγόρευση θα έπαιρνε τον ίδιο αριθμό και θα έσβηνε την
    // προηγούμενη από το ιστορικό. Ερώτηση μόνο για κείμενο που δεν έχει γίνει ακόμα προσφορά.
    if(quoteNo != null) return fresh();
    if(t && listenFrom !== 'lines' && !confirm('Πίσω στην αρχή; Το κείμενο που έγραψες θα σβηστεί.')) return review(t);
    return toStart();
  }
  if(cur === 's-redact') return $('redactCancel').click();
  if(cur === 's-lines'){ listenFrom = 'lines'; return review(lastText); }
  if(cur === 's-pdf') return SHOWN?.fromHistory ? $('histBack').click() : toLines();
  if(cur === 's-done'){
    if(SHOWN?.fromHistory) return openSaved(SHOWN.no);
    show('s-pdf', 'Προεπισκόπηση'); pdfMode(false); renderPdf(SHOWN); return quoteCta();
  }
  if(cur === 's-analysis') return $('anBack').click();
  if(cur === 's-rules') return $('rulesBack').click();
  if(cur === 's-history') return toStart();
  if(cur === 's-profile'){
    const back = profileBack; profileBack = null;
    if(!PROFILE) return back ? toLines() : undefined;     // χωρίς στοιχεία δεν βγαίνει PDF: πίσω στον έλεγχο
    return back ? back() : toStart();
  }
}
$('navBack').onclick = goBack;
syncBack(document.querySelector('.screen.on')?.id);

// ─── Χωρίς σήμα (src/offline.js): service worker και νέα έκδοση μόνο με «Ανανέωση», που σώζει πρώτα το πρόχειρο ───
// Πρόχειρο = κείμενο + πελάτης της προσφοράς που γράφεται. Αφού βγει PDF, η προσφορά είναι ήδη στο ιστορικό.
registerSW({bar: $('updateBar'), onReady: () => offlineUi.ready(), canLeave: () => leaveOk(), draft: () => {
  const cur = document.querySelector('.screen.on')?.id;
  if(authLocked || quoteNo != null || !['s-listen', 's-lines'].includes(cur)) return null;
  return {screen: cur, client: $('client').value, text: cur === 's-listen' ? transcript.textContent : lastText};
}});
const draft = authLocked ? null : takeDraft();
if(draft){
  $('client').value = draft.client;
  if(draft.screen === 's-lines') buildLines(draft.text);
  else review(draft.text, 'Η εφαρμογή ενημερώθηκε. Το κείμενό σου είναι εδώ.');
}

// Γεμάτη μνήμη (QuotaExceededError): η προσφορά που δεν αποθηκεύτηκε μένει στη μνήμη μέχρι να σταλεί — καμία
// επαναφόρτωση δεν τη σβήνει χωρίς ερώτηση.
const atRisk = () => !!SHOWN && SHOWN.unsaved && !SHOWN.sent && !SHOWN.fromHistory;
let leaving = false;          // ο τεχνίτης απάντησε ήδη «Συνέχεια»: όχι δεύτερη ερώτηση από τον browser
function leaveOk(){
  if(!atRisk()) return true;
  return leaving = confirm('Η προσφορά δεν αποθηκεύτηκε στο κινητό (γέμισε η μνήμη) και δεν έχει σταλεί. Αν συνεχίσεις, θα χαθεί. Συνέχεια;');
}
function fresh(){ if(leaveOk()) location.reload(); }
window.addEventListener('beforeunload', e => { if(atRisk() && !leaving){ e.preventDefault(); e.returnValue = ''; } });
// Συνδεδεμένος από πριν (πριν υπάρξει η οδηγία): μία φορά και σε αυτόν, στο Safari του iPhone.
if(!authLocked && account.enabled && authGate().required) offlineUi.iosHint();
