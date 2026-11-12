// npm start & PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/statistics.e2e.mjs
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {});
const base = process.env.APP_URL || 'http://127.0.0.1:8087/';
const profile = {name:'Δοκιμή', trade:'Υδραυλικός', phone:''};
const quote = (no, status) => ({no, status, at:1794000000000, title:'Δοκιμή', client:'Πελάτης',
  scheduled_date:null, scheduled_time:null, duration_days:1, rows:[{name:'Σωλήνας',qty:1,unit:'μ.',mat:100}],
  sum:{mat:100,lab:100,net:200,vat:48,total:248},vatRate:24,profile});
try{
  for(const [width, colorScheme] of [[360,'light'], [390,'dark']]){
    const context = await browser.newContext({viewport:{width,height:844},colorScheme});
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.addInitScript(({profile, quotes}) => {
      if(sessionStorage.seeded) return;
      sessionStorage.seeded = '1';
      localStorage.clear();
      localStorage.setItem('ergolav.profile',JSON.stringify(profile));
      localStorage.setItem('ergolav.quotes',JSON.stringify(quotes));
    }, {profile,quotes:['sent','won','won','lost','draft'].map((s,i) => quote(i+1,s))});
    await p.goto(base);
    await p.click('#statsOpen');
    await p.waitForSelector('#calStats:not([hidden])');
    assert.equal(await p.locator('.stats-total strong').textContent(),'4');
    assert.equal(await p.locator('.stats-rate').textContent(),'66,7%');
    assert.deepEqual(await p.locator('.stats-card strong').allTextContents(),['1','2','1']);
    assert.equal(await p.locator('#calUndated').isVisible(),false);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    if(process.env.STATISTICS_SCREENSHOT_DIR){
      await p.setViewportSize({width,height:1350});
      await p.screenshot({path:`${process.env.STATISTICS_SCREENSHOT_DIR}/statistics-${colorScheme}.png`,animations:'disabled'});
      await p.setViewportSize({width,height:844});
    }
    // Actual status controls, including undated quotes, update the same source of truth.
    await p.click('[data-view="list"]');
    await p.click('[data-a="status"][data-no="1"]');
    await p.click('[data-set="won"]');
    await p.click('[data-view="stats"]');
    assert.equal(await p.locator('.stats-rate').textContent(),'75%');
    await p.click('[data-view="list"]');
    await p.locator('[data-a="del"][data-no="4"]').click();
    await p.locator('[data-a="del"][data-no="4"]').click();
    await p.click('[data-view="stats"]');
    assert.equal(await p.locator('.stats-rate').textContent(),'100%');
    assert.equal(await p.locator('.stats-total strong').textContent(),'3');
    await p.reload();
    await p.click('#statsOpen');
    assert.equal(await p.locator('.stats-rate').textContent(),'100%');
    await p.evaluate(() => localStorage.removeItem('ergolav.quotes'));
    await p.click('[data-view="list"]');
    await p.click('#navBack');
    await p.click('#statsOpen');
    assert.equal(await p.locator('.stats-rate').textContent(),'—');
    assert.equal(await p.locator('.stats-empty').isVisible(),true);
    assert.deepEqual(errors,[]);
    console.log(`PASS statistics: ${width}px ${colorScheme}, counts, status edit, deletion, reload, empty`);
    await context.close();
  }
}finally{await browser.close();}
