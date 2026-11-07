// Cup — what is installed, what is outdated, what exists. Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { createStore, settings, setSetting } from './store.js';
import * as pour from './pour.js';
import { call, env as bridgeEnv, badge, cap, post, log, sizes as bridgeSizes } from './bridge.js';
import { runJob, toast } from './jobs.js';
import { sfx } from './sfx.js';

export const app = createStore({
  env: null, pourEnv: null, ready: false,
  installed: { formulae: [], casks: [], homebrew: { formulae: [], casks: [] } }, loadingInstalled: true,
  outdated: [], loadingOutdated: false, checkedAt: 0,
  cat: null, catError: '', loadingCat: true,
  taps: [], leaves: [],
  page: 'discover', sel: null, // sel = {name, kind}
  busy: new Set(), sizes: {}, // keys being worked on
});

export const isInstalled = (p) => {
  const i = app.get().installed;
  return (p.kind === 'cask' ? i.casks : i.formulae).some((x) => x.name === p.name);
};
export const installedVersion = (p) => {
  const i = app.get().installed;
  return (p.kind === 'cask' ? i.casks : i.formulae).find((x) => x.name === p.name)?.version;
};
export const outdatedOf = (p) => app.get().outdated.find((x) => x.name === p.name && x.kind === p.kind);

