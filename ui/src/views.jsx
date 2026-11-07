// Cup — the pages. Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon, LOGO } from './icons.jsx';
import { app, install, upgrade, uninstall, reinstall, refreshCatalogue, refreshInstalled, refreshOutdated, refreshTaps, refreshEnv, simple, isInstalled, human, sizeOf } from './data.js';
import { copyText } from './bridge.js';
import { CATEGORIES, catName, catHue, search, fame, parseDoctor, installLine, latestCup, newerThan } from './pour.js';
import { PkgCard, PkgRow, PkgIcon, KindBadge, PkgAction, openSheet, LogBox, Empty, useMore, LayoutPick, pkgMenu, confirmRemove, ask, hueVar, CopyBtn, contextMenu, Code } from './parts.jsx';
import { jobs, runJob, toast, clearJobs } from './jobs.js';
import { settings, setSetting, useSettings, DEFAULTS } from './store.js';
import { sfx, PACKS, SOUNDS } from './sfx.js';
import { call, open, snapshots, readBrewfile, deleteSnapshot, cap, get, relaunch } from './bridge.js';
import LICENCE from 'virtual:licence';

const H = ({ title, sub, children }) => (
  <header class="page-h"><div class="ph-t"><h1>{title}</h1>{sub && <p class="muted">{sub}</p>}</div><div class="ph-tools">{children}</div></header>
);
const Search = ({ value, onInput, placeholder = 'Search', autoFocus }) => (
  <label class="search"><Icon n="search" size={16} /><input id="find" type="search" value={value} placeholder={placeholder} autoFocus={autoFocus} onInput={(e) => { onInput(e.currentTarget.value); sfx('search'); }} /></label>
);

function Grid({ items, layout, onCtx }) {
  const [shown, more] = useMore(items);
  if (layout === 'list' || layout === 'compact' || layout === 'timeline') {
    return <><div class="rows" data-layout={layout}>{shown.map((p) => <PkgRow p={p} onCtx={onCtx} key={p.kind + p.name} />)}</div>{more}</>;
  }
  return <><div class="grid" data-layout={layout}>{shown.map((p) => <PkgCard p={p} onCtx={onCtx} key={p.kind + p.name} />)}</div>{more}</>;
}

// ---- Discover: hero, the creator's apps, shelves per category.
export function Discover() {
  const st = app.use();
  const s = useSettings();
  const [hero, setHero] = useState(0);
  const cat = st.cat;
  const picks = useMemo(() => cat ? cat.list.filter((p) => p.kind === 'cask' && p.source !== 'creator' && fame(p) < 1e6).sort((a, b) => fame(a) - fame(b)) : [], [cat]);
  const heroes = useMemo(() => [...(cat?.apps || []).slice(0, 6), ...picks.slice(0, 4)], [cat, picks]);
  useEffect(() => {
    if (!heroes.length || s.motion === 'off') return;
    const t = setInterval(() => setHero((h) => (h + 1) % heroes.length), 7000);
    return () => clearInterval(t);
  }, [heroes.length, s.motion]);
  if (!cat) return <Loading what="the catalogue" err={st.catError} retry={() => refreshCatalogue(true)} />;
  const h = heroes[hero % Math.max(1, heroes.length)];
  const shelves = CATEGORIES.filter(([id]) => id !== 'lib').map(([id, name, hue]) => {
    const items = cat.list.filter((p) => p.cat === id && p.kind === 'cask').sort((a, b) => fame(a) - fame(b) || a.name.localeCompare(b.name)).slice(0, 14);
    return { id, name, hue, items };
  }).filter((x) => x.items.length >= 4);
  const tools = cat.list.filter((p) => p.kind === 'formula' && fame(p) < 1e6).sort((a, b) => fame(a) - fame(b)).slice(0, 14);
  return (
    <div class="page discover">
      {h && (
        <section class="hero" style={{ '--h': hueVar(catHue(h.cat)) }} key={h.name}>
          <div class="hero-art" dangerouslySetInnerHTML={{ __html: LOGO(150, 'hero-cup') }} />
          <div class="hero-t">
            <span class="eyebrow">{h.source === 'creator' ? 'From the creator of Cup' : 'Staff pick'}</span>
            <h1>{h.title || h.name}</h1>
            <p>{h.desc}</p>
            <div class="row-btns"><PkgAction p={h} /><button class="btn ghost" onClick={() => openSheet(h)}>Details</button></div>
          </div>
          <PkgIcon p={h} size={96} />
          <div class="hero-dots">{heroes.map((_, i) => <button aria-label={`Pick ${i + 1}`} class={i === hero % heroes.length ? 'on' : ''} onClick={() => { setHero(i); sfx('nav'); }} />)}</div>
        </section>
      )}
      <div class="stats">
        <Stat n={cat.casks} label="apps" hue="amber" go="apps" />
        <Stat n={cat.formulae} label="command-line tools" hue="cyan" go="tools" />
        <Stat n={st.installed.formulae.length + st.installed.casks.length} label="installed here" hue="green" go="installed" />
        <Stat n={st.outdated.length} label="updates" hue={st.outdated.length ? 'orange' : 'teal'} go="updates" />
      </div>
      {cat.apps.length > 0 && <Shelf title="From the creator of Cup" hue="acc" items={cat.apps} />}
      <Shelf title="Popular apps" hue="blue" items={picks.slice(0, 14)} go={() => app.set({ page: 'apps' })} />
      <Shelf title="Popular tools" hue="cyan" items={tools} go={() => app.set({ page: 'tools' })} />
      <h2 class="rule">Categories</h2>
      <div class="cats">
        {CATEGORIES.map(([id, name, hue]) => {
          const n = cat.list.filter((p) => p.cat === id).length;
          return <button class="catcard" style={{ '--h': hueVar(hue) }} onClick={() => { sfx('nav'); app.set({ page: 'apps', catFilter: id }); }}><b>{name}</b><span class="ct-n">{n.toLocaleString()}</span></button>;
        })}
      </div>
      {shelves.map((x) => <Shelf title={x.name} hue={x.hue} items={x.items} go={() => app.set({ page: 'apps', catFilter: x.id })} />)}
    </div>
  );
}
function Stat({ n, label, hue, go }) {
  return <button class="stat" style={{ '--h': hueVar(hue) }} onClick={() => { sfx('nav'); app.set({ page: go }); }}><b class="ct-n">{Number(n || 0).toLocaleString()}</b><span>{label}</span></button>;
}
function Shelf({ title, items, hue, go }) {
  const ref = useRef();
  const scroll = (d) => { ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.8, behavior: 'smooth' }); sfx('nav'); };
  return (
    <section class="shelf" style={{ '--h': hueVar(hue) }}>
      <header><h2>{title}</h2><span class="grow" /><button class="icon-btn" aria-label="Back" onClick={() => scroll(-1)}>‹</button><button class="icon-btn" aria-label="More" onClick={() => scroll(1)}>›</button>{go && <button class="btn sm ghost" onClick={go}>See all</button>}</header>
      <div class="shelf-row" ref={ref}>{items.map((p) => <PkgCard p={p} onCtx={pkgMenu} key={p.name} />)}</div>
    </section>
  );
}
function Loading({ what, err, retry }) {
  if (err) return <Empty icon="warn" title={`Could not load ${what}`}><p class="muted">{err}</p><button class="btn acc" onClick={retry}>Try again</button></Empty>;
  return <div class="loading"><i class="spin big" /><p class="muted">Loading {what}…</p></div>;
}

