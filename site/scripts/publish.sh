#!/bin/sh
# Copies the built site (dist/) into a local checkout of the public site
# repository (patleeman/bb-studio-site), ready to review and commit there.
# It does not commit or push.
#
#   scripts/publish.sh <path-to-bb-studio-site-checkout>
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:?usage: publish.sh <path-to-bb-studio-site-checkout>}"
[ -d "$DEST/.git" ] || { echo "$DEST is not a git checkout" >&2; exit 1; }
[ -f "$HERE/dist/index.html" ] || { echo "build first: node scripts/build.mjs" >&2; exit 1; }
# Replace everything but the checkout's own git data and README.
find "$DEST" -mindepth 1 -maxdepth 1 ! -name .git ! -name README.md -exec rm -rf {} +
cp -R "$HERE/dist/." "$DEST/"
echo "Copied dist/ into $DEST. Review with: git -C \"$DEST\" status"
