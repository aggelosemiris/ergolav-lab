// Παράγει το markdown report από τα αποτελέσματα (όλα τα νούμερα υπολογίζονται από τα logs).
import { latencySummary, round, pct } from './stats.mjs';

// Προτεραιότητα ανά test (με βάση τον αντίκτυπο στον τεχνίτη/πελάτη) — default MEDIUM.
const PRIORITY = [
  [/^live-04/, 'CRITICAL'],
  [/^fail-1[01]/, 'HIGH'],          // χωρίς timeout — η οθόνη μένει για πάντα στο «Διαβάζω…»
  [/^fail-06/, 'HIGH'],             // 429: αγνοεί Retry-After, 15 αιτήματα ανά πάτημα
  [/^fail-16/, 'HIGH'],             // σιωπηλά κομμένη λίστα υλικών
  [/^llmout-0[123]/, 'HIGH'],       // παράλογες ποσότητες / τιμές ως ποσότητες μπαίνουν στην προσφορά
  [/^conflict-/, 'HIGH'],           // λάθος ποσότητα/υλικό στην προσφορά χωρίς προειδοποίηση
  [/^fail-09|^fail-12|^fail-20/, 'MEDIUM'],
  [/^similar-|^partial-|^variation-0[4789]|^variation-1[034]|^llmout-0[45]/, 'MEDIUM'],
  [/^variation-0[56]|^fail-1[345]|^large-/, 'LOW'],
];
const priorityOf = id => (PRIORITY.find(([re]) => re.test(id)) || [, 'MEDIUM'])[1];

export function summarize({catalog = [], failures = [], load = [], live = [], liveLoad = []}){
  const judged = [...catalog, ...failures, ...live].filter(r => r.pass !== null);
  const retr = [...catalog, ...live].filter(r => r.pass !== null && r.expected);
  const answer = [...catalog, ...live].filter(r => r.pass !== null);
  // Μόνο live cases όπου το μοντέλο ΑΠΑΝΤΗΣΕ — αλλιώς δεν υπάρχει μέτρηση (όχι «0% επιτυχία»).
  const answered = live.filter(r => r.pass !== null && r.final_answer != null);
  const inj = answered.filter(r => r.category === 'injection');
  const allLoad = [...load, ...liveLoad];
  const reqs = allLoad.reduce((s, t) => s + t.total_requests, 0);
  const calls = allLoad.reduce((s, t) => s + t.provider_calls, 0);
  const lat = latencySummary(allLoad.flatMap(t => t.latency_ms?.count ? [t.latency_ms.avg] : []));
  return {
    total: judged.length, passed: judged.filter(r => r.pass).length, failed: judged.filter(r => !r.pass).length,
    informational: [...catalog, ...live].filter(r => r.pass === null).length,
    retrieval_accuracy: pct(retr.reduce((s, r) => s + r.found, 0), retr.reduce((s, r) => s + r.expected, 0)),
    answer_accuracy: pct(answer.filter(r => r.pass).length, answer.length),
    faithfulness: pct(answered.filter(r => !r.hallucination_detected && !r.prompt_injection_detected).length, answered.length),
    live_answered: answered.length,
    hallucination_rate: pct(answer.filter(r => r.hallucination_detected).length, answer.length),
    prompt_injection_success_rate: pct(inj.filter(r => r.prompt_injection_detected).length, inj.length),
    llm_output_robustness: pct(catalog.filter(r => r.category === 'llm-output' && r.pass).length, catalog.filter(r => r.category === 'llm-output').length),
    provider_success_rate: pct(allLoad.reduce((s, t) => s + t.successful, 0), reqs),
    provider_failure_rate: pct(allLoad.reduce((s, t) => s + t.failed, 0), reqs),
    timeout_rate: pct(allLoad.reduce((s, t) => s + t.timeouts, 0), reqs),
    rate_limit_rate: pct(allLoad.reduce((s, t) => s + t.rate_limit_errors, 0), calls),
    latency_note: 'από τα load runs (μέσος όρος ανά βαθμίδα)',
    avg_latency: lat.avg, p95: Math.max(0, ...allLoad.map(t => t.latency_ms?.p95 ?? 0)), p99: Math.max(0, ...allLoad.map(t => t.latency_ms?.p99 ?? 0)),
  };
}

const f = (v, unit = '') => v == null ? 'N/A' : `${typeof v === 'number' ? round(v, 1) : v}${unit}`;
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ⏎ ');

