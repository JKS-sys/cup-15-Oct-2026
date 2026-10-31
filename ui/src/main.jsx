// Cup — the window. Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
// Free for personal use; copying this code is not permitted (see LICENSE).
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon, Logo, LOGO } from './icons.jsx';
import { app, refreshAll, refreshCatalogue, refreshEnv, refreshOutdated, scheduleChecks, dailyPing, reportCrash, install, upgrade } from './data.js';
import { loadSettings, settings, setSetting, useSettings } from './store.js';
import { sfx } from './sfx.js';
import { search as find, installLine, latestCup, newerThan } from './pour.js';
import { Sheet, Dialog, Toasts, Menu, Activity, PkgIcon, openSheet, ask, contextMenu } from './parts.jsx';
import { Discover, Browse, Installed, Updates, Taps, Bundle, Care, Log, Settings, About, Setup } from './views.jsx';
import { jobs, runJob, toast } from './jobs.js';
import { open, log } from './bridge.js';

const PAGES = [
  ['discover', 'Discover', 'discover', 'amber'],
  ['apps', 'Apps', 'apps', 'blue'],
  ['tools', 'Tools', 'tools', 'cyan'],
  ['installed', 'Installed', 'installed', 'green'],
  ['updates', 'Updates', 'updates', 'orange'],
  '-',
  ['bundle', 'Brewfile', 'bundle', 'violet'],
  ['taps', 'Taps', 'taps', 'teal'],
  ['care', 'Care', 'care', 'red'],
  ['log', 'Log', 'log', 'lime'],
  '-',
  ['settings', 'Settings', 'settings', 'sep'],
  ['about', 'About', 'about', 'amber'],
];
export const go = (page) => { if (app.get().page !== page) { sfx('nav'); app.set({ page, sel: null, ...(page === 'apps' || page === 'tools' ? {} : { catFilter: '' }) }); } };

// ---- Theme and motion follow the settings.
function applyLook(s) {
  const dark = s.theme === 'dark' || (s.theme === 'auto' && (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true));
  document.body.classList.toggle('t-dark', dark);
  document.body.classList.toggle('t-light', !dark);
  document.body.dataset.motion = s.motion;
  document.body.dataset.density = s.density;
}

function Sidebar() {
  const st = app.use();
  const j = jobs.use();
  const runningN = j.list.filter((x) => x.status === 'running').length;
  const count = { updates: st.outdated.length, installed: st.installed.formulae.length + st.installed.casks.length, log: runningN };
  return (
    <nav class="side" aria-label="Sections">
      <div class="brand"><Logo size={30} /><b>Cup</b></div>
      {PAGES.map((p) => p === '-' ? <hr /> : (
        <button class={`nav ${st.page === p[0] ? 'on' : ''}`} style={{ '--h': p[3] === 'sep' ? 'var(--c-sep)' : `var(--c-${p[3]})` }} onClick={() => go(p[0])} title={p[1]} aria-current={st.page === p[0] ? 'page' : undefined}>
          <Icon n={p[2]} /><span class="nl">{p[1]}</span>{count[p[0]] ? <span class={`cnt ${p[0] === 'updates' ? 'hot' : ''}`}>{count[p[0]]}</span> : null}
        </button>
      ))}
      <span class="grow" />
      <p class="side-by">By Jagadeesh Kumar S</p>
    </nav>
  );
}