// ---- Browse apps (casks) or tools (formulae).
export function Browse({ kind }) {
  const st = app.use();
  const s = useSettings();
  const [q, setQ] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const c = st.catFilter || '';
  const list = useMemo(() => {
    if (!st.cat) return [];
    let l = search(st.cat.list, q, { kind, cat: c || undefined });
    if (!q) l = l.sort((a, b) => fame(a) - fame(b) || a.name.localeCompare(b.name));
    if (onlyMine) l = l.filter(isInstalled);
    return l;
  }, [st.cat, q, c, kind, onlyMine, st.installed]);
  if (!st.cat) return <Loading what="the catalogue" err={st.catError} retry={() => refreshCatalogue(true)} />;
  return (
    <div class="page">
      <H title={kind === 'cask' ? 'Apps' : 'Command-line tools'} sub={`${list.length.toLocaleString()} ${c ? `in ${catName(c)}` : 'to choose from'}${st.cat.stale ? ' · offline copy' : ''}`}>
        <Search value={q} onInput={setQ} placeholder={kind === 'cask' ? 'Search apps' : 'Search tools'} />
        <select class="sel" value={c} onChange={(e) => app.set({ catFilter: e.currentTarget.value })} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map(([id, n]) => <option value={id}>{n}</option>)}
          <option value="other">Everything else</option>
        </select>
        <label class="tick"><input type="checkbox" checked={onlyMine} onChange={(e) => { setOnlyMine(e.currentTarget.checked); sfx(e.currentTarget.checked ? 'on' : 'off'); }} />Installed</label>
        <LayoutPick value={s.layout} onPick={(v) => { setSetting('layout', v); sfx('select'); }} />
      </H>
      {list.length ? <Grid items={list} layout={s.layout} onCtx={pkgMenu} /> : <Empty icon="search" title="Nothing matches"><p class="muted">Try fewer words, or another category.</p></Empty>}
    </div>
  );
}

