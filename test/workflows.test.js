// Ασφάλεια των GitHub workflows (docs/security/findings-2026-11-25.md, H1/H2). Χωρίς εξαρτήσεις: έλεγχος κειμένου.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../.github/workflows/', import.meta.url);
const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
const read = f => fs.readFileSync(new URL(f, dir), 'utf8');
// Τα jobs ενός workflow: {όνομα: κείμενο του job}. Job = γραμμή με 2 κενά και «όνομα:» κάτω από το «jobs:».
function jobs(src){
  const body = src.split(/^jobs:\s*$/m)[1] || '';
  const out = {}; let cur = null;
  for(const line of body.split('\n')){
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if(m){ cur = m[1]; out[cur] = ''; continue; }
    if(cur) out[cur] += line + '\n';
  }
  return out;
}
const SECRET = /secrets\.[A-Z_]*(SERVICE_ROLE|SECRET|SUPABASE)[A-Z_]*/;

test('workflows: κάθε job που διαβάζει μυστικό Supabase έχει environment και φρουρό για το lab (H1)', () => {
  let seen = 0;
  for(const f of files) for(const [name, body] of Object.entries(jobs(read(f)))){
    if(!SECRET.test(body)) continue;
    seen++;
    assert.match(body, /^ {4}environment:\s*\S+/m, `${f} → ${name}: διαβάζει μυστικό χωρίς environment`);
    assert.match(body, /^ {4}if:\s*github\.ref == 'refs\/heads\/lab'\s*$/m, `${f} → ${name}: χωρίς φρουρό github.ref για το lab`);
  }
  assert.ok(seen > 0, 'κανένα job με μυστικό Supabase: άλλαξε το όνομα του secret; ενημέρωσε το test');
});

test('workflows: κανένα pull_request_target (θα έδινε μυστικά σε κώδικα από fork)', () => {
  for(const f of files) assert.doesNotMatch(read(f), /pull_request_target/, f);
});

test('workflows: το required check «Lab unit tests» τρέχει σε κάθε PR προς το lab (H2)', () => {
  const hits = files.filter(f => /^\s+name:\s*Lab unit tests\s*$/m.test(read(f)));
  assert.equal(hits.length, 1, 'ακριβώς ένα job με όνομα «Lab unit tests» (το ruleset του lab το περιμένει)');
  const src = read(hits[0]);
  assert.match(src, /^ {2}pull_request:\s*$/m, `${hits[0]}: χωρίς pull_request`);
  assert.match(src, /npm test/, `${hits[0]}: δεν τρέχει npm test`);
  assert.doesNotMatch(src, /secrets\./, `${hits[0]}: τα tests των PR δεν παίρνουν μυστικά`);
});
