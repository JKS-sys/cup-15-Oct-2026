// Cup unit checks: colours (no pink, readable), every sound has a picture, parsers.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  ✗ ${m}`); } else console.log(`  ✓ ${m}`); };

// ---- Colours.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const hsl = (h) => { const [r, g, b] = hex(h), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let H = 0; if (d) H = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; H = (H * 60 + 360) % 360; const l = (mx + mn) / 2; const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0; return [H, s, l]; };
const lum = (h) => { const [r, g, b] = hex(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const colours = [...css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((m) => m[0]);
const pink = colours.filter((c) => { const [h, s] = hsl(c); return s > 0.2 && h >= 280 && h <= 350; });
ok(pink.length === 0, `no pink among ${colours.length} colours${pink.length ? `: ${pink.join(' ')}` : ''}`);
for (const theme of ['t-dark', 't-light']) {
  const block = css.match(new RegExp(`\\.${theme}\\{([^}]+)\\}`))[1];
  const v = Object.fromEntries([...block.matchAll(/--([\w-]+):(#[0-9a-f]{3,6})/gi)].map((m) => [m[1], m[2]]));
  const bad = [];
  for (const fg of ['fg', 'fg2', 'acc', 'c-blue', 'c-cyan', 'c-teal', 'c-green', 'c-lime', 'c-amber', 'c-orange', 'c-violet', 'c-red', 'c-sep']) {
    for (const bg of ['bg', 's1', 's2']) { const c = contrast(v[fg], v[bg]); if (c < 4.5) bad.push(`${fg} on ${bg} ${c.toFixed(2)}`); }
  }
  ok(bad.length === 0, `${theme}: every text colour ≥ 4.5:1${bad.length ? ` — ${bad.join(', ')}` : ''}`);
  ok(contrast(v['acc-fg'], v['acc-btn']) >= 4.5, `${theme}: text on the accent button ≥ 4.5:1`);
}

// ---- Modules under test, bundled for Node with a tiny window stand-in.
globalThis.window = globalThis; globalThis.localStorage = undefined;
const b = await esbuild.build({ stdin: { contents: "export * from './src/sfx.js'; export * from './src/pour.js';", resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'neutral', jsx: 'automatic', jsxImportSource: 'preact', mainFields: ['module', 'main'] });
const m = await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
const missing = Object.keys(m.SOUNDS).filter((n) => !m.SCENES[n]);
ok(missing.length === 0, `every one of ${Object.keys(m.SOUNDS).length} sounds has its own picture${missing.length ? ` (missing ${missing})` : ''}`);
const badPath = Object.values(m.SCENES).flatMap((s) => s.paths).filter((p) => !m.SCENE_PATHS[p]);
ok(badPath.length === 0, 'every picture draws known shapes');

const out = m.parseOutdated('jq 1.7 → 1.8.2\nfirefox 140 → 141\n✓ everything else\n', new Set(['firefox']));
ok(out.length === 2 && out[1].kind === 'cask' && out[0].to === '1.8.2', 'outdated lines parse (formula and cask)');
const doc = m.parseDoctor('==> pour 0.1.0\n✓ prefix ok\nWarning: bin not on PATH\n✗ broken link\n1 thing to look at.');
ok(doc.map((d) => d.ok).join() === 'ok,warn,bad,note', 'doctor lines parse');
ok(m.firstError('error: unexpected argument\n\nFor more information, try \'--help\'.') === 'unexpected argument', 'the error line wins over the hint');
ok(m.categorise({ name: 'font-fira-code', kind: 'cask', desc: 'x' }) === 'fonts', 'font casks are Fonts');
ok(m.categorise({ name: 'firefox', kind: 'cask', desc: 'Web browser' }) === 'browse', 'firefox is a browser');
ok(m.categorise({ name: 'ollama', kind: 'cask', desc: 'Get up and running with large language models (LLM)' }) === 'ai', 'ollama is AI');
const list = [{ name: 'jq', kind: 'formula', desc: 'Lightweight JSON processor' }, { name: 'jqp', kind: 'formula', desc: 'TUI playground for jq' }, { name: 'gojq', kind: 'formula', desc: 'Pure Go jq' }];
ok(m.search(list, 'jq')[0].name === 'jq', 'exact name ranks first');
ok(m.search(list, 'json processor').length === 1, 'all words must match');
console.log(fails ? `${fails} problem(s)` : 'units: all good');
process.exit(fails ? 1 : 0);
