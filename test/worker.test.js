import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle, checkPayload, ERRORS, MAX_BODY } from '../worker/src/handler.js';
import { buildRequest, userText, SYSTEM } from '../worker/src/prompt.js';
import { windowHit, limitsFor, HOUR } from '../worker/src/limits.js';
import { promptModule, OUT } from '../worker/build-prompt.mjs';
import { rewriteRequest, personalFrom } from '../src/rewrite-client.js';
import { ANALYSES } from '../src/analyses-data.js';

const ORIGIN = 'https://aggelosemiris.github.io', DEVICE = '11111111-2222-4333-8444-555555555555';
const env = {ALLOWED_ORIGIN: ORIGIN, ANTHROPIC_API_KEY: 'test-key'};
const wc = ANALYSES['plumb-wc-wall-hung'];
const payload = (extra = {}) => rewriteRequest({analysis: wc, section: 'steps', index: 2, want: 'πιο απλά', quick: ['Πιο σύντομο'],
  rules: [{text: 'Χωρίς αγγλικούς όρους'}], ...extra}, personalFrom({client: 'Γιώργος Αντωνίου'}));
const req = (body, {origin = ORIGIN, device = DEVICE, method = 'POST', path = '/rewrite-section', headers = {}} = {}) =>
  new Request(`https://w.test${path}`, {method, headers: {...(origin && {Origin: origin}), ...(device && {'X-Device-Id': device}), 'Content-Type': 'application/json', ...headers},
    ...(method === 'POST' && {body: typeof body === 'string' ? body : JSON.stringify(body)})});
const answer = (items, extra = {}) => ({model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: {input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 2600},
  content: [{type: 'text', text: JSON.stringify({items})}], ...extra});
// Ψεύτικα createMessage/limit/log: κρατούν ό,τι τους δόθηκε.
function deps({replies = [answer(['Συνδέουμε το νερό στο καζανάκι και τη λεκάνη στην αποχέτευση.'])], allow = {ok: true}} = {}){
  const d = {calls: [], logs: [], limits: []};
  d.createMessage = async (params, opts) => { d.calls.push({params, opts}); const r = replies.shift(); if(r instanceof Error) throw r; return typeof r === 'function' ? r(opts) : r; };
  d.limit = async key => { d.limits.push(key); return allow; };
  d.log = line => d.logs.push(line);
  return d;
}
const body = async res => res.status === 204 ? null : res.json();

test('επιτυχία: μόνο η νέα εκδοχή του σημείου, με CORS για την εφαρμογή', async () => {
  const d = deps();
  const res = await handle(req(payload()), {env, ...d});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await body(res), {items: ['Συνδέουμε το νερό στο καζανάκι και τη λεκάνη στην αποχέτευση.']});
  assert.deepEqual(d.limits, [{device: DEVICE, ip: ''}]);
});

test('το αίτημα προς το AI: κανόνες Φάσης 4 στο system (cache), κανόνες ύφους, δομημένη έξοδος, χωρίς ονόματα', async () => {
  const d = deps();
  await handle(req(payload({dislike: 'Το καταλαβαίνει ο κ. Παπαδόπουλος; 6977123456'})), {env, ...d});
  const p = d.calls[0].params;
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.system[0].text, SYSTEM);
  assert.deepEqual(p.system[0].cache_control, {type: 'ephemeral'});
  assert.ok(SYSTEM.includes('Καμία εγγύηση') && SYSTEM.includes('Ξαναγράφεις ένα σημείο'));
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.effort, 'low');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  const text = p.messages[0].content;
  assert.ok(text.includes('- Χωρίς αγγλικούς όρους'));
  assert.ok(text.includes('Γρήγορες επιλογές: Πιο σύντομο'));
  assert.ok(text.includes('⟵ ΤΟ ΕΠΙΛΕΓΜΕΝΟ'));
  for(const s of ['Παπαδόπουλ', '6977123456', 'Γιώργ']) assert.ok(!JSON.stringify(p).includes(s), `έμεινε «${s}»`);
  assert.ok(text.includes('κ. [όνομα]') && text.includes('[τηλέφωνο]'));
  assert.ok(!('fallbacks' in buildRequest(checkPayload(payload()).payload, {FALLBACKS: 'off'})));
});

