#!/bin/sh
# Start, stop or call a SCRATCH BB Studio server for the site's screenshots.
# It has its own data dir, port and HOME, imports nothing from ~/.bb, and has
# no provider CLI on its PATH, so no real agent turn can start.
#
#   scratch.sh start | stop | bb <cli args...> | wipe
#
# Env: DESKTOP (the bb-studio-app-desktop worktree), SCRATCH (default /tmp/bbsite).
set -eu
DESKTOP="${DESKTOP:-$HOME/workingdir/bb-studio-app-desktop}"
SCRATCH="${SCRATCH:-/tmp/bbsite}"
DATA="$SCRATCH/data"
PORT=38994
DAEMON_PORT=38995
NODE_PATH_DIR=/opt/homebrew/bin

case "$DATA" in
  *".bb-studio"*|"$HOME/.bb"|"$HOME/.bb/"*) echo "refusing: $DATA is not a scratch dir" >&2; exit 1 ;;
esac

case "${1:-}" in
  start)
    mkdir -p "$DATA" "$SCRATCH/home"
    nohup env -i HOME="$SCRATCH/home" PATH="/usr/bin:/bin:$NODE_PATH_DIR" \
      BB_DATA_DIR="$DATA" BB_SERVER_PORT=$PORT BB_HOST_DAEMON_PORT=$DAEMON_PORT \
      BB_STUDIO_IMPORT_FROM=off BB_SKIP_ONBOARDING=1 \
      node "$DESKTOP/packages/bb-app/dist/bb-app.js" > "$SCRATCH/server.log" 2>&1 &
    for _ in $(seq 1 60); do
      curl -sf "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 && break
      sleep 1
    done
    tail -n 12 "$SCRATCH/server.log"
    ;;
  stop)
    env -i HOME="$SCRATCH/home" PATH="/usr/bin:/bin:$NODE_PATH_DIR" \
      node "$DESKTOP/packages/bb-app/dist/bb-app.js" stop --data-dir "$DATA"
    ;;
  bb)
    shift
    exec env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin \
      BB_DATA_DIR="$DATA" BB_SERVER_URL="http://127.0.0.1:$PORT" \
      node "$DESKTOP/apps/cli/dist/index.js" "$@"
    ;;
  wipe)
    rm -rf "$SCRATCH"
    ;;
  *) echo "usage: scratch.sh start|stop|bb ...|wipe" >&2; exit 2 ;;
esac