export async function refreshEnv() {
  const e = await bridgeEnv();
  app.set({ env: e });
  if (e.pour) {
    try { app.set({ pourEnv: await pour.pourEnv() }); } catch { app.set({ pourEnv: null }); }
  }
  return e;
}
export async function refreshInstalled() {
  app.set({ loadingInstalled: true });
  try { app.set({ installed: await pour.installed() }); } catch (e) { toast('err', `Could not read what is installed: ${e.message}`); }
  app.set({ loadingInstalled: false });
  refreshLeaves();
  refreshSizes();
}
/** On-disk size of every installed app and tool: its Cellar/Caskroom folder plus what it put elsewhere (the .app). */
export async function refreshSizes() {
  const st = app.get(), pre = st.pourEnv?.prefix, sep = st.env?.sep || '/';
  if (!pre) return;
  const abs = (x) => typeof x === 'string' && (x.startsWith('/') || /^[A-Za-z]:\\/.test(x));
  const items = [];
  for (const f of st.installed.formulae) items.push(`formula:${f.name}|${pre}${sep}Cellar${sep}${f.name}`);
  for (const c of st.installed.casks) {
    const extra = (c.artifacts || []).flatMap((a) => (typeof a === 'string' ? [a.replace(/^[a-z]+:/, '')] : [])).filter(abs).filter((p) => !p.startsWith(`${pre}${sep}bin`));
    items.push([`cask:${c.name}`, `${pre}${sep}Caskroom${sep}${c.name}`, ...extra].join('|'));
  }
  for (const h of [...st.installed.homebrew.formulae, ...st.installed.homebrew.casks]) if (abs(h.path)) items.push(`brew-${h.kind}:${h.name}|${h.path}`);
  if (!items.length) return;
  const got = await bridgeSizes(items);
  if (got && typeof got === 'object') app.set({ sizes: got });
}
export const sizeOf = (p, brew = false) => app.get().sizes?.[`${brew ? 'brew-' : ''}${p.kind}:${p.name}`];
export function human(n) {
  if (n == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
export async function refreshLeaves() { try { app.set({ leaves: await pour.leaves() }); } catch { /* fine */ } }
export async function refreshTaps() { try { app.set({ taps: await pour.taps() }); } catch { /* fine */ } }
export async function refreshOutdated({ fetchIndex = false, quiet = false } = {}) {
  app.set({ loadingOutdated: true });
  try {
    if (fetchIndex) await cap(['update']);
    const casks = new Set(app.get().installed.casks.map((c) => c.name));
    const list = await pour.outdated(casks);
    const before = app.get().outdated.length;
    app.set({ outdated: list, checkedAt: Date.now() });
    setSetting('lastCheck', Date.now());
    badge(list.length ? String(list.length) : '');
    if (!quiet && list.length > before) sfx('updates');
  } catch (e) { if (!quiet) toast('err', `Could not check for updates: ${e.message}`); }
  app.set({ loadingOutdated: false });
}
export async function refreshCatalogue(force = false) {
  app.set({ loadingCat: true, catError: '' });
  try { app.set({ cat: await pour.catalogue(force) }); } catch (e) { log('catalogue', e); app.set({ catError: e.message || String(e) }); }
  app.set({ loadingCat: false });
}
export async function refreshAll() {
  await refreshInstalled();
  await Promise.all([refreshOutdated({ quiet: true }), refreshTaps()]);
}

// ---- Actions (each one is a visible job).
const key = (p) => `${p.kind}:${p.name}`;
function mark(ps, on) {
  const b = new Set(app.get().busy);
  for (const p of ps) on ? b.add(key(p)) : b.delete(key(p));
  app.set({ busy: b });
}
const kindFlag = (ps) => (ps.every((p) => p.kind === 'cask') ? ['--cask'] : ps.every((p) => p.kind === 'formula') ? ['--formula'] : []);
const label = (ps) => (ps.length === 1 ? ps[0].title || ps[0].name : `${ps.length} packages`);
function byKind(ps) { const c = ps.filter((p) => p.kind === 'cask'), f = ps.filter((p) => p.kind === 'formula'); return [f, c].filter((x) => x.length); }

export async function install(ps, at, { force = false } = {}) {
  for (const group of byKind(ps)) {
    mark(group, true);
    await runJob(['install', ...kindFlag(group), ...(force ? ['--force'] : []), ...group.map((p) => p.name)], { title: `Pour ${label(group)}`, start: 'pour', done: 'poured', at });
    mark(group, false);
  }
  await refreshInstalled();
}
export async function uninstall(ps, at, { zap = false } = {}) {
  for (const group of byKind(ps)) {
    mark(group, true);
    await runJob(['uninstall', ...kindFlag(group), ...(zap ? ['--zap'] : []), ...group.map((p) => p.name)], { title: `Remove ${label(group)}`, start: 'drain', done: 'success', risky: zap, at });
    mark(group, false);
  }
  await refreshInstalled();
  app.set({ outdated: app.get().outdated.filter((o) => !ps.some((p) => p.name === o.name)) });
}
export async function reinstall(ps, at) {
  for (const group of byKind(ps)) {
    mark(group, true);
    await runJob(['reinstall', ...kindFlag(group), ...group.map((p) => p.name)], { title: `Pour again: ${label(group)}`, start: 'refill', done: 'poured', at });
    mark(group, false);
  }
  await refreshInstalled();
}
export async function upgrade(ps, at) {
  const s = settings();
  const all = !ps;
  const groups = all ? [[]] : byKind(ps);
  for (const group of groups) {
    mark(group, true);
    await runJob(['upgrade', ...(group.length ? kindFlag(group) : []), ...(s.greedy ? ['--greedy'] : []), ...group.map((p) => p.name)], { title: all ? 'Upgrade everything' : `Upgrade ${label(group)}`, start: 'upgrade', done: 'poured', at });
    mark(group, false);
  }
  if (s.autoCleanup) await runJob(['cleanup'], { title: 'Clean up after upgrading', start: 'clean', done: 'clean' });
  await refreshInstalled();
  await refreshOutdated({ quiet: true });
}
export async function simple(args, title, sound = 'start', done = 'success', at) {
  const j = await runJob(args, { title, start: sound, done, at });
  return j;
}

// ---- Background checks and the anonymous daily hello.
let timer = 0;
export function scheduleChecks() {
  clearInterval(timer);
  const h = settings().checkEvery;
  if (!h) return;
  timer = setInterval(() => refreshOutdated({ fetchIndex: true, quiet: true }), h * 3600e3);
}
export async function dailyPing() {
  const s = settings();
  if (!s.ping || Date.now() - s.lastPing < 20 * 3600e3) return;
  const e = app.get().env || {};
  setSetting('lastPing', Date.now());
  await post('ping', { app: 'cup', mid: s.mid, os: e.os, arch: e.arch, version: e.version, plan: 'free' });
}
export function reportCrash(kind, message, place = '', stack = '') {
  if (!settings().ping) return;
  if (/ResizeObserver loop|^Script error\.?$/.test(message)) return;
  const e = app.get().env || {};
  post('crashes', { app: 'cup', kind, version: e.version, os: e.os, message: String(message).slice(0, 500), place: String(place).slice(0, 200), stack: String(stack).slice(0, 4000), mid: settings().mid });
}

/** Crashes saved by the native side (panics, failed requests) go out once, as one batch. */
export async function sendSavedCrashes() {
  let list = [];
  try { list = await call('crashlog'); } catch { return; }
  if (!Array.isArray(list) || !list.length) return;
  window.__cupSent = list;
  if (!settings().ping) return;
  const e = app.get().env || {};
  const r = await post('crashes', { app: 'cup', version: e.version, os: e.os, crashes: list.slice(-50).map((c) => ({ kind: c.kind, message: c.message, place: c.place, version: e.version, os: e.os, mid: settings().mid })) });
  if (r !== '') await call('crashlog', 'clear').catch(() => {});
}
