// Cup — sounds (synthesised, no files) and the little self-drawing picture each one brings.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { settings } from './store.js';

let ctx = null;
function audio() {
  if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
export const PACKS = {
  soft: { name: 'Soft', pitch: 1, len: 1 },
  glass: { name: 'Glass', type: 'sine', pitch: 2, len: 1.4, echo: 0.12 },
  wood: { name: 'Wood', type: 'triangle', pitch: 0.6, len: 0.6 },
  retro: { name: 'Retro', type: 'square', pitch: 1, len: 0.9, gain: 0.5 },
  bells: { name: 'Bells', type: 'sine', pitch: 1.5, len: 2, echo: 0.18, gain: 0.8 },
  space: { name: 'Space', type: 'sine', pitch: 0.8, len: 1.8, echo: 0.22 },
  marimba: { name: 'Marimba', type: 'triangle', pitch: 0.9, len: 0.5, echo: 0.09 },
  cafe: { name: 'Café', type: 'triangle', pitch: 0.75, len: 1.2, echo: 0.05 },
};
let pack = PACKS.soft;
function voice(a, out, { f = 440, f2, type = 'sine', at = 0, dur = 0.12, gain = 0.2, attack = 0.005 }) {
  f *= pack.pitch; if (f2) f2 *= pack.pitch; dur *= pack.len; gain *= pack.gain ?? 1;
  if (pack.type && type !== 'sawtooth') type = pack.type;
  const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
}
const tone = (a, o, x) => { voice(a, o, x); if (pack.echo) voice(a, o, { ...x, at: (x.at || 0) + pack.echo, gain: (x.gain ?? 0.2) * 0.35 }); };
function noise(a, out, { at = 0, dur = 0.25, from = 3000, to = 300, gain = 0.15 }) {
  const t = a.currentTime + at, len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = a.createBufferSource(); s.buffer = buf;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(bp).connect(g).connect(out); s.start(t);
}
/** A liquid pour: bubbles rising in pitch over a soft hiss. */
function bubbles(a, o, n, up = true, at = 0) {
  for (let i = 0; i < n; i++) { const f = up ? 300 + i * 70 + Math.random() * 90 : 900 - i * 60 - Math.random() * 90; tone(a, o, { f, f2: f * 1.9, at: at + i * 0.045 + Math.random() * 0.02, dur: 0.05, gain: 0.05 }); }
}

export const SOUNDS = {
  // Tiny UI sounds (only in Lively, three a second at most).
  tick: (a, o) => tone(a, o, { f: 1800, type: 'triangle', dur: 0.03, gain: 0.06 }),
  nav: (a, o) => tone(a, o, { f: 2400, f2: 2000, dur: 0.025, gain: 0.04 }),
  key: (a, o) => tone(a, o, { f: 2600, dur: 0.018, gain: 0.02 }),
  hover: (a, o) => tone(a, o, { f: 3200, dur: 0.012, gain: 0.01 }),
  // Moving around and showing things.
  open: (a, o) => tone(a, o, { f: 440, f2: 660, type: 'triangle', dur: 0.09, gain: 0.09 }),
  close: (a, o) => tone(a, o, { f: 660, f2: 420, type: 'triangle', dur: 0.09, gain: 0.07 }),
  search: (a, o) => tone(a, o, { f: 1760, f2: 2349, dur: 0.04, gain: 0.035 }),
  found: (a, o) => { tone(a, o, { f: 1175, dur: 0.05, gain: 0.05 }); tone(a, o, { f: 1760, at: 0.05, dur: 0.1, gain: 0.05 }); },
  select: (a, o) => tone(a, o, { f: 988, f2: 1319, dur: 0.05, gain: 0.05 }),
  selectAll: (a, o) => [659, 784, 988, 1175, 1319].forEach((f, i) => tone(a, o, { f, at: i * 0.028, dur: 0.07, gain: 0.045 })),
  on: (a, o) => { tone(a, o, { f: 660, f2: 990, dur: 0.07, gain: 0.07 }); tone(a, o, { f: 1320, at: 0.06, dur: 0.06, gain: 0.04 }); },
  off: (a, o) => tone(a, o, { f: 760, f2: 440, dur: 0.08, gain: 0.06 }),
  copy: (a, o) => { tone(a, o, { f: 988, dur: 0.06, gain: 0.1 }); tone(a, o, { f: 1319, at: 0.05, dur: 0.08, gain: 0.09 }); },
  night: (a, o) => [784, 659, 523, 392].forEach((f, i) => tone(a, o, { f, at: i * 0.07, dur: 0.35, gain: 0.05 })),
  sunrise: (a, o) => [392, 523, 659, 784].forEach((f, i) => tone(a, o, { f, at: i * 0.07, dur: 0.35, gain: 0.05 })),
  palette: (a, o) => { noise(a, o, { dur: 0.18, from: 700, to: 3000, gain: 0.05 }); tone(a, o, { f: 523, f2: 1047, dur: 0.16, gain: 0.06 }); },
  // Pour's work.
  pour: (a, o) => { noise(a, o, { dur: 0.5, from: 600, to: 2400, gain: 0.05 }); bubbles(a, o, 9, true); },
  poured: (a, o) => { bubbles(a, o, 5, true); [523, 659, 784, 1047].forEach((f, i) => tone(a, o, { f, type: 'triangle', at: 0.25 + i * 0.07, dur: 0.24, gain: 0.09 })); },
  drain: (a, o) => { noise(a, o, { dur: 0.45, from: 2400, to: 200, gain: 0.08 }); bubbles(a, o, 7, false); tone(a, o, { f: 180, f2: 90, at: 0.3, dur: 0.16, gain: 0.08 }); },
  refill: (a, o) => { bubbles(a, o, 6, true); tone(a, o, { f: 392, f2: 784, at: 0.2, dur: 0.3, gain: 0.07 }); },
  upgrade: (a, o) => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, o, { f, type: 'triangle', at: i * 0.06, dur: 0.26, gain: 0.08 })),
  updates: (a, o) => { tone(a, o, { f: 880, type: 'triangle', dur: 0.12, gain: 0.07 }); tone(a, o, { f: 1175, type: 'triangle', at: 0.13, dur: 0.18, gain: 0.07 }); },
  fresh: (a, o) => [784, 988, 1175, 1568].forEach((f, i) => tone(a, o, { f, at: i * 0.08, dur: 0.26, gain: 0.07 })),
  clean: (a, o) => { noise(a, o, { dur: 0.35, from: 800, to: 6000, gain: 0.06 }); tone(a, o, { f: 784, f2: 1568, at: 0.1, dur: 0.3, gain: 0.05 }); },
  doctor: (a, o) => { tone(a, o, { f: 1200, f2: 1800, dur: 0.18, gain: 0.04 }); tone(a, o, { f: 1800, at: 0.22, dur: 0.05, gain: 0.03 }); },
  clink: (a, o) => { [2093, 2637].forEach((f, i) => tone(a, o, { f, at: i * 0.05, dur: 0.3, gain: 0.05 })); tone(a, o, { f: 3136, at: 0.02, dur: 0.15, gain: 0.02 }); },
  untap: (a, o) => { tone(a, o, { f: 1319, f2: 660, dur: 0.18, gain: 0.06 }); noise(a, o, { at: 0.1, dur: 0.12, from: 1200, to: 300, gain: 0.05 }); },
  snapshot: (a, o) => { noise(a, o, { dur: 0.05, from: 5000, to: 2500, gain: 0.18 }); noise(a, o, { at: 0.07, dur: 0.06, from: 3500, to: 1800, gain: 0.14 }); },
  restore: (a, o) => { noise(a, o, { dur: 0.38, from: 4200, to: 260, gain: 0.1 }); tone(a, o, { f: 880, f2: 330, dur: 0.34, gain: 0.06 }); },
  export: (a, o) => { [523, 659, 784].forEach((f, i) => tone(a, o, { f, type: 'triangle', at: i * 0.05, dur: 0.14, gain: 0.07 })); noise(a, o, { at: 0.12, dur: 0.2, from: 2000, to: 6000, gain: 0.04 }); },
  pin: (a, o) => { tone(a, o, { f: 1200, type: 'square', dur: 0.02, gain: 0.04 }); tone(a, o, { f: 784, at: 0.03, dur: 0.14, gain: 0.09 }); },
  start: (a, o) => { tone(a, o, { f: 440, f2: 880, type: 'square', dur: 0.06, gain: 0.03 }); tone(a, o, { f: 1320, at: 0.06, dur: 0.12, gain: 0.06 }); },
  cancel: (a, o) => { tone(a, o, { f: 784, f2: 523, type: 'triangle', dur: 0.12, gain: 0.07 }); tone(a, o, { f: 392, at: 0.1, dur: 0.14, gain: 0.05 }); },
  success: (a, o) => [523, 659, 784].forEach((f, i) => tone(a, o, { f, at: i * 0.06, dur: 0.16, gain: 0.1 })),
  error: (a, o) => { tone(a, o, { f: 220, type: 'square', dur: 0.09, gain: 0.06 }); tone(a, o, { f: 185, type: 'square', at: 0.1, dur: 0.14, gain: 0.06 }); },
  warn: (a, o) => { tone(a, o, { f: 494, type: 'triangle', dur: 0.14, gain: 0.06 }); tone(a, o, { f: 466, type: 'triangle', at: 0.16, dur: 0.22, gain: 0.05 }); },
  confirm: (a, o) => { tone(a, o, { f: 440, type: 'triangle', dur: 0.1, gain: 0.06 }); tone(a, o, { f: 554, type: 'triangle', at: 0.1, dur: 0.1, gain: 0.06 }); },
  star: (a, o) => [2093, 2637, 3136, 3951].forEach((f, i) => tone(a, o, { f, at: i * 0.035, dur: 0.08, gain: 0.03 })),
  welcome: (a, o) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, o, { f, type: 'sine', at: i * 0.06, dur: 0.3, gain: 0.06 })); noise(a, o, { at: 0.3, dur: 0.5, from: 6000, to: 10000, gain: 0.03 }); },
  splash: (a, o) => {
    noise(a, o, { at: 0, dur: 0.7, from: 500, to: 2600, gain: 0.04 }); bubbles(a, o, 12, true, 0.05);
    [261.6, 329.6, 392, 523.3, 659.3, 784].forEach((f, i) => tone(a, o, { f, type: 'triangle', at: 0.6 + i * 0.07, dur: 0.9, gain: 0.04, attack: 0.02 }));
  },
  sparkle: (a, o) => [2093, 2637, 3136, 3951].forEach((f, i) => tone(a, o, { f, at: i * 0.035, dur: 0.08, gain: 0.025 })),
};
export const CHATTER = new Set(['tick', 'nav', 'key', 'hover', 'open', 'close', 'search', 'select', 'on', 'off']);
const TINY = new Set(['tick', 'nav', 'key', 'hover']);
let lastTiny = [];

