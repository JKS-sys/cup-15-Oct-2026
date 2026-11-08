#!/usr/bin/env bash
# Cup — one script for everything: checks, builds for every system, release, publish.
#
#   bash update.sh                 build, test, release and publish a new version
#   bash update.sh --no-publish    build and test only (installers land in release/)
#   bash update.sh --version 1.2.3 release exactly this version (must be newer)
#   bash update.sh --skip-linux    --skip-windows --skip-freebsd   leave a system out
#
# Runs on the owner's Mac. Every tool comes from Pour (never Homebrew). Nothing runs
# on GitHub's machines. Caches live outside this folder, so a fresh unzip is quick.
# Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
set -Eeuo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
APP=cup NAME=Cup
OWNER=JKS-sys
SUFFIX=15-Oct-2026
REPO="$OWNER/$APP-$SUFFIX"
BUCKET="$APP-$(printf '%s' "$SUFFIX" | tr 'A-Z' 'a-z')"          # R2 names are lowercase: cup-15-oct-2026
FEED="https://github.com/$REPO/releases/latest/download/latest.json"
HOMEPAGE="https://github.com/$REPO"
LINE="App store and manager for the Pour package manager — find, install, update and tidy apps and tools in one tiny window"
BUDGET=$((1024 * 1024))                                            # every program ≤ 1 MiB
BUILD_CACHE="${CUP_BUILD_CACHE:-/Users/Shared/cup-build}"

PUBLISH=1 WANT_VERSION="" SKIP_LINUX=0 SKIP_WINDOWS=0 SKIP_FREEBSD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-publish) PUBLISH=0 ;;
    --version) WANT_VERSION="${2:?}"; shift ;;
    --skip-linux) SKIP_LINUX=1 ;;
    --skip-windows) SKIP_WINDOWS=1 ;;
    --skip-freebsd) SKIP_FREEBSD=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done

