# Local ergolav service

Run `npm start` with Node 24. The service binds only to `127.0.0.1:8087`.

Create a quote and open its companion-PDF dialog. First-time setup is shown there and sends the actual material analysis request, not a standalone probe. After successful analysis, the credential remains only in server memory until restart. It is never written to Git or sent back in status responses.

The technician requests the companion PDF without entering credentials. Material descriptions, quantities and units pass through the local server; customer and business profile data and quote prices do not.

Five demo units are provided. Analysis reserves one unit temporarily. The unit is consumed only after browser PDF creation succeeds and the completion endpoint confirms it. Completion is idempotent. Failed or cancelled analysis does not consume a unit.

The local ledger is `.service-data/lab.json`, excluded from Git and static serving. This prototype has one local demo account, no real payments and no production customer authentication. Public deployment requires authenticated customer/admin accounts, a persistent account ledger, verified payment events and server-side PDF generation/delivery.

Tests: `npm test`, and `node tests/browser/service.e2e.mjs` with the documented Playwright environment variables. Provider calls are mocked in tests; PDF generation is real. Actual provider access is verified by the owner, not assumed from mock results.

References:
- https://developers.openai.com/api/reference/overview
- https://developers.openai.com/api/docs/guides/error-codes


## Activation on an actual quote

The first setup now appears inside the companion-PDF dialog of a completed quote. The owner selects a provider and supplies the credential there once. `/api/service/analysis` performs the real analysis of that quote, without a separate generic probe. Configuration becomes active only after the complete analysis succeeds; errors and cancellation leave it unconfigured. Following quotes do not ask for a credential again during the same server session. The standalone owner page only explains this flow and manages demo balance.


## Gemini availability and latency

First-time Gemini activation lists the models available to the supplied credential and selects a compatible fast Flash model from that list instead of assuming a fixed model id. This metadata read is part of the quote request, not a separate text-generation probe. Gemini 2.5 uses the supported thinking-budget parameter; Flash-Lite classification uses minimal reasoning. No fallback sends data to a different provider.

Diagnostics record only provider, model endpoint, HTTP status, phase and duration; no credential, request body or report text is logged. The local diagnostic endpoint exposes the same bounded metadata. The service restores normal TLS certificate verification if the surrounding shell disabled it.

The real quote-6 trial on 2026-11-02 completed with gemini-3.5-flash-lite: model discovery approximately 0.23s, classification 2.13s, detail batches 3.99s and 1.54s. The generated companion PDF had three A4 pages. This observation is not a general latency guarantee.
