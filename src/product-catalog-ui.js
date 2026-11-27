import {clean} from './price-match.js';
import {formatEur} from './number.js';

const PAGE_SIZE = 20;
const FRESH_DAYS = 21;
const ONE_DAY = 86400000;
const url = 'src/product-catalog.json.gz';
const dateFormat = new Intl.DateTimeFormat('el-GR', {dateStyle: 'medium', timeZone: 'Europe/Athens'});
const searchText = value => clean(value).replace(/[^\p{L}\p{N}./"×]+/gu, ' ').trim();

export function indexProductCatalog(data){
  return data.products.map(row => {
    const [, name, brand, , aliases, , detail] = row;
    return {row, name: searchText(name), text: searchText([name, brand, ...aliases, detail].join(' '))};
  });
}

export function searchProductCatalog(index, query){
  const q = searchText(query).slice(0, 120).trim();
  if(!q) return index;
  const terms = [...new Set(q.split(/\s+/))];
  const numbers = terms.filter(term => /^\d/.test(term)).map(term => new RegExp(
    `(?<![\\d.])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d]|\\.\\d)`
  ));
  const words = terms.filter(term => !/^\d/.test(term));
  const matches = index.filter(item => words.every(term => item.text.includes(term)) && numbers.every(re => re.test(item.text)));
  const rank = item => item.name === q ? 0 : item.name.startsWith(q) ? 1 : item.name.includes(q) ? 2 : 3;
  return matches.sort((a, b) => rank(a) - rank(b));
}

export function groupCatalogMatches(matches){
  const groups = new Map();
  for(const match of matches){
    if(!groups.has(match.name)) groups.set(match.name, []);
    groups.get(match.name).push(match);
  }
  return [...groups.values()];
}

export function displayedCatalogPrice(product, offers){
  const verified = offers.filter(row => Number.isInteger(row.cents) && row.cents > 0 && Number.isFinite(Date.parse(row.verified_at)));
  const fresh = verified.filter(row => Date.now() - Date.parse(row.verified_at) <= FRESH_DAYS * ONE_DAY);
  const source = fresh.length ? fresh : verified;
  source.sort((a, b) => fresh.length ? a.cents - b.cents || b.verified_at.localeCompare(a.verified_at)
    : b.verified_at.localeCompare(a.verified_at) || a.cents - b.cents);
  if(source.length){
    const {cents, supplier_id: supplier, verified_at: date, price_kind} = source[0];
    return {cents, supplier, date, label: fresh.length ? (price_kind === 'listed' ? 'Δημοσιευμένη τιμή λιανικής' : 'Κανονική τιμή λιανικής') : 'Τελευταία επαληθευμένη τιμή'};
  }
  const archival = product[5];
  if(!archival) return null;
  const [cents, date, supplier] = archival;
  return {cents, supplier, date, label: 'Τιμή αρχικής συλλογής'};
}

async function readCatalog(){
  const response = await fetch(url);
  if(!response.ok) throw new Error('Ο κατάλογος δεν φορτώθηκε');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = bytes[0] === 31 && bytes[1] === 139
    ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    : bytes;
  return indexProductCatalog(await new Response(body).json());
}

export function mountProductCatalog({screen, db}){
  const input = screen.querySelector('input');
  const list = screen.querySelector('ul');
  const status = screen.querySelector('[role=status]');
  const more = screen.querySelector('[data-more]');
  const retry = screen.querySelector('[data-retry]');
  let index, load, groups, offset, timer, revision = 0;
  const number = n => n.toLocaleString('el-GR');

  function setPrice(target, product, offers){
    const price = displayedCatalogPrice(product, offers);
    target.textContent = price
      ? `${formatEur(price.cents / 100)} · ${price.label} · ${price.supplier} · ${dateFormat.format(new Date(price.date))}`
      : 'Δεν υπάρχει καταγεγραμμένη τιμή';
  }

  async function displayPrices(page, elements, current){
    try {
      const client = await db();
      if(!client || revision !== current) return;
      const {data, error} = await client.from('product_catalog_prices').select('product_id,supplier_id,cents,price_kind,verified_at')
        .in('product_id', page.map(({row}) => row[0]));
      if(error || revision !== current) return;
      const offers = new Map();
      for(const price of data){
        if(!offers.has(price.product_id)) offers.set(price.product_id, []);
        offers.get(price.product_id).push(price);
      }
      page.forEach(({row}, i) => setPrice(elements[i], row, offers.get(row[0]) || []));
    } catch { /* Η τιμή της αρχικής συλλογής παραμένει εμφανής μαζί με την ημερομηνία. */ }
  }

  function productLine(container, {row}, showTitle){
    const [, name, brand, unit, , , detail] = row;
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    const info = document.createElement('p');
    const price = document.createElement('p');
    heading.textContent = name;
    info.textContent = [brand, unit, detail].filter(Boolean).join(' · ');
    info.hidden = !info.textContent;
    price.className = 'hint';
    setPrice(price, row, []);
    if(showTitle) item.append(heading);
    item.append(info, price);
    container.append(item);
    return price;
  }

  function similarResults(group){
    const card = document.createElement('li');
    const details = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = `${group[0].row[1]} · ${number(group.length)} καταχωρίσεις`;
    const variants = document.createElement('ul');
    variants.className = 'product-results';
    const next = document.createElement('button');
    next.className = 'ghost';
    next.type = 'button';
    next.textContent = 'Περισσότερες καταχωρίσεις';
    const current = revision;
    let shown = 0;
    function append(){
      const part = group.slice(shown, shown + PAGE_SIZE);
      shown += part.length;
      next.hidden = shown >= group.length;
      const prices = part.map(entry => productLine(variants, entry, false));
      void displayPrices(part, prices, current);
    }
    details.addEventListener('toggle', () => { if(details.open && !shown) append(); });
    next.addEventListener('click', append);
    details.append(title, variants, next);
    card.append(details);
    list.append(card);
  }

  function appendPage(){
    const page = groups.slice(offset, offset + PAGE_SIZE);
    const individual = [], prices = [];
    for(const group of page){
      if(group.length > 1) similarResults(group);
      else {
        individual.push(group[0]);
        prices.push(productLine(list, group[0], true));
      }
    }
    offset += page.length;
    more.hidden = offset >= groups.length;
    if(individual.length) void displayPrices(individual, prices, revision);
  }

  function search(){
    if(!index) return;
    revision++;
    const matches = searchProductCatalog(index, input.value);
    groups = groupCatalogMatches(matches);
    offset = 0;
    list.replaceChildren();
    status.textContent = groups.length ? `${number(groups.length)} αποτελέσματα` : 'Δεν βρέθηκαν προϊόντα.';
    appendPage();
  }

  async function open(){
    clearTimeout(timer);
    input.value = '';
    input.disabled = !index;
    retry.hidden = true;
    if(!index){
      status.textContent = 'Φόρτωση καταλόγου…';
      load ??= readCatalog();
      try { index = await load; }
      catch {
        load = null;
        status.textContent = 'Ο κατάλογος δεν φορτώθηκε. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.';
        retry.hidden = false;
        return;
      }
    }
    input.disabled = false;
    search();
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 140); });
  more.addEventListener('click', appendPage);
  retry.addEventListener('click', open);
  return {open};
}