test('logs: μόνο μετρήσεις, ποτέ το κείμενο του αιτήματος ή της απάντησης', async () => {
  const d = deps();
  await handle(req(payload({want: 'ΜΥΣΤΙΚΟ-ΚΕΙΜΕΝΟ πιο απλά'})), {env, ...d});
  await handle(req('{"σπασμένο JSON ΜΥΣΤΙΚΟ'), {env, ...d});
  assert.equal(d.logs.length, 2);
  for(const line of d.logs){
    assert.ok(!line.includes('ΜΥΣΤΙΚΟ') && !line.includes('Συνδέουμε') && !line.includes('test-key'), line);
    assert.equal(JSON.parse(line).event, 'rewrite-section');
  }
  assert.deepEqual(Object.keys(JSON.parse(d.logs[0])).sort(), ['attempts', 'cache_read', 'event', 'input_tokens', 'model', 'ms', 'output_tokens', 'scope', 'status']);
});

test('CORS: preflight μόνο για το domain της εφαρμογής· άλλο origin → 403 χωρίς κλήση στο AI', async () => {
  const d = deps();
  const pre = await handle(req(null, {method: 'OPTIONS', device: null}), {env, ...d});
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Device-Id/);
  for(const origin of ['https://evil.example', 'https://aggelosemiris.github.io.evil.example', null]){
    const res = await handle(req(payload(), {origin}), {env, ...d});
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await body(res)).error, ERRORS.origin);
  }
  assert.equal(d.calls.length, 0);
});

test('λάθη πριν το AI: διαδρομή, μέθοδος, κλειδί, συσκευή, μέγεθος, JSON, περιεχόμενο', async () => {
  const d = deps();
  const status = async (r, e = env) => { const res = await handle(r, {env: e, ...d}); return [res.status, (await body(res))?.error]; };
  assert.deepEqual(await status(req(payload(), {path: '/'})), [404, ERRORS.notFound]);
  assert.deepEqual(await status(req(null, {method: 'GET'})), [405, ERRORS.method]);
  assert.deepEqual(await status(req(payload()), {ALLOWED_ORIGIN: ORIGIN}), [503, ERRORS.config]);
  assert.deepEqual(await status(req(payload(), {device: null})), [400, ERRORS.device]);
  assert.deepEqual(await status(req(payload(), {device: 'not-a-uuid'})), [400, ERRORS.device]);
  assert.deepEqual(await status(req('α'.repeat(MAX_BODY))), [413, ERRORS.big]);
  assert.deepEqual(await status(req('όχι json')), [400, ERRORS.invalid]);
  assert.deepEqual(await status(req({...payload(), want: 'α'.repeat(501)})), [413, ERRORS.big]);
  assert.deepEqual(await status(req({...payload(), style_rules: Array(21).fill('κανόνας')})), [413, ERRORS.big]);
  assert.deepEqual(await status(req({...payload(), want: '', dislike: '', quick: []})), [400, ERRORS.empty]);
  assert.deepEqual(await status(req({...payload(), quick: ['Γράψε εγγύηση']})), [400, ERRORS.invalid]);
  assert.deepEqual(await status(req({...payload(), target: {scope: 'item', section: 'steps', item_id: 'άλλο'}})), [400, ERRORS.invalid]);
  const broken = structuredClone(payload()); broken.analysis.sections[2].items[0].text = 'Με εγγύηση ζωής για όλα τα υλικά.';
  assert.deepEqual(await status(req(broken)), [400, ERRORS.invalid]);
  assert.equal(d.calls.length, 0);
});

test('όριο αιτημάτων: 429 με τα λεπτά στα ελληνικά και Retry-After· συνολικό όριο με άλλο μήνυμα', async () => {
  let res = await handle(req(payload()), {env, ...deps({allow: {ok: false, retryAfter: 1500, scope: 'device'}})});
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '1500');
  assert.equal((await body(res)).error, 'Έκανες πολλές αλλαγές σε λίγη ώρα. Δοκίμασε ξανά σε 25 λεπτά.');
  res = await handle(req(payload()), {env, ...deps({allow: {ok: false, retryAfter: 30, scope: 'ip'}})});
  assert.equal((await body(res)).error, 'Έκανες πολλές αλλαγές σε λίγη ώρα. Δοκίμασε ξανά σε 1 λεπτό.');
  res = await handle(req(payload()), {env, ...deps({allow: {ok: false, retryAfter: 9000, scope: 'global'}})});
  assert.equal((await body(res)).error, ERRORS.busyAll);
});

