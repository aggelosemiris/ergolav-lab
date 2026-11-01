// Μικρόφωνο σε πραγματικό χρόνο: Web Speech API για το κείμενο, Web Audio για τη στάθμη.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const isAndroid = /Android/i.test(navigator.userAgent);

export const micSupported = !!SR;

const ERRORS = {
  'not-allowed': 'Δεν έχω πρόσβαση στο μικρόφωνο. Επίτρεψέ το από τις ρυθμίσεις του browser.',
  'service-not-allowed': 'Ο browser δεν επιτρέπει αναγνώριση φωνής εδώ.',
  'audio-capture': 'Δεν βρέθηκε μικρόφωνο.',
  'network': 'Η αναγνώριση φωνής θέλει σύνδεση στο internet.',
  'language-not-supported': 'Ο browser δεν υποστηρίζει ελληνικά για φωνή.',
};

/**
 * onText(finalText, interimText) σε κάθε ενημέρωση
 * onLevels(Float32Array 0..1) ~60 φορές/δευτ. όσο ακούει (αν υπάρχει στάθμη)
 * onError(message) όταν σταματά λόγω σφάλματος
 */
export function createMic({lang = 'el-GR', bars = 18, onText, onLevels, onError}){
  let rec = null, active = false, committed = '', sessionFinal = '';
  let stream = null, ctx = null, raf = 0, ended = null;

  const join = (a, b) => (a && b) ? a.replace(/\s+$/, '') + ' ' + b.replace(/^\s+/, '') : (a || b);
  // Κάθε τελική φράση = μια παύση στην ομιλία· το κόμμα τη χωρίζει για τον parser.
  const joinPhrase = (a, b) => (a && b && !/[.,;!?]$/.test(a.trim())) ? join(a.trim() + ',', b) : join(a, b);

  function startRecognition(){
    rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    // Το Android Chrome διπλασιάζει αποτελέσματα σε continuous — εκεί κάνουμε σύντομες συνεδρίες με επανεκκίνηση.
    rec.continuous = !isAndroid;
    rec.maxAlternatives = 1;
    sessionFinal = '';

    rec.onresult = e => {
      let fin = '', interim = '';
      for(let i = 0; i < e.results.length; i++){
        const r = e.results[i];
        if(r.isFinal) fin = joinPhrase(fin, r[0].transcript.trim());
        else interim = join(interim, r[0].transcript.trim());
      }
      sessionFinal = fin;
      onText(joinPhrase(committed, sessionFinal), interim);
    };
    rec.onerror = e => {
      if(e.error === 'no-speech' || e.error === 'aborted') return; // θα ξαναξεκινήσει στο onend
      active = false;
      onError(ERRORS[e.error] || `Σφάλμα αναγνώρισης φωνής (${e.error}).`);
    };
    rec.onend = () => {
      committed = joinPhrase(committed, sessionFinal);
      sessionFinal = '';
      onText(committed, '');
      if(ended){ ended(committed); ended = null; return; }
      if(active){
        // Ο browser κλείνει τη συνεδρία μετά από σιωπή — συνεχίζουμε μέχρι να πατήσει «Τέλος».
        try { startRecognition(); } catch { setTimeout(() => active && startRecognition(), 250); }
      }
    };
    rec.start();
  }

  async function startLevels(){
    // Στο Android το getUserMedia παράλληλα με την αναγνώριση «κλέβει» το μικρόφωνο.
    if(isAndroid || !navigator.mediaDevices?.getUserMedia || !onLevels) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}});
      if(!active){ stopLevels(); return false; }
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 512; an.smoothingTimeConstant = 0.75;
      ctx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const hz = ctx.sampleRate / an.fftSize;
      const lo = Math.floor(90 / hz), hi = Math.ceil(3500 / hz); // εύρος φωνής
      const out = new Float32Array(bars);
      const loop = () => {
        an.getByteFrequencyData(data);
        const step = (hi - lo) / bars;
        for(let b = 0; b < bars; b++){
          let s = 0, n = 0;
          for(let k = Math.floor(lo + b*step); k < Math.floor(lo + (b+1)*step); k++){ s += data[k]; n++; }
          out[b] = Math.min(1, (n ? s / n : 0) / 170);
        }
        onLevels(out);
        raf = requestAnimationFrame(loop);
      };
      loop();
      return true;
    } catch {
      stopLevels();
      return false;
    }
  }

  function stopLevels(){
    cancelAnimationFrame(raf); raf = 0;
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    ctx?.close().catch(() => {}); ctx = null;
  }

  return {
    /** Ξεκινά· επιστρέφει Promise<boolean> αν υπάρχει ζωντανή στάθμη ήχου. */
    start(initial = ''){
      if(!SR) throw new Error('unsupported');
      committed = initial; active = true;
      startRecognition();
      return startLevels();
    },
    /** Σταματά και επιστρέφει Promise με όλο το κείμενο (περιμένει την τελευταία φράση). */
    stop(){
      active = false;
      stopLevels();
      return new Promise(resolve => {
        const done = () => { ended = null; resolve(joinPhrase(committed, sessionFinal)); };
        ended = done;
        setTimeout(() => ended === done && done(), 1500);
        try { rec?.stop(); } catch { done(); }
      });
    },
    get listening(){ return active; },
  };
}