// ---- Installed: the main table, with multi-select and bulk actions.
export function Installed() {
  const st = app.use();
  const s = useSettings();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set());
  const last = useRef(null);
  const enrich = (x) => ({ ...(st.cat?.byKey.get(`${x.kind}:${x.name}`) || {}), ...x, desc: st.cat?.byKey.get(`${x.kind}:${x.name}`)?.desc || '' });
  const all = useMemo(() => [...st.installed.casks, ...st.installed.formulae].map(enrich), [st.installed, st.cat]);
  const leaves = new Set(st.leaves);
  const list = useMemo(() => {
    let l = all;
    if (tab === 'casks') l = l.filter((p) => p.kind === 'cask');
    if (tab === 'formulae') l = l.filter((p) => p.kind === 'formula');
    if (tab === 'requested') l = l.filter((p) => p.kind === 'cask' || p.onRequest);
    if (tab === 'leaves') l = l.filter((p) => p.kind === 'formula' && leaves.has(p.name));
    if (q) l = search(l, q);
    return l.sort((a, b) => a.name.localeCompare(b.name));
  }, [all, tab, q, st.leaves]);
  const hb = st.installed.homebrew;
  const hbCount = hb.formulae.length + hb.casks.length;
  const chosen = list.filter((p) => sel.has(p.kind + p.name));
  const toggle = (p, e) => {
    const k = p.kind + p.name, n = new Set(sel);
    if (e?.shiftKey && last.current) {
      const a = list.findIndex((x) => x.kind + x.name === last.current), b = list.findIndex((x) => x.kind + x.name === k);
      for (const x of list.slice(Math.min(a, b), Math.max(a, b) + 1)) n.add(x.kind + x.name);
    } else n.has(k) ? n.delete(k) : n.add(k);
    last.current = k; setSel(n); sfx('select');
  };
  // Drag down the checkboxes to select or deselect many: the first box decides which.
  const dragRef = useRef(null);
  const drag = {
    start(p, e) {
      const k = p.kind + p.name;
      if (e.shiftKey) { toggle(p, e); return; }
      const mode = !sel.has(k);
      dragRef.current = { mode, seen: new Set([k]) };
      last.current = k;
      setSel((s) => { const n = new Set(s); mode ? n.add(k) : n.delete(k); return n; });
      sfx(mode ? 'select' : 'off');
      document.body.classList.add('dragsel');
      const end = () => { dragRef.current = null; document.body.classList.remove('dragsel'); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); };
      addEventListener('pointerup', end); addEventListener('pointercancel', end);
    },
    over(p) {
      const d = dragRef.current; const k = p.kind + p.name;
      if (!d || d.seen.has(k)) return;
      d.seen.add(k);
      setSel((s) => { const n = new Set(s); d.mode ? n.add(k) : n.delete(k); return n; });
      sfx('tick');
    },
  };
  const totalSize = all.reduce((t, p) => t + (st.sizes?.[`${p.kind}:${p.name}`] || 0), 0);
  const chosenSize = chosen.reduce((t, p) => t + (st.sizes?.[`${p.kind}:${p.name}`] || 0), 0);
  const ctx = (e, p) => pkgMenu(e, p, ['-', { label: sel.has(p.kind + p.name) ? 'Unselect' : 'Select', icon: 'check', run: () => toggle(p) }]);
  return (
    <div class="page">
      <H title="Installed" sub={`${st.installed.casks.length} apps · ${st.installed.formulae.length} tools${totalSize ? ` · ${human(totalSize)} on disk` : ''}${hbCount ? ` · ${hbCount} more from Homebrew` : ''}`}>
        <Search value={q} onInput={setQ} placeholder="Filter installed" />
        <button class="btn ghost" onClick={() => { refreshInstalled(); sfx('fresh'); }}><Icon n="refresh" size={16} />Refresh</button>
      </H>
      <nav class="tabs">
        {[['all', 'Everything', all.length], ['casks', 'Apps', st.installed.casks.length], ['formulae', 'Tools', st.installed.formulae.length], ['requested', 'Chosen by you', null], ['leaves', 'Leaves', st.leaves.length], ['homebrew', 'From Homebrew', hbCount]].map(([k, n, c]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => { setTab(k); setSel(new Set()); sfx('tick'); }}>{n}{c != null && <span class="ct-n">{c}</span>}</button>
        ))}
      </nav>
      {tab === 'leaves' && <p class="note">Leaves are tools nothing else needs — the ones that are safe to remove when you no longer use them.</p>}
      {tab === 'homebrew' ? <HomebrewTab hb={hb} /> : (
        <>
          <div class={`bulk ${chosen.length ? 'on' : ''}`}>
            <label class="tick"><input type="checkbox" checked={chosen.length > 0 && chosen.length === list.length} onChange={(e) => { setSel(e.currentTarget.checked ? new Set(list.map((p) => p.kind + p.name)) : new Set()); sfx('selectAll'); }} />{chosen.length ? `${chosen.length} selected${chosenSize ? ` · ${human(chosenSize)}` : ''}` : 'Select all'}</label>
            <span class="grow" />
            <button class="btn sm" disabled={!chosen.length} onClick={(e) => upgrade(chosen, e.currentTarget).then(() => setSel(new Set()))}><Icon n="updates" size={14} />Upgrade</button>
            <button class="btn sm" disabled={!chosen.length} onClick={(e) => reinstall(chosen, e.currentTarget)}><Icon n="refresh" size={14} />Pour again</button>
            <button class="btn sm danger" disabled={!chosen.length} onClick={(e) => confirmRemove(chosen, e.currentTarget).then(() => setSel(new Set()))}><Icon n="trash" size={14} />Remove</button>
          </div>
          {st.loadingInstalled && !all.length ? <Loading what="what is installed" /> : list.length ? (
            <div class="rows" data-layout={s.installedLayout}>{list.map((p) => <PkgRow p={p} checked={sel.has(p.kind + p.name)} onCheck={(e) => toggle(p, e)} drag={drag} onCtx={ctx} key={p.kind + p.name} extra={p.kind === 'formula' && !p.onRequest ? <span class="badge muted">needed by others</span> : null} />)}</div>
          ) : <Empty title={q ? 'Nothing matches' : 'Nothing here yet'}><p class="muted">{q ? 'Try another word.' : 'Pick something in Discover and press Get.'}</p><button class="btn acc" onClick={() => app.set({ page: 'discover' })}>Open Discover</button></Empty>}
        </>
      )}
    </div>
  );
}
function HomebrewTab({ hb }) {
  const items = [...hb.casks, ...hb.formulae];
  if (!items.length) return <Empty title="Nothing from Homebrew"><p class="muted">Pour finds nothing Homebrew installed on this computer.</p></Empty>;
  const missing = items.filter((x) => !x.inPour).length;
  return (
    <>
      <div class="card callout">
        <div><h3>Move everything to Pour</h3><p class="muted">{items.length} packages were installed by Homebrew. Pour can install the same things itself{missing ? ` (${missing} are not in Pour’s index yet and stay where they are)` : ''}. Homebrew is not removed.</p></div>
        <div class="row-btns">
          <button class="btn ghost" onClick={(e) => runJob(['migrate', '--dry-run'], { title: 'Plan the move from Homebrew', start: 'start', done: 'success', at: e.currentTarget })}>Show the plan</button>
          <button class="btn acc" onClick={async (e) => {
            const at = e.currentTarget;
            if (!(await ask({ title: 'Move to Pour?', body: <p>Pour installs everything Homebrew has installed here. This can take a while and download a lot.</p>, ok: 'Move', type: 'MIGRATE' }))) return;
            await runJob(['migrate'], { title: 'Move from Homebrew to Pour', start: 'pour', done: 'poured', risky: true, at });
            refreshInstalled();
          }}>Move to Pour</button>
        </div>
      </div>
      <div class="rows">{items.map((x) => <div class="row"><b>{x.name}</b><span class="muted">{x.kind === 'cask' ? 'app' : 'tool'}</span><span class="grow" />{sizeOf(x, true) != null && <span class="size ct-n">{human(sizeOf(x, true))}</span>}<span class="ver ct-n">{x.version}</span>{x.inPour ? <span class="badge b-ok">in Pour</span> : <span class="badge muted">Homebrew only</span>}</div>)}</div>
    </>
  );
}

