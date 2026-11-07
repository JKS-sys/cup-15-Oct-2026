# shellcheck shell=bash
# Read .env as data, never as shell code.
#
#   . scripts/env.sh && load_env
#
# `. ./.env` runs every line as a command, so a value with a space in it
# (MAC_SIGN_IDENTITY=JKS-sys App Self-Signed) ran "App" and stopped
# update.sh. This reads KEY=VALUE lines, strips one pair of surrounding
# quotes, and exports them — whatever the value contains. Works in macOS's
# bash 3.2.
load_env() {
  local file="${1:-.env}" line key val
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[2]}"
    val="${BASH_REMATCH[3]}"
    if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    export "$key=$val"
  done < "$file"
  # Plan ids may be named by price (RZP_20_MONTHLY, RZP_220_YEARLY) or by
  # period (RZP_PLAN_MONTHLY, RZP_PLAN_YEARLY). Either name fills the other.
  : "${RZP_PLAN_MONTHLY:=${RZP_20_MONTHLY:-}}" "${RZP_PLAN_YEARLY:=${RZP_220_YEARLY:-}}"
  : "${RZP_20_MONTHLY:=${RZP_PLAN_MONTHLY:-}}" "${RZP_220_YEARLY:=${RZP_PLAN_YEARLY:-}}"
  export RZP_PLAN_MONTHLY RZP_PLAN_YEARLY RZP_20_MONTHLY RZP_220_YEARLY
}

# Write KEY="VALUE" once (quoted, so even a plain `source` would be safe).
keep_env() {
  local file="${3:-.env}"
  grep -q "^$1=" "$file" 2>/dev/null && return 0
  # A file whose last line has no newline would swallow the new key.
  if [ -s "$file" ] && [ -n "$(tail -c1 "$file")" ]; then printf '\n' >> "$file"; fi
  printf '%s="%s"\n' "$1" "$2" >> "$file"
}

# Write KEY="VALUE", replacing an existing (possibly empty) line.
set_env() {
  local file="${3:-.env}" tmp
  tmp=$(mktemp)
  if [ -f "$file" ]; then grep -v "^$1=" "$file" > "$tmp" || true; fi
  if [ -s "$tmp" ] && [ -n "$(tail -c1 "$tmp")" ]; then printf '\n' >> "$tmp"; fi
  printf '%s="%s"\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$file"; rm -f "$tmp"
}

