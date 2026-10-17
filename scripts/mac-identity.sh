#!/usr/bin/env bash
# One stable code-signing identity for every build, made once.
#
#   bash scripts/mac-identity.sh        (update.sh runs it for you on a Mac)
#
# Why: macOS remembers permissions (Downloads folder, Keychain "Always Allow",
# notifications…) per signature. Ad-hoc signatures change with every build, so
# after each update macOS forgets and asks again. A self-signed certificate
# that stays the same keeps every "Allow" across updates. It is not an Apple
# Developer ID (no notarisation, so the first launch still needs
# `xattr -cr /Applications/<App>.app`), but the permission prompts stop.
#
# Made once in your login keychain and saved (base64, password) in .env so CI
# signs with the very same identity. Prints names only, never secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname)" = Darwin ] || { echo "mac-identity: macOS only — skipping."; exit 0; }
. scripts/env.sh; load_env

NAME="${MAC_SIGN_IDENTITY:-JKS-sys App Self-Signed}"
KC="$HOME/Library/Keychains/login.keychain-db"

have() { security find-identity -v -p codesigning 2>/dev/null | grep -q "\"$NAME\""; }
keep() { keep_env "$1" "$2"; }

if have; then
  echo "  signing identity: \"$NAME\" (already in your keychain)"
  keep MAC_SIGN_IDENTITY "$NAME"
  exit 0
fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
# -legacy where the openssl knows it (3.x); macOS's own LibreSSL already uses the old format.
L=(); openssl pkcs12 -help 2>&1 | grep -q -- '-legacy' && L=(-legacy)

if [ -n "${MAC_SIGN_P12:-}" ] && [ -n "${MAC_SIGN_PASSWORD:-}" ]; then
  # Made on another Mac: bring the same one here.
  printf '%s' "$MAC_SIGN_P12" | base64 -D > "$TMP/id.p12"
  echo "  importing the saved signing identity from .env"
else
  echo "  creating a signing identity \"$NAME\" (once)"
  PASS=$(openssl rand -hex 16)
  cat > "$TMP/cfg" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
O = Jagadeesh Kumar S
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cfg" 2>/dev/null
  openssl pkcs12 -export ${L[@]+"${L[@]}"} -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$TMP/id.p12" -passout "pass:$PASS"
  keep MAC_SIGN_P12 "$(base64 < "$TMP/id.p12" | tr -d '\n')"
  keep MAC_SIGN_PASSWORD "$PASS"
  MAC_SIGN_PASSWORD="$PASS"
fi
keep MAC_SIGN_IDENTITY "$NAME"

security import "$TMP/id.p12" -k "$KC" -P "$MAC_SIGN_PASSWORD" -T /usr/bin/codesign >/dev/null
openssl pkcs12 -in "$TMP/id.p12" -nokeys -passin "pass:$MAC_SIGN_PASSWORD" ${L[@]+"${L[@]}"} -out "$TMP/cert.pem" 2>/dev/null
echo "  macOS will ask for your login password once, to trust it for code signing."
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" "$TMP/cert.pem"

have && echo "  signing identity ready: \"$NAME\"" || { echo "  !! the identity was imported but codesign cannot see it — open Keychain Access and check it is trusted for Code Signing."; exit 1; }
