# Stress test — ergolav

Επαναλήψιμο stress/adversarial test για την ανάγνωση σημειώσεων (LLM provider) και την αντιστοίχιση
κειμένου σε υλικά καταλόγου. **Δεν αλλάζει τίποτα στην εφαρμογή**: εισάγει τα `src/*.js` όπως είναι και
αντικαθιστά μόνο το `fetch` και το `setTimeout` μέσα στο process του test. Χωρίς νέα dependencies (Node ≥ 22).

## Εκτέλεση

```sh
npm run test:stress                 # MOCK — ψεύτικος provider, καμία δικτυακή κλήση, ~1 λεπτό
npm run test:stress:scale            # 80.000 χρήστες: μετρημένο βάρος/CPU + προσομοίωση provider → SCALE_80K.md
npm run test:stress:live:dry        # LIVE harness με προσομοιωμένη ανάγνωση — 0 πραγματικές κλήσεις
npm run test:stress:live            # LIVE — πραγματικό Gemini (χρειάζεται GEMINI_API_KEY)
STRICT=1 npm run test:stress        # exit code 1 αν αποτύχει κάποιο mock test (για CI)
```

### Το key για το live (μόνο environment variable — ποτέ σε αρχείο)

Η εφαρμογή στον browser **δεν** διαβάζει environment variables (το key μπαίνει στην οθόνη και μένει στο
`localStorage` του κινητού). Μόνο το live test διαβάζει **`GEMINI_API_KEY`** (`tests/stress/run-live.mjs`).

macOS / Linux (μόνο για το τρέχον terminal):
```sh
export GEMINI_API_KEY="MY_API_KEY"
npm run test:stress:live
unset GEMINI_API_KEY
```
Για να μη μείνει το key στο ιστορικό του shell: `read -rs GEMINI_API_KEY && export GEMINI_API_KEY` (επικόλληση + Enter).

Windows PowerShell (μόνο για το τρέχον παράθυρο):
```powershell
$env:GEMINI_API_KEY="MY_API_KEY"
npm run test:stress:live
Remove-Item Env:GEMINI_API_KEY
```
Για να μη μείνει στο ιστορικό (PowerShell 7+): `$env:GEMINI_API_KEY = Read-Host -MaskInput`.

Σε cloud session του Claude Code: πρόσθεσε το `GEMINI_API_KEY` ως environment variable στις ρυθμίσεις του
environment· το βλέπει νέο session.

### Όρια ασφαλείας του live

**Μόνο συνθετικές φωτογραφίες** (`fixtures/`, κείμενο γραμμένο για το test — κανένα πραγματικό όνομα, τηλέφωνο ή
διεύθυνση). Στο δωρεάν επίπεδο του Gemini η Google μπορεί να χρησιμοποιήσει το περιεχόμενο και να το διαβάσουν
άνθρωποι (βλ. `docs/SOURCES.md`). Καμία φωτογραφία πελάτη ή πραγματικής σημείωσης στο live.

Concurrency 1 · έως **10** πραγματικές κλήσεις συνολικά (`LIVE_MAX_CALLS`, πάνω από 10 μόνο με
`LIVE_ALLOW_MORE=1`) · έως **2** ανά test (`LIVE_MAX_CALLS_PER_TEST`) · οι κλήσεις πέρα από τα όρια μπλοκάρονται
τοπικά και δεν φεύγουν · **διακοπή** με την πρώτη μη αναμενόμενη κατανάλωση (retry, οποιοδήποτε μη-200,
timeout). Το key γίνεται redact σε κάθε έξοδο και στο τέλος ελέγχονται όλα τα αρχεία εξόδου για κομμάτι του.

Τα 8 live σενάρια (`cases/live.cases.mjs`): καθαρή φωτογραφία (+2 επαναλήψεις αν μένουν κλήσεις), πολλά υλικά,
διόρθωση, άρνηση, τιμή, άγνωστη ποσότητα, prompt injection, κομμένη/θολή. Report: `LAST_REPORT_LIVE.md`
(dry: `LAST_REPORT_LIVE_DRY.md`) — MOCK και LIVE σε ξεχωριστές ενότητες, με σύγκριση.

## Τι ελέγχεται