/** Plays a sound and, when animations allow, its picture. Never throws. */
export function sfx(name, at) {
  try {
    window.__cupSfxHook?.(name);
    const s = settings();
    const lively = s.motion === 'lively';
    if (TINY.has(name)) {
      if (!lively) return;
      const now = performance.now();
      lastTiny = lastTiny.filter((t) => now - t < 1000);
      if (lastTiny.length >= 3) return;
      lastTiny.push(now);
    }
    if (!CHATTER.has(name) || lively) scene(name, at);
    if (!s.sound || (s.soundMode === 'smart' && CHATTER.has(name))) return;
    pack = PACKS[s.pack] || PACKS.soft;
    const play = SOUNDS[name], a = play && audio();
    if (!a) return;
    const m = a.createGain(); m.gain.value = Math.max(0, Math.min(1, s.volume ?? 0.5)); m.connect(a.destination);
    play(a, m);
  } catch { /* a nicety, never in the way */ }
}

// ---- Scenes: one self-drawing picture for every sound (stroke paths draw themselves).
const P = {
  cup: 'M30 44h52v26a22 22 0 0 1-22 22h-8a22 22 0 0 1-22-22z M82 50h8a10 10 0 0 1 0 20h-8',
  stream: 'M58 6c0 12-4 18-4 30',
  drops: 'M40 30a3 3 0 1 0 .1 0 M66 24a3 3 0 1 0 .1 0 M52 18a2 2 0 1 0 .1 0',
  check: 'M34 62l16 16 32-34',
  cross: 'M38 40l44 44M82 40l-44 44',
  arrowUp: 'M60 92V30M38 52l22-22 22 22',
  arrowDown: 'M60 28v62M38 68l22 22 22-22',
  ring: 'M60 20a40 40 0 1 1-.1 0',
  spark: 'M60 16v18M60 86v18M16 60h18M86 60h18M29 29l12 12M79 79l12 12M91 29L79 41M41 79L29 91',
  broom: 'M82 18L50 62M38 60l24 14-10 26-30-12z',
  magnifier: 'M52 26a24 24 0 1 1-.1 0M70 70l22 22',
  bell: 'M40 78V54a20 20 0 0 1 40 0v24h8H32zM54 86a6 6 0 0 0 12 0',
  pulse: 'M14 60h22l8-22 14 44 10-30 6 8h32',
  glasses: 'M30 30h24v24a12 12 0 0 1-24 0zM66 30h24v24a12 12 0 0 1-24 0zM42 66v26M78 66v26M32 92h20M68 92h20',
  camera: 'M22 40h18l6-10h28l6 10h18v46H22zM60 48a14 14 0 1 1-.1 0',
  box: 'M24 40l36-18 36 18v40l-36 18-36-18zM24 40l36 18 36-18M60 58v40',
  pin: 'M60 98V60M44 24h32l-4 18 12 14H36l12-14z',
  moon: 'M74 22a36 36 0 1 0 24 52 30 30 0 0 1-24-52z',
  sun: 'M60 40a20 20 0 1 1-.1 0M60 12v12M60 96v12M12 60h12M96 60h12M26 26l9 9M85 85l9 9M94 26l-9 9M35 85l-9 9',
  star: 'M60 14l13 28 30 4-22 21 6 30-27-15-27 15 6-30-22-21 30-4z',
  play: 'M42 30v60l48-30z',
  stop: 'M36 36h48v48H36z',
  doc: 'M34 18h36l18 18v66H34zM70 18v18h18M44 56h34M44 68h34M44 80h22',
  copy: 'M42 34h40v52H42zM30 22h40v8M30 22v52h8',
  list: 'M28 36h64M28 60h64M28 84h64M18 36h2M18 60h2M18 84h2',
  key: 'M38 60a14 14 0 1 1-.1 0M52 60h44M84 60v12M94 60v8',
  wave: 'M10 70c10-20 20-20 30 0s20 20 30 0 20-20 30 0',
  swirl: 'M60 60m-30 0a30 30 0 1 0 60 0a24 24 0 1 0-48 0a18 18 0 1 0 36 0',
  palette: 'M60 18a42 42 0 1 0 0 84c8 0 10-8 4-14-4-6 0-12 8-12h12a18 18 0 0 0 18-18c0-22-18-40-42-40zM40 44a4 4 0 1 0 .1 0M60 34a4 4 0 1 0 .1 0M80 44a4 4 0 1 0 .1 0',
  hand: 'M40 96V58l-8-12M40 58V28a6 6 0 0 1 12 0v26M52 54V22a6 6 0 0 1 12 0v32M64 54V26a6 6 0 0 1 12 0v34M76 58V40a6 6 0 0 1 12 0v30c0 16-10 26-26 26H40',
};
const S = (paths, hue = 'acc', extra = '') => ({ paths, hue, extra });
export const SCENES = {
  tick: S(['check'], 'c-cyan'), nav: S(['arrowUp'], 'c-blue'), key: S(['key'], 'c-violet'), hover: S(['ring'], 'c-sep'),
  open: S(['box'], 'c-blue'), close: S(['box', 'cross'], 'c-sep'), search: S(['magnifier'], 'c-cyan'), found: S(['magnifier', 'spark'], 'c-teal'),
  select: S(['check'], 'c-teal'), selectAll: S(['list', 'check'], 'c-teal'), on: S(['play'], 'c-green'), off: S(['stop'], 'c-sep'),
  copy: S(['copy'], 'c-blue'), night: S(['moon'], 'c-violet'), sunrise: S(['sun'], 'c-amber'), palette: S(['palette'], 'c-orange'),
  pour: S(['cup', 'stream', 'drops'], 'acc'), poured: S(['cup', 'check', 'spark'], 'c-green'), drain: S(['cup', 'arrowDown'], 'c-orange'),
  refill: S(['cup', 'swirl'], 'c-cyan'), upgrade: S(['arrowUp', 'ring'], 'c-lime'), updates: S(['bell'], 'c-amber'), fresh: S(['wave', 'check'], 'c-cyan'),
  clean: S(['broom', 'spark'], 'c-teal'), doctor: S(['pulse'], 'c-red'), clink: S(['glasses', 'spark'], 'acc'), untap: S(['glasses', 'cross'], 'c-sep'),
  snapshot: S(['camera'], 'c-blue'), restore: S(['camera', 'arrowDown'], 'c-violet'), export: S(['doc', 'arrowUp'], 'c-cyan'), pin: S(['pin'], 'c-amber'),
  start: S(['play'], 'c-blue'), cancel: S(['hand'], 'c-orange'), success: S(['ring', 'check'], 'c-green'), error: S(['ring', 'cross'], 'c-red'),
  warn: S(['bell', 'cross'], 'c-orange'), confirm: S(['hand', 'check'], 'c-amber'), star: S(['star'], 'acc'), welcome: S(['cup', 'star'], 'acc'),
  splash: S(['cup', 'stream'], 'acc'), sparkle: S(['spark'], 'acc'),
};

