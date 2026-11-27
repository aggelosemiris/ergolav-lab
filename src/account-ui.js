// Οθόνες λογαριασμού: «Σύνδεση / Νέος λογαριασμός» (με επιβεβαίωση email και «Ξέχασα τον κωδικό»), «Ο λογαριασμός μου»,
// «Ποια στοιχεία κρατάς;» και το κουμπί της κεφαλίδας. Λογική: account.js.
//
// ΥΠΟΧΡΕΩΤΙΚΟΣ λογαριασμός (AUTH_ENABLED = true): χωρίς συνεδρία η εφαρμογή δείχνει ΜΟΝΟ την οθόνη σύνδεσης.
// Η απόφαση παίρνεται χωρίς δίκτυο, από τη συνεδρία που κράτησε η συσκευή (ακόμα και ληγμένη): ο τεχνίτης χωρίς σήμα
// δεν κλειδώνεται ποτέ έξω. Κλείδωμα μόνο όταν ο server πει ότι η συνεδρία δεν ισχύει πια — και τότε ό,τι έγραφε μένει.
// Με AUTH_ENABLED = false (ή χωρίς ρυθμίσεις) δεν κάνει τίποτα: ούτε κουμπί, ούτε φόρτωμα βιβλιοθήκης.
import { createAccount, MSG, needsLatin, passwordCheck, validEmail, throttleText } from './account.js';
import { getLogo, initials, loadProfile } from './profile.js';
import { loadTurnstile, mountWidget } from './turnstile.js';
import * as CONFIG from './config.js';
import { online, onNet, NO_NET } from './net.js';
import { esc } from './html.js';

const SITE_KEY = CONFIG.TURNSTILE_SITE_KEY || '';
export const RESEND_S = 60;          // «Στείλε ξανά» μετά από τόσα δευτερόλεπτα

const $ = id => document.getElementById(id);
const SCREENS = ['s-login', 's-account', 's-pchoice'];
const STRENGTH = {weak: 'Αδύναμος', good: 'Καλός', strong: 'Δυνατός'};

// Πεδία ανά βήμα: ποιο input παίρνει το σφάλμα του account.js (field).
const FIELDS = {
  in: {email: 'inEmail', password: 'inPw'},
  up: {email: 'upEmail', password: 'upPw', repeat: 'upPw2', terms: 'upTerms'},
  confirm: {code: 'cfCode', email: 'cfCode'},
  forgot: {email: 'fgEmail'},
  reset: {code: 'rsCode', password: 'rsPw', repeat: 'rsPw2', email: 'rsCode'},
};
const TITLES = {in: 'Σύνδεση', up: 'Νέος λογαριασμός', confirm: 'Επιβεβαίωση email', forgot: 'Ξέχασα τον κωδικό', reset: 'Νέος κωδικός'};
const SUBMIT = {in: 'Σύνδεση', up: 'Δημιουργία λογαριασμού', confirm: 'Επιβεβαίωση', forgot: 'Στείλε μου κωδικό', reset: 'Αποθήκευση και σύνδεση'};
const LEDE = 'Ο λογαριασμός κρατά τα στοιχεία της επιχείρησής σου και το λογότυπο σε κάθε κινητό σου.';
// Χωρίς σήμα: ό,τι θέλει τον server κλειδώνει (η τοπική αποσύνδεση όχι). «Συνδέθηκε ποτέ εδώ;» για το σωστό μήνυμα.
export const SEEN = 'ergolav.account.seen';
export const FIRST_TIME = 'Την πρώτη φορά σε αυτή τη συσκευή η σύνδεση θέλει σήμα. Μετά το ergolav δουλεύει και χωρίς σήμα.';
const NET_LOGIN = ['lgGoogle', 'lgSubmit', 'lgResend', 'inConfirm'];
const NET_ACCOUNT = ['acctPwOpen', 'acctPwSave', 'acctEmOpen', 'acctEmSend', 'acctEmVerify', 'acctSignOutAll', 'acctDelete', 'acctDelYes', 'acctDelGoogle'];

/**
 * show/cta: της εφαρμογής. here(): «θυμήσου πού είμαι» → συνάρτηση που γυρίζει εκεί.
 * busy(): αν τώρα δεν επιτρέπεται να φύγει από την οθόνη (π.χ. ακούει το μικρόφωνο).
 * home(): η αρχική οθόνη. onProfileChange(): ήρθαν στη συσκευή στοιχεία από τον λογαριασμό.
 * needProfile(): η υποχρεωτική φόρμα «Τα στοιχεία σου» (λογαριασμός ποτέ χωρίς όνομα επιχείρησης).
 * onLockChange(locked): η εφαρμογή κλειδώνει/ξεκλειδώνει τις οθόνες της.
 */