// ---- Updates.
export function Updates() {
  const st = app.use();
  const s = useSettings();
  const list = st.outdated.map((o) => ({ ...(st.cat?.byKey.get(`${o.kind}:${o.name}`) || {}), ...o, version: o.to }));
  const when = st.checkedAt ? new Date(st.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not yet';
  return (
    <div class="page">
      <H title="Updates" sub={`${list.length} waiting · checked ${when}`}>
        <label class="tick" title="Also upgrade apps that update themselves"><input type="checkbox" checked={s.greedy} onChange={(e) => setSetting('greedy', e.currentTarget.checked)} />Include self-updating apps</label>
        <button class="btn ghost" disabled={st.loadingOutdated} onClick={() => { refreshOutdated({ fetchIndex: true }); sfx('start'); }}>{st.loadingOutdated ? <i class="spin" /> : <Icon n="refresh" size={16} />}Check now</button>
        <button class="btn acc" disabled={!list.length} onClick={(e) => upgrade(null, e.currentTarget)}><Icon n="updates" size={16} />Upgrade all</button>
      </H>
      {list.length ? (
        <div class="rows">{list.map((p) => <PkgRow p={p} onCtx={pkgMenu} key={p.kind + p.name} extra={<span class="vchange"><s class="ct-n">{p.from}</s> → <b class="ct-n">{p.to}</b></span>} />)}</div>
      ) : st.loadingOutdated ? <Loading what="updates" /> : <Empty icon="check" title="Everything is up to date"><p class="muted">Cup checks {s.checkEvery ? `every ${s.checkEvery} hours` : 'when you ask'}{s.checkAtStart ? ' and when it starts' : ''}.</p></Empty>}
    </div>
  );
}

// ---- Taps (extra registries).
export function Taps() {
  const st = app.use();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => { refreshTaps(); }, []);
  const valid = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) && /^https:\/\/\S+$/.test(url);
  return (
    <div class="page">
      <H title="Taps" sub="Extra registries Pour reads besides its own index" />
      <div class="card form-row">
        <label class="field">Name<input placeholder="user/name" value={name} onInput={(e) => setName(e.currentTarget.value.trim())} /></label>
        <label class="field grow">Index address<input placeholder="https://…/index.json" value={url} onInput={(e) => setUrl(e.currentTarget.value.trim())} /></label>
        <button class="btn acc" disabled={!valid} onClick={async (e) => { await runJob(['tap', 'add', name, url], { title: `Tap ${name}`, start: 'clink', done: 'clink', at: e.currentTarget }); setName(''); setUrl(''); refreshTaps(); refreshCatalogue(true); }}><Icon n="plus" size={16} />Add tap</button>
      </div>
      <div class="rows">
        {st.taps.map((t) => (
          <div class="row" onContextMenu={(e) => contextMenu(e, [{ label: 'Copy address', icon: 'copy', run: () => copyText(t.url) }, { label: 'Open address', icon: 'globe', run: () => open(t.url) }])}>
            <Icon n="taps" /><div class="row-main"><b>{t.name}</b><span class="muted clamp">{t.url}</span></div>
            <button class="btn sm danger" onClick={async (e) => { const at = e.currentTarget; if (await ask({ title: `Remove the ${t.name} tap?`, body: tapWarning(t.name), ok: 'Remove', danger: true })) { await runJob(['tap', 'remove', t.name], { title: `Untap ${t.name}`, start: 'untap', done: 'untap', at }); refreshTaps(); } }}>Remove</button>
          </div>
        ))}
        {!st.taps.length && <Empty icon="taps" title="No extra taps" />}
      </div>
    </div>
  );
}

