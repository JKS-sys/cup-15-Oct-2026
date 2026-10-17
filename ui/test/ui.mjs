// Cup end-to-end test: every page, a real install and removal through Pour, both themes,
// small windows. Zero page errors allowed. Copyright (c) 2026 Jagadeesh Kumar S.
import { launch, sleep, shotDir } from './harness.mjs';
import { join } from 'node:path';

let fails = 0;
const check = (c, msg) => { if (!c) { fails++; console.log(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); };
const shots = process.argv.includes('--shots');

const { browser, page, errors, opened } = await launch({ store: { settings: { splash: true, sound: false, motion: 'subtle' } } });
await page.waitForSelector('#splash');
check(await page.locator('.sp-by').textContent() === 'By Jagadeesh Kumar S', 'splash byline');
await page.waitForSelector('#splash', { state: 'detached', timeout: 6000 });
await page.waitForSelector('.hero', { timeout: 30000 });
check(true, 'discover loaded with catalogue');
if (shots) await page.screenshot({ path: join(shotDir, 'discover-dark.png') });

const pages = ['Apps', 'Tools', 'Installed', 'Updates', 'Brewfile', 'Taps', 'Care', 'Log', 'Settings', 'About', 'Discover'];
for (const p of pages) {
  await page.click(`.nav[title="${p}"]`);
  await page.waitForSelector('.page');
  await sleep(p === 'Care' ? 1500 : 500);
  const h = await page.locator('.page h1').first().textContent().catch(() => '');
  check(h.length > 0, `${p} page renders (${h})`);
}

// Search the catalogue and open a sheet.
await page.keyboard.press('Control+k');
await page.fill('.palette input', 'tree');
await page.waitForSelector('.pal-list button .pkicon');
await page.keyboard.press('ArrowDown');
const target = page.locator('.pal-list button:has(.pl-t b:text-is("tree"))').first();
await target.click();
await page.waitForSelector('.sheet h2');
check((await page.locator('.sheet h2').textContent()).includes('tree'), 'palette opens the sheet for tree');
await page.waitForSelector('.sheet .facts');
if (shots) await page.screenshot({ path: join(shotDir, 'sheet.png') });

// Install through Pour, see it under Installed, remove it again.
const getBtn = page.locator('.sheet .sh-actions button', { hasText: 'Get it' });
const hadTree = !(await getBtn.count());
if (hadTree) console.log('  • tree is already installed here — the install and removal steps are skipped so nothing of yours is removed');
if (!hadTree) {
  await getBtn.click();
  await page.waitForSelector('.sheet .sh-actions button:has-text("Remove")', { timeout: 120000 });
  check(true, 'tree poured');
}
await page.keyboard.press('Escape');
if (!hadTree) {
await page.click('.nav[title="Installed"]');
await page.waitForSelector('.row.pk:has-text("tree")');
check(true, 'tree listed under Installed');
if (shots) await page.screenshot({ path: join(shotDir, 'installed.png') });
await page.click('.row.pk:has-text("tree")', { button: 'right' });
await page.click('.cmenu button:has-text("Remove")');
await page.click('.modal .btn.danger');
await page.waitForSelector('.row.pk:has-text("tree")', { state: 'detached', timeout: 60000 });
check(true, 'tree removed through the right-click menu');
await page.click('.nav[title="Log"]');
check(await page.locator('.logbox').count() >= 2, 'log has the install and the removal');
}
await page.click('.nav[title="Log"]');
// The log is empty when the install was skipped, so only open an entry when there is one.
if (await page.locator('.logbox .logbar').count()) await page.locator('.logbox .logbar').first().click();
if (shots) await page.screenshot({ path: join(shotDir, 'log.png') });

// Snapshot.
await page.click('.nav[title="Brewfile"]');
await page.click('button:has-text("Take snapshot")');
await page.waitForSelector('.rows .row:has-text("snapshot-")', { timeout: 30000 });
check(true, 'snapshot taken');

// Light theme.
await page.click('.nav[title="Settings"]');
await page.selectOption('.opt:has-text("Theme") select', 'light');
await page.click('.nav[title="Discover"]');
await sleep(600);
check(await page.evaluate(() => document.body.classList.contains('t-light')), 'light theme applies');
if (shots) { await page.screenshot({ path: join(shotDir, 'discover-light.png') }); }
await page.click('.nav[title="Apps"]'); await sleep(800);
if (shots) await page.screenshot({ path: join(shotDir, 'apps-light.png') });
await page.selectOption('.opt:has-text("Theme") select', 'dark').catch(() => {});

// Fit: nothing scrolls sideways or sticks out at any size.
const sizes = [[420, 260], [560, 420], [760, 520], [980, 640], [1280, 800], [1600, 1000]];
for (const [w, h] of sizes) {
  await page.setViewportSize({ width: w, height: h });
  for (const p of ['Discover', 'Apps', 'Installed', 'Updates', 'Care', 'Settings', 'About', 'Brewfile', 'Log', 'Taps']) {
    await page.locator(`.nav[title="${p}"]`).click();
    await sleep(250);
    const bad = await page.evaluate(() => {
      const out = [];
      const vw = innerWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push(`page ${document.documentElement.scrollWidth}>${vw}`);
      const c = document.querySelector('.content');
      if (c && c.scrollWidth > c.clientWidth + 1) out.push(`content ${c.scrollWidth}>${c.clientWidth}`);
      const scrollers = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p !== c && p !== document.body && p !== document.documentElement) return true; } return false; };
      for (const el of document.querySelectorAll('.content *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > vw + 1 && !scrollers(el)) { out.push(`${el.tagName}.${el.className} ${Math.round(r.right)}>${vw}`); if (out.length > 4) break; }
      }
      return out;
    });
    if (bad.length) { fails++; console.log(`  ✗ ${w}×${h} ${p}: ${bad.join('; ')}`); }
  }
}
check(true, `fit checked at ${sizes.length} sizes`);
check(errors.length === 0, `zero page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
await browser.close();
console.log(fails ? `${fails} problem(s)` : 'all good');
process.exit(fails ? 1 : 0);