# ---- Output, and no silent stops.
B=$'\033[1m' D=$'\033[2m' G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' C=$'\033[36m' N=$'\033[0m'
step() { printf '\n%s➤ %s%s\n' "$B$C" "$*" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
DIED=0 LAST_ERR=""
die() { DIED=1; printf '\n%s✗ %s%s\n' "$R" "$*" "$N"; exit 1; }
trap 'LAST_ERR="line $LINENO: $BASH_COMMAND"' ERR
LX_PID=""
cleanup() {
  local code=$?
  [ -n "$LX_PID" ] && kill "$LX_PID" 2>/dev/null || true
  if [ $code -ne 0 ] && [ $DIED = 0 ]; then printf '\n%s✗ stopped at %s (exit %s)%s\n' "$R" "${LAST_ERR:-?}" "$code" "$N"; fi
}
trap cleanup EXIT

. scripts/env.sh
# Secrets: the ipconfig dashboard vault first (key from the keychain or the gh sign-in); a local .env is optional and only overrides.
[ -f .env ] && load_env .env
vault_key; [ -n "${VAULT_KC_SAID:-}" ] && ok "vault key (APPS_API_KEY): $VAULT_KC_SAID"
[ -n "${APPS_API_KEY:-}" ] || { command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; } || die "no vault key: set APPS_API_KEY in the keychain (service 'ipconfig vault') or sign in with gh auth login"
load_vault cup; ok "vault: $VAULT_SAID"
[ -n "${GH_TOKEN:-}" ] && export GH_TOKEN

# ---- Pour first: every tool comes from it.
export PATH="${POUR_PREFIX:-/opt/pour}/bin:$HOME/.pour/bin:/opt/pour/bin:$HOME/.cargo/bin:$PATH"
need_pour() {
  command -v pour >/dev/null 2>&1 && return 0
  step "Installing Pour (the package manager every tool comes from)"
  curl -fsSL https://ipconfig.co.network/pour/install | sh
  export PATH="/opt/pour/bin:$HOME/.pour/bin:$PATH"
  command -v pour >/dev/null 2>&1 || die "Pour did not install"
}
pkg_install() { need_pour; local f; for f in "$@"; do case "$f" in cask:*) pour install --cask "${f#cask:}" ;; *) pour install "$f" ;; esac || warn "pour could not install $f"; done; }
need_tool() { command -v "$1" >/dev/null 2>&1 || pkg_install "${2:-$1}"; command -v "$1" >/dev/null 2>&1; }
# Like need_tool, but also looks inside the formula's own folders when Pour did not link the program.
find_tool() {
  local bin=$1 f=${2:-$1} pre d
  command -v "$bin" >/dev/null 2>&1 && return 0
  pkg_install "$f"
  pre=$(pour --prefix 2>/dev/null || echo /opt/pour)
  for d in "$pre/bin" "$pre/opt/$f/bin" "$pre"/Cellar/"$f"/*/bin "$pre"/Cellar/"$f"/*/toolchain-x86_64/bin /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$d/$bin" ]; then export PATH="$d:$PATH"; ok "$bin found in $d"; return 0; fi
  done
  warn "$bin was not found after installing $f (looked in $pre/bin, $pre/opt/$f/bin and $pre/Cellar/$f)"
  return 1
}

step "Checking tools"
[ "$(uname)" = Darwin ] || warn "not a Mac: macOS builds are skipped here"
need_tool node node || die "node is needed"
need_tool git git || die "git is needed"
need_tool gh gh || warn "gh missing: publishing will not work"
if ! command -v cargo >/dev/null 2>&1; then
  need_tool rustup rustup || curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
  export PATH="$HOME/.cargo/bin:$PATH"
fi
command -v rustup >/dev/null 2>&1 && rustup target add aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-gnu >/dev/null 2>&1 || true
# Docker builds Linux, Windows and FreeBSD in one Debian container (Docker Desktop, or colima from Pour).
DOCKER_OK=0
if [ $((SKIP_LINUX + SKIP_WINDOWS + SKIP_FREEBSD)) -lt 3 ]; then
  if ! docker info >/dev/null 2>&1; then
    command -v docker >/dev/null 2>&1 || pkg_install docker
    command -v colima >/dev/null 2>&1 || pkg_install colima
    if command -v colima >/dev/null 2>&1; then
      echo "  starting colima (a small Linux VM for Docker)…"
      mkdir -p "$BUILD_CACHE"
      # The build cache lives outside your home folder: share it with the VM too.
      colima start --cpu 4 --memory 8 --vm-type vz --vz-rosetta --mount "$HOME:w" --mount "$BUILD_CACHE:w" >/dev/null 2>&1 \
        || colima start --cpu 4 --memory 8 --mount "$HOME:w" --mount "$BUILD_CACHE:w" >/dev/null 2>&1 || true
    fi
  fi
  if docker info >/dev/null 2>&1; then DOCKER_OK=1; ok "Docker is running (Linux, Windows and FreeBSD build in it)"
  else warn "Docker is not running — start Docker Desktop or run: colima start. Windows is tried with MinGW on the Mac; Linux and FreeBSD need Docker"; fi
fi
# Without Docker, Windows can still build on the Mac with Pour's MinGW and NSIS.
if [ $DOCKER_OK = 0 ] && [ $SKIP_WINDOWS = 0 ]; then
  { find_tool x86_64-w64-mingw32-g++ mingw-w64 && find_tool makensis nsis; } || { warn "MinGW or NSIS not found on the Mac and Docker is off: Windows is skipped"; SKIP_WINDOWS=1; }
fi
[ $DOCKER_OK = 1 ] || { SKIP_LINUX=1; SKIP_FREEBSD=1; }
ok "tools ready · build cache: $BUILD_CACHE (delete it to start clean)"
mkdir -p "$BUILD_CACHE"
export CARGO_TARGET_DIR="$BUILD_CACHE/target"

# ---- Version: the higher of what is published and what this folder says, plus one.
step "Choosing the version"
LOCAL=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
PUBLISHED=""
if command -v gh >/dev/null 2>&1; then PUBLISHED=$({ gh release view --repo "$REPO" --json tagName -q .tagName 2>/dev/null || true; } | sed 's/^v//'); fi
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]; }
BASE="$LOCAL"; [ -n "$PUBLISHED" ] && newer "$PUBLISHED" "$LOCAL" && BASE="$PUBLISHED"
if [ -n "$WANT_VERSION" ]; then
  [ -z "$PUBLISHED" ] || newer "$WANT_VERSION" "$PUBLISHED" || die "--version $WANT_VERSION is not newer than the published $PUBLISHED"
  VERSION="$WANT_VERSION"
