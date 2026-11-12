#!/bin/sh
# Builds the demo instance from nothing: a scratch data dir with the Studio
# plugin built from this repository's HEAD, the fictional threads, Bots,
# pages, memory, todos and automations. Leaves the scratch server running on
# 127.0.0.1:38994 for capture.mjs. `scratch.sh stop && scratch.sh wipe` cleans up.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DESKTOP="${DESKTOP:-$HOME/workingdir/bb-studio-app-desktop}"
SCRATCH="${SCRATCH:-/tmp/bbsite}"
export DESKTOP SCRATCH
S="$HERE/scratch.sh"

"$S" stop 2>/dev/null || true
"$S" wipe
mkdir -p "$SCRATCH/src"

# Studio, built from HEAD in the scratch dir (never in the checkout another app loads).
git -C "$REPO" archive HEAD plugins | tar -x -C "$SCRATCH/src"
(cd "$SCRATCH/src/plugins" && pnpm install --frozen-lockfile --prefer-offline >/dev/null)
(cd "$SCRATCH/src/plugins/packages/bb-studio" && "$S" bb plugin build . >/dev/null)
(cd "$SCRATCH/src/plugins/packages/bb-studio-visual-chat" && "$S" bb plugin build . >/dev/null)

# Studio's first run would make its own "Assistant" as the primary Bot; mark it done.
mkdir -p "$SCRATCH/data/plugins/studio"
printf '{"version":1,"state":"done","reason":"bots","at":0,"botId":null,"welcomeThreadId":null,"opened":true}\n' > "$SCRATCH/data/plugins/studio/onboarding.json"
"$S" start
"$S" bb plugin install "$SCRATCH/src/plugins/packages/bb-studio" --yes >/dev/null
"$S" bb plugin install "$SCRATCH/src/plugins/packages/bb-studio-visual-chat" --yes >/dev/null
"$S" stop
sleep 2

(cd "$DESKTOP" && node_modules/.bin/tsx --conditions=source "$HERE/seed-db.mts" "$DESKTOP" "$SCRATCH/data" "$SCRATCH/ids.json")
"$S" start
node "$HERE/seed-studio.mjs" "$SCRATCH/ids.json"
node "$HERE/fixups.mjs" "$SCRATCH/ids.json"
# Studio keeps some of this in memory: reload it, then put the fixups back.
"$S" bb plugin reload studio >/dev/null
sleep 12
node "$HERE/fixups.mjs" "$SCRATCH/ids.json"
# Pages, a whiteboard, a design, a dashboard, a mini app, artifacts, a recording and a Visual Chat board.
node "$HERE/seed-features.mjs" "$SCRATCH/ids.json"
