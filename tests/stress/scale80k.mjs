// Πόσο αντέχει η εφαρμογή με 80.000 χρήστες ταυτόχρονα; — τι μετριέται πραγματικά και τι προσομοιώνεται.
//   node tests/stress/scale80k.mjs            (USERS=80000 SCALE=0.1 για άλλες τιμές)
// ΔΕΝ στέλνει ούτε ένα αίτημα σε πραγματική υπηρεσία (GitHub Pages, Google, Anthropic): 80.000 πραγματικά
// αιτήματα θα ήταν επίθεση σε τρίτους. Το δίκτυο είναι mock με εικονικό ρολόι (όπως το υπόλοιπο stress suite).
//   A. ΜΕΤΡΗΘΗΚΕ   βάρος σελίδας (από τα πραγματικά αρχεία) → πόσα GB/μήνα ζητά ο στόχος από το hosting
//   B. ΜΕΤΡΗΘΗΚΕ   CPU του κινητού ανά χρήστη (parser) — το κόστος είναι στη συσκευή του κάθε χρήστη
//   C. ΠΡΟΣΟΜΟΙΩΘΗΚΕ κλήσεις προς provider με 80.000 χρήστες: (1) καθένας με δικό του key (σήμερα),
//                    (2) ένα κοινό key πίσω από μελλοντικό server, με διάφορα όρια αιτημάτων/λεπτό.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { parse } from '../../src/parse.js';
import { runLoadTier, realisticMock } from './suites/provider-load.mjs';
import { freshPhoto } from './suites/provider-failures.mjs';
import { installClock } from './lib/clock.mjs';
import { mockProvider, ok, err } from './lib/provider.mjs';
import { rng, lognormal, round } from './lib/stats.mjs';

const USERS = Number(process.env.USERS || 80000);
const SCALE = Number(process.env.SCALE || 0.1);            // 1 εικονικό δευτερόλεπτο = SCALE πραγματικά
const ROOT = new URL('../../', import.meta.url);
const out = [];
const say = s => { console.log(s); out.push(s); };
const fmt = n => n.toLocaleString('el-GR');
const KB = b => (b / 1024).toFixed(1) + ' KB';
const GB = b => (b / 1024 ** 3).toFixed(1) + ' GB';

// ── A. Βάρος σελίδας ─────────────────────────────────────────
say(`# Stress test ${fmt(USERS)} χρηστών — ${new Date().toISOString().slice(0, 10)}\n`);
say('> Τι είναι μετρημένο και τι προσομοίωση φαίνεται σε κάθε ενότητα. Δεν έγινε ΚΑΝΕΝΑ πραγματικό αίτημα προς GitHub Pages / Google / Anthropic.\n');
say('## A. Βάρος σελίδας — ΜΕΤΡΗΘΗΚΕ (gzip, όπως το σερβίρει το GitHub Pages)');
const gz = f => zlib.gzipSync(fs.readFileSync(new URL(f, ROOT)), {level: 9}).length;
const mods = ['index.html', ...fs.readdirSync(new URL('src/', ROOT)).map(f => 'src/' + f)];
const initial = mods.reduce((s, f) => s + gz(f), 0);
const pdfLib = gz('vendor/html2pdf.bundle.min.js'), sdk = gz('vendor/anthropic-sdk-0.129.0.mjs');
say(`| Τι | gzip | πότε φορτώνεται |\n|---|---|---|`);
say(`| Εφαρμογή (${mods.length} αρχεία: index + ${mods.length - 1} modules) | ${KB(initial)} | σε κάθε πρώτη επίσκεψη |`);
say(`| Βιβλιοθήκη PDF (html2pdf) | ${KB(pdfLib)} | μόνο όταν φτιαχτεί 1ο PDF |`);
say(`| Anthropic SDK | ${KB(sdk)} | μόνο αν ο χρήστης έχει key Anthropic |`);
const perUser = initial + pdfLib, total = perUser * USERS;
const SOFT = 100 * 1024 ** 3;
say(`\nΠρώτη επίσκεψη με PDF: ${KB(perUser)} ανά χρήστη → **${GB(total)}** για ${fmt(USERS)} χρήστες (χωρίς cache, χωρίς Google Fonts).`);
say(`Το GitHub Pages έχει **soft όριο 100 GB/μήνα** (docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) → ` +
  `${(SOFT / total).toFixed(1)} τέτοια «κύματα» χρηστών τον μήνα μέχρι να ξεπεραστεί· στις επόμενες επισκέψεις ο browser χρησιμοποιεί cache.`);
say(`Αιτήματα προς το hosting: ${mods.length} αρχεία ανά πρώτη επίσκεψη (+1 για το PDF) → αν και οι ${fmt(USERS)} έρχονται μέσα σε 1 λεπτό: ` +
  `≈ ${fmt(Math.round(USERS * (mods.length + 1) / 60))} αιτήματα/δευτ. σε στατικά αρχεία (CDN· ΔΕΝ μετρήθηκε — δεν φορτώνουμε τρίτο).\n`);

