#!/usr/bin/env node
// A FreeBSD sysroot for cross-compiling Cup on the Mac:
//   node scripts/freebsd-sysroot.mjs <dir>
// base.txz (headers, libc, crt files) from download.freebsd.org, then the GTK /
// WebKitGTK / libsoup / librsvg packages and their whole dependency closure from
// pkg.freebsd.org, unpacked — never run. Made once; a marker file says it is
// complete, so later releases reuse it. The release is the newest 14.x that
// download.freebsd.org still lists (old ones move to the archive, which is why
// a fixed "14.3" broke with a 404); FREEBSD_RELEASE and FREEBSD_BRANCH
// (quarterly) can still be set in the environment. Packages download eight at
// a time.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: freebsd-sysroot.mjs <dir>'); process.exit(2); }
const BRANCH = process.env.FREEBSD_BRANCH || 'quarterly';
const ROOTS = ['xorgproto', 'gtk3', 'webkit2-gtk_41', 'libsoup3', 'librsvg2-rust', 'pkgconf', 'openssl', 'glib', 'cairo', 'pango', 'gdk-pixbuf2', 'atk', 'harfbuzz'];
const marker = path.join(dir, '.cup-sysroot-ok');
// A finished sysroot is kept whatever release it was made from, unless one is asked for.
if (fs.existsSync(marker) && (!process.env.FREEBSD_RELEASE || fs.readFileSync(marker, 'utf8').startsWith(`${process.env.FREEBSD_RELEASE}/`))) {
  console.log(`sysroot ready: ${dir} (${fs.readFileSync(marker, 'utf8').trim()})`); process.exit(0);
}
fs.mkdirSync(path.join(dir, '.dl'), { recursive: true });

const MIRROR = 'https://download.freebsd.org/releases/amd64';
const ARCHIVE = 'https://ftp-archive.freebsd.org/pub/FreeBSD-Archive/old-releases/amd64';
async function newest(major) {
  try {
    const r = await fetch(`${MIRROR}/`, { headers: { 'user-agent': 'cup-release' } });
    const t = await r.text();
    const v = [...t.matchAll(/(\d+)\.(\d+)-RELEASE/g)].map((m) => [Number(m[1]), Number(m[2])]).filter(([a]) => a === major);
    v.sort((a, b) => b[1] - a[1]);
    if (v.length) return `${v[0][0]}.${v[0][1]}`;
  } catch { /* offline listing — fall back below */ }
  return `${major}.4`;
}
const REL = process.env.FREEBSD_RELEASE || await newest(Number(process.env.FREEBSD_MAJOR || 14));
const MAJOR = REL.split('.')[0];
const ABI = `FreeBSD:${MAJOR}:amd64`;
const PKG = `https://pkg.freebsd.org/${ABI}/${BRANCH}`;

async function get(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'cup-release' } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      fs.writeFileSync(`${file}.part`, Buffer.from(await r.arrayBuffer()));
      fs.renameSync(`${file}.part`, file);
      return file;
    } catch (e) { if (i === 2) throw e; await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); }
  }
}
// bsdtar (macOS) reads .txz and the zstd .pkg files itself; GNU tar needs zstd installed.
const TAR = (() => { try { execFileSync('bsdtar', ['--version'], { stdio: 'ignore' }); return 'bsdtar'; } catch { return 'tar'; } })();
// Only what linking needs: libraries, pkg-config files, headers. Compilers, programs,
// docs, icons and translations the closure drags in (LLVM alone is 1.8 GB) stay out.
const SKIP = ['+*', '*usr/local/llvm*', '*usr/local/bin/*', '*usr/local/sbin/*', '*usr/local/libexec/*', '*usr/local/share/*', '*usr/local/man/*', '*usr/local/lib/python*', '*usr/local/lib/perl5*', '*usr/local/lib/ruby*', '*usr/local/lib/node*', '*usr/lib/debug/*', '*usr/local/lib/*.a', '*-portbld-freebsd*'];
const untar = (file, ...only) => execFileSync(TAR, ['-xf', file, '-C', dir, ...SKIP.flatMap((x) => ['--exclude', x]), ...only], { stdio: ['ignore', 'ignore', 'ignore'] });

console.log(`== FreeBSD ${REL} base (headers and libraries)`);
const baseFile = path.join(dir, '.dl', `base-${REL}.txz`);
let base;
try { base = await get(`${MIRROR}/${REL}-RELEASE/base.txz`, baseFile); }
catch { console.log('   (not on the main mirror any more — trying the archive)'); base = await get(`${ARCHIVE}/${REL}-RELEASE/base.txz`, baseFile); }
untar(base, './usr/include', './usr/lib', './lib', './usr/libdata');

console.log(`== ${ABI}/${BRANCH} package catalogue`);
const site = await get(`${PKG}/packagesite.pkg`, path.join(dir, '.dl', 'packagesite.pkg'));
const tmp = path.join(dir, '.dl', 'site');
fs.mkdirSync(tmp, { recursive: true });
execFileSync(TAR, ['-xf', site, '-C', tmp]);
const yaml = fs.readdirSync(tmp).find((f) => f.startsWith('packagesite.yaml'));
const byName = new Map();
for (const line of fs.readFileSync(path.join(tmp, yaml), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { const p = JSON.parse(line); byName.set(p.name, p); } catch { /* not a package line */ }
}
const want = new Set();
const queue = ROOTS.filter((n) => byName.has(n) || console.log(`  (no ${n} in this catalogue)`));
while (queue.length) {
  const n = queue.shift();
  if (want.has(n) || !byName.has(n)) continue;
  want.add(n);
  for (const d of Object.keys(byName.get(n).deps || {})) queue.push(d);
}
console.log(`== ${want.size} packages`);
let i = 0;
const list = [...want];
const files = new Array(list.length);
let next = 0;
async function worker() {
  while (next < list.length) {
    const k = next++;
    const rp = byName.get(list[k]).repopath || byName.get(list[k]).path;
    files[k] = await get(`${PKG}/${rp}`, path.join(dir, '.dl', path.basename(rp)));
    if (++i % 25 === 0) console.log(`   ${i}/${list.length} downloaded`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
// A package may hard-link to a file the skip list left out (tar then says
// "cannot hard link" and exits 2): what linking needs is unpacked all the same.
for (const f of files) { try { untar(f); } catch { /* partial is fine — see above */ } }
// pkg-config files point at /usr/local: PKG_CONFIG_SYSROOT_DIR prefixes them.
// share/pkgconfig holds a few .pc files that the skip list left out: take just those.
for (const f of files) { try { execFileSync(TAR, ['-xf', f, '-C', dir, ...(TAR === 'tar' ? ['--wildcards'] : []), '*usr/local/share/pkgconfig/*'], { stdio: 'ignore' }); } catch { /* none in this package */ } }
fs.writeFileSync(marker, `${REL}/${BRANCH}\n`);
// The downloads are not needed once unpacked.
fs.rmSync(path.join(dir, '.dl'), { recursive: true, force: true });
console.log(`sysroot ready: ${dir}`);