# ---- ipconfig dashboard vault: secrets come from the vault, so no .env is needed.
load_vault() {
  local app="${1:-cup}" base="${VAULT_URL:-https://ipconfig.co.network/api/v1/owner}"
  [ "${CUP_VAULT:-1}" = 0 ] && { VAULT_SAID="skipped (CUP_VAULT=0)"; return 0; }
  # no key on this Mac: the owner's GitHub sign-in (`gh auth login`) opens the vault (the dashboard checks the account)
  local tok="${APPS_API_KEY:-}" via="the vault key"
  if [ -z "$tok" ] && command -v gh >/dev/null 2>&1; then tok="$(gh auth token 2>/dev/null || true)"; via="your GitHub sign-in"; fi
  [ -n "$tok" ] || { VAULT_SAID="not used (no APPS_API_KEY and no gh sign-in — run: gh auth login)"; return 0; }
  command -v curl >/dev/null 2>&1 || { VAULT_SAID="not used (no curl)"; return 0; }
  local dir file code line key val n=0 filled=""
  dir="$(mktemp -d "${TMPDIR:-/tmp}/cup-vault.XXXXXX")" || return 0
  chmod 700 "$dir"; file="$dir/env"; ( umask 077; : > "$file" )
  # the key travels in a header read from a file (never on the command line, where `ps` could see it)
  printf 'header = "Authorization: Bearer %s"\n' "$tok" > "$dir/h"; chmod 600 "$dir/h"; tok=""
  # one retry (a fresh Mac's first request can meet a cold DNS / proxy); "000" = no HTTP answer at all
  # the dashboard keeps one vault per app plus "shared": this app's vault with the shared one, as a .env
  code="$(curl -sS --max-time 20 --retry 1 --retry-delay 2 -K "$dir/h" -o "$file" -w '%{http_code}' "$base/vault/$app/export?format=env&shared=1" 2>/dev/null)" || true
  code="${code:-000}"; code="${code:0:3}"
  if [ "$code" = 404 ]; then   # an older dashboard: the single-vault export
    code="$(curl -sS --max-time 20 -K "$dir/h" -o "$file" -w '%{http_code}' "$base/vault/export?app=$app" 2>/dev/null)" || true
    code="${code:-000}"; code="${code:0:3}"
  fi
  rm -f "$dir/h"
  if [ "$code" != 200 ]; then rm -rf "$dir"; if [ "$code" = 000 ]; then VAULT_SAID="could not be reached (no answer from ipconfig.co.network) — using .env alone"; else VAULT_SAID="could not be read (HTTP $code) — using .env alone"; fi; return 0; fi
  # the export is NAME=value lines; a JSON answer ({ ok, env }) is unwrapped too
  if head -c1 "$file" | grep -q '{'; then
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.env||j.data?.env||""))' "$file" > "$file.x" 2>/dev/null && mv "$file.x" "$file"
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[2]}"; val="${BASH_REMATCH[3]}"
    if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    # .env's / the environment's own value wins; between the vault's lines the later one wins (the export lists the
    # shared vault first, then the app's own — so Cup's own entry beats a shared one of the same name)
    if [ -n "${!key:-}" ] && [[ " $filled " != *" $key "* ]]; then continue; fi
    export "$key=$val"
    [[ " $filled " == *" $key "* ]] || { n=$((n + 1)); filled="$filled $key"; }
  done < "$file"
  rm -rf "$dir"
  VAULT_SAID="$n key(s) from the dashboard vault${filled:+:$filled}"
  # the plan-id aliases again, for keys the vault filled
  : "${RZP_PLAN_MONTHLY:=${RZP_20_MONTHLY:-}}" "${RZP_PLAN_YEARLY:=${RZP_220_YEARLY:-}}"
  : "${RZP_20_MONTHLY:=${RZP_PLAN_MONTHLY:-}}" "${RZP_220_YEARLY:=${RZP_PLAN_YEARLY:-}}"
  export RZP_PLAN_MONTHLY RZP_PLAN_YEARLY RZP_20_MONTHLY RZP_220_YEARLY
}

# 1.0.24: the App Store Connect API key (.p8) on any Mac. APPLE_API_KEY_PATH from another Mac (or the vault) names a
# file this Mac does not have: look where Apple's own tools look (AuthKey_<id>.p8 in ~/.appstoreconnect/private_keys,
# ~/private_keys, ~/.private_keys, ~/Downloads, the repo's .keys/), or take the key itself from APPLE_API_KEY_P8
# (its text, or base64 — keep it in the vault) and write it to a 0600 file in the build cache. Prints nothing secret.
resolve_p8() {
  [ -n "${APPLE_API_KEY_ID:-}" ] || return 0
  [ -n "${APPLE_API_KEY_PATH:-}" ] && [ -r "$APPLE_API_KEY_PATH" ] && return 0
  local name="AuthKey_${APPLE_API_KEY_ID}.p8" d f
  for d in "$HOME/.appstoreconnect/private_keys" "$HOME/private_keys" "$HOME/.private_keys" "$HOME/Downloads" "$HOME/Desktop" "${ROOT:-.}/.keys" "$HOME/Signing"; do
    [ -r "$d/$name" ] && { APPLE_API_KEY_PATH="$d/$name"; export APPLE_API_KEY_PATH; P8_SAID="found $name in $d"; return 0; }
  done
  if [ -n "${APPLE_API_KEY_P8:-}" ]; then
    local dir="${CUP_CACHE:-/Users/Shared/cup-build}/keys"; mkdir -p "$dir" && chmod 700 "$dir"
    f="$dir/$name"; ( umask 077
      if printf '%s' "$APPLE_API_KEY_P8" | grep -q 'BEGIN PRIVATE KEY'; then printf '%s\n' "$APPLE_API_KEY_P8" | sed 's/\\n/\n/g' > "$f"
      else printf '%s' "$APPLE_API_KEY_P8" | base64 -D > "$f" 2>/dev/null || printf '%s' "$APPLE_API_KEY_P8" | base64 -d > "$f"; fi )
    grep -q 'BEGIN PRIVATE KEY' "$f" 2>/dev/null && { APPLE_API_KEY_PATH="$f"; export APPLE_API_KEY_PATH; P8_SAID="written from APPLE_API_KEY_P8"; return 0; }
    rm -f "$f"
  fi
  return 0
}

