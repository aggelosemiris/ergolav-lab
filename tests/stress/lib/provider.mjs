// Ελεγχόμενος «ψεύτικος» Gemini provider + καταγραφέας για τον πραγματικό.
// Αντικαθιστά μόνο το globalThis.fetch όσο τρέχει ένα σενάριο· ο κώδικας της εφαρμογής μένει ίδιος.

const GEMINI_RE = /generativelanguage\.googleapis\.com\/v1beta\/models\/([^:]+):generateContent/;
const realFetch = globalThis.fetch;

/** Κάθε αίτημα της εφαρμογής φέρει μοναδικό «base64» (π.χ. req-17) ώστε να ξέρουμε σε ποιο request ανήκει. */
function requestTag(init){
  // Μήκος + τέλος: οι JPEG έχουν ίδια αρχή (κεφαλίδα), οπότε η αρχή δεν ξεχωρίζει φωτογραφίες.
  try { const d = JSON.parse(init.body).contents[0].parts[0].inline_data.data; return d.length > 60 ? `${d.length}:${d.slice(-40)}` : d; } catch { return '?'; }
}

/**
 * handler(call) → spec: {status=200, body, headers, delayMs, networkError, hang}
 *   call = {n, model, tag, at}
 */
export function mockProvider(clock, handler){
  const calls = [];
  const fetch = async (url, init = {}) => {
    const m = String(url).match(GEMINI_RE);
    if(!m) throw new Error(`Απρόσμενο αίτημα προς ${url} — το test μπλοκάρει κάθε δίκτυο εκτός του mock`);
    const call = {n: calls.length + 1, model: m[1], tag: requestTag(init), at: clock.now()};
    calls.push(call);
    const spec = await handler(call) ?? {};
    // Όπως το πραγματικό fetch: αν ο client ακυρώσει (timeout), το αίτημα αποτυγχάνει με AbortError.
    const aborted = new Promise((_, fail) => init.signal?.addEventListener('abort', () => {
      call.outcome = 'aborted'; call.latency = clock.now() - call.at;
      fail(new DOMException('The operation was aborted.', 'AbortError'));
    }, {once: true}));
    aborted.catch(() => {});
    if(spec.hang){ call.outcome = 'hang'; return aborted; }
    if(spec.delayMs) await Promise.race([clock.sleep(spec.delayMs), aborted]);
    call.latency = clock.now() - call.at;
    if(spec.networkError){ call.outcome = 'network'; throw new TypeError('Failed to fetch'); }
    call.status = spec.status ?? 200;
    const body = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? {});
    call.usage = typeof spec.body === 'object' ? spec.body?.usageMetadata : undefined;
    return new Response(body, {status: call.status, headers: {'content-type': 'application/json', ...(spec.headers || {})}});
  };
  return {
    calls,
    install(){ globalThis.fetch = fetch; },
    uninstall(){ globalThis.fetch = realFetch; },
  };
}

/** Καταγράφει τα πραγματικά αιτήματα (live mode) χωρίς να καταγράφει headers/keys. */
export function recordingFetch(){
  const calls = [];
  const fetch = async (url, init = {}) => {
    const m = String(url).match(GEMINI_RE);
    const call = {n: calls.length + 1, model: m?.[1] ?? String(url).split('?')[0], at: performance.now()};
    calls.push(call);
    try {
      const r = await realFetch(url, init);
      call.latency = performance.now() - call.at;
      call.status = r.status;
      call.retryAfter = r.headers.get('retry-after');
      try { call.usage = (await r.clone().json()).usageMetadata; } catch {}
      return r;
    } catch (e) {
      call.latency = performance.now() - call.at;
      call.outcome = 'network';
      throw e;
    }
  };
  return {calls, install(){ globalThis.fetch = fetch; }, uninstall(){ globalThis.fetch = realFetch; }};
}

// ── Βοηθητικές απαντήσεις σε μορφή Gemini ──
export const ok = (text, usage = {promptTokenCount: 1560, candidatesTokenCount: 40, totalTokenCount: 1600}, finishReason = 'STOP') =>
  ({status: 200, body: {candidates: [{finishReason, content: {parts: [{text}]}}], usageMetadata: usage}});
export const err = (status, message, reason, headers) =>
  ({status, headers, body: {error: {code: status, message, status: reason, details: reason ? [{reason}] : []}}});
