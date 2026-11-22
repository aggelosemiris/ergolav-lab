// Εικονίδια αρχικής οθόνης (icons/*.png) από το λογότυπο: «e» σε #F5B84B, φόντο #10235C, γραμματοσειρά Commissioner
// (vendor/fonts). Τρέχει μία φορά, όταν αλλάξει το λογότυπο· τα PNG μπαίνουν στο git.
// Εκτέλεση: node tools/icons.mjs   (Playwright + Chromium: PLAYWRIGHT_MODULE / CHROMIUM_PATH όπως στα browser tests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BG = '#10235C', FG = '#F5B84B';
// size: px · glyph: ύψος του «e» ως κλάσμα της πλευράς · radius: στρογγυλές γωνίες (διάφανες) ως κλάσμα της πλευράς.
// maskable: το «e» μέσα στον ασφαλή κύκλο (80%)· apple: γεμάτο τετράγωνο, οι γωνίες στρογγυλεύουν από το iOS.
const ICONS = [
  {file: 'icon-192.png', size: 192, glyph: 0.50, radius: 0.22},
  {file: 'icon-512.png', size: 512, glyph: 0.50, radius: 0.22},
  {file: 'icon-maskable-512.png', size: 512, glyph: 0.40, radius: 0},
  {file: 'apple-touch-icon.png', size: 180, glyph: 0.50, radius: 0},
];

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const page = await browser.newPage({deviceScaleFactor: 1});
const font = fs.readFileSync(path.join(ROOT, 'vendor/fonts/commissioner-latin-wght-normal.woff2')).toString('base64');
fs.mkdirSync(path.join(ROOT, 'icons'), {recursive: true});
for(const icon of ICONS){
  const png = await page.evaluate(async ({icon, font, BG, FG}) => {
    const bytes = Uint8Array.from(atob(font), c => c.charCodeAt(0));
    const face = new FontFace('Logo', bytes, {weight: '100 900'});
    document.fonts.add(await face.load());
    const {size, glyph, radius} = icon, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = BG;
    ctx.beginPath(); ctx.roundRect(0, 0, size, size, radius * size); ctx.fill();
    // Το «e» κεντραρισμένο με βάση το πραγματικό του περίγραμμα (όχι τη γραμμή βάσης).
    let px = size, m;
    for(let i = 0; i < 3; i++){
      ctx.font = `800 ${px}px Logo`;
      m = ctx.measureText('e');
      px *= glyph * size / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
    }
    ctx.font = `800 ${px}px Logo`;
    m = ctx.measureText('e');
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    ctx.fillStyle = FG;
    ctx.fillText('e', (size - w) / 2 + m.actualBoundingBoxLeft, (size - h) / 2 + m.actualBoundingBoxAscent);
    return c.toDataURL('image/png').split(',')[1];
  }, {icon, font, BG, FG});
  fs.writeFileSync(path.join(ROOT, 'icons', icon.file), Buffer.from(png, 'base64'));
  console.log(`icons/${icon.file} · ${icon.size}×${icon.size}`);
}
await browser.close();
