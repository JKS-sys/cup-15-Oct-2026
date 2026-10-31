#!/usr/bin/env bash
# Builds Cup for Linux (x86_64 + arm64), Windows (x64) and FreeBSD (x86_64) inside one
# Debian container on the Mac — no emulation, no GitHub machines:
#   • Linux: the Mac's own architecture natively, the other against an unpacked sysroot
#   • Windows: MinGW-w64 (static C++ runtime) and an NSIS per-user installer
#   • FreeBSD: clang + lld against a FreeBSD 14 sysroot made once on the Mac
#
#   bash scripts/cross-build.sh <version> [linux] [windows] [freebsd]   (default: all three)
#
# Caches live in Docker volumes and in $BUILD_CACHE, so a fresh unzip only rebuilds Cup.
# Docker Hub limits anonymous pulls, so the base image comes from Amazon's public mirror
# (CUP_LINUX_IMAGE overrides it). A network that re-signs TLS can pass its certificate
# file in CUP_EXTRA_CA_FILE.
# Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?version}"; shift
WANT="${*:-linux windows freebsd}"
OUT="${OUT:-release}"
BUILD_CACHE="${BUILD_CACHE:-${CUP_BUILD_CACHE:-/Users/Shared/cup-build}}"
IMAGE=cup-cross:5
mkdir -p "$OUT" "$BUILD_CACHE"
[ -f ui/dist/index.html ] || { echo "ui/dist/index.html missing — build the interface first"; exit 1; }
has() { case " $WANT " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
case "$(uname -m)" in arm64|aarch64) HOSTARCH=arm64; PLAT=linux/arm64 ;; *) HOSTARCH=amd64; PLAT=linux/amd64 ;; esac

# ---- The builder image (made once; about 3 minutes).
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "  making the builder image (once)…"
  # Several mirrors of the same Debian image: anonymous pulls are rate-limited here and there.
  BASE=""
  for img in ${CUP_LINUX_IMAGE:-} public.ecr.aws/docker/library/debian:bookworm mirror.gcr.io/library/debian:bookworm debian:bookworm; do
    if docker image inspect "$img" >/dev/null 2>&1 || docker pull -q --platform "$PLAT" "$img" >/dev/null 2>&1; then BASE=$img; break; fi
    echo "  (could not pull $img — trying the next mirror)"
  done
  [ -n "$BASE" ] || { echo "  ✗ no Debian image could be pulled (rate limits?) — try again later"; exit 1; }
  # Certificates for HTTPS downloads inside the image: an extra bundle if given, else the Mac's own list.
  CA_SRC="${CUP_EXTRA_CA_FILE:-}"; [ -z "$CA_SRC" ] && [ -s /etc/ssl/cert.pem ] && CA_SRC=/etc/ssl/cert.pem
  SECRET=(); [ -n "$CA_SRC" ] && SECRET=(--secret "id=ca,src=$CA_SRC")
  NET=(); [ -n "${CUP_DOCKER_NET:-}" ] && NET=(--network "$CUP_DOCKER_NET")
  DOCKER_BUILDKIT=1 docker build --platform "$PLAT" ${NET[@]+"${NET[@]}"} ${SECRET[@]+"${SECRET[@]}"} \
    --build-arg BASE="$BASE" \
    --build-arg DEB_MIRRORS="${CUP_DEB_MIRRORS:-http://deb.debian.org https://deb.debian.org https://mirrors.edge.kernel.org https://ftp.in.debian.org}" \
    --build-arg HTTPS_PROXY="${CUP_DOCKER_PROXY:-}" -t "$IMAGE" - <<'DOCKER'
