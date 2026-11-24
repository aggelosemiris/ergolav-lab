// Adapters σελίδων για προμηθευτές ειδικοτήτων (tools/prices/adapters/shops.mjs): κανονική τιμή ΜΟΝΟ όταν δηλώνεται ρητά.
// Τα κομμάτια HTML είναι ίδια με τη σήμανση των sites (μέτρηση 24/11/2026). Όλοι οι προμηθευτές είναι απενεργοποιημένοι.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWooHtml, parseJournal, parsePresta, parseEshop, wooHtmlItems, journalItems } from '../tools/prices/adapters/shops.mjs';

const woo = (id, name, price) => `<div class="product-grid-item product wd-hover-base type-product post-${id} status-publish">` +
  `<div class="product-element-bottom"><h3 class="wd-entities-title"><a href="https://www.oikeiaoikia.gr/product/p${id}/">${name}</a></h3>` +
  `<div class="wrap-price"><span class="price">${price}</span></div></div></div>`;
const amt = v => `<span class="woocommerce-Price-amount amount"><bdi>${v}&nbsp;<span class="woocommerce-Price-currencySymbol">&euro;</span></bdi></span>`;

test('WooCommerce HTML: <del>/<ins> = ρητή αρχική· μία τιμή = κανονική· εύρος = μη επαληθευμένο· χωρίς τιμή = παράλειψη', () => {
  const html = woo(1, 'Νιπτήρας 50 εκ.', `<del aria-hidden="true">${amt('54,00')}</del> <span class="screen-reader-text">Original price was: 54,00&nbsp;&euro;.</span><ins aria-hidden="true">${amt('29,70')}</ins>`) +
    woo(2, 'Ντουζιέρα 80x80cm', amt('120,00')) + woo(3, 'Χρώμα 3lt &amp; 9lt', `${amt('13,50')} &ndash; ${amt('32,00')}`) + woo(4, 'Κατάλογος', '');
  const items = parseWooHtml(html, 'https://www.oikeiaoikia.gr/');
  assert.deepEqual(items.map(i => [i.id, i.verification, i.regularCents, i.currentCents, i.promo]),
    [['1', 'verified', 5400, 2970, true], ['2', 'verified', 12000, 12000, false], ['3', 'unverified', null, 1350, false]]);
  assert.equal(items[2].reason, 'price-range');
  assert.equal(items[2].name, 'Χρώμα 3lt & 9lt');
});

test('OpenCart/Journal3: price-normal = κανονική· price-new + price-old = ρητή αρχική', () => {
  const card = (id, name, price) => `<div class="product-thumb"><div class="caption"><div class="name"><a href="https://www.palousis.gr/καμπίνες?product_id=${id}">${name}</a></div><div class="price"><div>${price}</div> <span class="price-tax">Προ ΦΠΑ:1,00€</span></div></div></div>`;
  const items = parseJournal(card(26791, 'A914 ΚΡΥΣΤΑΛΛΟ 80Χ80', '<span class="price-normal">486,00€</span>') +
    card(26792, 'Νιπτήρας 50', '<span class="price-new">80,00€</span> <span class="price-old">100,00€</span>') + card(26793, 'Χωρίς', ''), 'https://www.palousis.gr/');
  assert.deepEqual(items.map(i => [i.id, i.verification, i.regularCents, i.currentCents, i.promo]),
    [['26791', 'verified', 48600, 48600, false], ['26792', 'verified', 10000, 8000, true]]);
});

