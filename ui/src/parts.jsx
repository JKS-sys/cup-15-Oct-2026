// Cup — shared pieces: package tiles, the info sheet, dialogs, toasts, menus, log boxes.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { app, install, uninstall, reinstall, upgrade, isInstalled, installedVersion, outdatedOf, simple, refreshInstalled } from './data.js';
import { catName, catHue, hostOf, installLine, info as pourInfo, deps as pourDeps, uses as pourUses } from './pour.js';
import { open } from './bridge.js';
import { sfx } from './sfx.js';
import { settings, useSettings } from './store.js';
import { toast, onToast, cancelJob, jobs } from './jobs.js';

export const hueVar = (h) => (h === 'acc' ? 'var(--acc)' : `var(--c-${h})`);
const HUES = ['blue', 'cyan', 'teal', 'green', 'lime', 'amber', 'orange', 'violet'];
const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

/** Website icon when allowed (falls back to a coloured letter). */
export function PkgIcon({ p, size = 44 }) {
  const s = useSettings();
  const [bad, setBad] = useState(false);
  const host = p.source === 'creator' || /ipconfig\.co\.network$/.test(hostOf(p.homepage)) ? '' : hostOf(p.homepage);
  const hue = HUES[hash(p.name) % HUES.length];
  const letter = (p.title || p.name).replace(/^(font-|lib)/, '')[0]?.toUpperCase() || '?';
  return (
    <span class="pkicon" style={{ width: size, height: size, '--h': hueVar(hue) }}>
      <b style={{ fontSize: size * 0.46 }}>{letter}</b>
      {p.source === 'creator' && !bad && <img class="own" src={`https://ipconfig.co.network/img/${p.name}-icon-${document.body.classList.contains('t-light') ? 'light' : 'dark'}.webp`} alt="" loading="lazy" onError={() => setBad(true)} />}
      {s.icons && host && !bad && <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt="" loading="lazy" onError={() => setBad(true)} onLoad={(e) => { if (e.currentTarget.naturalWidth < 32) setBad(true); }} />}
    </span>
  );
}

export function KindBadge({ p }) {
  return <span class={`badge k-${p.kind}`}>{p.source === 'creator' ? 'by the creator' : p.kind === 'cask' ? 'app' : 'tool'}</span>;
}

export function StateBadge({ p }) {
  const st = app.use();
  const o = outdatedOf(p);
  if (st.busy.has(`${p.kind}:${p.name}`)) return <span class="badge b-busy"><i class="spin" />working</span>;
  if (o) return <span class="badge b-upd">update {o.to}</span>;
  if (isInstalled(p)) return <span class="badge b-ok"><Icon n="check" size={12} />installed</span>;
  return null;
}

/** The main button for a package, whatever its state. */
export function PkgAction({ p, small }) {
  const st = app.use();
  const ref = useRef();
  const busy = st.busy.has(`${p.kind}:${p.name}`);
  const inst = isInstalled(p);
  const o = outdatedOf(p);
  const go = (e) => {
    e.stopPropagation();
    if (busy) return;
    if (o) upgrade([p], ref.current);
    else if (inst) openSheet(p);
    else install([p], ref.current);
  };
  return (
    <button ref={ref} class={`btn ${o ? 'b-up' : inst ? 'ghost' : 'acc'} ${small ? 'sm' : ''}`} disabled={busy} onClick={go} title={installLine(p)}>
      {busy ? <i class="spin" /> : null}
      {busy ? 'Pouring…' : o ? 'Update' : inst ? 'Open' : 'Get'}
    </button>
  );
}

export function openSheet(p) { sfx('open'); app.set({ sel: { name: p.name, kind: p.kind } }); }

export function PkgCard({ p, onCtx }) {
  return (
    <article class="card pk" tabIndex={0} onClick={() => openSheet(p)} onKeyDown={(e) => e.key === 'Enter' && openSheet(p)} onContextMenu={(e) => onCtx?.(e, p)} style={{ '--h': hueVar(catHue(p.cat)) }}>
      <div class="pk-top"><PkgIcon p={p} /><div class="pk-t"><h3 title={p.name}>{p.title || p.name}</h3><span class="muted pk-sub">{catName(p.cat)}</span></div></div>
      <p class="pk-d">{p.desc || 'No description.'}</p>
      <div class="pk-foot"><KindBadge p={p} /><StateBadge p={p} /><span class="grow" /><span class="ver ct-n">{p.version}</span><PkgAction p={p} small /></div>
    </article>
  );
}

