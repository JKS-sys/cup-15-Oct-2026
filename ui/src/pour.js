// Cup — what Pour knows, in shapes the page can draw.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { cap, get } from './bridge.js';

export const HOST = 'https://ipconfig.co.network';
const clean = (s) => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lines = (s) => clean(s).split('\n').map((l) => l.trim()).filter(Boolean);

async function json(args) {
  const r = await cap([...args, '--json']);
  if (r.code !== 0) throw new Error(firstError(r.err || r.out) || `pour ${args[0]} failed`);
  const t = r.out.slice(r.out.search(/[[{]/));
  return JSON.parse(t);
}

/** The line that explains a failure (clap's "error:" line, never its hint). */
export function firstError(text) {
  const ls = lines(text);
  return (ls.find((l) => /^error[:!]/i.test(l)) || ls.find((l) => /^(✗|Error)/.test(l)) || ls[ls.length - 1] || '').replace(/^error:\s*/i, '');
}

export async function installed() {
  const j = await json(['list']);
  return {
    formulae: (j.formulae || []).map((f) => ({ name: f.name, kind: 'formula', version: f.version, onRequest: !!f.on_request, active: f.active !== false, deps: f.deps || [] })),
    casks: (j.casks || []).map((c) => ({ name: c.token, kind: 'cask', version: c.version, artifacts: c.artifacts || [] })),
    homebrew: {
      formulae: (j.homebrew?.formulae || []).map((f) => ({ name: f.name, kind: 'formula', version: f.version, inPour: !!f.in_pour, onRequest: !!f.on_request, path: f.path })),
      casks: (j.homebrew?.casks || []).map((c) => ({ name: c.token, kind: 'cask', version: c.version, inPour: !!c.in_pour, path: c.path })),
    },
  };
}

/** `pour outdated` prints `name old → new`. */
export function parseOutdated(text, caskNames = new Set()) {
  const out = [];
  for (const l of lines(text)) {
    const m = l.match(/^(\S+)\s+(\S+)\s+(?:→|->)\s+(\S+)$/);
    if (m) out.push({ name: m[1], from: m[2], to: m[3], kind: caskNames.has(m[1]) ? 'cask' : 'formula' });
  }
  return out;
}
export async function outdated(caskNames) {
  const r = await cap(['outdated']);
  if (r.code !== 0) throw new Error(firstError(r.err || r.out));
  return parseOutdated(r.out, caskNames);
}

export const pourEnv = () => json(['env']);
export async function info(name, kind) {
  const j = await json(['info', kind === 'cask' ? '--cask' : '--formula', name]);
  return Array.isArray(j) ? j[0] : j;
}
export async function plain(args) {
  const r = await cap(args);
  return { ok: r.code === 0, lines: lines(r.out), err: r.err };
}
export const leaves = async () => (await plain(['leaves'])).lines;
export const uses = async (n) => (await plain(['uses', n])).lines;
export const deps = async (n) => (await plain(['deps', n])).lines;
export async function taps() {
  return (await plain(['tap', 'list'])).lines.map((l) => { const [name, url] = l.split(/\t|\s{2,}|\s+(?=https?:)/); return { name, url: url || '' }; });
}

/** `pour doctor` → items with a state. */
export function parseDoctor(text) {
  return lines(text).filter((l) => !/^==>/.test(l)).map((l) => {
    if (/^✓/.test(l)) return { ok: 'ok', text: l.replace(/^✓\s*/, '') };
    if (/^(Warning|!|⚠)/i.test(l)) return { ok: 'warn', text: l.replace(/^(Warning:?|!|⚠)\s*/i, '') };
    if (/^(✗|error)/i.test(l)) return { ok: 'bad', text: l.replace(/^(✗|error:?)\s*/i, '') };
    return { ok: 'note', text: l };
  });
}

// ---- The catalogue: every formula and cask Pour can install, plus the creator's apps.
let cat = null;
export async function catalogue(force = false) {
  if (cat && !force) return cat;
  const [s, a] = await Promise.all([
    get(`${HOST}/pour/registry/search.json`, 'search-json', force ? 0 : 6 * 3600),
    get(`${HOST}/pour/api/apps`, 'pour-apps', force ? 0 : 3600),
  ]);
  if (!s.ok) throw new Error(s.error || 'the catalogue could not be downloaded');
  const j = JSON.parse(s.text);
  const rows = new Map();
  for (const r of j.rows || []) {
    const kind = r[1] === 0 ? 'formula' : 'cask';
    rows.set(`${kind}:${r[0]}`, { name: r[0], kind, desc: r[2] || '', version: r[3] || '', homepage: r[4] || '', source: 'pour' });
  }
  let apps = [];
  try { apps = a.ok ? (JSON.parse(a.text).apps || []) : []; } catch { /* offline */ }
  // The dashboard decides: only the creator's apps registered and switched on there are shown.
  try {
    const d = await get(`${HOST}/api/v1/apps`, 'dash-apps', force ? 0 : 900);
    const list = d.ok ? (JSON.parse(d.text).apps || []) : null;
    if (list) {
      const on = new Set(list.filter((x) => !/pending|off|hidden|disabled|inactive/i.test(String(x.status ?? '')) && x.active !== false && x.enabled !== false).map((x) => x.id || x.app || x.slug));
      apps = apps.filter((x) => on.has(x.token));
    }
  } catch { /* dashboard unreachable: keep Pour's list */ }
  for (const x of apps) rows.set(`cask:${x.token}`, { name: x.token, title: x.name, kind: 'cask', desc: x.desc || '', version: x.version || '', homepage: x.homepage || '', source: 'creator' });
  const list = [...rows.values()];
  for (const r of list) r.cat = categorise(r);
  cat = { list, byKey: rows, apps: apps.map((x) => rows.get(`cask:${x.token}`)).filter(Boolean), formulae: j.formulae, casks: j.casks, generated: j.generated_at, stale: !!s.stale };
  return cat;
}
export const keyOf = (p) => `${p.kind}:${p.name}`;

// ---- Categories, from words in the name and description (data, first match wins).
export const CATEGORIES = [
  ['ai', 'AI & Assistants', 'violet', /\b(ai|llm|gpt|chatgpt|openai|ollama|machine learning|neural|copilot|assistant|transcri)/],
  ['dev', 'Developer Tools', 'blue', /\b(code|coding|editor|ide|git|github|terminal|shell|developer|sdk|api|debug|compiler|database|sql|docker|kubernetes|container|programming|json|yaml|regex|http client|devops|lint|build)/],
  ['browse', 'Browsers', 'cyan', /\b(browser|web browser|chromium|firefox)/],
  ['prod', 'Productivity', 'teal', /\b(note|notes|task|todo|calendar|clipboard|launcher|window manag|tiling|productiv|focus|timer|reminder|snippet|automation|shortcut|mind ?map|outline)/],
  ['design', 'Design & Photo', 'orange', /\b(image|photo|picture|design|vector|draw|drawing|paint|3d|cad|svg|icon|color picker|colour|screenshot|figma|sketch|render)/],
  ['audio', 'Music & Audio', 'lime', /\b(audio|music|sound|podcast|spotify|mp3|synth|daw|midi|equali|volume|radio|recorder)/],
  ['video', 'Video & Streaming', 'amber', /\b(video|movie|media player|stream|youtube|mpv|vlc|subtitle|screen record|camera|webcam|obs)/],
  ['chat', 'Communication', 'blue', /\b(chat|messag|mail|email|slack|discord|telegram|whatsapp|zoom|meeting|voip|irc|matrix|conferenc)/],
  ['sec', 'Security & Privacy', 'red', /\b(password|vpn|encrypt|firewall|privacy|security|2fa|authenticat|gpg|pgp|ssh key|antivirus|malware|tor)/],
  ['net', 'Networking', 'cyan', /\b(network|proxy|ssh|ftp|sftp|dns|wifi|wi-fi|bandwidth|download manager|torrent|bittorrent|http|curl|wget|ip address|port scan)/],
  ['sync', 'Cloud & Backup', 'teal', /\b(backup|sync|cloud|storage|dropbox|drive|s3|nas|file shar)/],
  ['office', 'Writing & Office', 'violet', /\b(document|pdf|markdown|writing|writer|spreadsheet|office|ebook|epub|word processor|latex|presentation|reader)/],
  ['util', 'System Utilities', 'amber', /\b(system|disk|menu bar|menubar|monitor|battery|clean|uninstall|finder|file manager|archive|zip|unzip|keyboard|mouse|trackpad|display|bluetooth|utility|benchmark|hardware)/],
  ['games', 'Games', 'lime', /\b(game|gaming|emulator|steam|minecraft|chess|puzzle)/],
  ['sci', 'Science & Learning', 'green', /\b(science|math|statistic|astronom|chemistry|biology|learn|education|language learning|dictionary|calculator|plot|data analysis)/],
  ['fonts', 'Fonts', 'orange', /^font-/],
  ['lib', 'Libraries', 'blue', /\b(library|libraries|bindings|framework|toolkit|implementation of|parser|codec|c\+\+|header)/],
];
export function categorise(p) {
  if (p.kind === 'cask' && /^font-/.test(p.name)) return 'fonts';
  const t = `${p.name} ${p.desc}`.toLowerCase();
  for (const [id, , , re] of CATEGORIES) if (id !== 'fonts' && re.test(t)) return id;
  return 'other';
}
export const catName = (id) => CATEGORIES.find((c) => c[0] === id)?.[1] || 'Everything else';
export const catHue = (id) => CATEGORIES.find((c) => c[0] === id)?.[2] || 'sep';

// Widely used picks, best known first — the shelves start with these.
export const PICKS = ('firefox google-chrome visual-studio-code iterm2 rectangle vlc obsidian raycast docker-desktop slack zoom spotify discord ' +
  'brave-browser arc notion 1password bitwarden alfred maccy stats appcleaner the-unarchiver keka iina handbrake obs audacity gimp inkscape blender ' +
  'figma postman insomnia tableplus dbeaver-community sublime-text zed cursor warp alacritty kitty wezterm ghostty sourcetree github fork ' +
  'transmission qbittorrent libreoffice calibre zotero anki telegram whatsapp signal element thunderbird keepassxc protonvpn tailscale ' +
  'karabiner-elements hiddenbar monitorcontrol aldente coconutbattery ollama lm-studio chatgpt claude utm virtualbox steam openemu ' +
  'git node python@3.13 wget curl jq ripgrep fd bat fzf htop btop tmux neovim vim ffmpeg imagemagick yt-dlp gh go rust deno bun ' +
  'postgresql@17 redis sqlite mysql nginx httpie tree watch coreutils openssl gnupg pandoc tldr eza zoxide starship lazygit pnpm yarn ' +
  'kubernetes-cli helm terraform awscli azure-cli pyenv nvm uv poetry cmake ninja llvm').split(' ');
const rank = new Map(PICKS.map((n, i) => [n, i]));
export const fame = (p) => (p.source === 'creator' ? -100 : rank.has(p.name) ? rank.get(p.name) : 1e6);

/** All words must match; names beat descriptions; exact beats prefix. */
export function search(list, q, { kind, cat: c } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const r of list) {
    if (kind && r.kind !== kind) continue;
    if (c && r.cat !== c) continue;
    if (!words.length) { out.push([fame(r) === 1e6 ? 0 : 1e7 - fame(r), r]); continue; }
    const n = r.name.toLowerCase(), t = (r.title || '').toLowerCase(), d = r.desc.toLowerCase();
    let s = 0, ok = true;
    for (const w of words) {
      if (n === w || t === w) s += 1000;
      else if (n.startsWith(w) || t.startsWith(w)) s += 600 - (n.length - w.length);
      else if (n.includes(w) || t.includes(w)) s += 300;
      else if (d.includes(w)) s += 100;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (fame(r) < 1e6) s += 200 - Math.min(199, fame(r));
    out.push([s, r]);
  }
  out.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  return out.map((x) => x[1]);
}

export const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
export const installLine = (p) => (p.kind === 'cask' ? `pour install --cask ${p.name}` : `pour install ${p.name}`);
