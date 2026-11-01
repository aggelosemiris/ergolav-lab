// Suite I/K/L/N/O: ελεγχόμενο load test πάνω στον πραγματικό κώδικα (readNotes).
// Mock mode: ψεύτικος Gemini με όριο αιτημάτων/λεπτό ανά μοντέλο, log-normal latency, τυχαία 503.
// Live mode: ίδιος runner με recordingFetch και αυστηρά όρια (βλ. run.mjs).
import { freshPhoto } from './provider-failures.mjs';
import { installClock } from '../lib/clock.mjs';
import { mockProvider, ok, err } from '../lib/provider.mjs';
import { latencySummary, rng, lognormal, round, pct } from '../lib/stats.mjs';

/** Ψεύτικος provider με ρεαλιστικά όρια. rpm: αιτήματα/λεπτό ανά μοντέλο (όπως μετράει η Google). */
export function realisticMock(clock, {rpm, latencyMs, errorRate, seed = 7}){
  const rand = rng(seed);
  const windows = {};                                   // μοντέλο → χρονοσφραγίδες τελευταίου λεπτού
  return mockProvider(clock, call => {
    const w = (windows[call.model] ||= []);
    while(w.length && call.at - w[0] > 60000) w.shift();
    if(w.length >= rpm) return {...err(429, 'Resource has been exhausted (e.g. check quota).', 'RESOURCE_EXHAUSTED', {'retry-after': '20'}), delayMs: 80};
    w.push(call.at);
    if(rand() < errorRate) return {...err(503, 'The model is overloaded.', 'UNAVAILABLE'), delayMs: lognormal(rand, latencyMs / 3)};
    return {...ok('12 μέτρα σωλήνας\n1 τεμάχιο λεκάνη κρεμαστή'), delayMs: lognormal(rand, latencyMs)};
  });
}

/**
 * Τρέχει requestCount αιτήματα με το πολύ `concurrency` ταυτόχρονα.
 * rps: ρυθμός εκκίνησης (0 = όσο πιο γρήγορα), duration: μετά από τόσο δεν ξεκινούν νέα,
 * timeout: όριο του harness ανά αίτημα (η εφαρμογή ΔΕΝ έχει δικό της), harnessRetries: επαναλήψεις
 * ολόκληρου του readNotes από το harness (0 = μετράμε την εφαρμογή όπως είναι).
 */
export async function runLoadTier({label, concurrency, requestCount, rps = 0, timeout, duration, harnessRetries = 0,
                                   scale, apiKey, makeProvider, payload, price}){
  const {readNotes} = await freshPhoto(label);            // μία συνεδρία ανά βαθμίδα (όπως ένα κοινό key)
  const clock = installClock(scale);
  const provider = makeProvider(clock);
  provider.install();
  const t0 = clock.now();
  const reqs = [];
  let next = 0, launched = 0;
  const startGap = rps > 0 ? 1000 / rps : 0;

  async function one(i){
    const req = {i, start: clock.now(), attempts: 0};
    reqs.push(req);
    for(let a = 0; a <= harnessRetries; a++){
      req.attempts++;
      const run = readNotes(payload(i), {apiKey}).then(text => ({text}), e => ({error: e?.message ?? String(e)}));
      const res = await Promise.race([run, clock.sleep(timeout).then(() => ({timeout: true}))]);
      Object.assign(req, res);
      if(res.text || res.timeout) break;
    }
    req.end = clock.now();
    req.latency = req.end - req.start;
  }

  async function worker(){
    while(next < requestCount){
      if(duration && clock.now() - t0 > duration) break;
      const i = next++;
      if(startGap){ const due = t0 + i * startGap; const now = clock.now(); if(due > now) await clock.sleep(due - now); }
      launched++;
      await one(i);
    }
  }
  try { await Promise.all(Array.from({length: Math.min(concurrency, requestCount)}, worker)); }
  finally { provider.uninstall(); clock.uninstall(); }

  const elapsed = clock.now() - t0;
  const calls = provider.calls;
  const ok_ = reqs.filter(r => r.text), failed = reqs.filter(r => r.error), timedOut = reqs.filter(r => r.timeout);
  const httpErr = calls.filter(c => c.status && c.status >= 400);
  const usage = calls.map(c => c.usage).filter(Boolean);
  const inTok = usage.reduce((s, u) => s + (u.promptTokenCount || 0), 0);
  const outTok = usage.reduce((s, u) => s + (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), 0);
  const errorsByMsg = {};
  for(const r of failed) errorsByMsg[r.error.slice(0, 70)] = (errorsByMsg[r.error.slice(0, 70)] || 0) + 1;

  return {
    label, concurrency, config: {requestCount, rps, timeout, duration, harnessRetries},
    total_requests: launched, successful: ok_.length, failed: failed.length, timeouts: timedOut.length,
    success_rate: pct(ok_.length, launched),
    provider_calls: calls.length, amplification: round(calls.length / Math.max(1, launched), 2),
    http_errors: httpErr.length, rate_limit_errors: calls.filter(c => c.status === 429).length,
    provider_errors: calls.filter(c => c.status >= 500).length, network_errors: calls.filter(c => c.outcome === 'network').length,
    retry_count: Math.max(0, calls.length - launched),
    latency_ms: Object.fromEntries(Object.entries(latencySummary(ok_.map(r => r.latency))).map(([k, v]) => [k, round(v)])),
    duration_ms: round(elapsed), throughput_rps: round(ok_.length / (elapsed / 1000), 2), requests_per_s: round(launched / (elapsed / 1000), 2),
    tokens: usage.length ? {input: inTok, output: outTok, total: inTok + outTok, avg_per_success: round((inTok + outTok) / Math.max(1, ok_.length))} : null,
    estimated_cost: price && usage.length ? round(inTok / 1e6 * price.in + outTok / 1e6 * price.out, 4) : null,
    user_visible_errors: errorsByMsg,
  };
}
