#!/usr/bin/env bash
# Pushes this folder to GitHub as one commit by the owner — also from a fresh unzip with no .git.
#   bash scripts/push-github.sh <owner/repo> "<message>"
# Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
REPO="$1" MSG="${2:-Update}"
URL="https://github.com/$REPO.git"
NAME="${GIT_OWNER_NAME:-Jagadeesh Kumar S}" MAIL="${GIT_OWNER_EMAIL:-JKS.sys@icloud.com}"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -q -b main
  git remote add origin "$URL"
fi
git remote set-url origin "$URL"
git config user.name "$NAME"; git config user.email "$MAIL"
if [ -n "${GH_TOKEN:-}" ]; then git config credential.helper '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'; fi
push() {
  if git fetch -q --depth=1 origin main 2>/dev/null; then git reset -q --soft FETCH_HEAD; fi
  # Rebuild the index from what .gitignore allows, so ignored files (update.sh) leave the repo too.
  git rm -r -q --cached --ignore-unmatch . >/dev/null
  git add -A
  git diff --cached --quiet && { echo "  GitHub: nothing changed"; return 0; }
  git commit -q -m "$MSG"
  git push -q origin HEAD:main
}
push || { echo "  push refused once — fetching again"; push; }
echo "  GitHub: pushed $(git rev-parse --short HEAD) to $REPO"
