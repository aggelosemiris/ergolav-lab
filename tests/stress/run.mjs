#!/usr/bin/env node
// ergolav stress test — μία εντολή: `npm run test:stress` (mock, ασφαλές) ή `npm run test:stress:live`.
// Δεν αλλάζει τίποτα στην εφαρμογή: εισάγει τα src/*.js όπως είναι και αντικαθιστά μόνο fetch/setTimeout
// μέσα στο process του test.
import fs from 'node:fs';
import { runCatalogSuite } from './suites/catalog.mjs';
import { runFailureSuite, SCENARIOS, runScenario } from './suites/provider-failures.mjs';
import { runLoadTier, realisticMock } from './suites/provider-load.mjs';
import { summarize, renderReport } from './lib/report.mjs';

const env = process.env;
// Το live είναι ξεχωριστό πρόγραμμα (run-live.mjs): δεν τρέχει και δεν αναμιγνύει mock tests.
if(env.LIVE === '1' || process.argv.includes('--live')){ await import('./run-live.mjs'); process.exit(process.exitCode ?? 0); }
const LIVE = false;
const num = (k, d) => env[k] != null && env[k] !== '' ? Number(env[k]) : d;
const list = (k, d) => (env[k] ?? d).split(',').map(Number).filter(Boolean);

const config = {
  REQUEST_COUNT: num('REQUEST_COUNT', 50), CONCURRENCY: list('CONCURRENCY', '1,5,10,25,50'), REQUESTS_PER_SECOND: num('REQUESTS_PER_SECOND', 0),
  TIMEOUT: num('TIMEOUT', 60000), MAX_RETRIES: num('MAX_RETRIES', 0), TEST_DURATION: num('TEST_DURATION', 0),
  SCALE: num('SCALE', 0.01), MOCK_RPM: num('MOCK_RPM', 10), MOCK_LATENCY_MS: num('MOCK_LATENCY_MS', 1800), MOCK_ERROR_RATE: num('MOCK_ERROR_RATE', 0.02),
  MOCK_OVERLOAD_ERROR_RATE: num('MOCK_OVERLOAD_ERROR_RATE', 0.6),
};
const price = env.PRICE_IN_PER_M && env.PRICE_OUT_PER_M ? {in: Number(env.PRICE_IN_PER_M), out: Number(env.PRICE_OUT_PER_M)} : null;