elif [ -z "$PUBLISHED" ]; then VERSION="$LOCAL"
else IFS=. read -r a b c <<<"$BASE"; VERSION="$a.$b.$((c + 1))"; fi
sed -i.bak "s/^version = \".*\"/version = \"$VERSION\"/" Cargo.toml && rm -f Cargo.toml.bak
sed -i.bak "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" ui/package.json && rm -f ui/package.json.bak
ok "Cup $VERSION (folder said $LOCAL${PUBLISHED:+, GitHub has $PUBLISHED})"

# ---- Interface, sealed once; then the tests.
step "Building the interface"
(cd ui && { [ -d node_modules ] || npm ci --no-audit --no-fund --prefer-offline; } && node build.mjs)
export CUP_SALT="${CUP_SALT:-$(od -An -N8 -tu8 /dev/urandom | tr -d ' ')}"
step "Testing"
cargo test --release 2>&1 | tee "$BUILD_CACHE/test.log" | { grep -E '^test result' || true; }
if grep -q 'test result: FAILED' "$BUILD_CACHE/test.log"; then
  { grep -E '^test .* FAILED$|panicked at|left:|right:' "$BUILD_CACHE/test.log" || true; } | head -20 | sed 's/^/    /'
  die "Rust tests failed (full log: $BUILD_CACHE/test.log)"
fi
TOTAL=$(awk '/^test result/ {s+=$4} END {print s+0}' "$BUILD_CACHE/test.log"); ok "$TOTAL Rust tests passed"
cargo fmt --check >/dev/null 2>&1 || warn "cargo fmt would change some files"
(cd ui && node test/units.mjs | tail -1) || die "interface unit checks failed"
UI_OK=1 MAC_FAIL=0
if [ -x "${CUP_POUR:-/opt/pour/bin/pour}" ] && [ "${SKIP_UI_TEST:-0}" != 1 ]; then
  step "Interface test (a real browser; stops by itself after ${CUP_UI_TIMEOUT:-480}s)"
  # Use the Chrome already on the Mac when there is one; otherwise fetch Playwright's own once, with progress shown.
  if [ -z "${CHROMIUM:-}" ]; then
    for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
             "/Applications/Chromium.app/Contents/MacOS/Chromium" "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
             "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
      [ -x "$c" ] && { export CHROMIUM="$c"; break; }
    done
  fi
  if [ -n "${CHROMIUM:-}" ]; then echo "  browser: $CHROMIUM"
  else echo "  fetching the test browser (once, about 150 MB)…"
    # A lock left by an earlier, interrupted download blocks every later one; drop it when nothing is downloading.
    LOCK="$HOME/Library/Caches/ms-playwright/__dirlock"
    if [ -e "$LOCK" ]; then
      # An install still running from an earlier, stopped update.sh holds the lock for ever: stop it, then drop the lock.
      pkill -f "playwright.*install" 2>/dev/null || true; sleep 1
      rm -rf "$LOCK" && echo "  removed a stale download lock"
    fi
    (cd ui && npx --yes playwright install chromium) || warn "the test browser could not be fetched"; fi
  if (cd ui && CUP_POUR="${CUP_POUR:-/opt/pour/bin/pour}" node build.mjs --plain >/dev/null && CUP_POUR="${CUP_POUR:-/opt/pour/bin/pour}" node test/ui.mjs 2>&1 | tee "$BUILD_CACHE/ui-test.log"; exit "${PIPESTATUS[0]}"); then
    ok "interface test passed (zero page errors, every size fits)"
  else
    UI_OK=0
    warn "the interface test did not pass (log: $BUILD_CACHE/ui-test.log) — the installers are still built, but nothing is published"
  fi
  (cd ui && node build.mjs >/dev/null)
