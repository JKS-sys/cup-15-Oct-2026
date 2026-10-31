// Cup test harness: the real page in Chromium, with the Rust bridge played by Node
// and the real Pour binary underneath. Copyright (c) 2026 Jagadeesh Kumar S.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
export const POUR = process.env.CUP_POUR || '/opt/pour/bin/pour';
const DATA = join(os.tmpdir(), 'cup-test-data');
mkdirSync(join(DATA, 'snapshots'), { recursive: true });
mkdirSync(join(DATA, 'cache'), { recursive: true });
const childEnv = { ...process.env, NO_COLOR: '1', POUR_SOUND: '0', POUR_ANIMATIONS: '0', POUR_PREFIX: dirname(dirname(POUR)) };

// Watchdog: the whole test may take at most CUP_UI_TIMEOUT seconds (default 8 minutes).
let closing = false;
const limit = Number(process.env.CUP_UI_TIMEOUT || 480) * 1000;
if (/ui\.mjs$/.test(process.argv[1] || '')) setTimeout(() => { console.log(`  ✗ the interface test took longer than ${limit / 1000}s — stopped`); process.exit(4); }, limit).unref();
process.on('unhandledRejection', (e) => { console.log(`  ✗ ${String(e?.message || e).split('\n')[0]}`); process.exit(5); });

function run(cmd, args, env) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { env });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => res({ code: code ?? -1, out, err }));
    p.on('error', (e) => res({ code: -1, out, err: e.message }));
  });
}

export async function launch({ width = 1280, height = 800, pour = true, scheme = 'dark', store = {}, browser: given, video, demo = false } = {}) {
  const browser = given || await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, timeout: 60000, args: ['--autoplay-policy=no-user-gesture-required'] });
  // A crashed browser must end the test at once, never leave it waiting.
  if (!given) { const close = browser.close.bind(browser); browser.close = async (...a) => { closing = true; return close(...a); }; }
  if (!given) browser.on('disconnected', () => { if (!closing) { console.log('  ✗ the test browser crashed or quit — the interface test stops here'); process.exit(3); } });
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: video ? 1 : 2, ...(video ? { recordVideo: video } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  const opened = [];
  const copied = [];
  const procs = new Map();
  await page.exposeBinding('__cupNode', async (_src, a) => {
    const [op, ...x] = a;
    const ok = (v) => ({ ok: true, v });
    const no = (v) => ({ ok: false, v });
    switch (op) {
      case 'env': return ok({ os: 'linux', arch: 'x86_64', pour: pour ? POUR : null, home: os.homedir(), data: DATA, version: '1.0.0', sep: '/' });
      case 'cap': {
        const r = await run(POUR, x.slice(2), childEnv);
        return ok({ code: r.code, out: r.out, err: r.err });
      }
      case 'run': case 'installpour': {
        const job = x[0];
        const p = op === 'installpour' ? spawn('/bin/sh', ['-c', 'echo "==> pretend installer"; echo "✓ done"']) : spawn(POUR, x.slice(2), { env: childEnv });
        procs.set(job, p);
        const send = (k, d) => page.evaluate(([j, k, d]) => window.__cupEv(j, k, d), [job, k, d]).catch(() => {});
        p.stdout.on('data', (d) => send('line', d.toString()));
        p.stderr.on('data', (d) => send('err', d.toString()));
        p.on('close', (c) => { procs.delete(job); setTimeout(() => send('exit', String(c ?? -1)), 30); });
        return ok(job);
      }
      case 'kill': procs.get(x[0])?.kill(); return ok(true);
      case 'arm': return ok(Math.random().toString(16).slice(2));
      case 'get': {
        const [url, key] = x;
        const f = join(DATA, 'cache', key);
        if (!existsSync(f)) {
          const r = await run('curl', ['-fsSL', '--compressed', '-o', f, url], process.env);
          if (r.code !== 0) return ok({ ok: false, error: 'offline' });
        }
        return ok({ ok: true, text: readFileSync(f, 'utf8'), age: 0 });
      }
      case 'load': return ok(store[x[0]] ? JSON.stringify(store[x[0]]) : '');
      case 'save': store[x[0]] = JSON.parse(x[1]); return ok(true);
      case 'list': return ok({ dir: join(DATA, 'snapshots'), items: readdirSync(join(DATA, 'snapshots')).map((n) => ({ name: n, time: Math.floor(statSync(join(DATA, 'snapshots', n)).mtimeMs / 1000), size: statSync(join(DATA, 'snapshots', n)).size })) });
      case 'readfile': return existsSync(x[0]) ? ok(readFileSync(x[0], 'utf8')) : no('file not found');
      case 'delsnap': try { unlinkSync(join(DATA, 'snapshots', x[0])); } catch { /* gone */ } return ok(true);
      case 'open': opened.push(x[0]); return ok(true);
      case 'copy': copied.push(x[0]); return ok(true);
      case 'du': { const r = await run('du', ['-sk', '--', ...x.flatMap((i) => i.split('|').slice(1))], process.env); const out = {}; const lines = r.out.trim().split('\n'); let n = 0; for (const it of x) { const k = it.split('|'); let t = 0; for (let i = 1; i < k.length; i++) t += (Number((lines[n++] || '0').split(/\s/)[0]) || 0) * 1024; out[k[0]] = t; } return ok(out); }
      case 'post': case 'badge': case 'title': case 'quit': case 'relaunch': return ok(true);
      default: return no('unknown request');
    }
  });
  await page.addInitScript(() => {
    window.__CUP__ = { v: '1.0.0', os: 'linux' };
    window.__cup = (...a) => window.__cupNode(a).then((r) => (r.ok ? r.v : Promise.reject(r.v)));
  });
  if (demo) await page.addInitScript(() => { window.__CUP_DEMO__ = true; });
  await page.goto(`file://${join(here, '..', 'dist', 'index.html')}`);
  return { browser, page, errors, opened, copied, store };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const shotDir = join(here, '..', '..', 'docs', 'shots');
mkdirSync(shotDir, { recursive: true });
