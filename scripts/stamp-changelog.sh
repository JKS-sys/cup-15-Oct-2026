#!/usr/bin/env bash
# Turns "## Unreleased" into "## Cup <version> — dd-mon-yyyy" in the source that ships.
# Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
set -euo pipefail
cd "$(dirname "$0")/.."
V="$1"; D=$(date +%d-%b-%Y)
grep -q "^## Cup $V " CHANGELOG.md && exit 0
if grep -q '^## Unreleased' CHANGELOG.md; then
  awk -v v="$V" -v d="$D" 'BEGIN{done=0} /^## Unreleased/ && !done {print "## Unreleased\n"; print "## Cup " v " — " d; done=1; next} {print}' CHANGELOG.md >CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md
fi
