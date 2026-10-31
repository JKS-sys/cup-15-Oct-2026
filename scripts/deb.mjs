#!/usr/bin/env node
// Builds Cup's .deb without dpkg (works on the Mac): ar archive of debian-binary,
// control.tar.gz and data.tar.gz, written byte by byte.
//   node scripts/deb.mjs <cup binary> <amd64|arm64> <version> <out.deb>
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const [bin, arch, version, out] = process.argv.slice(2);
if (!out) { console.error('usage: deb.mjs <binary> <amd64|arm64> <version> <out.deb>'); process.exit(2); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = mkdtempSync(join(tmpdir(), 'cupdeb-'));
const data = join(t, 'data');
const put = (src, dst, mode) => { mkdirSync(dirname(join(data, dst)), { recursive: true }); copyFileSync(src, join(data, dst)); chmodSync(join(data, dst), mode); };
put(bin, 'usr/bin/cup', 0o755);
put(join(root, 'packaging/cup.desktop'), 'usr/share/applications/cup.desktop', 0o644);
put(join(root, 'assets/cup-256.png'), 'usr/share/icons/hicolor/256x256/apps/cup.png', 0o644);
put(join(root, 'assets/icon-dark.svg'), 'usr/share/icons/hicolor/scalable/apps/cup.svg', 0o644);
put(join(root, 'LICENSE'), 'usr/share/doc/cup/copyright', 0o644);
put(join(root, 'THIRD-PARTY-NOTICES.txt'), 'usr/share/doc/cup/THIRD-PARTY-NOTICES.txt', 0o644);
const kb = Math.ceil(Number(execFileSync('du', ['-sk', data]).toString().split(/\s/)[0]));
const ctl = join(t, 'control');
mkdirSync(ctl);
writeFileSync(join(ctl, 'control'), `Package: cup
Version: ${version}
Architecture: ${arch}
Maintainer: Jagadeesh Kumar S <JKS.sys@icloud.com>
Installed-Size: ${kb}
Depends: libwebkit2gtk-4.1-0, libgtk-3-0
Recommends: curl
Section: admin
Priority: optional
Homepage: https://github.com/JKS-sys/cup-15-Oct-2026
Description: App store and manager for the Pour package manager
 Cup finds, installs, updates and tidies apps and command-line tools
 with Pour, in one small window. Free for personal use.
`);
// Deterministic-enough tarballs; owner root.
const tar = (dir, file) => execFileSync('tar', ['-czf', file, '--owner=0', '--group=0', '-C', dir, '.'].filter((x) => !(process.platform === 'darwin' && /^--(owner|group)/.test(x))).concat(process.platform === 'darwin' ? [] : []));
if (process.platform === 'darwin') {
  execFileSync('tar', ['-czf', join(t, 'control.tar.gz'), '--uid', '0', '--gid', '0', '-C', ctl, '.']);
  execFileSync('tar', ['-czf', join(t, 'data.tar.gz'), '--uid', '0', '--gid', '0', '-C', data, '.']);
} else {
  tar(ctl, join(t, 'control.tar.gz'));
  tar(data, join(t, 'data.tar.gz'));
}
const member = (name, buf) => {
  const h = Buffer.alloc(60, ' ');
  h.write(name.padEnd(16), 0, 'ascii');
  h.write(String(Math.floor(Date.now() / 1000)).padEnd(12), 16, 'ascii');
  h.write('0'.padEnd(6), 28, 'ascii');
  h.write('0'.padEnd(6), 34, 'ascii');
  h.write('100644'.padEnd(8), 40, 'ascii');
  h.write(String(buf.length).padEnd(10), 48, 'ascii');
  h.write('`\n', 58, 'ascii');
  return Buffer.concat([h, buf, buf.length % 2 ? Buffer.from('\n') : Buffer.alloc(0)]);
};
writeFileSync(out, Buffer.concat([
  Buffer.from('!<arch>\n'),
  member('debian-binary', Buffer.from('2.0\n')),
  member('control.tar.gz', readFileSync(join(t, 'control.tar.gz'))),
  member('data.tar.gz', readFileSync(join(t, 'data.tar.gz'))),
]));
rmSync(t, { recursive: true, force: true });
console.log(`  .deb → ${out}`);