test('PrestaShop: product-price content = τρέχουσα· regular-price = ρητή αρχική', () => {
  const card = (id, price) => `<article class="product-miniature product-miniature-default js-product-miniature" data-id-product="${id}" data-id-product-attribute="0">` +
    `<h2 class="h3 product-title"><a href="https://kaxirismonotika.gr/home/${id}-x.html" class="product--title-link">Κόλλα…</a>` +
    `<a href="https://kaxirismonotika.gr/home/${id}-x.html" class="product--hover-title">Κόλλα πλακιδίων C2TE 25 kg</a></h2>` +
    `<div class="price-box">${price}</div></article>`;
  const items = parsePresta(card(1, '<span class="product-price" content="12.40" aria-label="Τιμή"> 12,40 € </span>') +
    card(2, '<span class="regular-price" aria-label="Κανονική τιμή">15,00 €</span> <span class="product-price" content="12.00"> 12,00 € </span>') + card(3, ''));
  assert.deepEqual(items.map(i => [i.id, i.verification, i.regularCents, i.currentCents]),
    [['1', 'verified', 1240, 1240], ['2', 'verified', 1500, 1200], ['3', 'unverified', null, undefined]]);
  assert.equal(items[0].name, 'Κόλλα πλακιδίων C2TE 25 kg');
});

test('e-shop.gr: «ΠΤΛ» είναι προτεινόμενη τιμή κατασκευαστή, όχι κανονική → μη επαληθευμένο· απλή τιμή = κανονική', () => {
  const card = (code, name, price) => `<div><a href="https://www.e-shop.gr/x-p-${code}" class="web-title-link"><b>${name}</b></a></div></td></tr><tr><td>${price}</td></tr>`;
  const items = parseEshop(card('PER.1', 'ΛΑΜΠΑ LED E27 10W', ' <b>3.90</b>&nbsp;&euro;') +
    card('PER.2', 'ΦΩΤΙΣΤΙΚΟ', '<span>ΠΤΛ&nbsp; 59.50&nbsp;&euro;</span> <span>MONO&nbsp;39.90&nbsp;&euro;</span>'));
  assert.deepEqual(items.map(i => [i.id, i.verification, i.regularCents, i.currentCents, i.reason]),
    [['PER.1', 'verified', 390, 390, null], ['PER.2', 'unverified', null, 3990, 'rrp-not-regular']]);
});

test('σελιδοποίηση: μόνο όσο υπάρχει επόμενη σελίδα· αν την κλείνει το robots.txt, σταματά χωρίς παράκαμψη', async () => {
  const pages = {'https://w.example/c/': woo(1, 'Α', amt('1,00')) + '<a href="https://w.example/c/page/2/">2</a>', 'https://w.example/c/page/2/': woo(2, 'Β', amt('2,00'))};
  const got = [];
  const fetcher = {get: async url => (got.push(url), {status: 200, body: pages[url] ?? ''})};
  const ids = []; for await (const it of wooHtmlItems({fetcher, base: 'https://w.example/', categories: ['/c/']})) ids.push(it.id);
  assert.deepEqual(ids, ['1', '2']); assert.deepEqual(got, ['https://w.example/c/', 'https://w.example/c/page/2/']);
  // Journal: το ?page=2 απαγορεύεται (Disallowed) → σταματά στην 1η σελίδα
  const card = `<div class="product-thumb"><div class="name"><a href="https://j.example/x?product_id=9">Χ</a></div><span class="price-normal">5,00€</span></div>`;
  const f2 = {get: async url => { if(/page=2/.test(url)){ const e = new Error('robots.txt: ' + url); e.name = 'Disallowed'; throw e; } return {status: 200, body: card + '<a href="?page=2">2</a>'}; }};
  const j = []; for await (const it of journalItems({fetcher: f2, base: 'https://j.example/', categories: ['/c']})) j.push(it.id);
  assert.deepEqual(j, ['9']);
  // μπλοκάρισμα (403/CAPTCHA) σταματά ΟΛΟ τον προμηθευτή
  const f3 = {get: async () => { const e = new Error('HTTP 403'); e.name = 'Blocked'; throw e; }};
  await assert.rejects(async () => { for await (const _ of wooHtmlItems({fetcher: f3, base: 'https://w.example/', categories: ['/c/']})); }, {name: 'Blocked'});
});