export function PkgRow({ p, checked, onCheck, onCtx, extra }) {
  return (
    <div class={`row pk ${checked ? 'on' : ''}`} tabIndex={0} onClick={() => openSheet(p)} onKeyDown={(e) => e.key === 'Enter' && openSheet(p)} onContextMenu={(e) => onCtx?.(e, p)}>
      {onCheck && <input type="checkbox" class="chk" checked={checked} onClick={(e) => { e.stopPropagation(); onCheck(e); }} aria-label={`Select ${p.name}`} />}
      <PkgIcon p={p} size={30} />
      <div class="row-main"><b>{p.title || p.name}</b><span class="muted clamp">{p.desc}</span></div>
      {extra}
      <KindBadge p={p} />
      <StateBadge p={p} />
      <span class="ver ct-n">{installedVersion(p) || p.version}</span>
      <PkgAction p={p} small />
    </div>
  );
}

// ---- The package sheet (everything about one formula or cask).
export function Sheet() {
  const st = app.use();
  const sel = st.sel;
  const [d, setD] = useState(null);
  const [extra, setExtra] = useState({});
  const [err, setErr] = useState('');
  const box = useRef();
  useEffect(() => {
    if (!sel) return;
    setD(null); setErr(''); setExtra({});
    let live = true;
    pourInfo(sel.name, sel.kind).then((x) => live && setD(x)).catch((e) => live && setErr(e.message));
    if (sel.kind === 'formula') {
      Promise.all([pourDeps(sel.name).catch(() => []), pourUses(sel.name).catch(() => [])]).then(([dp, us]) => live && setExtra({ deps: dp, uses: us }));
    }
    const k = (e) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', k);
    setTimeout(() => box.current?.focus(), 30);
    return () => { live = false; removeEventListener('keydown', k); };
  }, [sel?.name, sel?.kind]);
  if (!sel) return null;
  const row = st.cat?.byKey.get(`${sel.kind}:${sel.name}`) || { name: sel.name, kind: sel.kind, desc: '', version: '' };
  const p = { ...row, desc: d?.desc || row.desc, homepage: d?.homepage || row.homepage, version: d?.version || row.version };
  const close = () => { sfx('close'); app.set({ sel: null }); };
  const inst = isInstalled(p);
  const o = outdatedOf(p);
  const busy = st.busy.has(`${p.kind}:${p.name}`);
  const apps = (d?.artifacts || []).flatMap((a) => (a && a.app ? a.app : [])).filter((x) => typeof x === 'string');
  const deps = d?.dependencies || [];
  return (
    <div class="sheet-wrap" onClick={close}>
      <aside class="sheet" ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={p.name}>
        <header class="sh-head">
          <PkgIcon p={p} size={64} />
          <div class="sh-t">
            <h2>{p.title || (d?.names?.[0]) || p.name}</h2>
            <div class="sh-meta"><KindBadge p={p} /><StateBadge p={p} /><span class="badge" style={{ '--h': hueVar(catHue(row.cat)) }}>{catName(row.cat)}</span></div>
          </div>
          <button class="icon-btn" onClick={close} aria-label="Close"><Icon n="close" /></button>
        </header>
        <p class="sh-desc">{p.desc || (err ? '' : 'Loading…')}</p>
        <div class="sh-actions">
          {!inst && <button class="btn acc" disabled={busy} onClick={(e) => install([p], e.currentTarget)}><Icon n="installed" />Get it</button>}
          {o && <button class="btn b-up" disabled={busy} onClick={(e) => upgrade([p], e.currentTarget)}><Icon n="updates" />Update to {o.to}</button>}
          {inst && <button class="btn" disabled={busy} onClick={(e) => reinstall([p], e.currentTarget)}><Icon n="refresh" />Pour again</button>}
          {inst && <button class="btn danger" disabled={busy} onClick={(e) => confirmRemove([p], e.currentTarget)}><Icon n="trash" />Remove</button>}
          {inst && p.kind === 'formula' && <>
            <button class="btn ghost" onClick={(e) => simple(['pin', p.name], `Pin ${p.name}`, 'pin', 'pin', e.currentTarget)}><Icon n="pin" />Pin</button>
            <button class="btn ghost" onClick={(e) => simple(['unpin', p.name], `Unpin ${p.name}`, 'pin', 'success', e.currentTarget)}>Unpin</button>
            <button class="btn ghost" onClick={(e) => simple(['link', p.name], `Link ${p.name}`, 'start', 'success', e.currentTarget).then(refreshInstalled)}><Icon n="link" />Link</button>
            <button class="btn ghost" onClick={(e) => simple(['unlink', p.name], `Unlink ${p.name}`, 'start', 'success', e.currentTarget).then(refreshInstalled)}>Unlink</button>
          </>}
          {p.homepage && <button class="btn ghost" onClick={() => open(p.homepage)}><Icon n="globe" />Website</button>}
        </div>
        <div class="cmdline" title="Copy"><code>{installLine(p)}</code><CopyBtn text={installLine(p)} /></div>
        {err && <p class="note err">{err}</p>}
        <dl class="facts">
          <dt>Version</dt><dd class="ct-n">{p.version || '—'}{inst && installedVersion(p) !== p.version ? <span class="muted"> (you have {installedVersion(p)})</span> : null}</dd>
          {p.homepage && <><dt>Website</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); open(p.homepage); }}>{hostOf(p.homepage)}</a></dd></>}
          {d?.license && <><dt>Licence</dt><dd>{String(d.license)}</dd></>}
          {d?.tap && <><dt>From</dt><dd>{d.tap}</dd></>}
          {apps.length > 0 && <><dt>Puts in Applications</dt><dd>{apps.join(', ')}</dd></>}
          {d?.auto_updates && <><dt>Updates</dt><dd>Updates itself (Cup leaves it alone unless “Include apps that update themselves” is on)</dd></>}
          {d?.keg_only && <><dt>Keg-only</dt><dd>Not linked into the prefix by default</dd></>}
          {(d?.deprecated || d?.disabled) && <><dt>Status</dt><dd class="c-orange">{d.disabled ? 'Disabled upstream' : 'Deprecated upstream'}</dd></>}
          {d?.executables?.length > 0 && <><dt>Commands</dt><dd><code>{d.executables.slice(0, 20).join('  ')}</code></dd></>}
        </dl>
        {deps.length > 0 && <Section title={`Needs ${deps.length}`} items={deps} />}
        {extra.deps?.length > deps.length && <Section title={`Everything it pulls in (${extra.deps.length})`} items={extra.deps} />}
        {extra.uses?.length > 0 && <Section title={`Used by ${extra.uses.length} installed`} items={extra.uses} />}
        {d?.caveats && <><h4>Notes from the package</h4><pre class="caveats">{d.caveats}</pre></>}
      </aside>
    </div>
  );
}
function Section({ title, items }) {
  return (
    <><h4>{title}</h4><div class="chips">{items.map((n) => <button class="chip" onClick={() => openSheet({ name: n, kind: 'formula' })}>{n}</button>)}</div></>
  );
}

