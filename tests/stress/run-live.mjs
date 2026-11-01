#!/usr/bin/env node
// ergolav — LIVE validation με πραγματικό Google Gemini.
//   npm run test:stress:live        (χρειάζεται GEMINI_API_KEY στο περιβάλλον)
//   npm run test:stress:live:dry    (ίδιος έλεγχος με προσομοιωμένη ανάγνωση — 0 πραγματικές κλήσεις)
// Ασφάλεια: concurrency 1 · έως 10 πραγματικές κλήσεις συνολικά · έως 2 ανά test · διακοπή με την πρώτη
// μη αναμενόμενη κατανάλωση (retry, 429, 5xx, timeout) · το key δεν γράφεται ποτέ σε αρχείο ή οθόνη.
import fs from 'node:fs';
import { runLiveValidation, guardedRecorder } from './suites/live.mjs';
import { renderLiveReport } from './lib/live-report.mjs';
import { installClock } from './lib/clock.mjs';
import { mockProvider, ok } from './lib/provider.mjs';

const env = process.env;
const DRY = process.argv.includes('--dry') || env.LIVE_DRY === '1';
const num = (k, d) => env[k] != null && env[k] !== '' ? Number(env[k]) : d;
const config = {
  LIVE_MAX_CALLS: num('LIVE_MAX_CALLS', 10), LIVE_MAX_CALLS_PER_TEST: num('LIVE_MAX_CALLS_PER_TEST', 2),
  LIVE_STOP_ON_UNEXPECTED: env.LIVE_STOP_ON_UNEXPECTED !== '0', LIVE_SET: env.LIVE_SET || 'validation', CONCURRENCY: 1,
};
function die(msg, code = 2){ console.error(`✗ ${msg}`); process.exit(code); }

if(config.LIVE_MAX_CALLS > 10 && env.LIVE_ALLOW_MORE !== '1') die('LIVE_MAX_CALLS > 10: βάλε και LIVE_ALLOW_MORE=1 αν το θέλεις σίγουρα.');
const apiKey = DRY ? 'AIza' + 'D'.repeat(35) : (env.GEMINI_API_KEY || '').trim();
if(!apiKey) die('Λείπει το GEMINI_API_KEY από το περιβάλλον. (Για έλεγχο χωρίς key: npm run test:stress:live:dry)');
if(!DRY && apiKey.startsWith('sk-ant-')) die('Το live test υποστηρίζει μόνο Gemini (η διαδρομή Claude φορτώνει SDK από CDN, όχι σε Node).');

// ── Κανένα secret σε έξοδο: redaction σε ό,τι γράφεται ή τυπώνεται + τελικός έλεγχος αρχείων ──
const secretParts = DRY ? [] : [apiKey, apiKey.slice(-8), apiKey.slice(0, 14)].filter(p => p.length >= 8);
const redact = s => {
  let out = String(s);
  for(const p of secretParts) out = out.split(p).join('[REDACTED_KEY]');
  return out.replace(/AIza[0-9A-Za-z_-]{6,}|sk-ant-[0-9A-Za-z_-]+/g, '[REDACTED_KEY]').replace(/(AIza|sk-ant)[^\s…"]{0,8}…[^\s"]{0,6}/g, '[REDACTED_KEY]');
};
const say = s => process.stdout.write(redact(s) + '\n');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = new URL(`./reports/${stamp}-${DRY ? 'dry' : 'live'}/`, import.meta.url);
fs.mkdirSync(outDir, {recursive: true});

say(`▸ ${DRY ? 'DRY RUN (προσομοιωμένη ανάγνωση — 0 πραγματικές κλήσεις)' : 'LIVE VALIDATION — πραγματικό Gemini'}`);
say(`  όρια: concurrency 1 · ${config.LIVE_MAX_CALLS} κλήσεις συνολικά · ${config.LIVE_MAX_CALLS_PER_TEST} ανά test · διακοπή σε μη αναμενόμενη κατανάλωση: ${config.LIVE_STOP_ON_UNEXPECTED ? 'ναι' : 'όχι'}`);

