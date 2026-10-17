#!/usr/bin/env bash
# pour-register.sh — every new app (and CLI) registers itself on Pour at release time,
# so `pour install --cask <app>` (or `pour install <cli>`) works everywhere the moment the
# release is out. Source it from update.sh after latest.json is published:
#
#   . assets/pour-register.sh
#   pour_register cask peek "Peek" "Fast image viewer that opens pictures instantly" \
#       "https://ipconfig.co.network/peek" "https://ipconfig.co.network/updates/peek/latest.json"
#   pour_register cli sp "Swep CLI" "Disk cleaner for the terminal" "https://ipconfig.co.network/swep" \
#       "https://ipconfig.co.network/updates/swep/latest.json" sp
#
# The Pour registry checks it automatically (clean id, description, page answers, downloads
# answer, SHA-256 where listed) and lists it at once — no approval. APPS_API_KEY from .env
# (read with load_env) marks it as the creator's, so the same id can be updated every release.
# Never fails a release: a refusal prints the reasons and carries on.
#
# Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
pour_register() {
  local kind=$1 token=$2 name=$3 desc=$4 homepage=$5 feed=${6:-}; shift 6 2>/dev/null || shift $#
  local bins=("$@") body out code
  body=$(KIND="$kind" TOKEN="$token" NAME="$name" DESC="$desc" HOME_URL="$homepage" FEED="$feed" BINS="${bins[*]:-}" python3 -c '
import json, os
b = {"kind": os.environ["KIND"], "token": os.environ["TOKEN"], "name": os.environ["NAME"], "desc": os.environ["DESC"], "homepage": os.environ["HOME_URL"], "feed": os.environ["FEED"] or None, "from": "update.sh"}
bins = os.environ["BINS"].split()
if bins: b["bin"] = bins
print(json.dumps(b))')
  out=$(curl -sS -m 60 -o - -w '\n%{http_code}' -X POST "${POUR_REGISTER_URL:-https://ipconfig.co.network/pour/api/register}" \
    -H 'content-type: application/json' ${APPS_API_KEY:+-H "authorization: Bearer $APPS_API_KEY"} --data "$body" 2>&1) || true
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [ "${code:-0}" -lt 300 ] 2>/dev/null; then
    printf '  \033[32m✓\033[0m Pour: %s — %s\n' "$token" "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("install",""))' 2>/dev/null)"
  else
    printf '  \033[33m!\033[0m Pour did not list %s yet (HTTP %s):\n' "$token" "${code:-?}"
    printf '%s' "$out" | python3 -c 'import json,sys
try:
  j = json.load(sys.stdin); [print("     -", p) for p in j.get("problems", [j.get("message", "")])]
except Exception: print("     (no answer)")' 2>/dev/null
  fi
  return 0
}
