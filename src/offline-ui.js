// Ενδείξεις επάνω για τη λειτουργία χωρίς σήμα, και εγκατάσταση στην αρχική οθόνη. Βλ. docs/offline.md.
//
// - «Χωρίς σήμα · όλα αποθηκεύονται στο κινητό» όσο δεν υπάρχει σήμα (src/net.js).
// - «Έτοιμο: …» μία φορά ανά συσκευή, όταν τελειώσει η πρώτη εγκατάσταση του service worker.
// - Γεμάτη μνήμη (src/storage-guard.js): μήνυμα που μένει μέχρι να το κλείσει.
// - iPhone στο Safari (όχι από την αρχική οθόνη): μία φορά, μετά την πρώτη σύνδεση, «Πρόσθεσέ το στην αρχική οθόνη…».
//   Το Safari μπορεί να σβήσει τα δεδομένα μετά από 7 μέρες χωρίς χρήση· από την αρχική οθόνη η αποθήκευση είναι
//   ΞΕΧΩΡΙΣΤΗ από το Safari, γι' αυτό το λέμε νωρίς.
// - Android/Chrome: κουμπί εγκατάστασης από το beforeinstallprompt.
import { online, onNet } from './net.js';
import { FULL_MSG } from './storage-guard.js';

export const READY = 'ergolav.offlineReady';
export const IOS_HINT = 'ergolav.iosHint';
export const READY_MS = 8000;

const flag = (win, k) => { try { return !!win.localStorage.getItem(k); } catch { return false; } };
const setFlag = (win, k) => { try { win.localStorage.setItem(k, String(Date.now())); } catch {} };

/** iPhone/iPad στο Safari, ΟΧΙ από την αρχική οθόνη. */
export function iosBrowser(win = globalThis){
  const n = win.navigator || {};
  const ios = /iPhone|iPad|iPod/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
  const standalone = n.standalone === true || !!win.matchMedia?.('(display-mode: standalone)')?.matches;
  return ios && !standalone;
}

export function mountOfflineUi({win = globalThis, doc = win.document} = {}){
  const $ = id => doc.getElementById(id);
  const close = id => { const b = $(id); if(b) b.hidden = true; };
  doc.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => close(b.dataset.close)));

  const syncNet = v => { $('netBar').hidden = v; doc.documentElement.classList.toggle('no-net', !v); };
  onNet(syncNet);
  syncNet(online());

  // Android/Chrome: το μενού εγκατάστασης του browser, από δικό μας κουμπί.
  let deferred = null;
  const install = $('installApp');
  win.addEventListener?.('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if(install) install.hidden = false; });
  win.addEventListener?.('appinstalled', () => { deferred = null; if(install) install.hidden = true; });
  if(install) install.onclick = async () => {
    if(!deferred) return;
    const e = deferred; deferred = null; install.hidden = true;
    try { await e.prompt(); await e.userChoice; } catch {}
  };

  return {
    /** Τέλος πρώτης εγκατάστασης: μία φορά ανά συσκευή. */
    ready(){
      if(flag(win, READY)) return false;
      setFlag(win, READY);
      $('readyBar').hidden = false;
      win.setTimeout(() => close('readyBar'), READY_MS);
      return true;
    },
    /** Γέμισε η μνήμη: το μήνυμα μένει μέχρι να το κλείσει. */
    full(){ $('storageText').textContent = FULL_MSG; $('storageBar').hidden = false; },
    /** Μετά τη σύνδεση: μία φορά, μόνο στο Safari του iPhone. */
    iosHint(){
      if(!iosBrowser(win) || flag(win, IOS_HINT)) return false;
      setFlag(win, IOS_HINT);
      $('iosBar').hidden = false;
      return true;
    },
  };
}
