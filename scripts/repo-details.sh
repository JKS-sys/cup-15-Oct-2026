#!/usr/bin/env bash
# Description, website and topics on GitHub for an app's source and releases repos.
#   bash scripts/repo-details.sh <owner/src> <owner/releases> "<description>" <homepage> "<topic,topic,…>"
# release.sh runs it every time; needs gh with the repo scope (or GH_TOKEN in .env).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. scripts/env.sh; load_env; [ -n "${GH_TOKEN:-}" ] && export GH_TOKEN
SRC="$1" REL="$2" DESC="$3" HOME_URL="$4" TOPICS="$5"
# GitHub allows at most 20 topics per repository (each ≤ 50 chars, lowercase letters, digits and hyphens): use all 20.
NT="$(printf '%s' "$TOPICS" | awk -F, '{print NF}')"
if [ "$NT" -gt 20 ]; then echo "  topics: $NT given, GitHub keeps at most 20 — trimming the list"; TOPICS="$(printf '%s' "$TOPICS" | cut -d, -f1-20)"; NT=20; fi
[ "$NT" -lt 20 ] && echo "  topics: only $NT of the 20 GitHub allows — add more for discoverability"
for repo in "$SRC" "$REL"; do
  d="$DESC"; [ "$repo" = "$REL" ] && d="Downloads and update feed — $DESC"
  if gh repo edit "$repo" --description "$d" --homepage "$HOME_URL" --add-topic "$TOPICS" >/dev/null 2>&1
  then echo "  $repo: description, website and $(printf '%s' "$TOPICS" | awk -F, '{print NF}') topics set"
  else echo "  $repo: could not set details (token needs the repo scope) — carrying on"; fi
done
