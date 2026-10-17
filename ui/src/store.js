// Cup — app state and remembered settings. Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { useEffect, useState } from 'preact/hooks';
import { load, save } from './bridge.js';

export const DEFAULTS = {
  theme: 'auto', // auto | light | dark
  motion: 'subtle', // off | subtle | lively
  sound: true,
  soundMode: 'smart', // smart | all
  pack: 'soft',
  volume: 0.5,
  splash: true,
  layout: 'cards', // cards | list | compact | tiles | magazine | masonry | board | timeline
  installedLayout: 'list',
  greedy: false,
  autoCleanup: false,
  checkAtStart: true,
  checkEvery: 6, // hours, 0 = never
  icons: true,
  ping: true,
  confirmUninstall: true,
  density: 'cosy',
  mid: '',
  seenWelcome: false,
  lastCheck: 0,
  lastPing: 0,
};
let S = { ...DEFAULTS };
const subs = new Set();
export const settings = () => S;
export async function loadSettings() {
  const v = await load('settings', {});
  S = { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
  if (!S.mid) S.mid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  subs.forEach((f) => f(S));
  return S;
}
export function setSetting(k, v) {
  S = { ...S, [k]: v };
  save('settings', S);
  subs.forEach((f) => f(S));
}
export function useSettings() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  return S;
}

/** A tiny shared store: get(), set(patch), use() in components. */
export function createStore(init) {
  let v = init;
  const ls = new Set();
  return {
    get: () => v,
    set(p) { v = { ...v, ...(typeof p === 'function' ? p(v) : p) }; ls.forEach((f) => f(v)); },
    use() {
      const [, set] = useState(0);
      useEffect(() => { const f = () => set((n) => n + 1); ls.add(f); return () => ls.delete(f); }, []);
      return v;
    },
  };
}
