#!/bin/sh
# Install every bb plugin in packages/ (idempotent).
# Usage: bash scripts/install-all.sh   (or: pnpm plugins:install)
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ok=0
for pkg in "$REPO_DIR"/packages/bb-studio*/; do
	grep -q '"bb":' "$pkg/package.json" 2>/dev/null || continue
	name="$(basename "$pkg")"
	echo "==> bb plugin install $name"
	if bb plugin install "$pkg" --yes; then
		echo "    installed: $name"
		ok=$((ok + 1))
	else
		echo "    FAILED: $name" >&2
	fi
done

echo
echo "Installed $ok plugin(s). Installed plugins from this repo:"
plugin_ids="$(node -e 'const {plugins}=require(process.argv[1]); process.stdout.write(plugins.map(p=>p.name).join("|"))' "$REPO_DIR/.bb/plugins.json")"
bb plugin list 2>/dev/null | grep -E "^($plugin_ids)@" || true
