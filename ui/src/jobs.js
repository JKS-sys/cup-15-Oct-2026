// Cup — every Pour command the user starts, with its live log.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { stream, kill, arm, newJob } from './bridge.js';
import { createStore } from './store.js';
import { sfx } from './sfx.js';
import { firstError } from './pour.js';

export const jobs = createStore({ list: [] });
const MAX_LINES = 4000;

/** Line kinds for the log box (same everywhere). */
export function kindOf(l) {
  if (/^==>|^➤/.test(l)) return 'step';
  if (/^▶|^\$ /.test(l)) return 'cmd';
  if (/^✓|^🥂|poured|done in|^Success/i.test(l)) return 'ok';
  if (/^✗|^Error/.test(l)) return 'err';
  if (/^error:/i.test(l)) return 'errline';
  if (/^Warning|^⚠|^!/.test(l)) return 'warn';
  if (/^(Usage:|For more information)/.test(l)) return 'hint';
  if (/^\s*$/.test(l)) return 'skip';
  return 'out';
}

let toastFn = () => {};
export const onToast = (f) => { toastFn = f; };
export const toast = (kind, text, at) => toastFn(kind, text, at);

/**
 * Runs `pour <args>` as a visible job.
 * opts: title, sound (start), done (sound on success), risk (asks Rust for a one-time code), after()
 */
export async function runJob(args, { title, start = 'start', done = 'success', risky = false, after, at, op } = {}) {
  const id = newJob();
  const job = { id, title: title || `pour ${args.join(' ')}`, args, lines: [], status: 'running', started: Date.now(), ended: 0, code: null, problems: 0 };
  const push = (text, stream) => {
    const add = String(text).split('\n').filter((l, i, a) => l.length || i < a.length - 1);
    const prev = job.lines[job.lines.length - 1];
    for (const l of add) {
      if (prev && prev.t === l && /For more information/.test(l)) continue; // clap repeats its hint
      const k = kindOf(l);
      if (k === 'skip') continue;
      job.lines.push({ t: l, k: stream === 'err' && k === 'out' ? 'warn' : k });
      if (k === 'err' || k === 'errline') job.problems++;
    }
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
    jobs.set({ list: [...jobs.get().list] });
  };
  jobs.set({ list: [job, ...jobs.get().list].slice(0, 60) });
  sfx(start, at);
  let code;
  try {
    const nonce = risky ? await arm() : '';
    push(op === 'installpour' ? '▶ Pour installer' : `▶ pour ${args.join(' ')}`);
    code = await stream(args, { job: id, nonce, onLine: (t) => push(t, 'out'), onErr: (t) => push(t, 'err'), op });
  } catch (e) {
    push(`✗ ${e.message}`);
    code = -1;
  }
  job.code = code;
  job.ended = Date.now();
  job.status = code === 0 ? 'ok' : job.status === 'cancelled' ? 'cancelled' : 'failed';
  jobs.set({ list: [...jobs.get().list] });
  if (job.status === 'ok') { sfx(done, at); toast('ok', `${job.title} — done`); }
  else if (job.status === 'failed') {
    sfx('error', at);
    toast('err', `${job.title}: ${firstError(job.lines.map((l) => l.t).join('\n')) || 'it stopped'}`);
  }
  try { await after?.(job); } catch (e) { console.error(e); }
  return job;
}

export function cancelJob(id) {
  const j = jobs.get().list.find((x) => x.id === id);
  if (j && j.status === 'running') { j.status = 'cancelled'; kill(id); sfx('cancel'); jobs.set({ list: [...jobs.get().list] }); }
}
export const running = () => jobs.get().list.filter((j) => j.status === 'running');
export const clearJobs = () => jobs.set({ list: jobs.get().list.filter((j) => j.status === 'running') });
