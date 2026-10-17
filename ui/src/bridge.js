// Cup — talking to the Rust side. Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
// Every Pour command goes through `run` (streamed) or `cap` (captured); Rust checks it first.

const raw = (...a) => (typeof window.__cup === 'function'
  ? window.__cup(...a.map(String)).catch((e) => { throw e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e)); })
  : Promise.reject(new Error('Cup bridge missing')));
export const log = (...m) => { try { window.__cup?.('log', m.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(' ')); } catch { /* fine */ } };
export const call = raw;

const listeners = new Map(); // job → {line, err, exit}
window.__cupEv = (job, kind, data) => {
  const l = listeners.get(job);
  if (!l) return;
  try {
    if (kind === 'exit') { listeners.delete(job); l.exit?.(Number(data)); }
    else l[kind]?.(data);
  } catch (e) { console.error(e); }
};

let seq = 0;
export const newJob = () => `j${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Streams a Pour command. Resolves with the exit code when it ends. */
export function stream(args, { job = newJob(), nonce = '', onLine, onErr, op = 'run' } = {}) {
  return new Promise((resolve, reject) => {
    listeners.set(job, { line: onLine, err: onErr, exit: resolve });
    const p = op === 'installpour' ? raw('installpour', job) : raw('run', job, nonce, ...args);
    p.catch((e) => { listeners.delete(job); reject(new Error(String(e?.message || e))); });
  });
}

/** Runs a Pour command to the end and returns {code, out, err}. */
export const cap = (args, nonce = '') => raw('cap', '', nonce, ...args);
export const arm = () => raw('arm');
export const kill = (job) => raw('kill', job);
export const env = () => raw('env');
export const get = (url, key, maxAge = 3600) => raw('get', url, key, maxAge);
export const open = (url) => raw('open', url).catch(() => false);
export const badge = (t) => raw('badge', t).catch(() => {});
export const post = (path, body) => raw('post', path, JSON.stringify(body)).catch(() => '');

export async function load(name, fallback) {
  try { const t = await raw('load', name); return t ? JSON.parse(t) : fallback; } catch { return fallback; }
}
const saving = new Map();
/** Saves soon (coalesced), so a burst of changes writes once. */
export function save(name, value) {
  clearTimeout(saving.get(name));
  saving.set(name, setTimeout(() => raw('save', name, JSON.stringify(value)).catch(() => {}), 250));
}
export const snapshots = () => raw('list');
export const readBrewfile = (p) => raw('readfile', p);
export const deleteSnapshot = (n) => raw('delsnap', n);
export const quit = () => raw('quit');
export const relaunch = () => raw('relaunch');
