// Απόρρητο και συγχρονισμός (στόχος 11): το κείμενο λέει ακριβώς τι ανεβαίνει στον λογαριασμό. Αν ανοίξει ένας
// συγχρονισμός και το Απόρρητο γράφει ακόμα «μόνο στη συσκευή», το test αποτυγχάνει.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as CONFIG from '../src/config.js';

const html = fs.readFileSync(new URL('../legal/privacy.html', import.meta.url), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('οι προσφορές ανεβαίνουν (QUOTES_SYNC_ENABLED): το Απόρρητο το λέει, με πελάτες, 30 ημέρες και διαγραφή', () => {
  if(CONFIG.QUOTES_SYNC_ENABLED !== true) return;
  assert.doesNotMatch(text, /προσφορές[^.]*μένουν μόνο στη συσκευή/i, 'γράφει ακόμα ότι οι προσφορές μένουν μόνο στη συσκευή');
  for(const must of [/Τι κρατάμε στον λογαριασμό σου.*προσφορές/s, /πελάτη/, /30 ημέρες/, /Διαγραφή λογαριασμού[^.]*\.[^.]*οι προσφορές/,
    /ο καθένας βλέπει μόνο τις δικές του προσφορές/])
    assert.match(text, must, String(must));
});

test('οι δικές σου τιμές ανεβαίνουν με τον λογαριασμό (price-watch → user_products): το Απόρρητο το λέει', () => {
  if(CONFIG.AUTH_ENABLED !== true) return;
  assert.ok(fs.readFileSync(new URL('../src/price-watch.js', import.meta.url), 'utf8').includes("from('user_products').upsert"));
  assert.doesNotMatch(text, /τιμές σου μένουν μόνο στη συσκευή/i);
  assert.match(text, /δικές σου τιμές/);
});

test('«Άλλαξέ το» (ALLAXE_BOT_ENABLED): κανόνες και αναλύσεις στον λογαριασμό, ονόματα υλικών και μετρήσεις ανώνυμα', () => {
  if(CONFIG.ALLAXE_BOT_ENABLED !== true) return;
  assert.match(text, /κανόνες/);
  assert.match(text, /μόνο το όνομα του υλικού/);
  assert.match(text, /χωρίς κείμενα, χωρίς χρήστη/);
});

test('προσωρινό κείμενο: μένει η σήμανση «υπό νομικό έλεγχο» μέχρι την έγκριση', () => {
  assert.match(html, /Προσωρινό κείμενο, υπό νομικό έλεγχο/);
  assert.match(html, /Τελευταία αλλαγή: \d{1,2} [Α-Ωα-ωάέήίόύώ]+ 20\d\d/);
});
