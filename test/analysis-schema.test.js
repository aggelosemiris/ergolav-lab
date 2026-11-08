import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateAnalysis, withItemIds, SECTIONS, LICENSED_NOTE } from '../src/analysis-schema.js';
import { ANALYSES } from '../src/analyses-data.js';

const dir = new URL('../data/analyses/', import.meta.url);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const all = Object.assign({}, ...files.map(f => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')).analyses));
const clone = o => structuredClone(o);
const wc = ANALYSES['plumb-wc-wall-hung'];

test('όλες οι αναλύσεις του repo (data/analyses) είναι έγκυρες, με μοναδικά ids', () => {
  assert.ok(Object.keys(all).length >= 90, `μόνο ${Object.keys(all).length} αναλύσεις`);
  for(const [id, a] of Object.entries(all)){
    assert.equal(a.id, id);
    assert.deepEqual(validateAnalysis(a), [], id);
  }
});

test('η εφαρμογή έχει ακριβώς τις αναλύσεις του repo (src/analyses-data.js ενημερωμένο)', () => {
  for(const [id, a] of Object.entries(ANALYSES)) assert.deepEqual(a, all[id], `${id}: τρέξε node tools/catalog/export-app-data.mjs`);
});

test('εργασίες αδειούχου: σημαία και σημείωση· καμία εγγύηση ή υπόσχεση πουθενά', () => {
  assert.equal(all['elec-socket'].requires_licensed_professional, true);
  assert.equal(all['plumb-wc-wall-hung'].requires_licensed_professional, false);
  assert.match(LICENSED_NOTE, /αδειούχο/);
  const text = JSON.stringify(all).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  assert.ok(!/εγγυηση|εγγυομαστε|για παντα|100\s*%/.test(text));
});

test('ενότητες: πάντα οι πέντε, με τη σειρά και τα όρια πλήθους', () => {
  assert.deepEqual(SECTIONS.map(s => s.key), ['prerequisites', 'preparation', 'steps', 'checks', 'handover']);
  const a = clone(wc); a.sections.reverse();
  assert.ok(validateAnalysis(a).some(e => /πρέπει να είναι/.test(e)));
  const b = clone(wc); b.sections[2].items = b.sections[2].items.slice(0, 2);
  assert.ok(validateAnalysis(b).some(e => /Στάδια τοποθέτησης/.test(e)));
  const c = clone(wc); c.sections.pop();
  assert.ok(validateAnalysis(c).length);
});

test('κείμενα: αρίθμηση, εγγύηση, υπόσχεση, γενικόλογα, μήκος', () => {
  const bad = text => { const a = clone(wc); a.sections[2].items[0].text = text; return validateAnalysis(a); };
  assert.ok(bad('1. Στερεώνουμε το πλαίσιο στον τοίχο.').some(e => /αρίθμηση/.test(e)));
  assert.ok(bad('Στερεώνουμε το πλαίσιο, με εγγύηση πέντε ετών.').some(e => /εγγύηση/.test(e)));
  assert.ok(bad('Στερεώνουμε το πλαίσιο και δεν θα κουνηθεί ποτέ ξανά.').some(e => /υπόσχεση/.test(e)));
  assert.ok(bad('Στερεώνουμε το πλαίσιο με προσοχή και μεράκι.').some(e => /γενικόλογη/.test(e)));
  assert.ok(bad('Λίγο.').some(e => /κενό ή πολύ μεγάλο/.test(e)));
  assert.ok(bad('α'.repeat(321)).some(e => /κενό ή πολύ μεγάλο/.test(e)));
});

test('ids: μοναδικά και με το πρόθεμα της εργασίας και της ενότητας', () => {
  const a = clone(wc); a.sections[2].items[1].id = a.sections[2].items[0].id;
  assert.ok(validateAnalysis(a).some(e => /διπλό id/.test(e)));
  const b = clone(wc); b.sections[2].items[0].id = 'plumb-wc-wall-hung.checks.9';
  assert.ok(validateAnalysis(b).some(e => /πρέπει να ξεκινά/.test(e)));
  const c = clone(wc); delete c.sections[0].items[0].id;
  assert.ok(validateAnalysis(c).some(e => /λείπει το id/.test(e)));
});

test('λοιπά πεδία: διάρκεια με «ενδεικτικά» και εύρος, αναλώσιμα, σημείωση για τον τεχνίτη', () => {
  const with_ = patch => validateAnalysis({...clone(wc), ...patch});
  assert.ok(with_({typical_duration: '2 ημέρες'}).some(e => /ενδεικτικά/.test(e)));
  assert.deepEqual(with_({typical_duration: 'ενδεικτικά 2–3 ώρες'}), []);
  assert.ok(with_({related_consumables: Array(13).fill('σιλικόνη')}).length);
  assert.ok(with_({requires_licensed_professional: 'όχι'}).length);
  assert.ok(with_({notes_for_master: 'α'.repeat(401)}).length);
  assert.ok(with_({trade: 'αστροναύτης'}).some(e => /επάγγελμα/.test(e)));
});

test('απάντηση μοντέλου (απλά strings) → μορφή με ids, που περνά τον έλεγχο', () => {
  const raw = {title: ` ${wc.title} `, sections: wc.sections.map(s => ({key: s.key, items: s.items.map(i => i.text)})),
    typical_duration: wc.typical_duration, related_consumables: wc.related_consumables,
    requires_licensed_professional: false, notes_for_master: wc.notes_for_master};
  const a = withItemIds(raw, {id: wc.id, trade: wc.trade});
  assert.deepEqual(a, wc);
  assert.deepEqual(validateAnalysis({...raw, id: wc.id, trade: wc.trade}, {withIds: false}), []);   // id/επάγγελμα από το αίτημα
});