ARG BASE=debian:bookworm
FROM ${BASE}
ARG DEB_MIRRORS
ENV DEBIAN_FRONTEND=noninteractive RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
# apt with retries, and the next Debian mirror (HTTPS too) when one cannot be reached.
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' >/etc/apt/apt.conf.d/80cup && \
    printf '%s\n' '#!/bin/sh' \
      'S=/etc/apt/sources.list.d/debian.sources; [ -f "$S.orig" ] || cp "$S" "$S.orig"' \
      'CA=""; if [ -s /run/secrets/ca ]; then cp /run/secrets/ca /tmp/apt-ca.pem; chmod 644 /tmp/apt-ca.pem; CA="-o Acquire::https::CaInfo=/tmp/apt-ca.pem"; fi' \
      'for m in $DEB_MIRRORS; do' \
      '  sed "s#http://deb.debian.org#$m#g" "$S.orig" >"$S"' \
      '  if apt-get $CA update && apt-get $CA "$@"; then exit 0; fi' \
      '  echo "apt: $m did not work - trying the next Debian mirror"; rm -rf /var/lib/apt/lists/*' \
      'done; exit 1' >/usr/local/bin/apt-try && chmod +x /usr/local/bin/apt-try
ENV DEB_MIRRORS=$DEB_MIRRORS
RUN --mount=type=secret,id=ca,required=false \
    apt-try install -y --no-install-recommends ca-certificates curl build-essential pkg-config \
      libwebkit2gtk-4.1-dev libgtk-3-dev g++-mingw-w64-x86-64-posix nsis zip xz-utils zstd nodejs && \
    rm -rf /var/lib/apt/lists/*
# The other Linux architecture: its libraries unpacked into /sysroot/<arch> (never installed, never run).
RUN --mount=type=secret,id=ca,required=false \
    CA="" && { [ ! -s /run/secrets/ca ] || { cp /run/secrets/ca /tmp/apt-ca.pem && chmod 644 /tmp/apt-ca.pem && CA="-o Acquire::https::CaInfo=/tmp/apt-ca.pem"; }; } && \
    OTHER=$( [ "$(dpkg --print-architecture)" = amd64 ] && echo arm64 || echo amd64 ) && \
    GNU=$( [ "$OTHER" = arm64 ] && echo aarch64-linux-gnu || echo x86-64-linux-gnu ) && \
    dpkg --add-architecture "$OTHER" && \
    apt-try install -y --no-install-recommends g++-$GNU && \
    mkdir -p /tmp/debs /sysroot/$OTHER && cd /tmp/debs && \
    apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances --no-pre-depends \
      libwebkit2gtk-4.1-dev:$OTHER libgtk-3-dev:$OTHER libc6-dev:$OTHER libstdc++-12-dev:$OTHER \
      | grep -E "^[a-z0-9][^ <>]*(:$OTHER)?$" | sort -u > list && \
    (xargs -a list apt-get $CA download >/dev/null 2>&1 || xargs -a list -n 1 apt-get $CA download 2>/dev/null || true) && \
    for d in *.deb; do dpkg -x "$d" /sysroot/$OTHER; done && \
    rm -rf /tmp/debs /var/lib/apt/lists/*
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export CURL_CA_BUNDLE=/run/secrets/ca SSL_CERT_FILE=/run/secrets/ca; fi && \
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable && \
    rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-pc-windows-gnu x86_64-unknown-freebsd
# FreeBSD 14's libc++ headers need a current clang (Debian's 14 is too old): LLVM 19 from apt.llvm.org.
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export CURL_CA_BUNDLE=/run/secrets/ca; fi && \
    curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key -o /etc/apt/trusted.gpg.d/apt.llvm.org.asc && \
    echo "deb https://apt.llvm.org/bookworm/ llvm-toolchain-bookworm-19 main" >/etc/apt/sources.list.d/llvm.list && \
    apt-try install -y --no-install-recommends clang-19 lld-19 llvm-19 && rm -rf /var/lib/apt/lists/*
DOCKER
fi

# ---- FreeBSD sysroot, made once on the Mac (bsdtar reads FreeBSD's packages natively).
FB=""
if has freebsd; then
  if node scripts/freebsd-sysroot.mjs "$BUILD_CACHE/freebsd-sysroot" >"$BUILD_CACHE/freebsd-sysroot.log" 2>&1; then FB="$BUILD_CACHE/freebsd-sysroot"
  else echo "  ! FreeBSD sysroot could not be made — see $BUILD_CACHE/freebsd-sysroot.log"; WANT="${WANT//freebsd/}"; fi
fi

rm -rf .xout && mkdir -p .xout
NET=(); [ -n "${CUP_DOCKER_NET:-}" ] && NET=(--network "$CUP_DOCKER_NET")
docker run --rm --platform "$PLAT" ${NET[@]+"${NET[@]}"} \
  -v "$PWD":/src -w /src \
  -v cup-target:/target -v cup-cargo:/usr/local/cargo/registry \
  ${FB:+-v "$FB":/fbsd:ro} \
  -e CARGO_TARGET_DIR=/target -e CUP_SALT="${CUP_SALT:-}" -e HOSTARCH="$HOSTARCH" -e WANT="$WANT" -e VERSION="$VERSION" \
  ${CUP_DOCKER_PROXY:+-e HTTPS_PROXY="$CUP_DOCKER_PROXY"} ${CUP_EXTRA_CA_FILE:+-v "$CUP_EXTRA_CA_FILE":/extra-ca.crt:ro -e CARGO_HTTP_CAINFO=/extra-ca.crt} \
  "$IMAGE" bash -Eeuo pipefail -c '
    has() { case " $WANT " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
    linux() {
      local triple=$1 deb=$2 multi=$3
      if [ "$deb" = "$HOSTARCH" ]; then
        cargo build --release --target "$triple"
      else
        local sr=/sysroot/$deb up
        up=$(echo "$triple" | tr a-z- A-Z_)
        env PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_SYSROOT_DIR=$sr PKG_CONFIG_LIBDIR=$sr/usr/lib/$multi/pkgconfig:$sr/usr/share/pkgconfig \
          "CARGO_TARGET_${up}_LINKER=$multi-gcc" "CXX_${triple//-/_}=$multi-g++" "CC_${triple//-/_}=$multi-gcc" \
          "CARGO_TARGET_${up}_RUSTFLAGS=-C link-arg=--sysroot=$sr -C link-arg=-Wl,-rpath-link,$sr/usr/lib/$multi -C link-arg=-Wl,-rpath-link,$sr/lib/$multi -C link-arg=-L$sr/usr/lib/$multi -C link-arg=-L$sr/lib/$multi" \
          cargo build --release --target "$triple"
      fi
      install -m 755 "/target/$triple/release/cup" "/src/.xout/cup-linux-$deb"
      echo "  ✓ linux $deb: $(stat -c %s /src/.xout/cup-linux-$deb) bytes"
    }
    if has linux; then
      linux x86_64-unknown-linux-gnu amd64 x86_64-linux-gnu
      linux aarch64-unknown-linux-gnu arm64 aarch64-linux-gnu
    fi
    if has windows; then
      # The posix-threads MinGW: std::thread/mutex in the WebView glue need it on GCC 12.
      env CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc-posix CXX_x86_64_pc_windows_gnu=x86_64-w64-mingw32-g++-posix \
        AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar RC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-windres \
        CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc-posix \
        cargo build --release --target x86_64-pc-windows-gnu
      w=$(mktemp -d); cp /target/x86_64-pc-windows-gnu/release/cup.exe assets/cup.ico LICENSE THIRD-PARTY-NOTICES.txt "$w/"
      echo "  ✓ windows x64: $(stat -c %s "$w/cup.exe") bytes"
      makensis -V2 -DVERSION="$VERSION" -DSRC="$w" -DOUT="/src/.xout/Cup_${VERSION}_x64-setup.exe" packaging/installer.nsi
      (cd "$w" && zip -q -9 "/src/.xout/Cup_${VERSION}_windows-x64-portable.zip" cup.exe LICENSE THIRD-PARTY-NOTICES.txt)
      cp "$w/cup.exe" /src/.xout/cup-windows-x64.exe
    fi
    if has freebsd && [ ! -d /fbsd/usr/include ]; then
      echo "  ! the FreeBSD sysroot is not visible inside Docker — with colima run: colima stop; colima start --mount \$HOME:w --mount /Users/Shared/cup-build:w"
    fi
    if has freebsd && [ -d /fbsd/usr/include ]; then
      sr=/fbsd; T=x86_64-unknown-freebsd14
      printf "#!/bin/sh\nexec clang-19 --target=$T --sysroot=$sr --ld-path=/usr/lib/llvm-19/bin/ld.lld -L$sr/usr/local/lib -Wl,-rpath-link,$sr/usr/local/lib \"\$@\"\n" >/usr/local/bin/fbsd-cc
      printf "#!/bin/sh\nexec clang++-19 --target=$T --sysroot=$sr -stdlib=libc++ --ld-path=/usr/lib/llvm-19/bin/ld.lld -L$sr/usr/local/lib -Wl,-rpath-link,$sr/usr/local/lib \"\$@\"\n" >/usr/local/bin/fbsd-c++
      chmod +x /usr/local/bin/fbsd-cc /usr/local/bin/fbsd-c++
      env PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_SYSROOT_DIR=$sr PKG_CONFIG_LIBDIR=$sr/usr/local/libdata/pkgconfig:$sr/usr/local/share/pkgconfig:$sr/usr/libdata/pkgconfig \
        CC_x86_64_unknown_freebsd=fbsd-cc CXX_x86_64_unknown_freebsd=fbsd-c++ AR_x86_64_unknown_freebsd=llvm-ar-19 \
        CARGO_TARGET_X86_64_UNKNOWN_FREEBSD_LINKER=fbsd-cc \
        cargo build --release --target x86_64-unknown-freebsd
      install -m 755 /target/x86_64-unknown-freebsd/release/cup /src/.xout/cup-freebsd-x86_64
      echo "  ✓ freebsd x86_64: $(stat -c %s /src/.xout/cup-freebsd-x86_64) bytes"
    fi
  '

# ---- Packages, made here (the .deb writer needs only Node).
for a in amd64 arm64; do
  [ -f ".xout/cup-linux-$a" ] || continue
  node scripts/deb.mjs ".xout/cup-linux-$a" "$a" "$VERSION" "$OUT/cup_${VERSION}_${a}.deb"
  t=$(mktemp -d); cp ".xout/cup-linux-$a" "$t/cup"; cp LICENSE THIRD-PARTY-NOTICES.txt packaging/cup.desktop assets/cup-256.png "$t/"
  arch=$( [ $a = amd64 ] && echo x86_64 || echo aarch64 )
  tar -czf "$OUT/Cup_${VERSION}_linux-${arch}.tar.gz" -C "$t" . && rm -rf "$t"
done
if [ -f .xout/cup-freebsd-x86_64 ]; then
  t=$(mktemp -d); cp .xout/cup-freebsd-x86_64 "$t/cup"; cp LICENSE THIRD-PARTY-NOTICES.txt packaging/cup.desktop assets/cup-256.png "$t/"
  printf 'Cup for FreeBSD 14 (x86_64)\n\nNeeds: pkg install webkit2-gtk_41 gtk3 curl\nRun: ./cup\n' >"$t/README.txt"
  tar -czf "$OUT/Cup_${VERSION}_freebsd-x86_64.tar.gz" -C "$t" . && rm -rf "$t"
fi
mv .xout/Cup_* "$OUT/" 2>/dev/null || true
mkdir -p "$OUT/.programs" && mv .xout/cup-* "$OUT/.programs/" 2>/dev/null || true
rm -rf .xout
echo "cross builds done:"; ls "$OUT" | sed 's/^/    /'
