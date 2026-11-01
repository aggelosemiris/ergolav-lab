# Local ergolav service

Run `npm start` with Node 24. The service binds only to `127.0.0.1:8087`.

Open `/owner.html` once to configure and verify the provider connection. The check makes a small real provider request. The credential remains only in server memory until restart. It is never written to Git or sent back in status responses.

The technician requests the companion PDF without entering credentials. Material descriptions, quantities and units pass through the local server; customer and business profile data and quote prices do not.

Five demo units are provided. Analysis reserves one unit temporarily. The unit is consumed only after browser PDF creation succeeds and the completion endpoint confirms it. Completion is idempotent. Failed or cancelled analysis does not consume a unit.

The local ledger is `.service-data/lab.json`, excluded from Git and static serving. This prototype has one local demo account, no real payments and no production customer authentication. Public deployment requires authenticated customer/admin accounts, a persistent account ledger, verified payment events and server-side PDF generation/delivery.

Tests: `npm test`, and `node tests/browser/service.e2e.mjs` with the documented Playwright environment variables. Provider calls are mocked in tests; PDF generation is real. Actual provider access is verified by the owner, not assumed from mock results.

References:
- https://developers.openai.com/api/reference/overview
- https://developers.openai.com/api/docs/guides/error-codes
