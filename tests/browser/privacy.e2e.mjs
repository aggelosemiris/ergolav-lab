// Έλεγχος απορρήτου πάνω στα BYTES που στέλνονται στον provider (όχι σε ό,τι φαίνεται στην οθόνη).
//   1. Φωτογραφία με EXIF + GPS → η εικόνα που στέλνεται δεν έχει EXIF/GPS.
//   2. Χειροκίνητη κάλυψη → στην εικόνα που στέλνεται η περιοχή είναι μαύρη (και στο πρωτότυπο δεν ήταν).
//   3. Η εφαρμογή δεν τρέχει μέσα σε ξένο iframe.
// Εκτέλεση (χρειάζεται Playwright + Chromium, δεν είναι dependency του project):
//   npm start &   (http://localhost:8080)
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs node tests/browser/privacy.e2e.mjs
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://localhost:8080/';
const results = [];
const check = (name, pass, detail = '') => { results.push({name, pass}); console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── JPEG με EXIF/GPS: TIFF (big-endian) με IFD0 → GPS IFD (GPSLatitudeRef = N, GPSLatitude = 38°2'3") ──
function withGps(jpeg){
  const t = Buffer.alloc(80);
  t.write('MM', 0); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);
  t.writeUInt16BE(1, 8);                                              // IFD0: 1 entry
  t.writeUInt16BE(0x8825, 10); t.writeUInt16BE(4, 12); t.writeUInt32BE(1, 14); t.writeUInt32BE(26, 18);   // GPSInfo → 26
  t.writeUInt32BE(0, 22);
  t.writeUInt16BE(2, 26);                                             // GPS IFD: 2 entries
  t.writeUInt16BE(0x0001, 28); t.writeUInt16BE(2, 30); t.writeUInt32BE(2, 32); t.write('N\0', 36);           // GPSLatitudeRef
  t.writeUInt16BE(0x0002, 40); t.writeUInt16BE(5, 42); t.writeUInt32BE(3, 44); t.writeUInt32BE(56, 48);       // GPSLatitude → 56
  t.writeUInt32BE(0, 52);
  [38, 2, 3].forEach((v, i) => { t.writeUInt32BE(v, 56 + i * 8); t.writeUInt32BE(1, 60 + i * 8); });
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), t]);
  const app1 = Buffer.concat([Buffer.from([0xFF, 0xE1]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  // + IPTC (APP13) και σχόλιο (COM): μεταδεδομένα εκτός APP1, για να ελεγχθεί η λευκή λίστα.
  const seg = (marker, body) => Buffer.concat([Buffer.from([0xFF, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const app13 = seg(0xED, Buffer.from('Photoshop 3.0\0' + '8BIM IPTC Πελάτης Παπαδόπουλος', 'utf8'));
  const com = seg(0xFE, Buffer.from('Οδός Ερμού 12, τηλ 6900000000', 'utf8'));
  return Buffer.concat([jpeg.subarray(0, 2), app1, app13, com, jpeg.subarray(2)]);                             // αμέσως μετά το SOI
}
// Μεταδεδομένα ψάχνονται ΜΟΝΟ στα segments πριν από τα δεδομένα εικόνας (SOS). Μέσα στα συμπιεσμένα
// δεδομένα το ζεύγος 0x88 0x25 εμφανίζεται τυχαία (~1 στις 20 εκτελέσεις) — ήταν ψευδής συναγερμός.
function headerSegments(buf){
  const segs = []; let i = 2;
  while(i + 4 <= buf.length && buf[i] === 0xFF){
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    segs.push({marker, data: buf.subarray(i + 4, i + 2 + len)});
    if(marker === 0xDA) break;              // SOS: από εδώ και πέρα μόνο εικόνα
    i += 2 + len;
  }
  return segs;
}
const app1 = buf => headerSegments(buf).filter(s => s.marker === 0xE1);
const hasExif = buf => app1(buf).some(s => s.data.subarray(0, 6).equals(Buffer.from('Exif\0\0', 'binary')));
const hasGpsIfd = buf => app1(buf).some(s => s.data.includes(Buffer.from([0x88, 0x25])));
// Λευκή λίστα: πριν από το SOS επιτρέπονται μόνο όσα βάζει ο browser στην επανακωδικοποίηση.
// APP0/JFIF, APP2/ICC, DQT, SOF0/SOF2, DHT, DRI, SOS. Οτιδήποτε άλλο (APP1 EXIF/XMP, APP13 IPTC, COM…) = αποτυχία.
const ALLOWED = new Set([0xE0, 0xE2, 0xDB, 0xC0, 0xC2, 0xC4, 0xDD, 0xDA]);
const foreignSegments = buf => headerSegments(buf).map(s => s.marker).filter(m => !ALLOWED.has(m)).map(m => '0x' + m.toString(16));

const src = withGps(fs.readFileSync(new URL('../stress/fixtures/01-normal.jpg', import.meta.url)));
const tmp = new URL('./.gps-test.jpg', import.meta.url);
fs.writeFileSync(tmp, src);
check('η είσοδος έχει EXIF με GPS (έλεγχος του ίδιου του test)', hasExif(src) && hasGpsIfd(src));
check('η είσοδος αποτυγχάνει στη λευκή λίστα (APP1, APP13, COM)', foreignSegments(src).join(' ') === '0xe1 0xed 0xfe', foreignSegments(src).join(' '));

const b = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const p = await b.newPage({viewport: {width: 400, height: 860}});
// Στοιχεία επιχείρησης ήδη αποθηκευμένα (η φόρμα πρώτης φοράς ελέγχεται στο app.e2e).
await p.addInitScript(() => { if(!localStorage.getItem('ergolav.profile')) localStorage.setItem('ergolav.profile', JSON.stringify({name: 'Δοκιμή'})); });
let sent = null;
await p.route('https://generativelanguage.googleapis.com/**', async r => {
  sent = JSON.parse(r.request().postData()).contents[0].parts[0].inline_data.data;
  await r.fulfill({headers: {'access-control-allow-origin': '*'}, contentType: 'application/json',
    body: JSON.stringify({candidates: [{finishReason: 'STOP', content: {parts: [{text: '12 μέτρα σωλήνας'}]}}]})});
});
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p.goto(BASE);
// Φωτογραφία κλειστή στο πιλοτικό (PHOTO_ENABLED = false): τίποτα δεν πρέπει να φύγει. Οι έλεγχοι των bytes τρέχουν όταν ξανανοίξει.
if(!(await p.isVisible('#photo'))){
  check('πιλοτικό: το κουμπί φωτογραφίας ΔΕΝ φαίνεται', true);
  await p.setInputFiles('#photoInput', fs.realpathSync(tmp));
  await p.waitForTimeout(500);
  check('πιλοτικό: αρχείο στο κρυφό input δεν ανοίγει την κάλυψη και δεν στέλνεται', !(await p.isVisible('#s-redact.on')) && sent === null);
} else {
  await p.click('#photo');
  await p.fill('#keyInput', 'AIza' + 'P'.repeat(35));
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#keySave')]);
  await chooser.setFiles(fs.realpathSync(tmp));
  await p.waitForSelector('#s-redact.on');

  // Περιοχή κάλυψης: οριζόντια λωρίδα στο πάνω μέρος (σε κλάσματα της εικόνας, για σύγκριση με τα bytes).
  const box = await p.locator('#redactCanvas').boundingBox();
  const frac = {x0: 0.15, x1: 0.85, y0: 0.08, y1: 0.20};
  const before = await p.evaluate(({x, y}) => { const c = document.getElementById('redactCanvas'); return [...c.getContext('2d').getImageData(c.width * x, c.height * y, 1, 1).data].slice(0, 3); }, {x: 0.5, y: 0.14});
  await p.mouse.move(box.x + box.width * frac.x0, box.y + box.height * frac.y0);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width * frac.x1, box.y + box.height * frac.y1, {steps: 6});
  await p.mouse.up();
  await p.click('#ctaBtn');
  await p.waitForSelector('#s-lines.on', {timeout: 20000});

  const bytes = Buffer.from(sent, 'base64');
  if(process.env.PRIVACY_DUMP) fs.writeFileSync(process.env.PRIVACY_DUMP, bytes);
  check('στάλθηκε JPEG', bytes[0] === 0xFF && bytes[1] === 0xD8);
  check('τα bytes που στάλθηκαν ΔΕΝ έχουν EXIF', !hasExif(bytes));
  check('τα bytes που στάλθηκαν ΔΕΝ έχουν GPS IFD', !hasGpsIfd(bytes));
  check('τα bytes που στάλθηκαν έχουν μόνο segments της λευκής λίστας (κανένα APP1/APP13/COM…)', foreignSegments(bytes).length === 0,
    headerSegments(bytes).map(s => '0x' + s.marker.toString(16)).join(' '));
  // Αποκωδικοποίηση ΤΩΝ BYTES ΠΟΥ ΣΤΑΛΘΗΚΑΝ και δειγματοληψία pixels.
  const px = await p.evaluate(async ({b64, pts}) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return pts.map(([fx, fy]) => [...x.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data].slice(0, 3));
  }, {b64: sent, pts: [[0.5, 0.14], [0.3, 0.1], [0.7, 0.18], [0.5, 0.6]]});
  const dark = rgb => rgb.every(v => v < 30), light = rgb => rgb.reduce((a, v) => a + v, 0) > 300;
  check('στο πρωτότυπο η περιοχή ΔΕΝ ήταν μαύρη', light(before), JSON.stringify(before));
  check('στα bytes που στάλθηκαν η καλυμμένη περιοχή είναι μαύρη (3 σημεία)', px.slice(0, 3).every(dark), JSON.stringify(px.slice(0, 3)));
  check('εκτός κάλυψης η εικόνα μένει ίδια (όχι μαύρη)', !dark(px[3]), JSON.stringify(px[3]));
}

// iframe
await p.setContent(`<iframe src="${BASE}" width="400" height="300"></iframe>`);
await p.waitForTimeout(1500);
const frame = p.frames().find(f => f !== p.mainFrame());   // το iframe, όχι η κύρια σελίδα
check('μέσα σε ξένο iframe η εφαρμογή δεν τρέχει', /μόνο απευθείας/.test(await frame.textContent('body')));

await b.close();
fs.rmSync(tmp, {force: true});
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — απέτυχαν: ' + failed.map(r => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
