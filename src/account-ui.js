// Οθόνες λογαριασμού: «Σύνδεση ή εγγραφή», «Ο λογαριασμός μου», «Ποια στοιχεία κρατάς;» και το κουμπί της κεφαλίδας.
// Λογική: account.js. Με AUTH_ENABLED = false (ή χωρίς ρυθμίσεις) δεν κάνει τίποτα: ούτε κουμπί, ούτε φόρτωμα βιβλιοθήκης.
import { createAccount, MSG } from './account.js';
import { getLogo, initials } from './profile.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const SCREENS = ['s-login', 's-account', 's-pchoice'];
const LEGAL = {
  terms: 'Όροι χρήσης: θα δημοσιευτούν πριν ανοίξει η εφαρμογή σε πραγματικούς χρήστες.',
  privacy: 'Απόρρητο: ο λογαριασμός κρατά μόνο το email σου, τα στοιχεία της επιχείρησης και το λογότυπο. Το πλήρες κείμενο θα δημοσιευτεί πριν ανοίξει η εφαρμογή σε πραγματικούς χρήστες.',
};

/**
 * show/cta: της εφαρμογής. here(): «θυμήσου πού είμαι» → συνάρτηση που γυρίζει εκεί.
 * busy(): αν τώρα δεν επιτρέπεται να φύγει από την οθόνη (π.χ. ακούει το μικρόφωνο).
 * home(): η αρχική οθόνη. onProfileChange(): ήρθαν στη συσκευή στοιχεία από τον λογαριασμό.
 */
