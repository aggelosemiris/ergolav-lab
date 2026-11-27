// XSS: ένα esc() για όλη την εφαρμογή, που κάνει escape και το μονό εισαγωγικό (στόχος 5, εύρημα L1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { esc } from '../src/html.js';

const SRC = new URL('../src/', import.meta.url);
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));
const read = f => fs.readFileSync(new URL(f, SRC), 'utf8');

// Οι επιθέσεις του πλάνου, σε όνομα πελάτη, γραμμές και PDF.
const ATTACKS = ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', "' onmouseover='alert(1)"];

test('esc(): κανένα από τα 5 επικίνδυνα σύμβολα δεν περνά, ούτε το μονό εισαγωγικό', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  for(const a of ATTACKS){
    const out = esc(a);
    assert.doesNotMatch(out, /[<>"']/, a);
    // Μέσα σε attribute με μονά ή διπλά εισαγωγικά, η τιμή δεν «σπάει» για να προσθέσει onmouseover / onerror.
    for(const q of [`'`, `"`]) assert.equal(`<b title=${q}${out}${q}>`.split(q).length, 3, `${q} ${a}`);
  }
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(12.5), '12.5');
  assert.equal(esc('Γιώργος & Υιοί'), 'Γιώργος &amp; Υιοί');
});

test('ένας μόνο ορισμός esc() στο src/ (το src/html.js)· όλα τα αρχεία με innerHTML τον εισάγουν από εκεί', () => {
  const defs = files.filter(f => /(?:const|let|var|function)\s+(?:esc|escape|escapeHtml|escHtml)\b/.test(read(f)));
  assert.deepEqual(defs, ['html.js']);
  for(const f of files){
    const s = read(f);
    if(/\besc\(/.test(s) && f !== 'html.js') assert.match(s, /import \{[^}]*\besc\b[^}]*\} from '\.\/html\.js'/, f);
  }
});

test('κανένα attribute με τιμή από ${…} χωρίς διπλά εισαγωγικά (μονά ή καθόλου)', () => {
  const bad = [];
  for(const f of files) read(f).split('\n').forEach((l, i) => {
    if(/\s[a-zA-Z-]+='\$\{|\s[a-zA-Z-]+=\$\{/.test(l)) bad.push(`${f}:${i + 1}`);
  });
  assert.deepEqual(bad, []);
});
