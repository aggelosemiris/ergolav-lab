import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ψεύτικο localStorage ανά test (όπως στο history.test.js)· broken: κάθε κλήση πετάει.
function env(initial = {}, {broken = false} = {}){
  const data = {...initial};
  const fail = () => { throw new Error('QuotaExceededError'); };
  globalThis.localStorage = broken ? {getItem: fail, setItem: fail, removeItem: fail}
    : {getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }};
  return data;
}
const s = await import('../src/analysis-store.js');
const { ANALYSES } = await import('../src/analyses-data.js');
const { applyRewrite, rewriteRequest } = await import('../src/rewrite-client.js');
const wc = ANALYSES['plumb-wc-wall-hung'];
const edited = applyRewrite(wc, {scope: 'item', section: 'steps', item_id: 'plumb-wc-wall-hung.steps.3'}, ['Συνδέουμε το νερό και την αποχέτευση της λεκάνης.']).analysis;

test('εκδοχή του τεχνίτη: κρατιέται, χρησιμοποιείται, και η «Επαναφορά» γυρνά στην αρχική', () => {
  const data = env();
  assert.equal(s.getVersion(wc.id), null);
  assert.equal(s.saveVersion(edited), true);
  assert.deepEqual(s.getVersion(wc.id), edited);
  assert.ok(JSON.parse(data[s.VERSIONS])[wc.id].updated > 0);
  assert.equal(s.resetVersion(wc.id), true);
  assert.equal(s.getVersion(wc.id), null);
  assert.equal(s.resetVersion(wc.id), true);   // ξανά: τίποτα να σβηστεί
});

test('άκυρη ή χαλασμένη εκδοχή δεν κρατιέται και δεν διαβάζεται', () => {
  const data = env();
  const bad = structuredClone(edited); bad.sections[2].items[0].text = 'Με εγγύηση δέκα ετών για όλα.';
  assert.equal(s.saveVersion(bad), false);
  data[s.VERSIONS] = JSON.stringify({[wc.id]: {analysis: bad}});
  assert.equal(s.getVersion(wc.id), null);
  data[s.VERSIONS] = '{όχι json';
  assert.equal(s.getVersion(wc.id), null);
  assert.equal(s.saveVersion(edited), true);   // ξαναγράφεται από την αρχή
});

test('κανόνες ύφους: προσθήκη, χωρίς διπλούς, αλλαγή, σβήσιμο, έως 20', () => {
  env();
  assert.deepEqual(s.listRules(), []);
  const r = s.addRule('  Πιο απλά   λόγια ');
  assert.equal(r.text, 'Πιο απλά λόγια');
  assert.equal(s.addRule('πιο απλα λογια').id, r.id);          // ίδιος χωρίς τόνους/κεφαλαία
  assert.equal(s.addRule('   '), null);
  s.addRule('Χωρίς αγγλικούς όρους');
  assert.deepEqual(s.listRules().map(x => x.text), ['Πιο απλά λόγια', 'Χωρίς αγγλικούς όρους']);
  s.updateRule(r.id, 'Πιο απλά λόγια, σε μία πρόταση');
  assert.equal(s.listRules()[0].text, 'Πιο απλά λόγια, σε μία πρόταση');
  s.updateRule(r.id, '');                                       // κενό = σβήσιμο
  assert.deepEqual(s.listRules().map(x => x.text), ['Χωρίς αγγλικούς όρους']);
  s.deleteRule(s.listRules()[0].id);
  assert.deepEqual(s.listRules(), []);
  for(let i = 0; i < s.MAX_RULES; i++) assert.ok(s.addRule(`Κανόνας ${i}`));
  assert.equal(s.addRule('Ένας ακόμα'), null);
  assert.ok(s.addRule('x'.repeat(500)) === null && s.listRules().every(x => x.text.length <= s.MAX_RULE));
});

test('εφαρμογή των κανόνων: κάθε αποθηκευμένος κανόνας μπαίνει στο επόμενο «Άλλαξέ το»', () => {
  env();
  s.addRule('Πιο απλά λόγια');
  s.addRule('Χωρίς αγγλικούς όρους');
  const req = rewriteRequest({analysis: wc, section: 'steps', index: 0, quick: ['Πιο σύντομο'], rules: s.listRules()});
  assert.deepEqual(req.style_rules, ['Πιο απλά λόγια', 'Χωρίς αγγλικούς όρους']);
  s.deleteRule(s.listRules()[0].id);
  assert.deepEqual(rewriteRequest({analysis: wc, section: 'steps', index: 0, want: 'x', rules: s.listRules()}).style_rules, ['Χωρίς αγγλικούς όρους']);
});

test('αναγνωριστικό συσκευής: τυχαίο, σταθερό, χωρίς προσωπικά στοιχεία', () => {
  env();
  const id = s.deviceId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(s.deviceId(), id);
  env();
  assert.notEqual(s.deviceId(), id);
});

test('χωρίς αποθήκευση (ιδιωτική περιήγηση): τίποτα δεν σπάει', () => {
  env({}, {broken: true});
  assert.equal(s.getVersion(wc.id), null);
  assert.equal(s.saveVersion(edited), false);
  assert.deepEqual(s.listRules(), []);
  assert.equal(s.addRule('Πιο απλά'), null);
  assert.match(s.deviceId(), /^[0-9a-f-]{36}$/);
});