else warn "interface test skipped (needs Pour at /opt/pour, or SKIP_UI_TEST=1 was set)"; fi

OUT="release"; rm -rf "$OUT"; mkdir -p "$OUT"
size_check() { local f=$1 s; s=$(wc -c <"$f" | tr -d ' '); if [ "$s" -le $BUDGET ]; then ok "$(basename "$f"): $((s / 1024)) KB (budget 1024 KB)"; else warn "$(basename "$f") is $((s / 1024)) KB — over the 1 MB budget"; fi; }

# ---- Linux, Windows and FreeBSD in Docker, in the background while the Mac builds itself.
XWANT=""
[ $SKIP_LINUX = 1 ] || XWANT="$XWANT linux"
[ $SKIP_WINDOWS = 1 ] || [ $DOCKER_OK = 0 ] || XWANT="$XWANT windows"
[ $SKIP_FREEBSD = 1 ] || XWANT="$XWANT freebsd"
if [ -n "$XWANT" ]; then
  step "Linux, Windows and FreeBSD in Docker:$XWANT (background — log: $BUILD_CACHE/cross.log)"
  OUT="$OUT" BUILD_CACHE="$BUILD_CACHE" bash scripts/cross-build.sh "$VERSION" $XWANT >"$BUILD_CACHE/cross.log" 2>&1 & LX_PID=$!
fi