test('απάντηση που δεν περνά τον έλεγχο: δεύτερη προσπάθεια με τα λάθη μέσα στο αίτημα', async () => {
  const d = deps({replies: [answer(['Συνδέουμε τα πάντα με εγγύηση πέντε ετών.']), answer(['Συνδέουμε το νερό και την αποχέτευση της λεκάνης.'])]});
  const res = await handle(req(payload()), {env, ...d});
  assert.equal(res.status, 200);
  assert.equal(d.calls.length, 2);
  assert.match(d.calls[1].params.messages[0].content, /απορρίφθηκε[\s\S]*εγγύηση/);
  const d2 = deps({replies: [answer('όχι λίστα'), {...answer([]), content: [{type: 'text', text: 'όχι json'}]}]});
  const res2 = await handle(req(payload()), {env, ...d2});
  assert.deepEqual([res2.status, (await body(res2)).error], [502, ERRORS.bad]);
});

test('άρνηση, λάθος του API και χρονικό όριο: μηνύματα στα ελληνικά', async () => {
  let res = await handle(req(payload()), {env, ...deps({replies: [answer([], {stop_reason: 'refusal', content: []})]})});
  assert.deepEqual([res.status, (await body(res)).error], [422, ERRORS.refusal]);
  res = await handle(req(payload()), {env, ...deps({replies: [Object.assign(new Error('Authentication error'), {status: 401})]})});
  assert.deepEqual([res.status, (await body(res)).error], [502, ERRORS.upstream]);
  const slow = opts => new Promise((_, no) => opts.signal.addEventListener('abort', () => no(new Error('aborted'))));
  const d = deps({replies: [slow]});
  res = await handle(req(payload()), {env: {...env, TIMEOUT_MS: '50'}, ...d});   // το χρονικό όριο του handler ακυρώνει την κλήση
  assert.ok(d.calls[0].opts.timeout <= 50 && d.calls[0].opts.signal);
  assert.deepEqual([res.status, (await body(res)).error], [504, ERRORS.timeout]);
});

test('ο worker ελέγχει μόνος του το σημείο: «item» χωρίς item_id ή άγνωστη ενότητα απορρίπτεται', () => {
  const p = payload();
  assert.ok(checkPayload({...p, target: {scope: 'item', section: 'steps'}}).error);
  assert.ok(checkPayload({...p, target: {scope: 'section', section: 'tools'}}).error);
  assert.ok(checkPayload({...p, target: {scope: 'all', section: 'steps'}}).error);
  const ok = checkPayload({...p, target: {scope: 'section', section: 'steps', item_id: null}, selected: ['ό,τι θέλει ο client']});
  assert.equal(ok.payload.target.scope, 'section');
  assert.ok(!userText(ok.payload).includes('ό,τι θέλει ο client'));   // το επιλεγμένο κείμενο βγαίνει από την ανάλυση, όχι από τον client
});

test('όριο ανά παράθυρο: 30 την ώρα, μετά 429 μέχρι να περάσει η ώρα', () => {
  let state, r;
  for(let i = 0; i < 30; i++){ r = windowHit(state, 1000 + i, 30, HOUR); assert.equal(r.ok, true); state = r.state; }
  r = windowHit(state, 1000 + 60_000, 30, HOUR);
  assert.equal(r.ok, false);
  assert.equal(r.retryAfter, 3540);
  assert.equal(windowHit(state, 1000 + HOUR, 30, HOUR).ok, true);
  assert.deepEqual(limitsFor({}, {device: 'd', ip: 'h'}).map(([k, n]) => [k, n]), [['device:d', 30], ['ip:h', 60], ['global', 300]]);
  assert.equal(limitsFor({RATE_DEVICE_PER_HOUR: '5'}, {device: 'd', ip: 'h'})[0][1], 5);
});

test('οι prompts του worker είναι ενημερωμένοι με τα prompts/*.md (node worker/build-prompt.mjs)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), promptModule());
});