// ---- Brewfile export/import and snapshots.
export function Bundle() {
  const st = app.use();
  const sep = st.env?.sep || '/';
  const home = st.env?.home || '';
  const [out, setOut] = useState(`${home}${sep}Brewfile`);
  const [inp, setInp] = useState(`${home}${sep}Brewfile`);
  const [preview, setPreview] = useState('');
  const [snaps, setSnaps] = useState({ dir: '', items: [] });
  const [snapName, setSnapName] = useState('');
  const loadSnaps = () => snapshots().then(setSnaps).catch(() => {});
  useEffect(() => { loadSnaps(); }, []);
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return (
    <div class="page">
      <H title="Brewfile & snapshots" sub="Save what is installed, bring it back later or on another computer" />
      <div class="two">
        <section class="card">
          <h3><Icon n="file" />Export a Brewfile</h3>
          <p class="muted">A plain list of everything installed; Pour (and Homebrew) can read it.</p>
          <label class="field">Save to<input value={out} onInput={(e) => setOut(e.currentTarget.value)} /></label>
          <button class="btn acc" disabled={!out.trim()} onClick={(e) => runJob(['bundle', 'dump', '--file', out.trim(), '--force'], { title: 'Export Brewfile', start: 'export', done: 'export', risky: true, at: e.currentTarget })}>Export</button>
        </section>
        <section class="card">
          <h3><Icon n="installed" />Install from a Brewfile</h3>
          <p class="muted">Pours everything the file lists that is not installed yet.</p>
          <label class="field">File<input value={inp} onInput={(e) => { setInp(e.currentTarget.value); setPreview(''); }} /></label>
          <div class="row-btns">
            <button class="btn ghost" onClick={() => readBrewfile(inp.trim()).then((t) => { setPreview(t || '(empty)'); sfx('open'); }).catch((e) => toast('err', String(e)))}>Preview</button>
            <button class="btn ghost" onClick={(e) => runJob(['bundle', 'install', '--file', inp.trim(), '--dry-run'], { title: 'Brewfile plan', at: e.currentTarget })}>Show the plan</button>
            <button class="btn acc" onClick={(e) => runJob(['bundle', 'install', '--file', inp.trim()], { title: 'Install from Brewfile', start: 'pour', done: 'poured', at: e.currentTarget }).then(refreshInstalled)}>Install</button>
          </div>
          {preview && <pre class="caveats">{preview}</pre>}
        </section>
      </div>
      <h2 class="rule">Snapshots</h2>
      <div class="card form-row">
        <label class="field grow">Name<input placeholder={`snapshot-${stamp()}`} value={snapName} onInput={(e) => setSnapName(e.currentTarget.value.replace(/[^A-Za-z0-9 ._-]/g, ''))} /></label>
        <button class="btn acc" onClick={async (e) => {
          const n = (snapName.trim() || `snapshot-${stamp()}`).replace(/\s+/g, '-');
          await runJob(['bundle', 'dump', '--file', `${snaps.dir}${sep}${n}.Brewfile`, '--force'], { title: `Snapshot ${n}`, start: 'snapshot', done: 'snapshot', risky: true, at: e.currentTarget });
          setSnapName(''); loadSnaps();
        }}><Icon n="camera" size={16} />Take snapshot</button>
      </div>
      <div class="rows">
        {snaps.items.map((x) => (
          <div class="row">
            <Icon n="camera" /><div class="row-main"><b>{x.name.replace(/\.Brewfile$/, '')}</b><span class="muted">{new Date(x.time * 1000).toLocaleString()} · <span class="ct-n">{(x.size / 1024).toFixed(1)}</span> KB</span></div>
            <button class="btn sm ghost" onClick={() => readBrewfile(`${snaps.dir}${sep}${x.name}`).then((t) => ask({ title: x.name, body: <pre class="caveats">{t}</pre>, ok: 'Close' }))}>View</button>
            <button class="btn sm" onClick={(e) => runJob(['bundle', 'install', '--file', `${snaps.dir}${sep}${x.name}`], { title: `Restore ${x.name}`, start: 'restore', done: 'poured', at: e.currentTarget }).then(refreshInstalled)}>Restore</button>
            <button class="btn sm danger" onClick={async () => { if (await ask({ title: `Delete ${x.name}?`, body: <p>Only the snapshot file goes; nothing is uninstalled.</p>, ok: 'Delete', danger: true })) { await deleteSnapshot(x.name); sfx('drain'); loadSnaps(); } }}>Delete</button>
          </div>
        ))}
        {!snaps.items.length && <Empty icon="camera" title="No snapshots yet"><p class="muted">A snapshot is a Brewfile Cup keeps for you.</p></Empty>}
      </div>
    </div>
  );
}