# ---- macOS: Apple silicon and Intel, each its own small app.
if [ "$(uname)" = Darwin ]; then
  step "macOS"
  bash scripts/mac-identity.sh || true
  [ -f .env ] && load_env .env || true
  # Apple's own compiler and linker only: Pour's clang, ld or libraries on PATH must not mix in.
  SDK=$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)
  [ -n "$SDK" ] || die "Apple's command line tools are missing — run: xcode-select --install, then run update.sh again"
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null 2>&1 || true
  mac_build() { # $1 = aarch64 | x86_64
    local up; up=$(echo "$1" | tr a-z A-Z)
    env -u LIBRARY_PATH -u CPATH -u C_INCLUDE_PATH -u CPLUS_INCLUDE_PATH -u LDFLAGS -u CFLAGS -u CXXFLAGS -u CPPFLAGS \
        -u PKG_CONFIG_PATH -u DYLD_LIBRARY_PATH -u DYLD_FALLBACK_LIBRARY_PATH \
      PATH="/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.cargo/bin:$PATH" SDKROOT="$SDK" MACOSX_DEPLOYMENT_TARGET=11.0 \
      CC=/usr/bin/clang CXX=/usr/bin/clang++ AR=/usr/bin/ar \
      "CARGO_TARGET_${up}_APPLE_DARWIN_LINKER=/usr/bin/clang" \
      cargo build --release --target "$1-apple-darwin" >"$BUILD_CACHE/mac-$1.log" 2>&1
  }
  MAC_MADE=0
  for arch in aarch64 x86_64; do
    bin="$CARGO_TARGET_DIR/$arch-apple-darwin/release/cup"
    if ! mac_build "$arch"; then
      # Objects left by an earlier compiler can break the link: rebuild Cup's own part once from clean.
      rm -rf "$CARGO_TARGET_DIR/$arch-apple-darwin/release/build/cup-"* "$CARGO_TARGET_DIR/$arch-apple-darwin/release/deps/cup-"*
      echo "  retrying macOS $arch from clean…"
      mac_build "$arch" || {
        warn "macOS $arch build failed — the linker said:"
        L="$BUILD_CACHE/mac-$arch.log"
        if grep -qE 'Undefined symbols|ld: |building for macOS|library not found|framework not found' "$L"; then
          { grep -E '^error|Undefined symbols|ld: |"_[A-Za-z_0-9]+", referenced|building for macOS|not found' "$L" || true; } | grep -v '^ *= note: "' | head -30 | sed 's/^/    /'
        else tail -30 "$L" | sed 's/^/    /'; fi
        echo "    full log: $BUILD_CACHE/mac-$arch.log"
        continue
      }
    fi
    [ -f "$bin" ] || { warn "macOS $arch build made no program (log: $BUILD_CACHE/mac-$arch.log)"; continue; }
    MAC_MADE=$((MAC_MADE + 1))
    size_check "$bin"
    app="$BUILD_CACHE/mac-$arch/Cup.app"; rm -rf "$app"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    cp "$bin" "$app/Contents/MacOS/cup"
    sed "s/@VERSION@/$VERSION/g" packaging/Info.plist >"$app/Contents/Info.plist"
    cp assets/cup.icns "$app/Contents/Resources/cup.icns"
    cp LICENSE THIRD-PARTY-NOTICES.txt "$app/Contents/Resources/"
    # Sign by the certificate's SHA-1, so two certificates with the same name are never "ambiguous".
    SIGN_HASH=$(security find-identity -v -p codesigning 2>/dev/null | awk -v n="\"${MAC_SIGN_IDENTITY:-none}\"" 'index($0,n){print $2; exit}')
    if [ -n "$SIGN_HASH" ]; then
      codesign --force --deep --options runtime -s "$SIGN_HASH" "$app" && ok "signed with \"$MAC_SIGN_IDENTITY\""
    else codesign --force --deep -s - "$app" && warn "signed ad hoc (no saved identity)"; fi
    if [ -n "${APPLE_SIGN_IDENTITY:-}" ] && [ -n "${APPLE_NOTARY_PROFILE:-}" ]; then
      DEVID_HASH=$(security find-identity -v -p codesigning 2>/dev/null | awk -v n="\"$APPLE_SIGN_IDENTITY\"" 'index($0,n){print $2; exit}')
      codesign --force --deep --options runtime --timestamp -s "${DEVID_HASH:-$APPLE_SIGN_IDENTITY}" "$app"
      ditto -c -k --keepParent "$app" "$BUILD_CACHE/n.zip" && xcrun notarytool submit "$BUILD_CACHE/n.zip" --keychain-profile "$APPLE_NOTARY_PROFILE" --wait && xcrun stapler staple "$app" && ok "notarised"
    fi
    APPSZ=$(du -sk "$app" | cut -f1); ok "Cup.app ($arch): ${APPSZ} KB on disk"
    tag=$([ $arch = aarch64 ] && echo aarch64 || echo x64)
    tar -czf "$OUT/Cup_${VERSION}_${tag}.app.tar.gz" -C "$(dirname "$app")" Cup.app
    dmgdir="$BUILD_CACHE/dmg-$arch"; rm -rf "$dmgdir"; mkdir -p "$dmgdir"; cp -R "$app" "$dmgdir/"; ln -s /Applications "$dmgdir/Applications"
    hdiutil create -quiet -volname "Cup $VERSION" -srcfolder "$dmgdir" -ov -format UDZO "$OUT/Cup_${VERSION}_${tag}.dmg"
  done
  if [ $MAC_MADE = 2 ]; then ok "macOS installers ready"; else MAC_FAIL=1; warn "macOS: $MAC_MADE of 2 builds made — the other installers carry on"; fi
fi

# ---- Windows on the Mac itself (only when Docker is off).
if [ $SKIP_WINDOWS = 0 ] && [ $DOCKER_OK = 0 ]; then
  step "Windows x64 (MinGW on the Mac)"
  rustup target add x86_64-pc-windows-gnu >/dev/null 2>&1 || true
  CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc cargo build --release --target x86_64-pc-windows-gnu 2>&1 | { grep -E '^error' || true; }
  exe="$CARGO_TARGET_DIR/x86_64-pc-windows-gnu/release/cup.exe"
  if [ -f "$exe" ]; then
    size_check "$exe"
    w=$(mktemp -d); cp "$exe" assets/cup.ico LICENSE THIRD-PARTY-NOTICES.txt "$w/"
    makensis -V2 -DVERSION="$VERSION" -DSRC="$w" -DOUT="$ROOT/$OUT/Cup_${VERSION}_x64-setup.exe" packaging/installer.nsi
    (cd "$w" && zip -q -9 "$ROOT/$OUT/Cup_${VERSION}_windows-x64-portable.zip" cup.exe LICENSE THIRD-PARTY-NOTICES.txt); rm -rf "$w"
    ok "Windows installer and portable zip ready"
  else warn "Windows build failed"; fi
