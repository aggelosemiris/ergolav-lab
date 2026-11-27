// CSP (στόχος 6, εύρημα L2): κανένας AI host στο connect-src. Αν βρεθεί ποτέ XSS, ένας ανοιχτός AI host (π.χ. Files
// API) θα ήταν κανάλι για να φύγουν τα δεδομένα των πελατών προς λογαριασμό του επιτιθέμενου. Στο launch η εφαρμογή
// δεν καλεί κανένα AI από τον browser: φωτογραφία κλειστή (PHOTO_ENABLED), ανάλυση εργασιών μέσω του δικού μας server
// (/api, same-origin), «Άλλαξέ το» χωρίς AI. Νέος host στο connect-src = νέα γραμμή στο ALLOWED παρακάτω, με review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as CONFIG from '../src/config.js';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const metaCsp = read('index.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
const headersCsp = read('_headers').match(/Content-Security-Policy: (.+)/)[1];
const connect = csp => csp.match(/connect-src ([^;]+)/)[1].trim().split(/\s+/);

const AI = /anthropic|openai|generativelanguage|aiplatform|gemini|mistral|cohere|groq|together|deepseek|perplexity|huggingface|replicate|x\.ai\b/i;
const ALLOWED = new Set(["'self'", CONFIG.SUPABASE_URL, 'https://challenges.cloudflare.com',
  ...(CONFIG.REWRITE_URL ? [new URL(CONFIG.REWRITE_URL).origin] : [])]);

for(const [name, csp] of [['index.html', metaCsp], ['_headers', headersCsp]]){
  test(`${name}: κανένας AI host στο connect-src`, () => {
    assert.deepEqual(connect(csp).filter(h => AI.test(h)), []);
  });
  test(`${name}: το connect-src έχει μόνο τις γνωστές διευθύνσεις της εφαρμογής`, () => {
    assert.deepEqual(connect(csp).filter(h => !ALLOWED.has(h)), []);
  });
}

test('η φωτογραφία σημειώσεων (που καλεί AI από τον browser) μένει κλειστή όσο κανένας AI host δεν επιτρέπεται', () => {
  assert.match(read('src/app.js'), /^const PHOTO_ENABLED = false;$/m);
});