// Dry: «vision» που επιστρέφει ό,τι θα έγραφε ένα σωστό μοντέλο για κάθε φωτογραφία (ground truth).
const DRY_TEXT = {
  '01-normal.jpg': 'ανακαίνιση μπάνιου\n12 μέτρα σωλήνας\n1 τεμάχιο λεκάνη κρεμαστή\n1 τεμάχιο καζανάκι εντοιχισμού\n10 τετραγωνικά πλακάκι τοίχου λευκό',
  '11-many.jpg': 'ανακαίνιση μπάνιου Χαλάνδρι\nαποξήλωση\n2 κάδοι μπάζα\n8 τετραγωνικά στεγάνωση\n18 τετραγωνικά πλακάκι τοίχου γκρι\n6 τετραγωνικά πλακάκι δαπέδου γκρι\n1 τεμάχιο λεκάνη κρεμαστή\n1 τεμάχιο καζανάκι εντοιχισμού\n1 τεμάχιο έπιπλο μπάνιου 80\n1 τεμάχιο μπαταρία νιπτήρα\n1 τεμάχιο καμπίνα ντουζιέρας\n4 τεμάχια σποτ\n2 τεμάχια πρίζες',
  '12-correction.jpg': '12 μέτρα σωλήνα, όχι, τελικά 15 μέτρα\n1 τεμάχιο λεκάνη κρεμαστή',
  '13-negation.jpg': '1 τεμάχιο λεκάνη κρεμαστή\n2 τεμάχια διακόπτες γωνιακοί\nδεν χρειάζεται θερμοσίφωνας',
  '14-price.jpg': '1 τεμάχιο λεκάνη\n12 μέτρα σωλήνας',
  '15-unknown-qty.jpg': 'πλακάκια μπάνιου\n1 τεμάχιο μπαταρία νιπτήρα',
  '16-injection.jpg': '12 μέτρα σωλήνας\n1 τεμάχιο λεκάνη κρεμαστή\n2 τεμάχια διακόπτες γωνιακοί',
  '17-cut-blurry.jpg': '12 μέτρα σωλήνας\n1 τεμάχιο λεκάνη κρεμαστή\n2 τεμάχια διακόπτες γωνιακοί\n4 τεμάχια σποτ\n2 τεμάχια πρίζες',
};

let clock = null, mock = null;
if(DRY){
  clock = installClock(1);
  const byData = new Map();
  for(const [f, t] of Object.entries(DRY_TEXT)){
    try { const d = fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url)).toString('base64'); byData.set(`${d.length}:${d.slice(-40)}`, t); } catch {}
  }
  // LIVE_DRY_STATUS=503: προσομοίωση αστοχίας για να ελεγχθούν οι δικλείδες (όριο ανά test, διακοπή).
  const failStatus = num('LIVE_DRY_STATUS', 0);
  mock = mockProvider(clock, call => failStatus ? {status: failStatus, body: {error: {code: failStatus, message: 'simulated', status: 'UNAVAILABLE'}}} : ({...ok(byData.get(call.tag) ?? 'ΚΑΜΙΑ ΣΗΜΕΙΩΣΗ', {promptTokenCount: 1500, candidatesTokenCount: 30, totalTokenCount: 1530}), delayMs: 5}));
  mock.install();
}
const recorder = guardedRecorder({maxCalls: config.LIVE_MAX_CALLS, maxPerTest: config.LIVE_MAX_CALLS_PER_TEST});
recorder.install();
let res;
try {
  res = await runLiveValidation({apiKey, recorder, set: config.LIVE_SET, stopOnUnexpected: config.LIVE_STOP_ON_UNEXPECTED, say});
} finally {
  recorder.uninstall(); mock?.uninstall(); clock?.uninstall();
}
if(res.aborted) say(`  ⛔ ΔΙΑΚΟΠΗ: μη αναμενόμενη κατανάλωση — ${res.aborted}`);
say(`  ${DRY ? 'προσομοιωμένες' : 'πραγματικές'} κλήσεις: ${recorder.calls.length}/${config.LIVE_MAX_CALLS}${recorder.blocked ? ` · μπλοκαρίστηκαν από το όριο: ${recorder.blocked}` : ''}`);

let mockSummary = null;
try { mockSummary = JSON.parse(fs.readFileSync(new URL('./LAST_MOCK_SUMMARY.json', import.meta.url), 'utf8')); } catch {}

const meta = {timestamp: new Date().toISOString(), mode: DRY ? 'dry' : 'live', config, calls_made: recorder.calls.length, blocked: recorder.blocked, aborted: res.aborted};
const md = renderLiveReport({meta, res, calls: recorder.calls, mockSummary});
const files = {
  'report.md': md,
  'results.jsonl': res.rows.map(r => JSON.stringify(r)).join('\n') + '\n',
  'summary.json': JSON.stringify({meta, textPath: res.textPath}, null, 2),
};
for(const [name, content] of Object.entries(files)) fs.writeFileSync(new URL(name, outDir), redact(content));
const lastName = DRY ? 'LAST_REPORT_LIVE_DRY.md' : 'LAST_REPORT_LIVE.md';
fs.writeFileSync(new URL(`./${lastName}`, import.meta.url), redact(md));

// Τελικός έλεγχος: κανένα αρχείο εξόδου δεν περιέχει το key ή κομμάτι του. Δεν τυπώνεται η τιμή.
const written = [...Object.keys(files).map(n => new URL(n, outDir)), new URL(`./${lastName}`, import.meta.url)];
const leaked = written.filter(u => { const c = fs.readFileSync(u, 'utf8'); return secretParts.some(p => c.includes(p)); });
if(leaked.length){
  for(const u of leaked) fs.rmSync(u);
  die(`SECRET GUARD: βρέθηκε κομμάτι του key σε ${leaked.length} αρχείο(α) — διαγράφηκαν.`, 3);
}
say(`\nSECRET GUARD: κανένα κομμάτι του key στα αρχεία εξόδου ✓`);
say(`Report: tests/stress/${lastName}`);
process.exit(0);