export function renderReport({meta, results, summary}){
  const {catalog = [], failures = [], load = [], live = [], liveLoad = []} = results;
  const L = [];
  L.push(`# ergolav — Stress test report`, ``, `- Ημερομηνία: ${meta.timestamp}`, `- Mode: **${meta.mode}**${meta.mode === 'mock' ? ' (ψεύτικος provider — καμία δικτυακή κλήση· οι χρόνοι είναι προσομοιωμένοι)' : ''}`,
    `- Ρυθμίσεις: \`${JSON.stringify(meta.config)}\``, ``);
  L.push('## RAG STRESS TEST RESULTS (προσαρμοσμένο στο ergolav)', '', '| Μέτρηση | Τιμή |', '|---|---|',
    `| Total Tests | ${summary.total} (+${summary.informational} informational) |`,
    `| Passed | ${summary.passed} |`, `| Failed | ${summary.failed} |`,
    `| Retrieval Accuracy (υλικά που βρέθηκαν / αναμενόμενα) | ${f(summary.retrieval_accuracy, '%')} |`,
    `| Answer Accuracy (cases πλήρως σωστά) | ${f(summary.answer_accuracy, '%')} |`,
    `| Faithfulness (μόνο live, ${summary.live_answered} cases με απάντηση) | ${f(summary.faithfulness, '%')} |`,
    `| Hallucination Rate (υλικό/ποσότητα που δεν ειπώθηκε μπήκε στην προσφορά) | ${f(summary.hallucination_rate, '%')} |`,
    `| Prompt Injection Success Rate (μόνο live — χρειάζεται πραγματικό μοντέλο) | ${f(summary.prompt_injection_success_rate, '%')} |`,
    `| LLM-output robustness (parser απέναντι σε «περίεργη» έξοδο μοντέλου) | ${f(summary.llm_output_robustness, '%')} |`,
    `| Average Latency (${summary.latency_note}) | ${f(summary.avg_latency, ' ms')} |`,
    `| P95 Latency (χειρότερη βαθμίδα) | ${f(summary.p95, ' ms')} |`, `| P99 Latency (χειρότερη βαθμίδα) | ${f(summary.p99, ' ms')} |`,
    `| Provider Success Rate (ανά πάτημα χρήστη) | ${f(summary.provider_success_rate, '%')} |`,
    `| Provider Failure Rate | ${f(summary.provider_failure_rate, '%')} |`,
    `| Timeout Rate (όριο harness ${meta.config.TIMEOUT} ms) | ${f(summary.timeout_rate, '%')} |`,
    `| Rate Limit Rate (429 ανά HTTP κλήση) | ${f(summary.rate_limit_rate, '%')} |`, '');

  // Issues ανά προτεραιότητα
  const failed = [...catalog, ...failures, ...live].filter(r => r.pass === false);
  // Μία γραμμή ανά προφίλ φορτίου. HIGH μόνο αν χάθηκαν πατήματα χρηστών (<95%)· αλλιώς το κόστος είναι
  // οι επιπλέον κλήσεις (MEDIUM όταν είναι 429 — επιβαρύνουν το ίδιο όριο) ή μόνο η καθυστέρηση (LOW).
  const profiles = {};
  for(const t of [...load, ...liveLoad]) (profiles[t.profile ?? 'live'] ||= []).push(t);
  const loadIssues = Object.entries(profiles).flatMap(([name, ts]) => {
    const worst = Math.min(...ts.map(t => t.success_rate));
    const amp = ts.map(t => t.amplification), p95 = ts.map(t => round(t.latency_ms.p95 ?? 0));
    const rl = ts.reduce((s, t) => s + t.rate_limit_errors, 0);
    if(worst >= 95 && Math.max(...amp) <= 2) return [];
    return [{
      test_id: `load-${name}`, priority: worst < 95 ? 'HIGH' : rl ? 'MEDIUM' : 'LOW',
      query: `προφίλ ${name}, concurrency ${ts.map(t => t.concurrency).join('/')}`,
      failure_reason: `χειρότερη επιτυχία ${worst}% · ×${Math.min(...amp)}–×${Math.max(...amp)} HTTP κλήσεις ανά πάτημα · 429: ${rl} · p95 ${Math.min(...p95)}–${Math.max(...p95)} ms`,
      root_cause: worst < 95
        ? `provider — χωρητικότητα: τα ταυτόχρονα αιτήματα ξεπερνούν το όριο αιτημάτων/λεπτό (χειρότερο στο c=${ts.find(t => t.success_rate === worst).concurrency}). Client-side δεν λύνεται· χρειάζεται ουρά (backend) ή μεγαλύτερο όριο`
        : rl ? 'retry mechanism — επιπλέον κλήσεις για να βρεθεί μοντέλο με διαθέσιμο όριο (429)'
             : 'retry mechanism — επιτυχής ανάκαμψη· το κόστος είναι καθυστέρηση από τα retries/backoff',
    }];
  });
  const all = [...failed, ...loadIssues];
  for(const p of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']){
    const items = all.filter(r => (r.critical ? 'CRITICAL' : r.priority ?? priorityOf(r.test_id)) === p);
    L.push(`## ${p === 'CRITICAL' ? 'CRITICAL FAILURES' : p + ' PRIORITY ISSUES'} (${items.length})`, '');
    if(!items.length){ L.push('_Κανένα._', ''); continue; }
    L.push('| Test | Είσοδος | Τι έγινε (απόδειξη) | Root cause |', '|---|---|---|---|');
    for(const r of items) L.push(`| \`${r.test_id}\` | ${esc(r.query).slice(0, 90)} | ${esc(r.failure_reason)} | ${esc(r.root_cause)} |`);
    L.push('');
  }

  // Αναλυτικά
  L.push('## Retrieval / parser (ανά κατηγορία)', '', '| Κατηγορία | Pass | Fail | Info |', '|---|---|---|---|');
  const cats = [...new Set(catalog.map(r => r.category))];
  for(const c of cats){ const rs = catalog.filter(r => r.category === c);
    L.push(`| ${c} | ${rs.filter(r => r.pass).length} | ${rs.filter(r => r.pass === false).length} | ${rs.filter(r => r.pass === null).length} |`); }
  L.push('');
  const info = [...catalog, ...live].filter(r => r.pass === null);
  if(info.length){ L.push('**Informational (πολιτική, όχι pass/fail):**', '');
    for(const r of info) L.push(`- \`${r.test_id}\`: «${esc(r.query)}» → ${r.retrieved.filter(x => !x.unknown).map(x => `${x.qty} ${x.unit || ''} ${x.name || x.id}`).join(', ')} — ${r.note}`);
    L.push(''); }

  L.push('## Provider failure simulation', '', '| Σενάριο | Αποτέλεσμα | HTTP κλήσεις | Αναμονές backoff | Χρόνος | Μήνυμα στον χρήστη | Έλεγχοι που απέτυχαν |', '|---|---|---|---|---|---|---|');
  for(const r of failures) L.push(`| ${esc(r.query)} | ${r.pass ? '✅' : '❌'} | ${r.http_statuses.length} (${esc(r.http_statuses.join(','))}) | ${r.backoff_waits_ms.join(', ') || '—'} | ${round(r.latency_ms / 1000, 1)} s | ${esc(r.error_shown_to_user ?? '(επιτυχία)').slice(0, 80)} | ${esc(r.checks.filter(c => !c.pass).map(c => c.name).join('; ')) || '—'} |`);
  L.push('');

  for(const [title, rows] of [['Load test (mock provider)', load], ['Load test (live provider)', liveLoad]]){
    if(!rows.length) continue;
    L.push(`## ${title}`, '', '| Προφίλ | Concurrency | Αιτήματα | OK | Fail | Timeouts | HTTP κλήσεις (×) | 429 | 5xx | Retries | avg / p50 / p95 / p99 / min / max (ms) | Throughput (OK/s) | Tokens (in/out) | Κόστος |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for(const t of rows){ const l = t.latency_ms;
      L.push(`| ${t.profile ?? t.label} | ${t.concurrency} | ${t.total_requests} | ${t.successful} | ${t.failed} | ${t.timeouts} | ${t.provider_calls} (×${t.amplification}) | ${t.rate_limit_errors} | ${t.provider_errors} | ${t.retry_count} | ${[l.avg, l.median, l.p95, l.p99, l.min, l.max].map(x => x == null ? '—' : round(x)).join(' / ')} | ${t.throughput_rps} | ${t.tokens ? `${t.tokens.input}/${t.tokens.output}` : '—'} | ${t.estimated_cost ?? '—'} |`); }
    L.push('');
    const errs = rows.flatMap(t => Object.entries(t.user_visible_errors).map(([m, n]) => `${t.profile ?? ''} c=${t.concurrency}: ${n}× «${m}…»`));
    if(errs.length) L.push('Μηνύματα που είδαν οι χρήστες:', '', ...errs.map(e => `- ${e}`), '');
  }
  if(meta.mode === 'mock') L.push('> Τα tokens στο mock είναι σταθερά ενδεικτικά νούμερα (δεν μετρήθηκαν). Πραγματικά tokens/κόστος μόνο στο live mode.', '');

  if(live.length){
    L.push('## Live quality (πραγματικός provider)', '', '| Test | Pass | Υλικά που βγήκαν | Tokens in/out | Latency | Αιτία αποτυχίας |', '|---|---|---|---|---|---|');
    for(const r of live) L.push(`| \`${r.test_id}\` | ${r.pass === null ? 'info' : r.pass ? '✅' : '❌'} | ${esc(r.retrieved.filter(x => !x.unknown).map(x => `${x.qty} ${x.id}`).join(', ') || r.error_shown_to_user)} | ${r.input_tokens}/${r.output_tokens} | ${round(r.latency_ms)} ms | ${esc(r.failure_reason) || '—'} |`);
    L.push('');
  }
  return L.join('\n');
}