// ── B. CPU ανά χρήστη ────────────────────────────────────────
say('## B. CPU στη συσκευή του κάθε χρήστη — ΜΕΤΡΗΘΗΚΕ (parser, Node· το κινητό είναι πιο αργό)');
const phrases = [
  'δέκα μέτρα σωλήνα φ20, δύο μπαταρίες νιπτήρα και έναν νιπτήρα', 'αλλαγή λεκάνης κρεμαστή, ένα θερμοσίφωνα και τρία σιφόνια',
  'μπάνιο 12 τετραγωνικά πλακάκι λευκό στεγάνωση 12 τετραγωνικά και μία καμπίνα ντουζιέρας', 'δέκα πρίζες δεκαπέντε σποτ και είκοσι μέτρα καλώδιο',
  'βάψιμο 45 τετραγωνικά και μία πόρτα εσωτερική', 'ξηλωσε 3 μπαταριες, βαλε 2 νιπτηρες και 6 μετρα σωληνα ppr, οχι τον θερμοσιφωνα',
  '2 μπαταρίες ντουζιέρας, όχι 3 τελικά 2, και 15 τ.μ. πλακάκι γκρι πέτρα με κόλλα', 'kitchen sink with mixer, 5 sockets and 10 m cable',
];
const lats = [];
const t0 = performance.now();
for(let i = 0; i < USERS; i++){ const a = performance.now(); parse(phrases[i % phrases.length] + (i % 7 ? '' : ' ' + phrases[(i + 3) % phrases.length])); lats.push(performance.now() - a); }
const cpu = performance.now() - t0;
lats.sort((a, b) => a - b);
say(`${fmt(USERS)} αναλύσεις κειμένου σε ${(cpu / 1000).toFixed(2)} s σε ΕΝΑ νήμα → μέσο ${(cpu / USERS * 1000).toFixed(0)} µs, p95 ${(lats[Math.floor(USERS * .95)] * 1000).toFixed(0)} µs, max ${lats.at(-1).toFixed(2)} ms.`);
say('Κάθε χρήστης το τρέχει στο δικό του κινητό: το κόστος δεν προστίθεται σε κάτι κοινό. Δεν υπάρχει server ή βάση μας που να φορτώνει.\n');

// ── C. Κλήσεις προς provider ─────────────────────────────────
say(`## C. Κλήσεις ανάγνωσης φωτογραφίας με ${fmt(USERS)} χρήστες — ΠΡΟΣΟΜΟΙΩΣΗ (mock provider, εικονικό ρολόι ×${round(1 / SCALE)})`);
say('Κάθε χρήστης διαβάζει 1 φωτογραφία· όλοι ξεκινούν μέσα σε 60 δευτερόλεπτα. Latency mock: log-normal, διάμεσος 3 s. ' +
  'Οι παράμετροι (όρια, ποσοστό 503) είναι ΥΠΟΘΕΣΕΙΣ, όχι μετρήσεις της πραγματικής υπηρεσίας.\n');
const RPS = USERS / 60;
const base = {timeout: 120000, harnessRetries: 0, scale: SCALE, rps: RPS, concurrency: USERS, requestCount: USERS, apiKey: 'AIza' + 'S'.repeat(35), payload: i => `scale-${i}`,
  price: {in: 0.3, out: 2.5}};