export function mountAccount({show, cta, here, home = () => {}, busy = () => false, onProfileChange = () => {},
  needProfile = () => {}, onLockChange = () => {}, onLogin = () => {}, quotes = null, account = createAccount()}){
  if(!account.enabled) return {enabled: false, locked: () => false, canBack: () => true, back: () => false, profileSaved: async () => ({error: ''}), db: async () => null, userId: () => null};

  let returnTo = null, mode = 'in', email = '', locked = false, resume = null, lockedUser = null;
  let lastUserId = account.user()?.id || null;
  let pending = false, cooldownUntil = 0, throttleUntil = 0, recovered = false, reauthDone = false;
  const now = () => Date.now();
  const current = () => document.querySelector('.screen.on')?.id;
  const leave = () => { const r = returnTo || home; returnTo = null; r(); };
  const msg = (id, text) => { $(id).hidden = !text; $(id).textContent = text || ''; };

  /** Κουμπί σε αναμονή: κλειδωμένο (όχι διπλό πάτημα), με ένδειξη. Επιστρέφει το «τέλος». */
  function working(btn, label){
    const old = btn.textContent; pending = true;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = label;
    return () => { pending = false; btn.removeAttribute('aria-busy'); btn.textContent = old; btn.disabled = false; syncSubmit(); };
  }
  // Σφάλμα δίπλα στο πεδίο (και κόκκινο περίγραμμα)· χωρίς πεδίο, πάνω από τη φόρμα.
  function fieldErr(id, text){
    const e = $(id + 'Err'); if(!e) return;
    e.hidden = !text; e.textContent = text || '';
    $(id).closest('.field')?.classList.toggle('bad', !!text);
    if(text) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
  }
  const clearErrs = root => root.querySelectorAll('.ferr').forEach(e => fieldErr(e.id.slice(0, -3), ''));
  function showError(r, map){
    const id = r.field && map[r.field];
    if(id){ fieldErr(id, r.error); $(id).focus(); }
    else msg(map === FIELDS[mode] ? 'lgError' : 'acctError', r.error);
  }

  // ── Ματάκι σε κάθε πεδίο κωδικού ──
  document.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => {
    const input = $(b.dataset.eye), on = input.type === 'password';
    input.type = on ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού');
  });
  const hidePasswords = () => document.querySelectorAll('[data-eye]').forEach(b => {
    $(b.dataset.eye).type = 'password'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Εμφάνιση κωδικού');
  });
  // Κωδικός 6 ψηφίων: μόνο αριθμοί.
  ['cfCode', 'rsCode', 'acctEmCode'].forEach(id => $(id).addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  }));

  // ── Δύναμη κωδικού + λίστα κανόνων ──
  function syncRules(prefix, pw, repeat){
    const c = passwordCheck(pw, repeat);
    $(prefix + 'Rules').querySelectorAll('li').forEach(li => li.classList.toggle('ok', !!c.rules[li.dataset.r]));
    $(prefix + 'Meter').dataset.s = pw ? c.strength : '';
    $(prefix + 'MeterText').textContent = pw ? STRENGTH[c.strength] : '';
    const hint = needsLatin(pw) ? MSG.latin : '';
    if($(prefix + 'Hint').textContent !== hint) $(prefix + 'Hint').textContent = hint;   // ίδιο κείμενο: καμία νέα ανακοίνωση
    return c;
  }

  // ── Κουμπί κεφαλίδας ──
  document.querySelector('header').classList.add('auth');
  $('pfWhere').textContent = 'Μένουν στη συσκευή και στον λογαριασμό σου, για να έρχονται σε κάθε κινητό σου.';
  const btn = $('acctBtn');
  btn.hidden = false;
  const syncBtn = u => {
    $('acctLabel').textContent = u ? u.name : 'Σύνδεση';
    btn.classList.toggle('on', !!u);
    btn.setAttribute('aria-label', u ? `Ο λογαριασμός μου (${u.name})` : 'Σύνδεση');
  };
  account.onChange(syncBtn);
  syncBtn(account.user());
  btn.onclick = () => {
    if(locked || SCREENS.includes(current()) || busy()) return;
    returnTo = here();
    openAccount();
  };

  // ── Κλείδωμα ──
  function setLocked(v){
    locked = v;
    document.querySelector('header').classList.toggle('locked', v);
    onLockChange(v);
  }

  // ── CAPTCHA (Cloudflare Turnstile): ένα widget ανά οθόνη. Το Google δεν το χρειάζεται. ──
  function captchaFor(boxId, noteId, onChange){
    let w = null, loading = false;
    return {
      token: () => SITE_KEY ? (w?.token() || '') : '',
      ready: () => !SITE_KEY || !!w?.token(),
      reset(){ w?.reset(); onChange(); },
      async ensure(){
        if(!SITE_KEY || w || loading || !online()) return onChange();
        loading = true;
        $(boxId).hidden = false;
        msg(noteId, 'Έλεγχος ασφαλείας…');
        onChange();
        try {
          const ts = await loadTurnstile();
          w = mountWidget(ts, $(boxId), SITE_KEY, {
            onToken: () => { msg(noteId, ''); onChange(); },
            onReset: onChange,
            onError: () => { msg(noteId, MSG.captcha); onChange(); },
          });
        } catch { msg(noteId, MSG.captchaLoad); }
        loading = false;
        onChange();
      },
    };
  }
  const lgCaptcha = captchaFor('lgCaptcha', 'lgCaptchaNote', () => syncSubmit());
  const delCaptcha = captchaFor('acctCaptcha', 'acctCaptchaNote', () => syncDel());

  // ── Οθόνη σύνδεσης: βήματα ──
  const val = id => $(id).value;
  const valid = {
    in: () => true,                                         // σφάλματα δίπλα στα πεδία με το πάτημα
    up: () => validEmail(val('upEmail')) && passwordCheck(val('upPw'), val('upPw2')).ok && $('upTerms').checked,
    confirm: () => /^\d{6}$/.test(val('cfCode')),
    forgot: () => true,
    reset: () => (recovered || /^\d{6}$/.test(val('rsCode'))) && passwordCheck(val('rsPw'), val('rsPw2')).ok,
  };
  const needsCaptcha = m => ['in', 'up', 'forgot'].includes(m);
  function syncSubmit(){
    const s = $('lgSubmit');
    if(pending) return;
    s.disabled = !valid[mode]() || (needsCaptcha(mode) && !lgCaptcha.ready()) || throttleUntil > now();
    const left = Math.ceil((cooldownUntil - now()) / 1000);
    $('lgResend').disabled = left > 0 || !lgCaptcha.ready();
    $('lgResend').textContent = left > 0 ? `Στείλε ξανά (${left}″)` : 'Στείλε ξανά';
    $('inConfirm').disabled = !lgCaptcha.ready();
    syncNet();
  }
  // Χωρίς σήμα: κουμπιά που θέλουν τον server κλειδωμένα, με το μήνυμα. Πρώτη φορά σε αυτή τη συσκευή: γιατί.
  const seen = () => { try { return !!localStorage.getItem(SEEN); } catch { return false; } };
  function syncNet(){
    const off = !online();
    if(off){ [...NET_LOGIN, ...NET_ACCOUNT].forEach(id => { if($(id)) $(id).disabled = true; }); }
    msg('lgNet', off ? (locked && !seen() ? `${NO_NET}. ${FIRST_TIME}` : NO_NET) : '');
    msg('acctNet', off ? NO_NET : '');
  }
  onNet(v => {
    if(v){
      ['lgGoogle', ...NET_ACCOUNT].forEach(id => { if($(id) && !pending) $(id).disabled = false; });
      syncDel();
      if(current() === 's-login') lgCaptcha.ensure();
    }
    syncSubmit();
  });
  // Αντίστροφες μετρήσεις (στείλε ξανά, αναμονή μετά από λάθος κωδικούς): ένα ρολόι για όλες.
  setInterval(() => {
    if(current() !== 's-login') return;
    if(throttleUntil){
      const left = Math.ceil((throttleUntil - now()) / 1000);
      if(left > 0) msg('lgError', throttleText(left)); else { throttleUntil = 0; msg('lgError', ''); }
    }
    syncSubmit();
  }, 1000);

  function setMode(m, {keepMessages = false} = {}){
    mode = m;
    $('lgMain').hidden = !['in', 'up'].includes(m);
    $('pIn').hidden = m !== 'in'; $('pUp').hidden = m !== 'up';
    $('tabIn').setAttribute('aria-selected', String(m === 'in')); $('tabUp').setAttribute('aria-selected', String(m === 'up'));
    $('pConfirm').hidden = m !== 'confirm'; $('pForgot').hidden = m !== 'forgot'; $('pReset').hidden = m !== 'reset';
    $('lgSub').hidden = !['confirm', 'reset'].includes(m);
    $('lgOther').hidden = m === 'reset' && recovered;
    $('rsCode').closest('.field').hidden = recovered;
    $('lgTitle').textContent = TITLES[m];
    $('lgLede').hidden = !['in', 'up'].includes(m);
    $('lgSubmit').textContent = SUBMIT[m];
    if(m !== 'in') $('inConfirm').hidden = true;
    if(!keepMessages){ msg('lgError', throttleUntil > now() ? throttleText(Math.ceil((throttleUntil - now()) / 1000)) : ''); msg('lgStatus', ''); }
    clearErrs($('s-login'));
    hidePasswords();
    show('s-login', TITLES[m]);            // ξανά: συγχρονίζει το «‹ Πίσω» με το βήμα
    cta(null);
    syncSubmit();
  }
  function openLogin({error = '', status = '', m = 'in'} = {}){
    const left = account.throttleLeft();
    throttleUntil = left ? now() + left * 1000 : 0;
    recovered = false;
    setMode(m);
    if(error) msg('lgError', error);
    if(status) msg('lgStatus', status);
    lgCaptcha.ensure();
  }
  $('tabIn').onclick = () => { if(mode !== 'in'){ $('inEmail').value ||= val('upEmail'); setMode('in'); } };
  $('tabUp').onclick = () => { if(mode !== 'up'){ $('upEmail').value ||= val('inEmail'); setMode('up'); } };
  // Πληκτρολόγηση: κανόνες, κουμπί, και καθάρισμα του σφάλματος του πεδίου.
  $('s-login').addEventListener('input', e => {
    if(e.target.id) fieldErr(e.target.id, '');
    if(['upPw', 'upPw2'].includes(e.target.id)) fieldErr('upPw2', ''), fieldErr('upPw', '');
    syncRules('up', val('upPw'), val('upPw2'));
    syncRules('rs', val('rsPw'), val('rsPw2'));
    syncSubmit();
    if(e.target.id === 'cfCode' && /^\d{6}$/.test(e.target.value) && !pending) submit();
  });
  $('s-login').addEventListener('change', e => { if(e.target.id === 'upTerms'){ fieldErr('upTerms', ''); syncSubmit(); } });
  // Λάθη που φαίνονται μόλις φύγει από το πεδίο (όχι σε κάθε πλήκτρο).
  $('upEmail').addEventListener('blur', () => { if(val('upEmail') && !validEmail(val('upEmail'))) fieldErr('upEmail', MSG.badEmail); });
  $('upPw2').addEventListener('blur', () => { if(val('upPw2') && val('upPw2') !== val('upPw')) fieldErr('upPw2', MSG.mismatch); });
  $('rsPw2').addEventListener('blur', () => { if(val('rsPw2') && val('rsPw2') !== val('rsPw')) fieldErr('rsPw2', MSG.mismatch); });
  $('s-login').addEventListener('keydown', e => {
    if(e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && !$('lgSubmit').disabled){ e.preventDefault(); submit(); }
  });

  $('lgGoogle').onclick = async () => {
    if(pending) return;
    msg('lgError', '');
    const done = working($('lgGoogle'), 'Άνοιγμα Google…');
    const r = await account.signInGoogle();     // επιτυχία = η σελίδα πάει στο Google και επιστρέφει μετά
    if(r.error){ done(); msg('lgError', r.error); }
  };

  function startCooldown(){ cooldownUntil = now() + RESEND_S * 1000; syncSubmit(); }
  const sentTo = (id, text) => { $(id).textContent = text; };
  async function submit(){
    if(pending || $('lgSubmit').disabled) return;
    msg('lgError', ''); msg('lgStatus', '');
    const b = $('lgSubmit'), map = FIELDS[mode];
    if(mode === 'in'){
      const done = working(b, 'Σύνδεση…');
      const r = await account.signIn(val('inEmail'), val('inPw'), {captchaToken: lgCaptcha.token()});
      lgCaptcha.reset();                         // κάθε token ισχύει για μία φορά
      done();
      if(r.user) return loggedIn();
      if(r.wait){ throttleUntil = now() + r.wait * 1000; msg('lgError', r.error); return syncSubmit(); }
      $('inConfirm').hidden = !r.notConfirmed;
      if(r.notConfirmed) return msg('lgError', r.error);
      return showError(r, map);
    }
    if(mode === 'up'){
      const done = working(b, 'Δημιουργία…');
      email = val('upEmail').trim().toLowerCase();
      const r = await account.signUp(email, val('upPw'), {captchaToken: lgCaptcha.token(), repeat: val('upPw2'), terms: $('upTerms').checked});
      lgCaptcha.reset();
      done();
      if(r.error) return showError(r, map);
      if(r.user) return loggedIn();
      $('upPw').value = $('upPw2').value = '';
      return toConfirm();
    }
    if(mode === 'confirm'){
      const done = working(b, 'Έλεγχος…');
      const r = await account.confirmSignup(email, val('cfCode'));
      done();
      if(r.error){ $('cfCode').value = ''; return showError(r, map); }
      return loggedIn();
    }
    if(mode === 'forgot'){
      const done = working(b, 'Στέλνω…');
      email = val('fgEmail').trim().toLowerCase();
      const r = await account.requestReset(email, {captchaToken: lgCaptcha.token()});
      lgCaptcha.reset();
      done();
      if(r.error) return showError(r, map);
      recovered = false;
      setMode('reset');
      sentTo('rsSentTo', `Αν υπάρχει λογαριασμός με το ${email}, σου στείλαμε κωδικό 6 ψηφίων. Γράψ' τον και διάλεξε νέο κωδικό.`);
      startCooldown();
      return $('rsCode').focus();
    }
    if(mode === 'reset'){
      const done = working(b, 'Αποθήκευση…');
      if(!recovered){
        const v = await account.verifyReset(email, val('rsCode'));
        if(v.error){ done(); $('rsCode').value = ''; return showError(v, map); }
        recovered = true;                        // ο κωδικός email ισχύει μία φορά: δεν ξαναζητείται
        $('rsCode').closest('.field').hidden = true; $('lgOther').hidden = true;
      }
      const r = await account.setPassword(val('rsPw'), val('rsPw2'));
      done();
      if(r.error) return showError(r, map);
      return loggedIn('Ο νέος κωδικός αποθηκεύτηκε.');
    }
  }
  $('lgSubmit').onclick = submit;

  function toConfirm(){
    setMode('confirm');
    sentTo('cfSentTo', `Σου στείλαμε κωδικό 6 ψηφίων στο ${email}. Γράψ' τον εδώ για να επιβεβαιώσεις το email σου.`);
    $('cfCode').value = '';
    startCooldown();
    $('cfCode').focus();
  }
  $('inForgot').onclick = () => { $('fgEmail').value = val('inEmail'); setMode('forgot'); $('fgEmail').focus(); };
  // Σύνδεση με email που δεν επιβεβαιώθηκε: νέος κωδικός επιβεβαίωσης.
  $('inConfirm').onclick = async () => {
    if(pending) return;
    email = val('inEmail').trim().toLowerCase();
    const done = working($('inConfirm'), 'Στέλνω…');
    const r = await account.resendConfirm(email, {captchaToken: lgCaptcha.token()});
    lgCaptcha.reset();
    done();
    if(r.error) return msg('lgError', r.error);
    toConfirm();
  };
  $('lgResend').onclick = async () => {
    if(pending) return;
    msg('lgError', ''); msg('lgStatus', '');
    const done = working($('lgResend'), 'Στέλνω…');
    const r = mode === 'confirm' ? await account.resendConfirm(email, {captchaToken: lgCaptcha.token()})
      : await account.requestReset(email, {captchaToken: lgCaptcha.token()});
    lgCaptcha.reset();
    done();
    if(r.error) return msg('lgError', r.error);
    startCooldown();
    msg('lgStatus', 'Στάλθηκε νέος κωδικός.');
  };
  $('lgOther').onclick = () => setMode(mode === 'confirm' ? 'up' : 'forgot');

  // ── Μετά τη σύνδεση: στοιχεία επιχείρησης → (υποχρεωτικό όνομα) → εκεί που ήταν ή αρχική ──
  async function loggedIn(status = ''){
    ['inPw', 'upPw', 'upPw2', 'rsPw', 'rsPw2', 'rsCode', 'cfCode'].forEach(id => { $(id).value = ''; });
    const u = account.user();
    // Λήξη συνεδρίας στη μέση της δουλειάς: ίδιος χρήστης → πίσω στην οθόνη που ήταν, όπως ήταν.
    const back = resume && (!lockedUser || lockedUser === u?.id) ? resume : null;
    resume = null; lockedUser = null;
    setLocked(false);
    try { onLogin(); } catch {}
    const r = await account.syncProfile();
    if(r.action === 'downloaded') onProfileChange();
    if(r.action === 'conflict') return openChoice(r.local, r.remote, back);
    finish(back, status);
  }
  function finish(back, status = ''){
    if(!loadProfile()) return needProfile();     // πρώτη φορά: «Τα στοιχεία σου» πριν από την αρχική
    (back || home)();
    if(status) $('micNote').textContent = status;
  }

  function openChoice(local, remote, back){
    const logo = getLogo(local.logo);
    const card = (who, title, p, img, has) => `<div class="pc"><span class="pc-h">${title}</span>
      <div class="pc-b"><div class="logo">${img ? `<img src="${esc(img)}" alt="">` : esc(initials(p.name || '?'))}</div>
        <div><b>${esc(p.name || '—')}</b><span>${esc(p.trade || '')}</span><span>${esc(p.phone || '')}</span>
        <span>${has ? 'Με λογότυπο' : 'Χωρίς λογότυπο'}</span></div></div>
      <button class="primary" type="button" data-keep="${who}">Κράτα αυτά</button></div>`;
    $('pchoiceList').innerHTML =
      card('device', 'Σε αυτή τη συσκευή', local, logo, !!logo) +
      card('account', 'Στον λογαριασμό σου', {name: remote.business_name, trade: remote.specialty, phone: remote.phone}, '', !!remote.logo_path);
    msg('pchoiceError', '');
    $('pchoiceList').querySelectorAll('[data-keep]').forEach(b => b.onclick = async () => {
      if(pending) return;
      const done = working(b, 'Περίμενε…');
      const r = await account.keep(b.dataset.keep, remote);
      done();
      if(r.error) return msg('pchoiceError', r.error);
      if(b.dataset.keep === 'account') onProfileChange();
      finish(back);
    });
    show('s-pchoice', 'Λογαριασμός');
    cta(null);
  }

  // ── Ο λογαριασμός μου ──
  // Έχει κωδικό; Το ρωτάμε τη βάση (has_password) όταν χρειάζεται: αλλαγή κωδικού, διαγραφή.
  let hasPw = false;
  const providers = () => account.user()?.providers || [];
  const via = pw => { const g = providers().includes('google');
    $('acctVia').textContent = pw && g ? 'Σύνδεση με email και κωδικό ή με Google' : g ? 'Σύνδεση με Google' : 'Σύνδεση με email και κωδικό'; };
  function openAccount({status = '', error = '', del = false} = {}){
    const u = account.user();
    if(!u) return lock('expired');
    hasPw = providers().includes('email');           // πρώτη εκτίμηση· η βάση απαντά όταν χρειαστεί
    $('acctEmail').textContent = u.email || u.name;
    via(hasPw);
    $('acctPwOpen').textContent = 'Κωδικός πρόσβασης';
    ['acctPwBox', 'acctEmBox', 'acctEmCodeWrap', 'acctDelBox'].forEach(id => { $(id).hidden = true; });
    ['acctPwCur', 'acctPw', 'acctPw2', 'acctEm', 'acctEmCode', 'acctDelPw'].forEach(id => { $(id).value = ''; });
    $('acctWipe').checked = false;
    $('acctOutBox').hidden = true;
    clearErrs($('s-account')); hidePasswords();
    msg('acctStatus', status); msg('acctError', error);
    show('s-account', 'Λογαριασμός');
    syncNet();
    cta(null);
    if(del) openDelete();
  }
  async function askPassword(btn){
    const done = working(btn, 'Περίμενε…');
    hasPw = await account.hasPassword();
    done();
    via(hasPw);
    return hasPw;
  }
  const ACCT = {password: 'acctPw', repeat: 'acctPw2', current: 'acctPwCur', email: 'acctEm', code: 'acctEmCode'};
  $('s-account').addEventListener('input', e => {
    if(e.target.id) fieldErr(e.target.id, '');
    syncRules('acct', val('acctPw'), val('acctPw2'));
    syncDel();
  });
  $('acctPwOpen').onclick = async () => {
    if(pending) return;
    if(!$('acctPwBox').hidden){ $('acctPwBox').hidden = true; return; }
    const pw = await askPassword($('acctPwOpen'));
    $('acctPwBox').hidden = false;
    $('acctPwCurWrap').hidden = !pw;
    $('acctPwSave').textContent = pw ? 'Αλλαγή κωδικού' : 'Ορισμός κωδικού';
    syncRules('acct', '', '');
    $(pw ? 'acctPwCur' : 'acctPw').focus();
  };
  $('acctPwSave').onclick = async () => {
    if(pending) return;
    msg('acctError', ''); msg('acctStatus', '');
    const done = working($('acctPwSave'), 'Αποθήκευση…');
    const r = await account.setPassword(val('acctPw'), val('acctPw2'), {current: !$('acctPwCurWrap').hidden ? val('acctPwCur') : null});
    done();
    if(r.field === 'current') $('acctPwCurWrap').hidden = false;    // ο server ξέρει ότι υπάρχει κωδικός
    if(r.error) return showError(r, ACCT);
    openAccount({status: 'Ο κωδικός άλλαξε.'});
  };
  $('acctEmOpen').onclick = () => { $('acctEmBox').hidden = !$('acctEmBox').hidden; if(!$('acctEmBox').hidden) $('acctEm').focus(); };
  $('acctEmSend').onclick = async () => {
    if(pending) return;
    msg('acctError', ''); msg('acctStatus', '');
    const done = working($('acctEmSend'), 'Στέλνω…');
    const r = await account.changeEmail(val('acctEm'));
    done();
    if(r.error) return showError(r, ACCT);
    $('acctEmCodeWrap').hidden = false;
    $('acctEmSentTo').textContent = `Σου στείλαμε κωδικό 6 ψηφίων στο ${val('acctEm').trim().toLowerCase()}. Γράψ' τον εδώ:`;
    $('acctEmCode').focus();
  };
  $('acctEmVerify').onclick = async () => {
    if(pending) return;
    msg('acctError', '');
    const done = working($('acctEmVerify'), 'Έλεγχος…');
    const r = await account.confirmEmailChange(val('acctEm'), val('acctEmCode'));
    done();
    if(r.error) return showError(r, ACCT);
    openAccount({status: 'Το email άλλαξε.'});
  };

  // Αποσύνδεση αυτής της συσκευής. Με συγχρονισμό προσφορών (quotes): πρώτα ένας τελευταίος γύρος (αν υπάρχει σήμα) και
  // ερώτηση για τις προσφορές της συσκευής — όπως το «σβήσε και τα δεδομένα» της διαγραφής. Ό,τι δεν έχει ανέβει ακόμα
  // ΔΕΝ σβήνεται ποτέ (το κουτάκι κλειδώνει).
  async function signOutHere(wipe = false){
    const done = working($('acctSignOut'), 'Αποσύνδεση…');
    const uid = account.user()?.id ?? null;     // πριν την αποσύνδεση: σβήνονται ΜΟΝΟ οι δικές του (κοινή συσκευή)
    await account.signOut();       // μόνο αυτή η συσκευή
    done();
    if(wipe) quotes?.wipe(uid);
    signedOut(wipe ? 'Αποσυνδέθηκες. Οι προσφορές σβήστηκαν από αυτή τη συσκευή· είναι στον λογαριασμό σου.'
      : 'Αποσυνδέθηκες. Οι προσφορές σου έμειναν σε αυτή τη συσκευή.');
  }
  $('acctSignOut').onclick = async () => {
    if(pending) return;
    if(!quotes) return signOutHere();
    if(!$('acctOutBox').hidden) return;
    if(online()){ const done = working($('acctSignOut'), 'Συγχρονισμός…'); try { await quotes.flush(); } catch {} done(); }
    const left = quotes.pending();
    $('acctOutNote').textContent = left
      ? `${left === 1 ? '1 αλλαγή στις προσφορές δεν έχει' : `${left} αλλαγές στις προσφορές δεν έχουν`} ανέβει ακόμα στον λογαριασμό. Μένουν σε αυτή τη συσκευή και ανεβαίνουν όταν ξανασυνδεθείς με σήμα.`
      : 'Όλες οι προσφορές σου είναι και στον λογαριασμό.';
    $('acctOutWipe').checked = false;
    $('acctOutWipe').disabled = left > 0;
    $('acctOutWipeRow').classList.toggle('off', left > 0);
    $('acctOutBox').hidden = false;
    $('acctOutYes').focus();
  };
  $('acctOutNo').onclick = () => { $('acctOutBox').hidden = true; };
  $('acctOutYes').onclick = async () => {
    if(pending) return;
    const wipe = $('acctOutWipe').checked && !$('acctOutWipe').disabled && !quotes.pending();
    $('acctOutBox').hidden = true;
    await signOutHere(wipe);
  };
  $('acctSignOutAll').onclick = async () => {
    if(pending) return;
    msg('acctError', '');
    const done = working($('acctSignOutAll'), 'Αποσύνδεση…');
    const r = await account.signOut({global: true});
    done();
    if(r.error) return msg('acctError', r.error);
    signedOut('Αποσυνδέθηκες από όλες τις συσκευές. Οι προσφορές σου έμειναν σε αυτή τη συσκευή.');
  };
  function signedOut(status){
    returnTo = null; resume = null;
    setLocked(true);
    openLogin({status});
  }

  // Διαγραφή: ξανά επιβεβαίωση ταυτότητας. Με κωδικό → ο κωδικός· μόνο Google → νέα σύνδεση Google·
  // Google ΚΑΙ κωδικός → οποιοδήποτε από τα δύο.
  const syncDel = () => {
    if(pending) return;
    $('acctDelYes').disabled = !online() || (!reauthDone && hasPw && (!val('acctDelPw') || !delCaptcha.ready()));
  };
  async function openDelete(){
    if(pending) return;
    if(!reauthDone) await askPassword($('acctDelete'));
    const g = providers().includes('google'), pw = hasPw && !reauthDone;
    $('acctDelBox').hidden = false;
    $('acctDelPwWrap').hidden = !pw;
    $('acctDelGoogle').hidden = !(pw && g);                 // και τα δύο: «ή επιβεβαίωσε με Google»
    $('acctDelGoogleNote').hidden = hasPw || reauthDone;
    $('acctDelYes').textContent = !hasPw && !reauthDone ? 'Σύνδεση με Google και διαγραφή' : 'Ναι, σβήσε τον λογαριασμό';
    if(pw){ delCaptcha.ensure(); $('acctDelPw').focus(); }
    syncDel();
  }
  async function viaGoogle(btn){
    const done = working(btn, 'Άνοιγμα Google…');
    const r = await account.reauthGoogle('delete');
    if(r.error){ done(); msg('acctError', r.error); }
  }
  $('acctDelete').onclick = openDelete;
  $('acctDelGoogle').onclick = () => { if(!pending) viaGoogle($('acctDelGoogle')); };
  $('acctDelNo').onclick = () => { $('acctDelBox').hidden = true; $('acctDelPw').value = ''; };
  $('acctDelYes').onclick = async () => {
    if(pending || $('acctDelYes').disabled) return;
    msg('acctError', '');
    const wipe = $('acctWipe').checked;
    if(!hasPw && !reauthDone) return viaGoogle($('acctDelYes'));
    const done = working($('acctDelYes'), 'Διαγραφή…');
    if(!reauthDone){
      const a = await account.reauthPassword(val('acctDelPw'), {captchaToken: delCaptcha.token()});
      delCaptcha.reset();
      if(a.error){ done(); return showError({...a, field: a.field && 'password'}, {password: 'acctDelPw'}); }
    }
    const r = await account.deleteAccount({wipeLocal: wipe});
    done();
    if(r.error){ reauthDone = false; return msg('acctError', r.error); }
    reauthDone = false;
    if(wipe) return location.reload();       // η συσκευή άδειασε: η εφαρμογή ξεκινά από την αρχή (σύνδεση)
    signedOut('Ο λογαριασμός διαγράφηκε. Οι προσφορές σου έμειναν σε αυτή τη συσκευή.');
  };

  // ── Λήξη ή ανάκληση συνεδρίας με ίντερνετ: σύνδεση ξανά, ΧΩΡΙΣ να χαθεί ό,τι γράφει ──
  function lock(reason){
    if(locked) return;
    if(busy()) return void setTimeout(() => lock(reason), 1000);   // όχι στη μέση της υπαγόρευσης
    const cur = current();
    resume = cur && !SCREENS.includes(cur) ? here() : null;
    document.querySelectorAll('.sheet.on').forEach(s => s.classList.remove('on'));
    $('veil')?.classList.remove('on');
    setLocked(true);
    openLogin({error: MSG.relogin});
  }
  const markSeen = u => { if(u) try { localStorage.setItem(SEEN, '1'); } catch {} };
  account.onChange(u => { if(u){ lastUserId = u.id; markSeen(u); } });
  markSeen(account.user());
  account.onLock(reason => { lockedUser = lastUserId; lock(reason); });

  // ── Άνοιγμα ──
  setLocked(!account.user());
  if(locked) openLogin();
  account.init().then(r => {
    const purpose = r.fresh ? account.takeReauth() : '';
    if(r.fresh && purpose === 'delete'){ reauthDone = true; returnTo = home; return openAccount({del: true,
      status: 'Επιβεβαιώθηκες με Google. Πάτα «Ναι, σβήσε τον λογαριασμό» για να ολοκληρωθεί η διαγραφή.'}); }
    if(r.fresh) return loggedIn();
    if(!r.user && !locked){ lockedUser = lastUserId; return lock('expired'); }          // ο server είπε ότι η συνεδρία δεν ισχύει πια
    if(r.error && locked) msg('lgError', r.error);
  });

  return {
    enabled: true,
    locked: () => locked,
    /** Το «‹ Πίσω» φαίνεται; Κλειδωμένη εφαρμογή: μόνο μέσα στα βήματα της σύνδεσης (π.χ. ξέχασα → σύνδεση). */
    canBack: id => !(locked && id === 's-login' && ['in', 'up'].includes(mode)),
    /** «‹ Πίσω» της εφαρμογής σε μία από τις οθόνες λογαριασμού. */
    back(){
      const cur = current();
      if(cur === 's-login'){
        if(mode === 'confirm') setMode('up');
        else if(mode === 'forgot') setMode('in');
        else if(mode === 'reset') setMode(recovered ? 'in' : 'forgot');
        else if(!locked) leave();
        return true;
      }
      if(cur === 's-pchoice') return true;           // πρέπει να διαλέξει
      if(SCREENS.includes(cur)){ leave(); return true; }
      return false;
    },
    profileSaved: () => account.profileSaved(),
    db: () => account.db(),
    /** Ο συνδεδεμένος χρήστης (και χωρίς σήμα, από τη συνεδρία της συσκευής) ή null. */
    userId: () => account.user()?.id ?? null,
  };
}

export { MSG };
