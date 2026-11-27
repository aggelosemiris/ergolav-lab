// Dev και prod (στόχος 9): κάθε migration έχει γραμμή στον πίνακα του docs/migrations.md (με τη σειρά), έλεγχο στο
// supabase/tests/migration-status.sql και θέση στο τοπικό run-local.sh. Νέα migration χωρίς αυτά → αποτυγχάνει.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const files = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort();
const names = files.map(f => f.replace(/\.sql$/, ''));
const doc = read('docs/migrations.md');
const rows = doc.split('\n').filter(l => /^\| \d+ \| `\d{14}_/.test(l)).map(l => l.split('|').slice(1, -1).map(c => c.trim()));

test('υπάρχουν migrations και όλες έχουν όνομα «ΕΕΕΕΜΜΗΗωωλλδδ_όνομα.sql»', () => {
  assert.ok(files.length >= 10);
  for(const f of files) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/, f);
});

test('docs/migrations.md: μία γραμμή ανά migration, με τη σειρά, αριθμημένες 1, 2, 3…', () => {
  assert.deepEqual(rows.map(r => r[1].replace(/`/g, '')), names);
  assert.deepEqual(rows.map(r => +r[0]), names.map((_, i) => i + 1));
});

test('docs/migrations.md: dev και prod μόνο ✓, ✗ ή ?· το test κάθε γραμμής υπάρχει στο supabase/tests', () => {
  for(const r of rows){
    assert.ok(['✓', '✗', '?'].includes(r[4]), `dev: ${r[1]} → «${r[4]}»`);
    assert.ok(['✓', '✗', '?'].includes(r[5]), `prod: ${r[1]} → «${r[5]}»`);
    for(const t of r[3].match(/[a-z-]+\.sql/g) || []) assert.ok(fs.existsSync(new URL(`../supabase/tests/${t}`, import.meta.url)), `${r[1]}: ${t}`);
    // Στο prod δεν μπαίνει ✓ πριν από το dev, εκτός από όσες εφαρμόστηκαν πριν υπάρξει το dev (έως 27/11).
    if(r[5] === '✓' && r[4] !== '✓') assert.ok(r[1].replace(/`/g, '') < '20261128', `${r[1]}: prod ✓ χωρίς dev ✓`);
  }
});

test('supabase/tests/migration-status.sql: έλεγχος για κάθε migration, με τη σειρά, και μόνο ανάγνωση', () => {
  const sql = read('supabase/tests/migration-status.sql');
  assert.deepEqual([...sql.matchAll(/\('(\d{14}_[a-z0-9_]+)',/g)].map(m => m[1]), names);
  // Χωρίς σχόλια και κείμενα σε '…' (π.χ. has_table_privilege(…, 'INSERT')): καμία εντολή που αλλάζει κάτι.
  const code = sql.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''");
  assert.doesNotMatch(code, /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|call|do)\b/i);
  assert.equal(code.split(';').filter(s => s.trim()).length, 1, 'μία μόνο εντολή select');
});

test('supabase/tests/run-local.sh: τρέχει κάθε migration (δύο φορές, ξανατρέξιμη) και στο τέλος το migration-status.sql', () => {
  const sh = read('supabase/tests/run-local.sh');
  for(const f of files) assert.equal(sh.split(`migrations/${f}"`).length - 1, 2, f);
  assert.match(sh, /migration-status\.sql/);
});
