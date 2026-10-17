// README media: a walkthrough recorded as video with Cup's own sounds laid under it,
// plus 2× screenshots. Dev-only (run on a machine with Pour and ffmpeg).
//   CUP_POUR=/opt/pour/bin/pour node test/demo.mjs <outdir>
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { chromium } from 'playwright';
import { launch, sleep } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] || 'docs';
mkdirSync(out, { recursive: true });
const vids = join(out, '.vid');
rmSync(vids, { recursive: true, force: true });
const W = 1280, H = 800;

// ---- 1. Screenshots at 2×.
{
  const { browser, page } = await launch({ width: W, height: H, store: { settings: { splash: false, sound: false, motion: 'off' } } });
  await page.waitForSelector('.hero', { timeout: 60000 });
  await sleep(2500);
  const snap = async (name) => { await sleep(700); await page.screenshot({ path: join(out, `${name}.png`) }); };
  await snap('shot-discover');
  await page.click('.nav[title="Apps"]'); await snap('shot-apps');
  await page.click('.nav[title="Installed"]'); await snap('shot-installed');
  await page.click('.nav[title="Care"]'); await sleep(1500); await snap('shot-care');
  await page.click('.nav[title="Tools"]'); await page.fill('#find', 'ffmpeg'); await sleep(500);
  await page.locator('.pk').first().click(); await page.waitForSelector('.sheet .facts'); await snap('shot-sheet');
  await page.keyboard.press('Escape');
  await page.click('.nav[title="Settings"]'); await page.selectOption('.opt:has-text("Theme") select', 'light');
  await page.click('.nav[title="Discover"]'); await sleep(1200); await snap('shot-discover-light');
  await page.click('.nav[title="Brewfile"]'); await snap('shot-brewfile-light');
  await browser.close();
}

// ---- 2. The walkthrough video, with every sound noted.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const { page } = await launch({ width: W, height: H, store: { settings: { splash: true, sound: false, motion: 'lively', soundMode: 'all', pack: 'soft' } }, browser, demo: true, video: { dir: vids, size: { width: W, height: H } } });
const t0 = Date.now();
const events = [];
await page.exposeFunction('__cupSfxNote', (n) => events.push([(Date.now() - t0) / 1000, n]));
await page.evaluate(() => { window.__cupSfxHook = (n) => window.__cupSfxNote(n); });
await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
await page.waitForSelector('.hero', { timeout: 60000 });
await sleep(1500);
await page.mouse.move(600, 500);
await page.mouse.wheel(0, 500); await sleep(900);
await page.locator('.shelf .icon-btn[aria-label="More"]').first().click(); await sleep(900);
await page.mouse.wheel(0, -500); await sleep(500);
await page.click('.find-btn'); await page.waitForSelector('.palette input'); await sleep(300);
await page.keyboard.type('figlet', { delay: 90 }); await sleep(900);
await page.locator('.pal-list button:has(.pl-t b:text-is("figlet"))').first().click();
await page.waitForSelector('.sheet .facts'); await sleep(1200);
const get = page.locator('.sheet .sh-actions button', { hasText: 'Get it' });
const had = !(await get.count());
if (!had) { await get.click(); await page.waitForSelector('.sheet .sh-actions button:has-text("Remove")', { timeout: 120000 }); await sleep(1500); }
await page.keyboard.press('Escape'); await sleep(500);
await page.click('.nav[title="Installed"]'); await sleep(1400);
await page.click('.nav[title="Updates"]'); await sleep(1000);
await page.click('.nav[title="Care"]'); await sleep(1600);
await page.click('.nav[title="Log"]'); await sleep(800);
await page.locator('.logbox .logbar').first().click(); await sleep(1400);
await page.click('.top .icon-btn[aria-label="Theme"]'); await sleep(900);
await page.click('.nav[title="Apps"]'); await sleep(900);
await page.selectOption('.page-h select[aria-label="Layout"]', 'tiles'); await sleep(1400);
await page.selectOption('.page-h select[aria-label="Layout"]', 'cards'); await sleep(600);
if (!had) {
  await page.click('.nav[title="Installed"]'); await sleep(700);
  await page.click('.row.pk:has-text("figlet")', { button: 'right' }); await sleep(700);
  await page.click('.cmenu button:has-text("Remove")'); await sleep(600);
  await page.click('.modal .btn.danger');
  await page.waitForSelector('.row.pk:has-text("figlet")', { state: 'detached', timeout: 60000 }); await sleep(1200);
}
const seconds = (Date.now() - t0) / 1000 + 0.5;
// Render the sounds with Cup's own synthesiser, offline.
const pcm = await page.evaluate(async ([ev, s]) => {
  if (!window.__cupRender) return null;
  return window.__cupRender(ev, s);
}, [events, seconds]);
await page.close();
await browser.close();
const webm = join(vids, readdirSync(vids).find((f) => f.endsWith('.webm')));
const wav = join(vids, 'sound.wav');
if (pcm) {
  const [L, R] = pcm, n = L.length, b = Buffer.alloc(44 + n * 4);
  let peak = 1e-6; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.7 / peak; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.max(-1, Math.min(1, L[i])) * 32767 | 0, 44 + i * 4); b.writeInt16LE(Math.max(-1, Math.min(1, R[i])) * 32767 | 0, 46 + i * 4); }
  writeFileSync(wav, b);
}
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
ff('-i', webm, ...(pcm ? ['-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-shortest'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', join(out, 'demo.mp4'));
ff('-i', webm, '-vf', 'fps=8,scale=760:-1:flags=lanczos', '-c:v', 'libwebp_anim', '-quality', '50', '-compression_level', '6', '-loop', '0', '-an', join(out, 'demo.webp'));
for (const f of readdirSync(out).filter((f) => f.startsWith('shot-') && f.endsWith('.png'))) {
  ff('-i', join(out, f), '-c:v', 'libwebp', '-quality', '88', join(out, f.replace(/\.png$/, '.webp')));
  rmSync(join(out, f));
}
rmSync(vids, { recursive: true, force: true });
console.log(`demo: ${events.length} sounds over ${seconds.toFixed(1)} s → ${out}/demo.mp4, demo.webp, shot-*.webp`);