let live = 0;
function scene(name, at) {
  const s = settings();
  if (s.motion === 'off' || !SCENES[name] || live > 2) return;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch { /* old WebView */ }
  const sc = SCENES[name];
  const el = document.createElement('div');
  el.className = 'scene';
  const r = at?.getBoundingClientRect?.();
  if (r) { el.style.left = `${Math.max(8, Math.min(innerWidth - 104, r.left + r.width / 2 - 48))}px`; el.style.top = `${Math.max(8, Math.min(innerHeight - 104, r.top - 100))}px`; }
  else { el.style.right = '24px'; el.style.bottom = '150px'; }
  const col = sc.hue === 'acc' ? 'var(--acc)' : `var(--${sc.hue})`;
  el.innerHTML = `<svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true">${sc.paths.map((k, i) => `<path d="${P[k]}" pathLength="1" style="--i:${i};stroke:${col}"/>`).join('')}</svg>`;
  document.body.append(el);
  live++;
  setTimeout(() => { el.remove(); live--; }, s.motion === 'lively' ? 1500 : 1100);
}
export const SCENE_PATHS = P;

// README demos only: renders a list of [seconds, name] into stereo PCM (never used by the app).
if (typeof window !== 'undefined' && window.__CUP_DEMO__) {
  window.__cupRender = async (events, seconds, sr = 44100) => {
    const off = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    const s = settings();
    pack = PACKS[s.pack] || PACKS.soft;
    for (const [t, name] of events) {
      const play = SOUNDS[name];
      if (!play) continue;
      const shim = new Proxy(off, { get: (o, k) => (k === 'currentTime' ? t : typeof o[k] === 'function' ? o[k].bind(o) : o[k]) });
      const m = off.createGain(); m.gain.value = 0.9; m.connect(off.destination);
      play(shim, m);
    }
    const buf = await off.startRendering();
    return [Array.from(buf.getChannelData(0)), Array.from(buf.getChannelData(1))];
  };
}