const rows = [];
async function tier(label, makeProvider){
  const t0r = performance.now();
  const t = await runLoadTier({...base, label, makeProvider});
  const real = ((performance.now() - t0r) / 1000).toFixed(1);
  // Ίδια μηνύματα που διαφέρουν μόνο στον αριθμό δευτερολέπτων ομαδοποιούνται.
  const grouped = {};
  for(const [m, n] of Object.entries(t.user_visible_errors)){ const k = m.replace(/\d+/g, 'N').slice(0, 60); grouped[k] = (grouped[k] || 0) + n; }
  const err_ = Object.entries(grouped).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${fmt(n)}× «${m}»`).join(' · ') || '—';
  rows.push(`| ${label} | ${fmt(t.successful)} / ${fmt(t.total_requests)} (${t.success_rate}%) | ${fmt(t.provider_calls)} (×${t.amplification}) | ${fmt(t.rate_limit_errors)} | ${fmt(t.provider_errors)} | ${Math.round(t.latency_ms.median ?? 0)} / ${Math.round(t.latency_ms.p95 ?? 0)} / ${Math.round(t.latency_ms.p99 ?? 0)} ms | ${err_} |`);
  console.log(`  ${label}: ${t.successful}/${t.total_requests} OK, ${t.provider_calls} κλήσεις, 429=${t.rate_limit_errors} (${real}s πραγματικά)`);
  return t;
}

// (1) Δικό key ανά χρήστη: το όριο μετράει ανά key/project → ο καθένας έχει δικό του.
const perKey = (clock) => {
  const rand = rng(11), win = {};
  return mockProvider(clock, call => {
    const w = (win[call.tag + call.model] ||= []);
    while(w.length && call.at - w[0] > 60000) w.shift();
    if(w.length >= 10) return {...err(429, 'Resource has been exhausted.', 'RESOURCE_EXHAUSTED', {'retry-after': '20'}), delayMs: 80};
    w.push(call.at);
    if(rand() < 0.05) return {...err(503, 'The model is overloaded.', 'UNAVAILABLE'), delayMs: lognormal(rand, 1000)};
    return {...ok('12 μέτρα σωλήνας\n1 τεμάχιο λεκάνη κρεμαστή'), delayMs: lognormal(rand, 3000)};
  });
};
const control = await tier('1. Δικό key ανά χρήστη (όριο 10/λεπτό/key, 5% 503)', perKey);
// (2) Ένα κοινό key — μελλοντικός server. Όριο αιτημάτων/λεπτό ανά μοντέλο.
for(const rpm of [10, 1000, 10000, 100000]){
  await tier(`2. ΕΝΑ κοινό key, όριο ${fmt(rpm)}/λεπτό/μοντέλο`, clock => realisticMock(clock, {rpm, latencyMs: 3000, errorRate: 0.05, seed: 13}));
}
say(`| Σενάριο | Επιτυχία | Κλήσεις provider | 429 | 5xx | Latency διάμεσος / p95 / p99 (επιτυχίες) | Τι είδε ο χρήστης |\n|---|---|---|---|---|---|---|`);
rows.forEach(r => say(r));
say('\n*Οι «Κλήσεις provider» στο (2) είναι ΚΑΤΩ όριο: όλοι οι χρήστες μοιράζονται ΜΙΑ συνεδρία κώδικα, άρα μετά το πρώτο 429 το μοντέλο «κλειδώνει» για όλους. ' +
  'Στην πράξη κάθε browser έχει δική του συνεδρία — δες παρακάτω.*\n');

// (3) Χειρότερη περίπτωση ανά χρήστη: κάθε browser με δική του συνεδρία, provider εντελώς εξαντλημένος.
const SAMPLE = Math.min(USERS, 2000);
say(`### Χειρότερη περίπτωση ανά χρήστη (δείγμα ${fmt(SAMPLE)} χρηστών, ο καθένας με ΔΙΚΗ του συνεδρία, provider που απαντά συνέχεια 429 ή 503)`);
for(const [name, spec] of [['όλα 429', () => ({...err(429, 'Resource has been exhausted.', 'RESOURCE_EXHAUSTED', {'retry-after': '20'}), delayMs: 80})],
                           ['όλα 503', () => ({...err(503, 'The model is overloaded.', 'UNAVAILABLE'), delayMs: 500})]]){
  const clock = installClock(SCALE);
  const prov = mockProvider(clock, spec); prov.install();
  const per = new Array(SAMPLE).fill(0), results = [];
  try {
    await Promise.all(Array.from({length: SAMPLE}, async (_, i) => {
      const {readNotes} = await freshPhoto(`worst-${name}-${i}`);
      const before = prov.calls.length;
      await clock.sleep(i * (60000 / SAMPLE));
      const r = await readNotes(`worst-${i}`, {apiKey: 'AIza' + 'W'.repeat(35)}).then(() => 'ok', e => e.message);
      results.push(r);
    }));
  } finally { prov.uninstall(); clock.uninstall(); }
  const perUser = {}; for(const c of prov.calls){ perUser[c.tag] = (perUser[c.tag] || 0) + 1; }
  const counts = Object.values(perUser).sort((a, b) => a - b);
  const maxCalls = counts.at(-1) ?? 0, avg = prov.calls.length / SAMPLE;
  say(`- **${name}**: ${fmt(prov.calls.length)} κλήσεις από ${fmt(SAMPLE)} χρήστες → μέσο ${avg.toFixed(1)} κλήσεις/χρήστη, **μέγιστο ${maxCalls}**. ` +
      `Δηλαδή το πολύ ${maxCalls} κλήσεις ανά χρήστη (όριο της πολιτικής) → για ${fmt(USERS)} χρήστες ≤ ${fmt(maxCalls * USERS)} κλήσεις προς τον provider. ` +
      `Ο χρήστης βλέπει: «${[...new Set(results)][0]?.slice(0, 90)}».`);
}

fs.writeFileSync(new URL('SCALE_80K.md', import.meta.url), out.join('\n') + '\n');
console.log('\nΑναφορά: tests/stress/SCALE_80K.md');
process.exit(0);
