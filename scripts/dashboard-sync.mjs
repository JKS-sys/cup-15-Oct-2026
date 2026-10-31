#!/usr/bin/env node
// Every app Pour lists from the creator (Cup shows them) must also be registered and switched on
// in the ipconfig dashboard. This finds the ones the dashboard lacks or has switched off, and
// registers + activates them with the owner key (APPS_API_KEY from .env — never printed).
//   node scripts/dashboard-sync.mjs [--dry-run]
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.ACCOUNTS_API || 'https://ipconfig.co.network/api/v1';
const POUR = process.env.POUR_API || 'https://ipconfig.co.network/pour/api/apps';
const dry = process.argv.includes('--dry-run');

function envKey(name) {
  if (process.env[name]) return process.env[name];
  const f = join(root, '.env');
  if (!existsSync(f)) return '';
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}
const KEY = envKey('APPS_API_KEY');
const UA = { 'user-agent': 'Mozilla/5.0 (Cup release)', accept: 'application/json' };
const auth = { ...UA, 'content-type': 'application/json', authorization: `Bearer ${KEY}` };

async function json(url, opt = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, opt);
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
      if (r.status >= 500 && i < 2) { await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); continue; }
      return { status: r.status, j };
    } catch (e) { if (i === 2) return { status: 0, j: { message: e.message } }; }
  }
}
const say = (s) => console.log(`  ${s}`);

const pour = await json(POUR, { headers: UA });
const apps = pour.j?.apps || [];
if (!apps.length) { say(`! Pour's app list did not answer (HTTP ${pour.status})`); process.exit(0); }
if (!KEY) { say('! APPS_API_KEY is not in .env — cannot register apps on the dashboard'); process.exit(0); }

// What the dashboard has: the owner list first, the public one as a fallback.
let known = new Map();
const own = await json(`${API}/owner/apps`, { headers: auth });
const list = own.j?.apps || own.j?.rows || (Array.isArray(own.j) ? own.j : null);
if (list) for (const a of list) known.set(a.id || a.app || a.slug, a);
else { const pub = await json(`${API}/apps`, { headers: UA }); for (const a of pub.j?.apps || []) known.set(a.id || a.app || a.slug, a); }

const off = (a) => !a || /pending|off|hidden|disabled|inactive/i.test(String(a.status ?? '')) || a.active === false || a.enabled === false || a.on === false;
const todo = apps.filter((a) => off(known.get(a.token)));
say(`dashboard: ${known.size} apps known · Pour lists ${apps.length} · ${todo.length} to register or switch on${todo.length ? `: ${todo.map((a) => a.token).join(', ')}` : ''}`);
let bad = 0;
for (const a of todo) {
  const body = { app: a.token, id: a.token, name: a.name || a.token, line: a.desc || '', version: a.version || '', homepage: a.homepage || `https://ipconfig.co.network/${a.token}`, platform: 'all', status: 'on', active: true, pour: `pour install --cask ${a.token}` };
  if (dry) { say(`would register ${a.token}`); continue; }
  const steps = [
    ['hello', await json(`${API}/owner/hello`, { method: 'POST', headers: auth, body: JSON.stringify(body) })],
    ['sync', await json(`${API}/owner/sync`, { method: 'POST', headers: auth, body: JSON.stringify({ app: a.token, installs: [], codes: [], subs: [], crashes: [] }) })],
    ['switch on', await json(`${API}/owner/apps/${encodeURIComponent(a.token)}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'on', active: true, name: body.name, line: body.line, version: body.version }) })],
  ];
  const failed = steps.filter(([, r]) => !(r.status >= 200 && r.status < 300));
  if (failed.length === steps.length) { bad++; say(`✗ ${a.token}: ${failed.map(([n, r]) => `${n} HTTP ${r.status} ${r.j?.message || r.j?.error || ''}`).join(' · ')}`); }
  else say(`✓ ${a.token} registered and switched on${failed.length ? ` (${failed.map(([n, r]) => `${n} ${r.status}`).join(', ')} skipped)` : ''}`);
}
// Check again so the result is what the dashboard says, not what we hope.
if (!dry && todo.length) {
  const again = await json(`${API}/apps`, { headers: UA });
  const live = new Set((again.j?.apps || []).filter((a) => !off(a)).map((a) => a.id || a.app || a.slug));
  const still = todo.filter((a) => !live.has(a.token)).map((a) => a.token);
  say(still.length ? `! still not public on the dashboard: ${still.join(', ')} — approve them in the admin panel's Apps tab` : '✓ every app Cup shows is on the dashboard');
}
process.exit(bad ? 1 : 0);
