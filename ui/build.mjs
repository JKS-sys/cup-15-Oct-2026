// Cup interface build: one sealed HTML file for the Rust shell to carry.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved. See ../LICENSE.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const plain = process.argv.includes('--plain');
const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;
const cargo = readFileSync(join(here, '..', 'Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1] || version;

const js = await esbuild.build({
  entryPoints: [join(here, 'src/main.jsx')],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  target: ['safari15', 'chrome100'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  legalComments: 'none',
  define: { __VERSION__: JSON.stringify(cargo), __BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  plugins: [{ name: 'licence', setup(b) { b.onResolve({ filter: /^virtual:licence$/ }, () => ({ path: 'licence', namespace: 'lic' })); b.onLoad({ filter: /.*/, namespace: 'lic' }, () => ({ contents: readFileSync(join(here, '..', 'LICENSE'), 'utf8'), loader: 'text' })); } }],
});
const css = await esbuild.build({ entryPoints: [join(here, 'src/styles.css')], bundle: true, write: false, minify: true, loader: { '.css': 'css' } });

let code = js.outputFiles[0].text;
if (!plain) {
  const { default: O } = await import('javascript-obfuscator');
  code = O.obfuscate(code, {
    compact: true,
    simplify: true,
    target: 'browser',
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.8,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersType: 'function',
    splitStrings: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    unicodeEscapeSequence: false,
    seed: Math.floor(Math.random() * 1e9),
  }).getObfuscatedCode();
}
// Nothing may close the script tag early.
code = code.replace(/<\/script/gi, '<\\/script');

const csp = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data:";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="author" content="Jagadeesh Kumar S"><meta name="copyright" content="© 2026 Jagadeesh Kumar S. All rights reserved. Personal use only — copying this code is not permitted."><title>Cup</title><style>${css.outputFiles[0].text}</style></head><body class="t-dark"><div id="app"></div><script>${code}</script></body></html>`;
mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist/index.html'), html);
console.log(`ui: ${(html.length / 1024).toFixed(1)} KiB ${plain ? '(plain)' : '(sealed)'} → ui/dist/index.html`);