# 1.0.24: file paths written on another Mac (/Users/<someone else>/…) — a profile, the .p8 — made to work here: the
# same path under this Mac's home folder, else the same file name in the usual folders. Names only are printed.
PATH_KEYS="APPLE_API_KEY_PATH APPLE_PROVISION_PROFILE CUP_PROVISION_PROFILE  APPLE_STORE_PROVISION_PROFILE APPLE_STORE_CAMERA_PROFILE"
remap_paths() {
  local k v rest cand d base fixed=""
  for k in $PATH_KEYS; do
    v="${!k:-}"
    case "$v" in /*) ;; *) continue ;; esac   # empty, or base64 of the file — nothing to remap
    [ -r "$v" ] && continue
    cand=""
    case "$v" in /Users/*/*) rest="${v#/Users/}"; rest="${rest#*/}"; [ -r "$HOME/$rest" ] && cand="$HOME/$rest" ;; esac
    if [ -z "$cand" ]; then
      base="$(basename "$v")"
      for d in "$HOME/Signing" "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME/.private_keys" "$HOME/private_keys" \
               "$HOME/.appstoreconnect/private_keys" "$HOME/Library/MobileDevice/Provisioning Profiles" "${ROOT:-.}/.keys"; do
        [ -r "$d/$base" ] && { cand="$d/$base"; break; }
      done
    fi
    if [ -n "$cand" ]; then export "$k=$cand"; fixed="$fixed $k"; fi
  done
  PATHS_SAID="${fixed:+found on this Mac:$fixed}"
}

# 1.0.24: no .env needed. APPS_API_KEY (the one key that opens the vault) comes from the environment, a .env if there is
# one, or this Mac's login keychain (service "ipconfig vault", saved the first time it is typed); everything else comes
# from the vault. KEY=value in the environment or a .env still wins over the vault.
VAULT_KC_SERVICE="ipconfig vault"
vault_key() {
  [ -n "${APPS_API_KEY:-}" ] && return 0
  local k
  k="$(security find-generic-password -a "${USER:-owner}" -s "$VAULT_KC_SERVICE" -w 2>/dev/null || true)"
  # signed in with gh: the vault opens with that (load_vault) — no key to type
  if [ -z "$k" ] && command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then VAULT_KC_SAID="not needed (GitHub sign-in)"; return 0; fi
  if [ -z "$k" ] && [ -t 0 ]; then
    printf '  The vault key (APPS_API_KEY) is not on this Mac yet. Paste it once — it is kept in the login keychain: ' >&2
    IFS= read -rs k; printf '\n' >&2
    if [ -n "$k" ]; then security add-generic-password -U -a "${USER:-owner}" -s "$VAULT_KC_SERVICE" -l "ipconfig dashboard vault (APPS_API_KEY)" -w "$k" >/dev/null 2>&1 && VAULT_KC_SAID="saved in the login keychain"; fi
  fi
  [ -n "$k" ] && { APPS_API_KEY="$k"; export APPS_API_KEY; VAULT_KC_SAID="${VAULT_KC_SAID:-from the login keychain}"; }
  return 0
}

# import_identities — the Apple signing identities (certificates + private keys) from the vault into the login keychain,
# so a new Mac signs with no exported .p12 copied by hand. APPLE_SIGNING_P12 (base64, made by scripts/vault-files.sh
# with `security export -t identities`) + APPLE_SIGNING_P12_PASS. Only when an identity this run names is missing.
# Usage: import_identities "<identity>" …   → IDS_SAID
