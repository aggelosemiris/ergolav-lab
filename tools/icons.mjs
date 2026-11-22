// Εικονίδια αρχικής οθόνης (icons/*.png) από το ΕΠΙΣΗΜΟ λογότυπο: icons/ergolav-logo.jpg (τρίγωνο, πορτοκαλί
// τετράγωνο, «ERGOLAV» σε σκούρο φόντο). Τα pixels του λογότυπου μπαίνουν όπως είναι: κόβεται μόνο το περιεχόμενο
// (χωρίς τις άκρες της εικόνας) και κεντράρεται σε καθαρό φόντο ίδιου χρώματος.
// Τρέχει όταν αλλάξει το λογότυπο· τα PNG μπαίνουν στο git. Μετά: npm run sw:manifest.
// Εκτέλεση: node tools/icons.mjs   (Playwright + Chromium: PLAYWRIGHT_MODULE / CHROMIUM_PATH όπως στα browser tests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'icons/ergolav-logo.jpg';
export const BG = '#141E28';              // το φόντο του λογότυπου
// size: px · fit: πλάτος του περιεχομένου ως κλάσμα της πλευράς · radius: στρογγυλές γωνίες (διάφανες).
// maskable: όλο το περιεχόμενο μέσα στον ασφαλή κύκλο (80%)· apple: γεμάτο τετράγωνο, τις γωνίες τις κόβει το iOS.
const ICONS = [
  {file: 'icon-192.png', size: 192, fit: 0.72, radius: 0.22},
  {file: 'icon-512.png', size: 512, fit: 0.72, radius: 0.22},
  {file: 'icon-maskable-512.png', size: 512, fit: 0.58, radius: 0},
  {file: 'apple-touch-icon.png', size: 180, fit: 0.70, radius: 0},
];

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
const page = await browser.newPage({deviceScaleFactor: 1});
const src = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, SOURCE)).toString('base64');
for(const icon of ICONS){
  const png = await page.evaluate(async ({icon, src, BG}) => {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = src; });
    // Το περιεχόμενο: pixels που διαφέρουν από το φόντο, χωρίς 8px στις άκρες (εκεί η εικόνα έχει αχνή γραμμή).
    const t = document.createElement('canvas'); t.width = img.width; t.height = img.height;
    const tx = t.getContext('2d'); tx.drawImage(img, 0, 0);
    const {data} = tx.getImageData(0, 0, t.width, t.height), M = 8;
    let x0 = t.width, y0 = t.height, x1 = 0, y1 = 0;
    for(let y = M; y < t.height - M; y++) for(let x = M; x < t.width - M; x++){
      const i = (y * t.width + x) * 4;
      if(Math.abs(data[i] - 20) + Math.abs(data[i + 1] - 30) + Math.abs(data[i + 2] - 40) > 60){
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    const P = 3; x0 -= P; y0 -= P; x1 += P; y1 += P;               // λίγο περιθώριο για την εξομάλυνση των άκρων
    const cw = x1 - x0, ch = y1 - y0;
    const {size, fit, radius} = icon, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.beginPath(); ctx.roundRect(0, 0, size, size, radius * size); ctx.clip();
    ctx.fillStyle = BG; ctx.fillRect(0, 0, size, size);
    const w = fit * size, h = w * ch / cw;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x0, y0, cw, ch, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, {icon, src, BG});
  fs.writeFileSync(path.join(ROOT, 'icons', icon.file), Buffer.from(png, 'base64'));
  console.log(`icons/${icon.file} · ${icon.size}×${icon.size}`);
}
await browser.close();