export function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <button class="icon-btn" aria-label="Copy" onClick={(e) => {
      e.stopPropagation();
      const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select();
      try { (navigator.clipboard?.writeText(text) || Promise.reject()).catch(() => document.execCommand('copy')); } catch { document.execCommand('copy'); }
      t.remove(); setOk(true); sfx('copy', e.currentTarget); setTimeout(() => setOk(false), 1200);
    }}><Icon n={ok ? 'check' : 'copy'} size={16} /></button>
  );
}

// ---- Confirmation dialog (typed name for risk 3).
const dlg = { set: null };
export function ask({ title, body, ok = 'OK', danger = false, type, check }) {
  return new Promise((resolve) => { sfx('confirm'); dlg.set?.({ title, body, ok, danger, type, check, resolve }); });
}
export function Dialog() {
  const [d, setD] = useState(null);
  const [typed, setTyped] = useState('');
  const [box, setBox] = useState(false);
  dlg.set = (x) => { setTyped(''); setBox(false); setD(x); };
  const box2 = useRef();
  useEffect(() => {
    if (!d) return;
    setTimeout(() => box2.current?.querySelector(d.type ? '.field input' : '.modal-btns .btn:last-child')?.focus(), 0);
    const k = (e) => { if (e.key === 'Escape') done(false); };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [d]);
  if (!d) return null;
  const done = (v) => { d.resolve(v === true && d.check ? { ok: true, check: box } : v); setD(null); sfx(v ? 'select' : 'close'); };
  const can = !d.type || typed.trim() === d.type;
  return (
    <div class="modal-wrap" onClick={() => done(false)}>
      <div class="modal" role="alertdialog" ref={box2} onClick={(e) => e.stopPropagation()}>
        <h3>{d.title}</h3>
        <div class="modal-body">{d.body}</div>
        {d.check && <label class="tick"><input type="checkbox" checked={box} onChange={(e) => setBox(e.currentTarget.checked)} />{d.check}</label>}
        {d.type && <label class="field">Type <b>{d.type}</b> to go ahead<input value={typed} onInput={(e) => setTyped(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && can && done(true)} /></label>}
        <div class="modal-btns"><button class="btn ghost" onClick={() => done(false)}>Cancel</button><button class={`btn ${d.danger ? 'danger' : 'acc'}`} disabled={!can} onClick={() => done(true)}>{d.ok}</button></div>
      </div>
    </div>
  );
}

export async function confirmRemove(ps, at) {
  const casks = ps.some((p) => p.kind === 'cask');
  if (!settings().confirmUninstall) return uninstall(ps, at);
  const names = ps.map((p) => p.name);
  const r = await ask({
    title: ps.length === 1 ? `Remove ${names[0]}?` : `Remove ${ps.length} packages?`,
    body: <p>{names.slice(0, 12).join(', ')}{names.length > 12 ? ` and ${names.length - 12} more` : ''} will be removed with Pour.</p>,
    ok: 'Remove', danger: true,
    check: casks ? 'Also remove the app’s settings, caches and support files (zap)' : null,
    type: ps.length > 5 ? `REMOVE ${ps.length}` : undefined,
  });
  if (!r) return;
  return uninstall(ps, at, { zap: !!(r && r.check) });
}

// ---- Toasts.
export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => onToast((kind, text) => {
    const id = Math.random();
    setList((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), kind === 'err' ? 9000 : 4200);
  }), []);
  return <div class="toasts" aria-live="polite">{list.map((t) => <div class={`toast t-${t.kind}`} key={t.id}><Icon n={t.kind === 'err' ? 'warn' : 'check'} size={16} /><span>{t.text}</span></div>)}</div>;
}