// ---- Care: doctor, cleanup, index, Pour itself.
export function Care() {
  const st = app.use();
  const [doc, setDoc] = useState(null);
  const [plan, setPlan] = useState(null);
  const [selfUp, setSelfUp] = useState('');
  const pe = st.pourEnv;
  const runDoctor = async (at) => {
    sfx('doctor', at);
    const r = await cap(['doctor']);
    setDoc(parseDoctor(`${r.out}\n${r.err}`));
  };
  const runPlan = async (at) => {
    sfx('clean', at);
    const r = await cap(['cleanup', '--dry-run']);
    setPlan(`${r.out}${r.err}`.trim().split('\n').filter(Boolean));
  };
  useEffect(() => { runDoctor(); }, []);
  const age = pe?.index_generated_at ? Math.round((Date.now() / 1000 - pe.index_generated_at) / 3600) : null;
  return (
    <div class="page">
      <H title="Care" sub="Keep Pour healthy, tidy and current" />
      <div class="two">
        <section class="card">
          <h3><Icon n="care" />Check-up</h3>
          {doc ? <ul class="doc">{doc.map((d) => <li class={`d-${d.ok}`}><i>{d.ok === 'ok' ? '✓' : d.ok === 'warn' ? '⚠' : d.ok === 'bad' ? '✗' : '•'}</i>{d.text}</li>)}</ul> : <p class="muted">Checking…</p>}
          <button class="btn ghost" onClick={(e) => runDoctor(e.currentTarget)}>Check again</button>
        </section>
        <section class="card">
          <h3><Icon n="trash" />Clean up</h3>
          <p class="muted">Old versions and downloads Pour no longer needs.</p>
          {plan && <ul class="doc small">{plan.slice(0, 40).map((l) => <li>{l}</li>)}</ul>}
          <div class="row-btns">
            <button class="btn ghost" onClick={(e) => runPlan(e.currentTarget)}>Show what goes</button>
            <button class="btn acc" onClick={(e) => runJob(['cleanup'], { title: 'Clean up', start: 'clean', done: 'clean', at: e.currentTarget }).then(() => setPlan(null))}>Clean up</button>
          </div>
        </section>
        <section class="card">
          <h3><Icon n="refresh" />Package index</h3>
          <p class="muted">{pe ? <><span class="ct-n">{pe.formulae?.toLocaleString()}</span> tools and <span class="ct-n">{pe.casks?.toLocaleString()}</span> apps · updated {age == null ? '—' : age < 1 ? 'within the hour' : `${age} h ago`}</> : '—'}</p>
          <button class="btn acc" onClick={(e) => runJob(['update'], { title: 'Update the index', start: 'start', done: 'fresh', at: e.currentTarget }).then(() => { refreshEnv(); refreshCatalogue(true); refreshOutdated({ quiet: true }); })}>Update now</button>
        </section>
        <section class="card">
          <h3><Icon n="cup" />Pour</h3>
          {pe ? <dl class="facts small"><dt>Version</dt><dd class="ct-n">{pe.version}</dd><dt>System</dt><dd>{pe.platform}</dd><dt>Prefix</dt><dd><code>{pe.prefix}</code></dd><dt>Bottles</dt><dd>{pe.bottle_tag}</dd></dl> : <p class="muted">—</p>}
          {selfUp && <p class="note">{selfUp}</p>}
          <div class="row-btns">
            <button class="btn ghost" onClick={async () => { const r = await cap(['self-update', '--check']); setSelfUp((r.out || r.err).trim().split('\n').pop()); sfx('found'); }}>Check for a new Pour</button>
            <button class="btn" onClick={(e) => runJob(['self-update'], { title: 'Update Pour itself', start: 'upgrade', done: 'poured', at: e.currentTarget }).then(refreshEnv)}>Update Pour</button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---- Log of every command this session.
export function Log() {
  const j = jobs.use();
  return (
    <div class="page">
      <H title="Log" sub="Every Pour command Cup ran, with its full output">
        <button class="btn ghost" disabled={!j.list.length} onClick={() => { clearJobs(); sfx('clean'); }}>Clear finished</button>
      </H>
      {j.list.length ? j.list.map((x, i) => <LogBox job={x} key={x.id} open={i === 0} />) : <Empty icon="log" title="Nothing has run yet" />}
    </div>
  );
}

// ---- Settings.
/** What removing a tap does; the creator's default taps get a fuller warning. */
function tapWarning(name) {
  const n = name.toLowerCase();
  if (n.endsWith('pour-apps')) return <><p>This tap is where the creator's own desktop apps come from, Cup included.</p><ul><li>They disappear from search, Apps and Updates.</li><li>Ones you already have stay installed but stop getting updates through Pour, and <b>Update Cup with Pour</b> stops working.</li><li>It stays off until you add it again with <code>pour tap add jks-sys/pour-apps</code>.</li></ul></>;
  if (n.endsWith('pour-tools')) return <><p>This tap holds Pour's own builds of command-line tools.</p><ul><li>On Windows, FreeBSD and older Macs, tools with no ready-made build can no longer be installed.</li><li>Tools registered with Pour disappear from search.</li><li>Homebrew's main list is not affected. It stays off until you add it again.</li></ul></>;
  if (n.endsWith('pour-desktop')) return <><p>This tap holds installers of the creator's apps for Windows, Linux and FreeBSD; without it those apps can't be installed there.</p></>;
  return <p>Packages from it stay installed; Pour just stops reading it.</p>;
}

/** Problems Cup ran into: kept locally, sent (when allowed) on the next start, readable here. */
function Problems() {
  const [list, setList] = useState(null);
  const load = () => call('crashlog').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const seen = (window.__cupSent || []).concat(list || []);
  return (
    <section class="card"><h3>Problems</h3>
      <p class="muted">Errors and crashes Cup noticed on this computer. With the daily hello on, they go to the creator so they can be fixed.</p>
      {!seen.length ? <Empty icon="check" title="No problems recorded" /> : (
        <div class="crash-list">{seen.slice(-30).reverse().map((c) => <div class="row"><span class={`badge ${c.kind === 'panic' ? 'b-err' : 'b-warn'}`}>{c.kind}</span><span class="clamp"><Code text={`${c.message}${c.place ? ` (${c.place})` : ''}`} /></span></div>)}</div>
      )}
      <div class="row-btns">
        <button class="btn sm" onClick={() => { copyText(seen.map((c) => `${c.kind}: ${c.message} ${c.place || ''}`).join('\n')); sfx('copy'); toast('Problems copied', 'ok'); }} disabled={!seen.length}>Copy report</button>
        <button class="btn sm ghost" onClick={async () => { await call('crashlog', 'clear').catch(() => {}); window.__cupSent = []; load(); sfx('clean'); }} disabled={!seen.length}>Clear</button>
      </div>
    </section>
  );
}

export function Settings() {
  const s = useSettings();
  const st = app.use();
  const [cupNews, setCupNews] = useState('');
  const set = (k) => (e) => { const v = e.currentTarget.type === 'checkbox' ? e.currentTarget.checked : e.currentTarget.value; setSetting(k, v); sfx(typeof v === 'boolean' ? (v ? 'on' : 'off') : 'select'); };
  const checkCup = async () => {
    setCupNews('Checking…');
    const v = await latestCup();
    if (!v) { setCupNews('Could not reach the update feed.'); sfx('error'); return; }
    const newer = newerThan(v, st.env?.version || '0');
    setCupNews(newer ? `Cup ${v} is out — you have ${st.env?.version}.` : `You have the newest Cup (${st.env?.version}).`);
    sfx(newer ? 'updates' : 'found');
  };
  const updateCup = async (e) => {
    // Upgrade when Pour installed Cup; otherwise Pour installs the newest build over this one.
    const mine = app.get().installed.casks.some((c) => c.name === 'cup');
    await cap(['update']).catch(() => {});
    const j = await runJob(mine ? ['upgrade', '--cask', '--greedy', 'cup'] : ['install', '--cask', '--force', 'cup'], { title: 'Update Cup', start: 'upgrade', done: 'poured', at: e.currentTarget });
    if (j.status === 'ok' && await ask({ title: 'Restart Cup?', body: <p>The new Cup starts when this one closes.</p>, ok: 'Restart' })) relaunch();
  };
  return (
    <div class="page settings">
      <H title="Settings" />
      <section class="card"><h3>Look</h3>
        <Opt label="Theme"><select class="sel" value={s.theme} onChange={set('theme')}><option value="auto">Match the system</option><option value="light">Light</option><option value="dark">Dark</option></select></Opt>
        <Opt label="Animations"><select class="sel" value={s.motion} onChange={set('motion')}><option value="off">Off</option><option value="subtle">Subtle</option><option value="lively">Lively</option></select></Opt>
        <Opt label="Start-up animation"><input type="checkbox" checked={s.splash} onChange={set('splash')} /></Opt>
        <Opt label="Layout for apps and tools"><LayoutPick value={s.layout} onPick={(v) => setSetting('layout', v)} /></Opt>
        <Opt label="Installed list"><select class="sel" value={s.installedLayout} onChange={set('installedLayout')}><option value="list">List</option><option value="compact">Compact</option></select></Opt>
        <Opt label="Website icons" hint="Small icons come from the packages’ websites (through Google’s favicon service)"><input type="checkbox" checked={s.icons} onChange={set('icons')} /></Opt>
      </section>
      <section class="card"><h3>Sound</h3>
        <Opt label="Sounds"><input type="checkbox" checked={s.sound} onChange={set('sound')} /></Opt>
        <Opt label="Which sounds"><select class="sel" value={s.soundMode} onChange={set('soundMode')}><option value="smart">Only when something happens</option><option value="all">Every click too</option></select></Opt>
        <Opt label="Sound pack"><select class="sel" value={s.pack} onChange={(e) => { setSetting('pack', e.currentTarget.value); sfx('poured'); }}>{Object.entries(PACKS).map(([k, p]) => <option value={k}>{p.name}</option>)}</select></Opt>
        <Opt label="Volume"><input type="range" min="0" max="1" step="0.05" value={s.volume} onChange={(e) => { setSetting('volume', Number(e.currentTarget.value)); sfx('tick'); }} /></Opt>
        <Opt label="Try them"><div class="chips">{Object.keys(SOUNDS).filter((n) => !['hover', 'key'].includes(n)).map((n) => <button class="chip" onClick={(e) => sfx(n, e.currentTarget)}>{n}</button>)}</div></Opt>
      </section>
      <section class="card"><h3>Updates</h3>
        <Opt label="Check when Cup starts"><input type="checkbox" checked={s.checkAtStart} onChange={set('checkAtStart')} /></Opt>
        <Opt label="Check in the background"><select class="sel" value={s.checkEvery} onChange={(e) => setSetting('checkEvery', Number(e.currentTarget.value))}><option value="0">Never</option><option value="1">Every hour</option><option value="3">Every 3 hours</option><option value="6">Every 6 hours</option><option value="12">Every 12 hours</option><option value="24">Once a day</option></select></Opt>
        <Opt label="Include apps that update themselves"><input type="checkbox" checked={s.greedy} onChange={set('greedy')} /></Opt>
        <Opt label="Clean up after upgrading"><input type="checkbox" checked={s.autoCleanup} onChange={set('autoCleanup')} /></Opt>
        <Opt label="Ask before removing"><input type="checkbox" checked={s.confirmUninstall} onChange={set('confirmUninstall')} /></Opt>
        <Opt label={`Cup ${st.env?.version || ''}`} hint={cupNews || (s.lastCheck ? `Packages last checked ${new Date(s.lastCheck).toLocaleString()}` : '')}>
          <div class="row-btns"><button class="btn sm ghost" onClick={checkCup}>Check for a new Cup</button><button class="btn sm" onClick={updateCup}>Update Cup with Pour</button></div>
        </Opt>
      </section>
      <section class="card"><h3>Privacy</h3>
        <Opt label="Send an anonymous daily hello and crash notes" hint="Only the app name, version, system and a random id — never what you install. Helps the creator fix problems."><input type="checkbox" checked={s.ping} onChange={set('ping')} /></Opt>
      </section>
      <Problems />
      <section class="card"><h3>Start over</h3>
        <Opt label="Reset every setting"><button class="btn sm danger" onClick={async () => { if (await ask({ title: 'Reset settings?', body: <p>Cup goes back to how it started. Nothing you installed changes.</p>, ok: 'Reset', danger: true })) { for (const [k, v] of Object.entries(DEFAULTS)) if (k !== 'mid') setSetting(k, v); sfx('restore'); } }}>Reset</button></Opt>
      </section>
    </div>
  );
}
const Opt = ({ label, hint, children }) => <div class="opt"><div><b>{label}</b>{hint && <span class="muted">{hint}</span>}</div><div class="opt-c">{children}</div></div>;

// ---- About.
export function About() {
  const st = app.use();
  const [lic, setLic] = useState(false);
  return (
    <div class="page about">
      <section class="hero about-hero">
        <div class="hero-art" dangerouslySetInnerHTML={{ __html: LOGO(130, 'hero-cup') }} />
        <div class="hero-t">
          <h1>Cup <span class="ct-n">{st.env?.version}</span></h1>
          <p>A desktop home for Pour — find, pour, update and tidy everything on your computer, without the terminal.</p>
          <p class="byline">By Jagadeesh Kumar S</p>
          <div class="row-btns">
            <button class="btn acc" onClick={() => { open('https://github.com/JKS-sys/cup-15-Oct-2026'); sfx('star'); }}><Icon n="star" size={16} />Star Cup on GitHub</button>
            <button class="btn ghost" onClick={() => open('https://ipconfig.co.network/cup')}><Icon n="globe" size={16} />Website</button>
            <button class="btn ghost" onClick={() => open('https://razorpay.me/@NSBJKS')}><Icon n="heart" size={16} />Sponsor</button>
          </div>
        </div>
      </section>
      <div class="two">
        <section class="card">
          <h3>The creator</h3>
          <p><b>Jagadeesh Kumar S</b> — creator. He makes the Pour package manager and a family of small, fast apps, and presents NewsCraft World Report on the NewsCraft Studio YouTube channel: calm, careful, human news on world politics, business, tech and AI, science, climate and health.</p>
          <dl class="facts small">
            <dt>Email</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); open('mailto:JKS.sys@icloud.com'); }}>JKS.sys@icloud.com</a></dd>
            <dt>YouTube</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); open('https://www.youtube.com/@JKS-sys'); }}>youtube.com/@JKS-sys</a></dd>
            <dt>From</dt><dd>Velachery, Chennai, Tamil Nadu, India</dd>
            <dt>Sponsor</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); open('https://razorpay.me/@NSBJKS'); }}>razorpay.me/@NSBJKS</a></dd>
          </dl>
        </section>
        <section class="card">
          <h3>Licence</h3>
          <p>Cup is free for personal use. The code belongs to Jagadeesh Kumar S: copying, changing, rebranding or redistributing it is not allowed.</p>
          <button class="btn ghost" onClick={() => { setLic(!lic); sfx(lic ? 'close' : 'open'); }}>{lic ? 'Hide' : 'Read'} the licence</button>
          {lic && <pre class="caveats">{LICENCE}</pre>}
        </section>
      </div>
    </div>
  );
}