function Topbar({ onPalette }) {
  const s = useSettings();
  const cycle = (e) => {
    const next = { auto: 'light', light: 'dark', dark: 'auto' }[s.theme];
    setSetting('theme', next);
    sfx(next === 'dark' ? 'night' : next === 'light' ? 'sunrise' : 'palette', e.currentTarget);
  };
  return (
    <div class="top">
      <button class="find-btn" onClick={onPalette}><Icon n="search" size={16} /><span>Search apps, tools and commands</span><kbd>{navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd></button>
      <span class="grow" />
      <button class="icon-btn" onClick={cycle} title={`Theme: ${s.theme}`} aria-label="Theme"><Icon n={s.theme === 'auto' ? 'auto' : s.theme === 'dark' ? 'moon' : 'sun'} /></button>
      <button class="icon-btn" onClick={(e) => { setSetting('sound', !s.sound); if (!s.sound) sfx('on', e.currentTarget); }} title={s.sound ? 'Sounds on' : 'Sounds off'} aria-label="Sounds"><Icon n={s.sound ? 'sound' : 'mute'} /></button>
    </div>
  );
}

// ---- Command palette: pages, actions and the whole catalogue.
function Palette({ onClose }) {
  const st = app.use();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const ref = useRef();
  const inp = useRef();
  useEffect(() => { setTimeout(() => inp.current?.focus(), 0); }, []);
  const cmds = useMemo(() => [
    ...PAGES.filter((p) => p !== '-').map((p) => ({ t: `Go to ${p[1]}`, icon: p[2], run: () => go(p[0]) })),
    { t: 'Check for updates', icon: 'refresh', run: () => refreshOutdated({ fetchIndex: true }) },
    { t: 'Upgrade everything', icon: 'updates', run: () => upgrade(null) },
    { t: 'Update the package index', icon: 'refresh', run: () => runJob(['update'], { title: 'Update the index', done: 'fresh' }) },
    { t: 'Run a check-up (doctor)', icon: 'care', run: () => go('care') },
    { t: 'Clean up', icon: 'trash', run: () => runJob(['cleanup'], { title: 'Clean up', start: 'clean', done: 'clean' }) },
    { t: 'Take a snapshot', icon: 'camera', run: () => go('bundle') },
    { t: 'Keyboard shortcuts', icon: 'key', run: () => showKeys() },
    { t: 'Star Cup on GitHub', icon: 'star', run: () => open('https://github.com/JKS-sys/cup-15-Oct-2026') },
  ], []);
  const res = useMemo(() => {
    const w = q.toLowerCase().trim();
    const c = cmds.filter((x) => !w || x.t.toLowerCase().includes(w)).slice(0, w ? 6 : 12);
    const p = w && st.cat ? find(st.cat.list, w).slice(0, 30).map((x) => ({ t: x.title || x.name, sub: x.desc, p: x, run: () => openSheet(x) })) : [];
    return [...c, ...p];
  }, [q, st.cat]);
  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(res.length - 1, x + 1)); sfx('tick'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); sfx('tick'); }
    else if (e.key === 'Enter' && res[i]) { e.preventDefault(); onClose(); res[i].run(); sfx('select'); }
    else if (e.key === 'Escape') onClose();
  };
  return (
    <div class="modal-wrap top-wrap" onClick={onClose}>
      <div class="palette" onClick={(e) => e.stopPropagation()}>
        <label class="search big"><Icon n="search" /><input ref={inp} value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={key} placeholder="Type a name, a word, or a command" /></label>
        <div class="pal-list" ref={ref}>
          {res.map((r, n) => (
            <button class={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => { onClose(); r.run(); }}>
              {r.p ? <PkgIcon p={r.p} size={26} /> : <Icon n={r.icon} />}
              <span class="pl-t"><b>{r.t}</b>{r.sub && <span class="muted clamp">{r.sub}</span>}</span>
              {r.p && <code class="muted">{installLine(r.p)}</code>}
            </button>
          ))}
          {!res.length && <p class="muted pad">Nothing found.</p>}
        </div>
      </div>
    </div>
  );
}

const KEYS = [['⌘/Ctrl K', 'Search everything'], ['⌘/Ctrl F', 'Search this page'], ['⌘/Ctrl 1–4', 'Discover, Installed, Updates, Care'], ['⌘/Ctrl ,', 'Settings'], ['⌘/Ctrl R', 'Refresh'], ['⇧⌘/Ctrl L', 'Log'], ['Esc', 'Close a sheet or dialog'], ['Shift-click', 'Select a range'], ['Right-click', 'Actions for anything']];
function showKeys() { ask({ title: 'Keyboard shortcuts', body: <dl class="facts">{KEYS.map(([k, v]) => <><dt><kbd>{k}</kbd></dt><dd>{v}</dd></>)}</dl>, ok: 'Close' }); }

function menuAction(tag, setPal) {
  const map = { 1: () => go('about'), 2: () => go('settings'), 3: () => go('settings'), 4: () => document.getElementById('find')?.focus(), 5: () => setPal(true), 6: () => { refreshAll(); sfx('fresh'); }, 7: showKeys, 8: () => open('https://ipconfig.co.network/cup'), 9: () => open('https://github.com/JKS-sys/cup-15-Oct-2026'), 11: () => go('discover'), 12: () => go('installed'), 13: () => go('updates'), 14: () => go('care'), 15: () => go('log') };
  map[tag]?.();
}

// ---- Start-up animation: the cup fills, the name rises, the byline shines (≥ 1.6 s readable).
function Splash({ done }) {
  const s = settings();
  useEffect(() => {
    sfx('splash');
    const t1 = setTimeout(() => sfx('sparkle'), 1300);
    const t = setTimeout(done, s.motion === 'off' ? 900 : 3100);
    const k = () => done();
    addEventListener('keydown', k, true);
    return () => { clearTimeout(t); clearTimeout(t1); removeEventListener('keydown', k, true); };
  }, []);
  const hues = ['--acc', '--c-cyan', '--c-blue'];
  return (
    <div id="splash" onClick={done} aria-hidden="true">
      <div class="sp-glow" />
      <div class="sp-center">
        <div class="sp-cup" dangerouslySetInnerHTML={{ __html: LOGO(150) }} />
        <h1 class="sp-name">{[...'Cup'].map((c, i) => <span style={{ '--d': `${0.7 + i * 0.12}s`, color: `var(${hues[i]})` }}>{c}</span>)}</h1>
        <p class="sp-tag">Every app and tool, poured in one window</p>
        <p class="sp-by">By Jagadeesh Kumar S</p>
      </div>
    </div>
  );
}