function die(msg){ console.error(`✗ ${msg}`); process.exit(2); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = new URL(`./reports/${stamp}${LIVE ? '-live' : ''}/`, import.meta.url);
fs.mkdirSync(outDir, {recursive: true});
const logFile = new URL('results.jsonl', outDir);
// Κανένα secret στα logs: ούτε key, ούτε το «μασκαρισμένο» key που δείχνει η εφαρμογή στα μηνύματά της.
const redact = s => s.replace(/AIza[0-9A-Za-z_-]{6,}|sk-ant-[0-9A-Za-z_-]+/g, '[REDACTED_KEY]').replace(/(AIza|sk-ant)[^\s…"]{0,8}…[^\s"]{0,6}/g, '[REDACTED_KEY]');
const log = rows => { for(const r of rows) fs.appendFileSync(logFile, redact(JSON.stringify(r)) + '\n'); return rows; };
const say = s => process.stdout.write(redact(s) + '\n');

const results = {catalog: [], failures: [], load: [], live: [], liveLoad: []};
const mockOpts = {scale: config.SCALE ?? 0.01, timeout: config.TIMEOUT};

// 1. Smoke test — αν αυτό δεν δουλεύει, τα υπόλοιπα νούμερα δεν σημαίνουν τίποτα.
say('▸ Smoke test');
{
  const smoke = await runScenario(SCENARIOS[0], {scale: 0.01, timeout: 5000});
  const cat = runCatalogSuite({largeSizes: []}).find(r => r.test_id === 'normal-01');
  if(!smoke.pass || !cat.pass) die(`Smoke test απέτυχε — το harness δεν μετράει σωστά.\n${JSON.stringify({smoke, cat}, null, 1)}`);
  say('  ✓ harness OK (mock provider + parser)');
}

// 2. Parser / «retrieval» — ντετερμινιστικό, χωρίς δίκτυο
say('▸ Parser / κατάλογος (A, F, G, H)');
results.catalog = log(runCatalogSuite());
say(`  ${results.catalog.filter(r => r.pass).length} pass, ${results.catalog.filter(r => r.pass === false).length} fail`);

// 3. Provider failures — πάντα με mock (δεν προσομοιώνουμε αστοχίες σε πραγματικό provider)
say('▸ Provider failure simulation (J, L, M, N)');
results.failures = log(await runFailureSuite(mockOpts));
say(`  ${results.failures.filter(r => r.pass).length} pass, ${results.failures.filter(r => !r.pass).length} fail`);

if(!LIVE){
  // Δύο προφίλ: «quota» = όριο αιτημάτων/λεπτό ανά μοντέλο (δωρεάν επίπεδο), «overload» = high demand
  // (πολλά 503 σε όλα τα μοντέλα — αυτό που συνέβη στην πράξη).
  const profiles = [
    {name: 'quota', rpm: config.MOCK_RPM, errorRate: config.MOCK_ERROR_RATE},
    {name: 'overload', rpm: 1e6, errorRate: config.MOCK_OVERLOAD_ERROR_RATE},
  ];
  for(const prof of profiles){
    say(`▸ Load test σε mock provider [${prof.name}] (I, K, L, O) — rpm/μοντέλο=${prof.rpm >= 1e6 ? '∞' : prof.rpm}, πιθανότητα 503=${prof.errorRate}`);
    for(const c of config.CONCURRENCY){
      const t = await runLoadTier({
        label: `mock-${prof.name}-c${c}`, concurrency: c, requestCount: config.REQUEST_COUNT, rps: config.REQUESTS_PER_SECOND,
        timeout: config.TIMEOUT, duration: config.TEST_DURATION, harnessRetries: config.MAX_RETRIES, scale: config.SCALE,
        apiKey: 'AIza' + 'L'.repeat(35), payload: i => `load-${prof.name}-c${c}-${i}`, price,
        makeProvider: clock => realisticMock(clock, {rpm: prof.rpm, latencyMs: config.MOCK_LATENCY_MS, errorRate: prof.errorRate, seed: 7 + c}),
      });
      t.profile = prof.name;
      results.load.push(t); log([{suite: 'load', ...t}]);
      say(`  c=${String(c).padStart(2)}: ${t.successful}/${t.total_requests} OK, ${t.provider_calls} κλήσεις (×${t.amplification}), 429=${t.rate_limit_errors}, 5xx=${t.provider_errors}, p95=${Math.round(t.latency_ms.p95 ?? 0)}ms`);
    }
  }
}

const summary = summarize(results);
const meta = {timestamp: new Date().toISOString(), mode: LIVE ? 'live' : 'mock', config};
const md = renderReport({meta, results, summary});
fs.writeFileSync(new URL('report.md', outDir), redact(md));
fs.writeFileSync(new URL('summary.json', outDir), JSON.stringify({meta, summary}, null, 2));
fs.copyFileSync(new URL('report.md', outDir), new URL('./LAST_REPORT.md', import.meta.url));
// Για τη σύγκριση live ↔ mock: σύνοψη και pass/fail ανά test του τελευταίου mock run.
fs.writeFileSync(new URL('./LAST_MOCK_SUMMARY.json', import.meta.url), JSON.stringify({meta, summary,
  tests: Object.fromEntries([...results.catalog, ...results.failures].map(r => [r.test_id, r.pass]))}, null, 2));

const P = v => v == null ? 'N/A' : v + '%';
say(`\n━━ ${summary.passed}/${summary.total} passed · retrieval ${P(summary.retrieval_accuracy)} · hallucination ${P(summary.hallucination_rate)} · injection success ${P(summary.prompt_injection_success_rate)} · provider success ${P(summary.provider_success_rate)}`);
say(`Report: ${new URL('report.md', outDir).pathname}`);
if(env.STRICT === '1' && summary.failed) process.exit(1);
process.exit(0);   // τα σενάρια «hang» αφήνουν εκκρεμείς promises επίτηδες