| Suite | Αρχείο | Τι μετράει | Δίκτυο |
|---|---|---|---|
| Parser / κατάλογος | `suites/catalog.mjs`, `cases/catalog.cases.mjs` | Το «retrieval» του ergolav: σωστό υλικό & ποσότητα σε normal, noise, similar-but-wrong, conflict/διόρθωση, missing, partial, multi, duplicate, variation (ορθογραφία, συνώνυμα, greeklish, αγγλικά), έξοδος LLM (τιμές, markdown, εισαγωγές), μεγάλη είσοδος | όχι |
| Provider failures | `suites/provider-failures.mjs` | 20 σενάρια: 429 (+Retry-After), 500, 502, 503, network, timeout/hang, αργή απάντηση, HTML αντί JSON, κενό, malformed, MAX_TOKENS, SAFETY, άκυρο key, 404, injected «ΚΑΜΙΑ ΣΗΜΕΙΩΣΗ». Ελέγχει retry, backoff, Retry-After, όριο retries, timeout, μήνυμα στον χρήστη | όχι (mock) |
| Load | `suites/provider-load.mjs` | Βαθμίδες concurrency με δύο προφίλ provider: `quota` (όριο αιτημάτων/λεπτό ανά μοντέλο) και `overload` (πολλά 503). Latency avg/p50/p95/p99/min/max, throughput, 429/5xx, retries, πολλαπλασιασμός κλήσεων, tokens, κόστος | όχι (mock) ή ναι (live) |
| Live quality | `suites/live.mjs`, `cases/live.cases.mjs`, `fixtures/` | 10 φωτογραφίες: normal, noise, τιμολόγιο, **prompt injection μέσα στη φωτογραφία**, κενή, διαγραμμένα/διορθώσεις, ελλιπή, μεγάλη λίστα, διπλότυπα, αγγλικά. Ντετερμινιστικοί έλεγχοι (αναμενόμενα/απαγορευμένα υλικά, απαγορευμένο κείμενο, διαρροή prompt) — όχι LLM-as-judge | ναι |

## Ρυθμίσεις (μεταβλητές περιβάλλοντος)

| Μεταβλητή | Mock default | Live default | Σημασία |
|---|---|---|---|
| `REQUEST_COUNT` | 50 | 3 | αιτήματα ανά βαθμίδα |
| `CONCURRENCY` | `1,5,10,25,50` | `1,2` | βαθμίδες (live: >10 μόνο με `ALLOW_HIGH_CONCURRENCY=1`) |
| `REQUESTS_PER_SECOND` | 0 (χωρίς όριο) | 0.5 | ρυθμός εκκίνησης |
| `TIMEOUT` | 60000 | 60000 | όριο του harness ανά πάτημα σε ms (η εφαρμογή δεν έχει δικό της) |
| `MAX_RETRIES` | 0 | 0 | επαναλήψεις ολόκληρου του `readNotes` από το harness (0 = μετράμε την εφαρμογή όπως είναι· τα δικά της retries είναι σταθερά στον κώδικα) |
| `TEST_DURATION` | 0 (χωρίς όριο) | 120000 | μετά από τόσα ms δεν ξεκινούν νέα αιτήματα |
| `MOCK_RPM` / `MOCK_LATENCY_MS` / `MOCK_ERROR_RATE` / `MOCK_OVERLOAD_ERROR_RATE` | 10 / 1800 / 0.02 / 0.6 | — | συμπεριφορά του ψεύτικου provider (υποθέσεις — άλλαξέ τες για τα δικά σου όρια) |
| `SCALE` | 0.01 | — | επιτάχυνση χρόνου στο mock (οι χρόνοι αναφέρονται σε «πραγματικά» ms, ±5%) |
| `LIVE_MAX_CALLS` | — | 10 | σκληρό όριο HTTP κλήσεων προς τον provider για όλο το run |
| `PRICE_IN_PER_M` / `PRICE_OUT_PER_M` | — | — | τιμή ανά 1M tokens για εκτίμηση κόστους (αλλιώς δεν υπολογίζεται) |

Παράδειγμα live:

```sh
GEMINI_API_KEY=… LIVE_REPEAT=2 npm run test:stress:live
GEMINI_API_KEY=… LIVE_LOAD=1 CONCURRENCY=1,2,5 REQUEST_COUNT=5 npm run test:stress:live
```

## Όρια

- Η διαδρομή **Claude** δεν ελέγχεται: φορτώνει το SDK από CDN στον browser, κάτι που δεν τρέχει σε Node.
- Η σμίκρυνση φωτογραφίας (`shrink`), η φωνή (`mic.js`) και το PDF (`share.js`) θέλουν browser· δεν είναι μέρος αυτού του suite.
- Στο mock, τα tokens είναι σταθερά ενδεικτικά νούμερα· πραγματικά tokens/κόστος μόνο σε live.
- Τα 503 στο προφίλ `overload` είναι ανεξάρτητα ανά κλήση· στην πράξη μια υπερφόρτωση κρατάει λεπτά και
  καλύπτεται από το σενάριο `fail-03-503-always` (όλες οι κλήσεις αποτυγχάνουν).