function App() {
  const st = app.use();
  const s = useSettings();
  const [pal, setPal] = useState(false);
  const [splash, setSplash] = useState(s.splash);
  useEffect(() => applyLook(s), [s.theme, s.motion, s.density]);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const f = () => applyLook(settings());
    mq?.addEventListener?.('change', f);
    window.__cupMenu = (tag) => menuAction(tag, setPal);
    const k = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const tag = e.target.tagName;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((v) => !v); sfx('palette'); }
      else if (mod && e.key.toLowerCase() === 'f') { const f = document.getElementById('find'); if (f) { e.preventDefault(); f.focus(); f.select(); } }
      else if (mod && e.key === ',') { e.preventDefault(); go('settings'); }
      else if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); refreshAll(); sfx('fresh'); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); go('log'); }
      else if (mod && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); go(['discover', 'installed', 'updates', 'care'][Number(e.key) - 1]); }
      else if (e.key === '?' && !/INPUT|TEXTAREA|SELECT/.test(tag)) showKeys();
    };
    addEventListener('keydown', k);
    return () => { removeEventListener('keydown', k); mq?.removeEventListener?.('change', f); };
  }, []);
  const ready = st.env && st.env.pour;
  const Page = { discover: Discover, apps: () => <Browse kind="cask" />, tools: () => <Browse kind="formula" />, installed: Installed, updates: Updates, taps: Taps, bundle: Bundle, care: Care, log: Log, settings: Settings, about: About }[st.page] || Discover;
  return (
    <div class="shell" onContextMenu={(e) => {
      if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
      contextMenu(e, [{ heading: 'Cup' }, { label: 'Search everything', icon: 'search', keys: '⌘K', run: () => setPal(true) }, { label: 'Refresh', icon: 'refresh', keys: '⌘R', run: () => refreshAll() }, { label: 'Check for updates', icon: 'updates', run: () => refreshOutdated({ fetchIndex: true }) }, '-', { label: 'Settings', icon: 'settings', run: () => go('settings') }, { label: 'Keyboard shortcuts', icon: 'key', run: showKeys }, { label: 'Star Cup on GitHub', icon: 'star', run: () => open('https://github.com/JKS-sys/cup-15-Oct-2026') }]);
    }}>
      {st.env && !st.env.pour ? <Setup onDone={boot2} /> : (
        <>
          <Sidebar />
          <main class="main">
            <Topbar onPalette={() => { setPal(true); sfx('palette'); }} />
            <div class="content" key={st.page}>{ready ? <Page /> : <div class="loading"><i class="spin big" /></div>}</div>
            <Activity />
          </main>
        </>
      )}
      <Sheet />
      {pal && <Palette onClose={() => setPal(false)} />}
      <Dialog />
      <Menu />
      <Toasts />
      {splash && <Splash done={() => setSplash(false)} />}
    </div>
  );
}

async function boot2() {
  await refreshAll();
  const s = settings();
  if (s.checkAtStart) refreshOutdated({ fetchIndex: Date.now() - s.lastCheck > 3600e3, quiet: true });
  scheduleChecks();
  setTimeout(dailyPing, 20000);
  // Tell the owner when a newer Cup is out (once a start).
  setTimeout(async () => {
    const v = await latestCup().catch(() => null), have = app.get().env?.version;
    if (v && have && newerThan(v, have)) toast('ok', `Cup ${v} is out — Settings → Update Cup with Pour`);
  }, 8000);
}

async function boot() {
  window.addEventListener('error', (e) => log('error', e.message, e.filename, e.lineno));
  window.addEventListener('unhandledrejection', (e) => log('rejection', e.reason));
  window.addEventListener('error', (e) => reportCrash('js', e.message || 'error', `${e.filename || ''}:${e.lineno || 0}`, e.error?.stack || ''));
  window.addEventListener('unhandledrejection', (e) => reportCrash('promise', String(e.reason?.message || e.reason), '', e.reason?.stack || ''));
  await loadSettings();
  applyLook(settings());
  render(<App />, document.getElementById('app'));
  refreshCatalogue();
  try {
    const e = await refreshEnv();
    if (e.pour) await boot2();
  } catch (err) { app.set({ env: { pour: null, os: window.__CUP__?.os } }); reportCrash('boot', err.message); }
  let lastEvery = settings().checkEvery;
  setInterval(() => { if (settings().checkEvery !== lastEvery) { lastEvery = settings().checkEvery; scheduleChecks(); } }, 5000);
}
boot();
