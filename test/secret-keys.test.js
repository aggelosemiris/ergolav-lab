// Κλειδιά (στόχος 10, εύρημα M3): ένα sb_secret_… ανά χρήση, με επιστροφή στο παλιό service_role μέχρι τη μετάβαση.
// Βλ. docs/security/keys.md. Κανένα πραγματικό κλειδί εδώ: μόνο ψεύτικες τιμές με τη σωστή μορφή.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serverKey } from '../tools/prices/stores/supabase.mjs';
const { adminKey, EDGE_KEY_NAME } = await import('../supabase/functions/delete-account/handler.ts');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = role => `eyJ${b64({alg: 'HS256'}).slice(3)}.${b64({role, iss: 'supabase'})}.sig`;
const SECRET_PRICES = 'sb_secret_fakeGithubPrices0000000000', SECRET_EDGE = 'sb_secret_fakeEdgeFunctions00000000';
const LEGACY = jwt('service_role');

test('εργασία τιμών: πρώτα το δικό της sb_secret (SUPABASE_SECRET_KEY), αλλιώς το παλιό service_role', () => {
  assert.deepEqual(serverKey({SUPABASE_SECRET_KEY: SECRET_PRICES, SUPABASE_SERVICE_ROLE_KEY: LEGACY}), {key: SECRET_PRICES, kind: 'sb_secret'});
  assert.deepEqual(serverKey({SUPABASE_SERVICE_ROLE_KEY: LEGACY}), {key: LEGACY, kind: 'service_role (παλιό JWT)'});
  // Νέο κλειδί μπήκε στο παλιό όνομα secret: δουλεύει, αλλά το log το λέει.
  assert.equal(serverKey({SUPABASE_SERVICE_ROLE_KEY: SECRET_PRICES}).kind, 'sb_secret (στο παλιό όνομα secret)');
  assert.deepEqual(serverKey({}), {key: '', kind: 'none'});
  assert.deepEqual(serverKey({SUPABASE_SECRET_KEY: '  ', SUPABASE_SERVICE_ROLE_KEY: ''}), {key: '', kind: 'none'});
});

test('εργασία τιμών: ποτέ δημόσιο κλειδί (publishable / anon) ή άγνωστη μορφή στη θέση του μυστικού', () => {
  assert.throws(() => serverKey({SUPABASE_SECRET_KEY: 'sb_publishable_fake000'}), /Δημόσιο κλειδί/);
  assert.throws(() => serverKey({SUPABASE_SERVICE_ROLE_KEY: jwt('anon')}), /ρόλο «anon»/);
  assert.throws(() => serverKey({SUPABASE_SECRET_KEY: 'κάτι-άλλο'}), /Άγνωστη μορφή/);
});

test('delete-account: πρώτα το κλειδί «edge-functions» από το SUPABASE_SECRET_KEYS, αλλιώς το παλιό· ποτέ το «default»', () => {
  const env = o => name => o[name];
  assert.equal(EDGE_KEY_NAME, 'edge-functions');
  const keys = JSON.stringify({default: 'sb_secret_fakeDefault000000000000', 'edge-functions': SECRET_EDGE, 'github-prices': SECRET_PRICES});
  assert.deepEqual(adminKey(env({SUPABASE_SECRET_KEYS: keys, SUPABASE_SERVICE_ROLE_KEY: LEGACY})), {key: SECRET_EDGE, kind: 'sb_secret'});
  // Χωρίς δικό της κλειδί: το παλιό (όχι το default, όχι κλειδί άλλης χρήσης).
  const others = JSON.stringify({default: 'sb_secret_fakeDefault000000000000', 'github-prices': SECRET_PRICES});
  assert.deepEqual(adminKey(env({SUPABASE_SECRET_KEYS: others, SUPABASE_SERVICE_ROLE_KEY: LEGACY})), {key: LEGACY, kind: 'service_role (παλιό JWT)'});
  assert.equal(adminKey(env({SUPABASE_SECRET_KEYS: '{χαλασμένο', SUPABASE_SERVICE_ROLE_KEY: LEGACY})).key, LEGACY);
  assert.equal(adminKey(env({SUPABASE_SECRET_KEYS: JSON.stringify({'edge-functions': 'sb_publishable_x'}), SUPABASE_SERVICE_ROLE_KEY: LEGACY})).key, LEGACY);
  assert.throws(() => adminKey(env({SUPABASE_SECRET_KEYS: others})), /κανένα μυστικό κλειδί/);
});

test('workflow τιμών: το νέο κλειδί και το παλιό μόνο στο βήμα της ενημέρωσης, όχι στα tests ή σε άλλο βήμα', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/prices.yml', import.meta.url), 'utf8');
  const steps = yml.split(/\n {6}- /).slice(1);
  const using = steps.filter(s => /secrets\.SUPABASE_(SECRET_KEY|SERVICE_ROLE_KEY)\b/.test(s) && !/^name: Χωρίς/.test(s));
  assert.equal(using.length, 1, 'ακριβώς ένα βήμα παίρνει το κλειδί');
  assert.match(using[0], /^name: Ενημέρωση τιμών/);
});

test('κανένα πραγματικό κλειδί στο repo: ούτε sb_secret_, ούτε service_role JWT, έξω από τα ψεύτικα των tests', () => {
  const skip = /^(\.git|node_modules|data|media|vendor|tools\/catalog\/node_modules)(\/|$)/;
  const bad = [];
  const walk = dir => {
    for(const e of fs.readdirSync(new URL(`../${dir}`, import.meta.url), {withFileTypes: true})){
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if(skip.test(rel)) continue;
      if(e.isDirectory()){ walk(rel); continue; }
      if(!/\.(js|mjs|ts|json|ya?ml|md|html|sql|sh|toml|txt)$/.test(e.name) || rel.startsWith('test/')) continue;
      const s = fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
      if(/sb_secret_[A-Za-z0-9_-]{20,}/.test(s)) bad.push(`${rel}: sb_secret_`);
      for(const m of s.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]+/g)){
        try { if(JSON.parse(Buffer.from(m[1], 'base64url').toString()).role === 'service_role') bad.push(`${rel}: service_role JWT`); } catch {}
      }
    }
  };
  walk('');
  assert.deepEqual(bad, []);
});