// ---- Right-click menu.
let menuSet = null;
export function contextMenu(e, items) {
  e.preventDefault(); e.stopPropagation();
  menuSet?.({ x: e.clientX, y: e.clientY, items: items.filter(Boolean) });
  sfx('open');
}
export function Menu() {
  const [m, setM] = useState(null);
  const ref = useRef();
  menuSet = setM;
  useEffect(() => {
    if (!m) return;
    const off = () => setM(null);
    const k = (e) => e.key === 'Escape' && off();
    setTimeout(() => { addEventListener('pointerdown', off); addEventListener('keydown', k); addEventListener('blur', off); }, 0);
    const el = ref.current;
    if (el) {
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = `${Math.max(4, Math.min(m.x, innerWidth - w - 4))}px`;
      el.style.top = `${Math.max(4, Math.min(m.y, innerHeight - h - 4))}px`;
      if (h > innerHeight - 8) el.classList.add('cols');
    }
    return () => { removeEventListener('pointerdown', off); removeEventListener('keydown', k); removeEventListener('blur', off); };
  }, [m]);
  if (!m) return null;
  return (
    <div class="cmenu" ref={ref} role="menu" onPointerDown={(e) => e.stopPropagation()}>
      {m.items.map((it) => it === '-' ? <hr /> : it.heading ? <div class="cm-h">{it.heading}</div> :
        <button role="menuitem" class={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={(e) => { setM(null); it.run(e); }}>{it.icon && <Icon n={it.icon} size={15} />}<span>{it.label}</span>{it.keys && <kbd>{it.keys}</kbd>}</button>)}
    </div>
  );
}
export function pkgMenu(e, p, extra = []) {
  const inst = isInstalled(p), o = outdatedOf(p);
  contextMenu(e, [
    { heading: p.name },
    { label: 'Details', icon: 'about', run: () => openSheet(p) },
    !inst && { label: 'Get it', icon: 'installed', run: () => install([p]) },
    o && { label: `Update to ${o.to}`, icon: 'updates', run: () => upgrade([p]) },
    inst && { label: 'Pour again', icon: 'refresh', run: () => reinstall([p]) },
    inst && { label: 'Remove…', icon: 'trash', danger: true, run: () => confirmRemove([p]) },
    '-',
    { label: 'Copy install command', icon: 'copy', run: () => { navigator.clipboard?.writeText(installLine(p)); sfx('copy'); toast('ok', 'Copied'); } },
    p.homepage && { label: 'Open website', icon: 'globe', run: () => open(p.homepage) },
    ...extra,
  ]);
}

// ---- Log box: live status, counts and a badge per line kind.
const BADGE = { step: '➤', cmd: '▶', ok: '✓', err: '✗', errline: '!', warn: '⚠', hint: '?', out: '' };
export function LogBox({ job, open: startOpen = false }) {
  const [openState, setOpen] = useState(startOpen);
  const ref = useRef();
  useEffect(() => { const el = ref.current; if (el && openState) el.scrollTop = el.scrollHeight; }, [job.lines.length, openState]);
  const secs = Math.round(((job.ended || Date.now()) - job.started) / 1000);
  const warn = job.lines.filter((l) => l.k === 'warn').length;
  return (
    <section class={`logbox s-${job.status}`}>
      <header class="logbar" onClick={() => { setOpen(!openState); sfx(openState ? 'close' : 'open'); }}>
        <span class={`dot d-${job.status}`} />
        <b class="clamp">{job.title}</b>
        <span class="grow" />
        <span class="muted">{job.status === 'running' ? 'running' : job.status === 'ok' ? 'done' : job.status}</span>
        <span class="ct-n">{secs}s</span>
        <span class="muted"><span class="ct-n">{job.lines.length}</span> lines</span>
        {job.problems > 0 && <span class="badge b-err">{job.problems} problem{job.problems > 1 ? 's' : ''}</span>}
        {warn > 0 && <span class="badge b-warn">{warn} warning{warn > 1 ? 's' : ''}</span>}
        {job.status === 'running' && <button class="btn sm ghost" onClick={(e) => { e.stopPropagation(); cancelJob(job.id); }}><Icon n="stop" size={13} />Stop</button>}
        <CopyBtn text={job.lines.map((l) => l.t).join('\n')} />
      </header>
      {openState && <div class="log" ref={ref}>{job.lines.map((l) => <div class={`ll k-${l.k}`}><i>{BADGE[l.k]}</i><span>{l.t}</span></div>)}</div>}
    </section>
  );
}

/** A thin strip at the bottom with whatever is running now. */
export function Activity() {
  const j = jobs.use();
  const run = j.list.filter((x) => x.status === 'running');
  if (!run.length) return null;
  const last = run[0];
  const line = last.lines[last.lines.length - 1]?.t || '';
  return (
    <div class="activity" onClick={() => app.set({ page: 'log' })} role="status">
      <i class="spin" /><b>{last.title}</b><span class="muted clamp">{line}</span>
      {run.length > 1 && <span class="badge">+{run.length - 1}</span>}
      <button class="btn sm ghost" onClick={(e) => { e.stopPropagation(); cancelJob(last.id); }}>Stop</button>
    </div>
  );
}

export function Empty({ icon = 'cup', title, children }) {
  return <div class="empty"><Icon n={icon} size={42} /><h3>{title}</h3>{children}</div>;
}

/** Shows items a page at a time as the user scrolls (catalogue has ~16,000). */
export function useMore(list, step = 90) {
  const [n, setN] = useState(step);
  const ref = useRef();
  useEffect(() => setN(step), [list]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && setN((v) => v + step), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list, n]);
  return [list.slice(0, n), n < list.length ? <div ref={ref} class="more muted">Showing {n} of {list.length}…</div> : null];
}

export const LAYOUTS = [['cards', 'Cards'], ['list', 'List'], ['compact', 'Compact'], ['tiles', 'Tiles'], ['magazine', 'Magazine'], ['masonry', 'Masonry'], ['board', 'Board'], ['timeline', 'Timeline']];
export function LayoutPick({ value, onPick }) {
  return (
    <select class="sel" value={value} onChange={(e) => onPick(e.currentTarget.value)} aria-label="Layout" title="Layout">
      {LAYOUTS.map(([k, n]) => <option value={k}>{n}</option>)}
    </select>
  );
}
