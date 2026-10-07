#!/bin/sh
# Pack @bb-studio/kit into packages/bb-studio-kit.tgz, which the plugins depend
# on. BB installs a Git plugin by running npm in its package directory alone,
# and npm would symlink a directory dependency: the bundler then resolves the
# kit's own imports from packages/bb-studio-kit/, which has no node_modules.
# npm extracts a tarball dependency into the plugin's node_modules instead.
# With --check, fail when the committed tarball doesn't match the kit sources.
set -eu
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
tarball="$repo_dir/packages/bb-studio-kit.tgz"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/bb-studio.XXXXXX")"
trap 'rm -rf "$scratch_dir" "$tarball.tmp.$$"' EXIT HUP INT TERM
(cd "$repo_dir/packages/bb-studio-kit" && npm pack --silent --pack-destination "$scratch_dir" >/dev/null)
packed="$(ls "$scratch_dir"/*.tgz)"
if [ "${1:-}" = "--check" ]; then
  cmp -s "$packed" "$tarball" || {
    echo "packages/bb-studio-kit.tgz is stale: run scripts/refresh-locks.sh for every plugin" >&2
    exit 1
  }
  exit 0
fi
# Copy beside the tarball, then rename: a move from TMPDIR crosses
# filesystems and an interrupted copy would leave a partial tarball.
cp "$packed" "$tarball.tmp.$$"
mv -f "$tarball.tmp.$$" "$tarball"