fi

if [ -n "$LX_PID" ]; then
  step "Waiting for the Docker builds"
  if wait "$LX_PID"; then LX_PID=""; { grep -E '✓' "$BUILD_CACHE/cross.log" || true; }
  else LX_PID=""; warn "a Docker build failed — last lines:"; tail -40 "$BUILD_CACHE/cross.log" || true; fi
  for f in "$OUT"/.programs/*; do [ -f "$f" ] && size_check "$f"; done
  rm -rf "$OUT/.programs"
fi
echo "Haiku: no system WebView backend exists there, so there is no Haiku build." >"$BUILD_CACHE/haiku.txt"

# ---- Release notes, feed, checksums.
step "Release notes and feed"
NOTES=$(node -e 'const t=require("fs").readFileSync("CHANGELOG.md","utf8");const parts=t.split(/^## .*$/m).slice(1).map(x=>x.trim());process.stdout.write((parts.find(Boolean)||"").split("\n").slice(0,40).join("\n"))')
[ -n "$NOTES" ] || NOTES="Improvements and fixes."
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DL="https://github.com/$REPO/releases/download/v$VERSION"
sum() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1 || sha256sum "$1" | cut -d' ' -f1; }
entry() { local k=$1 f=$2; [ -f "$OUT/$f" ] && printf '    "%s": {"url": "%s/%s", "sha256": "%s", "size": %s},\n' "$k" "$DL" "$f" "$(sum "$OUT/$f")" "$(wc -c <"$OUT/$f" | tr -d ' ')"; return 0; }
{
  printf '{\n  "name": "cup",\n  "version": "%s",\n  "pub_date": "%s",\n  "notes": %s,\n  "platforms": {\n' "$VERSION" "$DATE" "$(printf '%s' "$NOTES" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))')"
  entry darwin-aarch64 "Cup_${VERSION}_aarch64.app.tar.gz"
  entry darwin-x86_64 "Cup_${VERSION}_x64.app.tar.gz"
  entry macos-arm64-dmg "Cup_${VERSION}_aarch64.dmg"
  entry macos-x86_64-dmg "Cup_${VERSION}_x64.dmg"
  entry windows-x86_64 "Cup_${VERSION}_x64-setup.exe"
  entry windows-x86_64-portable "Cup_${VERSION}_windows-x64-portable.zip"
  entry linux-x86_64-deb "cup_${VERSION}_amd64.deb"
  entry linux-aarch64-deb "cup_${VERSION}_arm64.deb"
  entry linux-x86_64 "Cup_${VERSION}_linux-x86_64.tar.gz"
  entry linux-aarch64 "Cup_${VERSION}_linux-aarch64.tar.gz"
  entry freebsd-x86_64 "Cup_${VERSION}_freebsd-x86_64.tar.gz"
  printf '    "_": null\n  }\n}\n'
} >"$OUT/latest.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));delete j.platforms._;require("fs").writeFileSync(process.argv[1],JSON.stringify(j,null,2)+"\n")' "$OUT/latest.json"
(cd "$OUT" && for f in *; do [ "$f" = SHA256SUMS ] || printf '%s  %s\n' "$(sum "$f")" "$f"; done >SHA256SUMS)
ok "$(ls "$OUT" | wc -l | tr -d ' ') files in $OUT/"
ls -l "$OUT" | sed 1d | awk '{printf "    %8d KB  %s\n", $5/1024, $9}'

if [ $PUBLISH = 0 ]; then step "Done (not published: --no-publish)"; exit 0; fi
if [ $MAC_FAIL = 1 ]; then step "Done — installers are in $OUT/, NOT published because a macOS build failed"; echo "  see $BUILD_CACHE/mac-*.log"; DIED=1; exit 1; fi
if [ $UI_OK = 0 ]; then step "Done — installers are in $OUT/, NOT published because the interface test failed"; echo "  see $BUILD_CACHE/ui-test.log; to publish anyway: SKIP_UI_TEST=1 bash update.sh"; DIED=1; exit 1; fi

# ---- Publish: source and release on the public repository, mirror on R2, then Pour.
step "GitHub ($REPO, public)"
gh auth status >/dev/null 2>&1 || die "gh is not signed in (gh auth login, or GH_TOKEN in the vault)"
gh repo view "$REPO" >/dev/null 2>&1 || gh repo create "$REPO" --public --description "$LINE" --homepage "$HOMEPAGE" >/dev/null && ok "repository ready"
bash scripts/stamp-changelog.sh "$VERSION"
bash scripts/push-github.sh "$REPO" "Cup $VERSION"
bash scripts/repo-details.sh "$REPO" "$REPO" "$LINE" "$HOMEPAGE" "cup,pour,package-manager,app-store,gui,desktop-app,macos,windows,linux,freebsd,rust,webview,lightweight,brewfile,software-updater,package-manager-gui,casks,formulae,developer-tools,open-source-alternative" || true
if gh release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then gh release upload "v$VERSION" "$OUT"/* --repo "$REPO" --clobber
else gh release create "v$VERSION" "$OUT"/* --repo "$REPO" --title "Cup $VERSION" --notes "$NOTES" --latest; fi
ok "release v$VERSION published"
# Keep the newest five releases.
gh release list --repo "$REPO" --limit 100 --json tagName -q '.[].tagName' 2>/dev/null | tail -n +6 | while read -r t; do gh release delete "$t" --repo "$REPO" --yes --cleanup-tag >/dev/null 2>&1 && ok "pruned $t"; done || true

step "R2 mirror ($BUCKET)"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  W() { local i; for i in 1 2 3 4 5; do if out=$(npx --yes wrangler@4 "$@" 2>&1); then return 0; fi; printf '%s' "$out" | grep -qiE 'malformed|5[0-9][0-9]|timed? ?out|ECONN' || { printf '%s\n' "$out" | tail -3; return 1; }; sleep $((i * 5)); done; return 1; }
  W r2 bucket info "$BUCKET" >/dev/null 2>&1 || W r2 bucket create "$BUCKET" || warn "could not create the bucket"
  for f in "$OUT"/*; do b=$(basename "$f"); [ "$b" = latest.json ] && continue; W r2 object put "$BUCKET/releases/v$VERSION/$b" --file "$f" --remote || warn "R2: $b not uploaded"; done
  W r2 object put "$BUCKET/latest.json" --file "$OUT/latest.json" --content-type application/json --remote && ok "R2 mirror updated (latest.json last)" || warn "R2 latest.json not uploaded (Cloudflare's side) — GitHub is the source of truth"
else warn "Cloudflare keys missing in the vault: R2 mirror skipped"; fi

step "Pour and the dashboard"
node scripts/dashboard-sync.mjs || warn "some apps could not be switched on in the dashboard (see above)"
. scripts/pour-register.sh
pour_register cask cup "Cup" "$LINE" "$HOMEPAGE" "$FEED"
curl -fsS -m 30 -X POST https://ipconfig.co.network/api/v1/apps/register -H 'content-type: application/json' \
  ${APPS_API_KEY:+-H "authorization: Bearer $APPS_API_KEY"} \
  --data "{\"app\":\"cup\",\"name\":\"Cup\",\"line\":\"App store for the Pour package manager\",\"version\":\"$VERSION\",\"platform\":\"all\",\"homepage\":\"$HOMEPAGE\"}" >/dev/null 2>&1 && ok "dashboard knows Cup $VERSION" || warn "dashboard did not answer (it registers Cup on its first ping anyway)"

step "Done: Cup $VERSION"
echo "  Install anywhere:  curl -fsSL https://ipconfig.co.network/pour/install | sh && pour install --cask cup"
