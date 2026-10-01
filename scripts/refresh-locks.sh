#!/bin/sh
# Regenerate npm locks outside the pnpm workspace, as BB Git installs do.
set -eu
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/refresh-locks.sh bb-studio-tasks [bb-studio-decisions ...]" >&2
  exit 2
fi
scratch_dir="$(mktemp -d)"
trap 'rm -rf "$scratch_dir"' EXIT HUP INT TERM
git clone --quiet --shared --no-checkout "$repo_dir" "$scratch_dir/repo"
git -C "$scratch_dir/repo" checkout --quiet HEAD
# Kit metadata is read by npm while resolving each plugin's file dependency.
cp "$repo_dir/packages/bb-studio-kit/package.json" "$scratch_dir/repo/packages/bb-studio-kit/package.json"
for package_name in "$@"; do
  source_dir="$repo_dir/packages/$package_name"
  target_dir="$scratch_dir/repo/packages/$package_name"
  test -f "$source_dir/package.json" || { echo "Unknown package: $package_name" >&2; exit 2; }
  cp "$source_dir/package.json" "$target_dir/package.json"
  # The plugin's .npmrc (install-links, legacy-peer-deps) shapes its lock.
  cp "$source_dir/.npmrc" "$target_dir/.npmrc" 2>/dev/null || rm -f "$target_dir/.npmrc"
  cp "$source_dir/package-lock.json" "$target_dir/package-lock.json" 2>/dev/null || rm -f "$target_dir/package-lock.json"
  (cd "$target_dir" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund)
  cp "$target_dir/package-lock.json" "$source_dir/package-lock.json"
done