export function mountAccount({show, cta, here, home = () => {}, busy = () => false, onProfileChange = () => {}, account = createAccount()}){
  if(!account.enabled) return {enabled: false, back: () => false, profileSaved: async () => ({error: ''})};

  let returnTo = null, email = '', step = 'start';
  const msg = (id, text) => { $(id).hidden = !text; $(id).textContent = text || ''; };
  const current = () => document.querySelector('.screen.on')?.id;
  const leave = () => { const r = returnTo || home; returnTo = null; r(); };
  const working = (btn, label) => { const old = btn.textContent; btn.disabled = true; btn.textContent = label;
    return () => { btn.disabled = false; btn.textContent = old; }; };

  // ── Κουμπί κεφαλίδας ──
  document.querySelector('header').classList.add('auth');
  const btn = $('acctBtn');
  btn.hidden = false;
  const syncBtn = u => {
    btn.textContent = u ? u.name : 'Σύνδεση';
    btn.classList.toggle('on', !!u);
    btn.setAttribute('aria-label', u ? 'Ο λογαριασμός μου' : 'Σύνδεση ή εγγραφή');
  };
  account.onChange(syncBtn);
  syncBtn(null);
  btn.onclick = () => {
    if(SCREENS.includes(current()) || busy()) return;
    returnTo = here();
    account.user() ? openAccount() : openLogin();
  };

  // ── Σύνδεση ή εγγραφή ──
  function loginStep(s){
    step = s;
    $('loginStart').hidden = s !== 'start';
    $('loginCode').hidden = s !== 'code';
    msg('loginError', ''); msg('loginStatus', '');
  }
  function openLogin(error = ''){
    loginStep('start');
    $('legalText').hidden = true;
    show('s-login', 'Σύνδεση');
    cta(null);
    msg('loginError', error);
  }
  $('loginGoogle').onclick = async () => {
    msg('loginError', '');
    const done = working($('loginGoogle'), 'Άνοιγμα Google…');
    const r = await account.signInGoogle();     // επιτυχία = η σελίδα πάει στο Google και επιστρέφει μετά
    if(r.error){ done(); msg('loginError', r.error); }
  };
  async function send(){
    email = $('loginEmail').value.trim();
    msg('loginError', '');
    const done = working($('loginSend'), 'Στέλνω…');
    const r = await account.sendCode(email);
    done();
    if(r.error) return msg('loginError', r.error);
    loginStep('code');
    $('loginSentTo').textContent = `Σου στείλαμε 6ψήφιο κωδικό στο ${email}. Γράψ' τον εδώ:`;
    $('loginOtp').value = '';
    $('loginOtp').focus();
  }
  $('loginSend').onclick = send;
  $('loginEmail').addEventListener('keydown', e => { if(e.key === 'Enter') send(); });
  async function verify(){
    msg('loginError', '');
    const done = working($('loginVerify'), 'Έλεγχος…');
    const r = await account.verifyCode(email, $('loginOtp').value);
    done();
    if(r.error) return msg('loginError', r.error);
    afterLogin();
  }
  $('loginVerify').onclick = verify;
  $('loginOtp').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if(e.target.value.length === 6) verify();
  });
  $('loginResend').onclick = async () => {
    msg('loginError', ''); msg('loginStatus', '');
    const r = await account.sendCode(email);
    if(r.error) msg('loginError', r.error); else msg('loginStatus', 'Στάλθηκε νέος κωδικός.');
  };
  $('loginOther').onclick = () => { loginStep('start'); $('loginEmail').focus(); };
  document.querySelectorAll('[data-legal]').forEach(b => b.onclick = () => {
    $('legalText').hidden = false; $('legalText').textContent = LEGAL[b.dataset.legal];
  });

  // ── Μετά τη σύνδεση: στοιχεία επιχείρησης ──
  async function afterLogin(){
    const r = await account.syncProfile();
    if(r.action === 'conflict') return openChoice(r.local, r.remote);
    if(r.action === 'downloaded') onProfileChange();
    openAccount({fresh: true, status: {
      uploaded: 'Συνδέθηκες. Τα στοιχεία της επιχείρησής σου ανέβηκαν στον λογαριασμό.',
      downloaded: 'Συνδέθηκες. Τα στοιχεία της επιχείρησής σου ήρθαν από τον λογαριασμό.',
    }[r.action] || 'Συνδέθηκες.', error: r.error});
  }

  function openChoice(local, remote){
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
      const done = working(b, 'Περίμενε…');
      const r = await account.keep(b.dataset.keep, remote);
      done();
      if(r.error) return msg('pchoiceError', r.error);
      if(b.dataset.keep === 'account') onProfileChange();
      openAccount({fresh: true, status: b.dataset.keep === 'account'
        ? 'Κρατήθηκαν τα στοιχεία του λογαριασμού (τα προηγούμενα της συσκευής φυλάχτηκαν ως αντίγραφο).'
        : 'Κρατήθηκαν τα στοιχεία της συσκευής και ανέβηκαν στον λογαριασμό.'});
    });
    show('s-pchoice', 'Λογαριασμός');
    cta(null);
  }

  // ── Ο λογαριασμός μου ──
  function openAccount({fresh = false, status = '', error = ''} = {}){
    const u = account.user();
    if(!u) return openLogin();
    $('acctEmail').textContent = u.email || u.name;
    $('acctVia').textContent = u.provider === 'google' ? 'Σύνδεση με Google' : 'Σύνδεση με κωδικό email';
    $('acctDelBox').hidden = true; $('acctWipe').checked = false;
    msg('acctStatus', status); msg('acctError', error);
    show('s-account', 'Λογαριασμός');
    if(fresh) cta('Συνέχεια', leave); else cta(null);
  }
  $('acctSignOut').onclick = async () => {
    const done = working($('acctSignOut'), 'Αποσύνδεση…');
    await account.signOut();       // μόνο αυτή η συσκευή· τα δεδομένα της εφαρμογής μένουν
    done();
    leave();
  };
  $('acctDelete').onclick = () => { $('acctDelBox').hidden = false; $('acctDelYes').focus(); };
  $('acctDelNo').onclick = () => { $('acctDelBox').hidden = true; };
  $('acctDelYes').onclick = async () => {
    msg('acctError', '');
    const wipe = $('acctWipe').checked;
    const done = working($('acctDelYes'), 'Διαγραφή…');
    const r = await account.deleteAccount({wipeLocal: wipe});
    done();
    if(r.error) return msg('acctError', r.error);
    if(wipe) return location.reload();       // η συσκευή άδειασε: η εφαρμογή ξεκινά από την αρχή
    leave();
  };

  // ── Άνοιγμα: συνεδρία που έμεινε ανοιχτή ή επιστροφή από το Google ──
  account.init().then(r => {
    if(r.fresh){ returnTo = here(); afterLogin(); }
    else if(r.error){ returnTo = here(); openLogin(r.error); }
  });

  return {
    enabled: true,
    /** «‹ Πίσω» της εφαρμογής σε μία από τις οθόνες λογαριασμού. */
    back(){
      const cur = current();
      if(cur === 's-login' && step === 'code'){ loginStep('start'); return true; }
      if(SCREENS.includes(cur)){ leave(); return true; }
      return false;
    },
    profileSaved: () => account.profileSaved(),
  };
}

export { MSG };
