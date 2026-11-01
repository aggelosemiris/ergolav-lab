import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ψεύτικο localStorage/location ανά test· φρέσκο module ώστε να διαβάζει το νέο «origin».
function env(hostname, initial = {}){
  const data = {...initial};
  globalThis.location = {hostname};
  globalThis.localStorage = {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }};
  return data;
}
const load = tag => import(`../src/photo.js?t=${tag}`);
const KEY = 'AIza' + 'Q'.repeat(35);

test('εξ ορισμού το key μένει μόνο στη μνήμη', async () => {
  const data = env('ergolav.gr');
  const m = await load('mem');
  m.setKey(KEY);
  assert.equal(m.getKey(), KEY);
  assert.deepEqual(Object.keys(data), []);
});

test('«θυμήσου» σε δικό σου domain → αποθηκεύεται· «ξέχασε» → σβήνει', async () => {
  const data = env('ergolav.gr');
  const m = await load('remember');
  m.setKey(KEY, {remember: true});
  assert.equal(data['ergolav.apiKey'], KEY);
  m.forgetKey();
  assert.equal(m.getKey(), '');
  assert.deepEqual(Object.keys(data), []);
});

test('κοινόχρηστο domain (raw.githack.com): ποτέ αποθήκευση, και σβήνει ό,τι είχε μείνει από παλιά έκδοση', async () => {
  const data = env('raw.githack.com', {'ergolav.anthropicKey': KEY, 'ergolav.apiKey': KEY});
  const m = await load('shared');
  assert.equal(m.canRememberKey(), false);
  assert.deepEqual(Object.keys(data), [], 'τα παλιά αποθηκευμένα keys σβήστηκαν κατά τη φόρτωση');
  m.setKey(KEY, {remember: true});
  assert.equal(m.getKey(), KEY, 'δουλεύει για αυτή τη συνεδρία');
  assert.deepEqual(Object.keys(data), [], 'αλλά δεν γράφεται πουθενά');
});

test('το <user>.github.io είναι κοινόχρηστο (όλα τα repo του λογαριασμού) → ποτέ αποθήκευση', async () => {
  const data = env('aggelosemiris.github.io');
  const m = await load('ghpages');
  assert.equal(m.canRememberKey(), false);
  m.setKey(KEY, {remember: true});
  assert.deepEqual(Object.keys(data), []);
});
