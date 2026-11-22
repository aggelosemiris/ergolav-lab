// Λογαριασμός χωρίς σήμα: ποτέ αποσύνδεση, κανένα αίτημα στο παρασκήνιο, συνεδρία που δεν σβήνει σε «captive portal».
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, authFetch } from '../src/account.js';
import { _reset, markOffline } from '../src/net.js';

const CFG = {AUTH_ENABLED: true, SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: 'anon-key'};
const user = {id: 'u-1', email: 'a@example.com', app_metadata: {provider: 'email', providers: ['email']}, identities: [], user_metadata: {}};
const session = {access_token: 'x', refresh_token: 'r', expires_at: 1, user};

function setup({onLine = true} = {}){
  const store = new Map([['sb-abcdefgh-auth-token', JSON.stringify(session)]]);
  const win = {navigator: {onLine}, location: {href: 'https://a.github.io/ergolav/'}, history: {replaceState(){}},
    localStorage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k), get length(){ return store.size; }, key: i => [...store.keys()][i]}};
  let cb = null;
  const client = {auth: {getSession: async () => ({data: {session: null}, error: {name: 'AuthRetryableFetchError'}}), onAuthStateChange: f => { cb = f; }}};
  const a = createAccount({config: CFG, getClient: async () => client, win});
  return {a, win, fire: (ev, s) => cb(ev, s)};
}
beforeEach(() => _reset());

test('χωρίς σήμα, συνεδρία που δεν ανανεώθηκε: ο χρήστης μένει (από τη συσκευή)', async () => {
  const {a} = setup({onLine: false});
  const r = await a.init();
  assert.equal(r.user?.id, 'u-1');
});

test('SIGNED_OUT που δεν ζήτησε ο τεχνίτης: χωρίς σήμα ΠΟΤΕ κλείδωμα· με σήμα κλείδωμα (όπως πριν)', async () => {
  for(const [online, expectLock] of [[false, false], [true, true]]){
    _reset();
    const {a, win, fire} = setup();
    await a.init();
    const locks = []; a.onLock(r => locks.push(r));
    win.navigator.onLine = online;
    fire('SIGNED_OUT', null);
    assert.equal(locks.length, expectLock ? 1 : 0, `online=${online}`);
    assert.equal(!!a.user(), !expectLock);
  }
});

test('σήμα που «χάθηκε» από αποτυχημένο αίτημα (net.js) μετράει όπως το navigator.onLine', async () => {
  const {a, fire} = setup();
  await a.init();
  const locks = []; a.onLock(r => locks.push(r));
  markOffline();
  fire('SIGNED_OUT', null);
  assert.equal(locks.length, 0);
  assert.equal(await a.db(), null, 'χωρίς σήμα: κανένας συγχρονισμός στο παρασκήνιο');
});

test('authFetch: σελίδα HTML στο /auth/v1/ (captive portal) = σφάλμα δικτύου, ώστε να ΜΗ σβηστεί η συνεδρία', async () => {
  const res = (type, status = 200) => ({status, headers: {get: () => type}});
  const win = {fetch: async u => u.includes('html') ? res('text/html') : u.includes('nocontent') ? res(null, 204) : res('application/json')};
  const f = authFetch(CFG, win);
  await assert.rejects(f(`${CFG.SUPABASE_URL}/auth/v1/token?html`), e => e instanceof TypeError);
  assert.equal((await f(`${CFG.SUPABASE_URL}/auth/v1/token`)).status, 200);
  assert.equal((await f(`${CFG.SUPABASE_URL}/auth/v1/logout?nocontent`)).status, 204);
  assert.equal((await f(`${CFG.SUPABASE_URL}/storage/v1/object/html`)).status, 200, 'μόνο το auth· τα αρχεία (λογότυπο) δεν είναι JSON');
});