// ---- First run without Pour.
export function Setup({ onDone }) {
  const st = app.use();
  const [job, setJob] = useState(null);
  const go = async (e) => {
    const j = await runJob([], { title: 'Install Pour', start: 'pour', done: 'poured', at: e.currentTarget, op: 'installpour' });
    setJob(j);
    const env = await refreshEnv();
    if (env.pour) { sfx('welcome'); onDone(); }
  };
  const jl = jobs.use().list.find((x) => x.title === 'Install Pour');
  return (
    <div class="page setup">
      <div class="setup-card card">
        <div dangerouslySetInnerHTML={{ __html: LOGO(110) }} />
        <h1>Cup needs Pour</h1>
        <p>Cup is the window; <b>Pour</b> is the package manager that does the work. It installs in a few seconds and lives in <code>{st.env?.os === 'windows' ? '%LOCALAPPDATA%\\Pour' : '/opt/pour'}</code>.</p>
        {st.env?.os !== 'windows' && <p class="muted small">Pour may ask for your password once to create its folder.</p>}
        <div class="row-btns center"><button class="btn acc big" disabled={jl?.status === 'running'} onClick={go}>{jl?.status === 'running' ? <i class="spin" /> : <Icon n="installed" />}Install Pour</button>
          <button class="btn ghost" onClick={() => open('https://ipconfig.co.network/pour')}>About Pour</button></div>
        <div class="cmdline"><code><Code shell text="curl -fsSL https://ipconfig.co.network/pour/install | sh" /></code><CopyBtn text="curl -fsSL https://ipconfig.co.network/pour/install | sh" /></div>
        <button class="btn sm ghost" onClick={async () => { const e = await refreshEnv(); if (e.pour) onDone(); else toast('err', 'Pour is still not found'); }}>I installed it — look again</button>
        {jl && <LogBox job={jl} open />}
        {job?.status === 'failed' && <p class="note err">The installer stopped. The log above says why; you can also run the command in a terminal.</p>}
      </div>
    </div>
  );
}
