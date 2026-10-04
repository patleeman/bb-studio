#!/bin/sh
# Repack the kit, then regenerate npm locks outside the pnpm workspace, as BB
# Git installs do.
set -eu
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/refresh-locks.sh bb-studio-pages [bb-studio-decisions ...]" >&2
  exit 2
fi
sh "$repo_dir/scripts/pack-kit.sh"
scratch_dir="$(mktemp -d)"
trap 'rm -rf "$scratch_dir"' EXIT HUP INT TERM
git clone --quiet --shared --no-checkout "$repo_dir" "$scratch_dir/repo"
git -C "$scratch_dir/repo" checkout --quiet HEAD
# npm reads the kit tarball while resolving each plugin's file dependency.
cp "$repo_dir/packages/bb-studio-kit.tgz" "$scratch_dir/repo/packages/bb-studio-kit.tgz"
for package_name in "$@"; do
  source_dir="$repo_dir/packages/$package_name"
  target_dir="$scratch_dir/repo/packages/$package_name"
  test -f "$source_dir/package.json" || { echo "Unknown package: $package_name" >&2; exit 2; }
  # A package added since HEAD has no directory in the clone yet.
  mkdir -p "$target_dir"
  cp "$source_dir/package.json" "$target_dir/package.json"
  cp "$source_dir/package-lock.json" "$target_dir/package-lock.json" 2>/dev/null || rm -f "$target_dir/package-lock.json"
  # npm keeps a locked tarball's integrity, so drop the kit to rehash it.
  test ! -f "$target_dir/package-lock.json" || node -e '
    const fs = require("node:fs");
    const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    delete lock.packages["node_modules/@bb-studio/kit"];
    fs.writeFileSync(process.argv[1], JSON.stringify(lock, null, 2) + "\n");
  ' "$target_dir/package-lock.json"
  (cd "$target_dir" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund)
  cp "$target_dir/package-lock.json" "$source_dir/package-lock.json"
done
