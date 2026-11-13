#!/bin/bash
# Moves the daily driver from bb (~/.bb) to BB Studio (~/.bb-studio): steps 1-8 and the automated checks
# of the cutover plan. Unattended and idempotent: a re-run skips what is done. It stops at the first failed
# check and prints the rollback for that point. It never unpauses a runner or an automation, never reads
# a secret aloud, and writes nothing under the bb data folder.
#
#   cutover.sh             run it
#   cutover.sh --dry-run   run the read-only checks, print every command that would change something
#
# Settings come from the environment, or from the file CUTOVER_ENV names (KEY=value lines, sourced):
# COS (the Bot's Main thread id, required), LEAD_THREADS, ARCHIVE_ROOT, LOG_DIR, CLI, HANDOFF_DOC,
# APNS_KEY_HINT, and for a rehearsal on copies LIVE_DIR, STUDIO_DIR, the ports and the start/stop commands.
set -eEuo pipefail

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
if [ -n "${CUTOVER_ENV:-}" ]; then
  # shellcheck disable=SC1090
  set -a; . "$CUTOVER_ENV"; set +a
fi
LIVE_DIR="${LIVE_DIR:-$HOME/.bb}"
STUDIO_DIR="${STUDIO_DIR:-$HOME/.bb-studio}"
LIVE_PORT="${LIVE_PORT:-38886}"
STUDIO_PORT="${STUDIO_PORT:-38986}"
STOP_LIVE="${STOP_LIVE:-osascript -e 'quit app \"bb Nightly\"'}"
START_LIVE_HINT="${START_LIVE_HINT:-open -a \"bb Nightly\"}"
START_STUDIO="${START_STUDIO:-open -a \"BB Studio\"}"
STOP_STUDIO="${STOP_STUDIO:-osascript -e 'quit app \"BB Studio\"'}"
TAILSCALE="${TAILSCALE:-on}"              # off in a rehearsal: print the repoint instead
ARCHIVE_ROOT="${ARCHIVE_ROOT:-$HOME/bb-cutover}"
LOG_DIR="${LOG_DIR:-$ARCHIVE_ROOT}"
REWRITE_FROM="${REWRITE_FROM:-$HOME/.bb}"   # paths in Bot jobs that name the old data folder
REWRITE_TO="${REWRITE_TO:-$HOME/.bb-studio}"
COS="${COS:?set COS to the Main thread id of the Bot, see CUTOVER_ENV}"
LEAD_THREADS="${LEAD_THREADS:-}"
APNS_KEY_HINT="${APNS_KEY_HINT:-the AuthKey_<id>.p8 file from Apple}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TRANSFER="$HERE/transfer-bot.mjs"
CLI="${CLI:?set CLI to the BB Studio CLI entry (apps/cli/dist/index.js)}"
API="http://127.0.0.1:$STUDIO_PORT/api/v1"
STATE="$ARCHIVE_ROOT/cutover-state-$(basename "$STUDIO_DIR")"
HANDOFF_DOC="${HANDOFF_DOC:-$ARCHIVE_ROOT/HANDOFF.md}"
HANDOFF_TEXT="${HANDOFF_TEXT:-You now run in BB Studio (port $STUDIO_PORT). Live bb is stopped, not deleted; your old thread $COS is archived here, read-only and searchable. Runners and automations are paused on purpose. Read $HANDOFF_DOC, reply with one line saying you have it, and wait for Patrick before changing anything.}"

mkdir -p "$LOG_DIR" "$STATE"; chmod 700 "$STATE"
LOG="$LOG_DIR/cutover-$(date +%Y%m%d-%H%M%S)$([ $DRY = 1 ] && echo -dry || true).log"
exec > >(tee -a "$LOG") 2>&1
B="$(cat "$STATE/backup-dir" 2>/dev/null || echo "$ARCHIVE_ROOT/cutover-$(date +%Y%m%d-%H%M%S)")"

UNMARK="node -e 'const fs=require(\"fs\"),p=process.argv[1],j=JSON.parse(fs.readFileSync(p,\"utf8\"));delete j.cutoverAt;fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\\n\")' '$STUDIO_DIR/fork-import.json'   # and resume the mirror: curl -X POST $API/fork/import/resume"
STEP="0 (pre-checks)"
rollback() {
  echo; echo "!!! STOPPED at step $STEP. Rollback for this point:"
  case "$STEP" in
    0*|1*) echo "    Nothing has changed. Fix the problem and run the script again." ;;
    2*|3*) echo "    BB Studio's Bot data is unchanged. Start live bb again:  $START_LIVE_HINT" ;;
    4*|5*) echo "    BB Studio's Bot data is unchanged. Start live bb again:  $START_LIVE_HINT"; echo "    $UNMARK" ;;
    *) cat <<EOF
    $UNMARK
    $STOP_STUDIO
    while lsof -nP -iTCP:$STUDIO_PORT -sTCP:LISTEN >/dev/null 2>&1; do sleep 1; done
    for f in bb.db fork-import.db plugins/studio/data.db plugins/automations/data.db; do rm -f "$STUDIO_DIR/\$f-wal" "$STUDIO_DIR/\$f-shm"; cp -p "$B/bb-studio/\$f" "$STUDIO_DIR/\$f"; done
    tailscale serve --bg --https=443 http://127.0.0.1:$LIVE_PORT
    $START_LIVE_HINT
EOF
    ;;
  esac
  echo "    Log: $LOG"
}
trap 'rollback' ERR

say() { printf '\n=== %s\n' "$*"; }
ok() { printf '  ok   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; trap - ERR; rollback; exit 1; }
# A command that changes something: printed in a dry run, run otherwise.
run() { if [ $DRY = 1 ]; then printf '  WOULD RUN: %s\n' "$*"; else printf '  + %s\n' "$*"; eval "$@"; fi; }
cli() { env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin BB_DATA_DIR="$STUDIO_DIR" BB_SERVER_URL="http://127.0.0.1:$STUDIO_PORT" node "$CLI" "$@"; }
rpc() { local f; f=$(mktemp); printf '%s' "$3" > "$f"; cli plugin rpc call "$1" "$2" --input-file "$f" --json; rm -f "$f"; }
# Read-only; a stopped server's WAL database has no -shm to share, so fall back to an immutable read.
q() { sqlite3 -readonly "$1" "$2" 2>/dev/null || sqlite3 "file:$1?immutable=1" "$2"; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
healthy() { curl -sf -m 3 "http://127.0.0.1:$STUDIO_PORT/health" >/dev/null; }
wait_for() { local i; for i in $(seq 1 "$2"); do eval "$1" && return 0; sleep 2; done; return 1; }
done_step() { [ -f "$STATE/$1.done" ]; }
mark() { [ $DRY = 1 ] || date +%s > "$STATE/$1.done"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const o=j.output??j;console.log(($1))})"; }

echo "cutover.sh $([ $DRY = 1 ] && echo DRY RUN || true) $(date)"
echo "live $LIVE_DIR :$LIVE_PORT  ->  studio $STUDIO_DIR :$STUDIO_PORT   backup $B   log $LOG"

say "0  Pre-checks"
[ -f "$LIVE_DIR/bb.db" ] && ok "live bb.db" || fail "no $LIVE_DIR/bb.db"
[ -f "$STUDIO_DIR/bb.db" ] && ok "studio bb.db" || fail "no $STUDIO_DIR/bb.db"
[ -f "$CLI" ] && ok "pinned CLI" || fail "no CLI at $CLI"
[ -f "$TRANSFER" ] && ok "transfer-bot.mjs" || fail "no $TRANSFER"
[ "$(node -e 'console.log(require(process.argv[1]).sourceDataDir)' "$STUDIO_DIR/fork-import.json")" = "$LIVE_DIR" ] && ok "BB Studio mirrors $LIVE_DIR" || fail "fork-import.json does not name $LIVE_DIR"
for f in "$LIVE_DIR/plugins/studio/data.db" "$LIVE_DIR/plugins/automations/data.db" "$STUDIO_DIR/plugins/studio/data.db" "$STUDIO_DIR/plugins/automations/data.db"; do [ -f "$f" ] || fail "missing $f"; done
ok "plugin databases present"
cos_status=$(q "$LIVE_DIR/bb.db" "select status from threads where id='$COS'")
echo "  live: Chief of Staff $COS is $cos_status; runners active $(q "$LIVE_DIR/plugins/studio/data.db" "select count(*) from bot_runners where state='active'"); BB automations on $(q "$LIVE_DIR/plugins/automations/data.db" "select count(*) from automations where enabled=1")"

say "1  BB Studio running, mirror on"
STEP="1 (BB Studio up)"
if healthy; then ok "BB Studio answers on :$STUDIO_PORT"
else run "$START_STUDIO"; [ $DRY = 1 ] || { wait_for healthy 90 && ok "BB Studio up" || fail "BB Studio did not start"; }; fi
if [ $DRY = 0 ] || healthy; then
  paused=$(curl -s "$API/fork/import" | json 'o.paused')
  echo "  mirror paused: $paused"
fi

say "2  Stop live bb"
STEP="2 (stop live bb)"
if ! done_step 2 && [ "${cos_status:-}" != "idle" ] && [ "${cos_status:-}" != "error" ]; then
  [ $DRY = 1 ] && echo "  (the Chief of Staff must be idle before the real run)" || fail "Chief of Staff thread is '$cos_status', not idle: wait for it, then run again"
fi
if listening "$LIVE_PORT"; then
  run "$STOP_LIVE"
  [ $DRY = 1 ] || { wait_for "! listening $LIVE_PORT" 60 && ok "live bb stopped" || fail "live bb still listens on :$LIVE_PORT (kill -TERM \$(lsof -t -nP -iTCP:$LIVE_PORT -sTCP:LISTEN))"; }
else ok "live bb is not running"; fi
if [ $DRY = 0 ]; then
  sleep 2
  [ -z "$(lsof "$LIVE_DIR/bb.db" "$LIVE_DIR/plugins/studio/data.db" 2>/dev/null)" ] && ok "no process holds live databases" || fail "a process still holds live databases"
  mark 2
fi
echo "  (manual later: System Settings > General > Login Items: turn bb Nightly off)"

say "3  Final mirror sync, then pause the mirror"
STEP="3 (final sync)"
if done_step 3; then ok "already done"
else
  [ "${paused:-false}" = "true" ] && run "curl -sf -X POST $API/fork/import/resume >/dev/null"
  if [ $DRY = 1 ]; then echo "  WOULD RUN: curl -X POST $API/fork/import/sync, then /pause"
  else
    curl -sf -X POST "$API/fork/import/sync" > "$STATE/final-sync.json" || fail "final sync failed"
    json '"  synced: "+Object.entries(o).filter(([k,v])=>typeof v==="number").map(([k,v])=>k+"="+v).join(" ")+" | plugin rows written="+(o.plugins?.rowsWritten??"-")' < "$STATE/final-sync.json"
    [ "$(curl -sf -X POST "$API/fork/import/pause" | json 'o.paused')" = "true" ] && ok "mirror paused" || fail "mirror did not pause"
  fi
  mark 3
fi
if [ $DRY = 1 ]; then echo "  WOULD RUN: set cutoverAt in $STUDIO_DIR/fork-import.json (BB Studio owns every Bot, runner and automation from then on)"
else
  node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));if(typeof j.cutoverAt!=="number"){j.cutoverAt=Date.now();fs.writeFileSync(p+".tmp",JSON.stringify(j,null,2)+"\n");fs.renameSync(p+".tmp",p)}' "$STUDIO_DIR/fork-import.json"
  ok "cutoverAt $(node -e 'console.log(require(process.argv[1]).cutoverAt)' "$STUDIO_DIR/fork-import.json") in fork-import.json"
fi

say "4  Quit BB Studio and back up"
STEP="4 (backup)"
if done_step 6; then ok "the Bot was already moved; BB Studio keeps running"
elif done_step 4; then ok "backup already at $B"
else
  run "$STOP_STUDIO"
  [ $DRY = 1 ] || { wait_for "! listening $STUDIO_PORT" 60 && ok "BB Studio stopped" || fail "BB Studio still listens on :$STUDIO_PORT"; sleep 2; }
  run "mkdir -p '$B/bb-studio/plugins/studio' '$B/bb-studio/plugins/automations' && chmod 700 '$B'"
  for f in bb.db fork-import.db plugins/studio/data.db plugins/automations/data.db; do
    run "sqlite3 '$STUDIO_DIR/$f' \".backup '$B/bb-studio/$f'\""
  done
  if [ $DRY = 0 ]; then
    [ "$(sqlite3 "$B/bb-studio/plugins/studio/data.db" 'pragma integrity_check')" = ok ] && ok "studio backup integrity ok" || fail "backup integrity"
    [ "$(sqlite3 "$B/bb-studio/bb.db" 'pragma quick_check')" = ok ] && ok "bb.db backup ok" || fail "bb.db backup"
    echo "$B" > "$STATE/backup-dir"
  fi
  mark 4
fi

say "5  The Bot's files"
STEP="5 (files)"
if done_step 6; then ok "already done (a re-run never copies over BB Studio's newer files)"; else
run "mkdir -p '$STUDIO_DIR/thread-storage/$COS/staff' && rsync -a '$LIVE_DIR/thread-storage/$COS/staff/' '$STUDIO_DIR/thread-storage/$COS/staff/'"
run "mkdir -p '$STUDIO_DIR/plugins/automations/scripts' && rsync -a '$LIVE_DIR/plugins/automations/scripts/' '$STUDIO_DIR/plugins/automations/scripts/'"
if [ $DRY = 0 ]; then
  diff -rq "$LIVE_DIR/thread-storage/$COS/staff" "$STUDIO_DIR/thread-storage/$COS/staff" >/dev/null && ok "staff folder identical" || fail "staff folder differs after rsync"
fi
n=$( (grep -rl '/\.bb/' "$LIVE_DIR/plugins/automations/scripts" 2>/dev/null || true) | wc -l | tr -d ' ')
echo "  automation scripts still naming ~/.bb: $n (review before turning automations on)"
fi

say "6  Move the Bot (paused)"
STEP="6 (move the Bot)"
if done_step 6; then ok "already done (a re-run never copies over BB Studio's newer Bot data)"
else
if [ $DRY = 0 ] && listening "$STUDIO_PORT"; then run "$STOP_STUDIO"; wait_for "! listening $STUDIO_PORT" 60 || fail "BB Studio still listens on :$STUDIO_PORT"; sleep 2; fi
RW=(--rewrite "$REWRITE_FROM/thread-storage/=$REWRITE_TO/thread-storage/" --rewrite "$REWRITE_FROM/bin/bb=$REWRITE_TO/bin/bb")
if [ $DRY = 1 ]; then
  echo "  WOULD RUN: node $TRANSFER --from $LIVE_DIR --to $STUDIO_DIR ${RW[*]} --manifest $B/manifest.json"
  echo "  (the script's dry run does not open BB Studio's databases; transfer-bot.mjs --dry-run on copies shows the counts)"
else
  node --no-warnings "$TRANSFER" --from "$LIVE_DIR" --to "$STUDIO_DIR" "${RW[@]}" --manifest "$B/manifest.json" | sed 's/^/  /'
  S="$STUDIO_DIR/plugins/studio/data.db"; L="$LIVE_DIR/plugins/studio/data.db"
  for t in memory_records bot_skills bot_runners bot_automations bot_loops; do
    a=$(q "$L" "select count(*) from $t"); b=$(q "$S" "select count(*) from $t")
    [ "$a" = "$b" ] && ok "$t $b = live" || fail "$t $b, live $a"
  done
  [ "$(q "$S" "select count(*) from bot_runners where state='active'")" = 0 ] && ok "every runner paused" || fail "a runner is active"
  [ "$(q "$S" "select count(*) from bot_automations where state='active'")" = 0 ] && ok "every Bot automation paused" || fail "a Bot automation is active"
  [ "$(q "$STUDIO_DIR/plugins/automations/data.db" "select count(*) from automations where enabled=1")" = 0 ] && ok "every BB automation off" || fail "a BB automation is on"
fi
mark 6
fi

say "7  Start BB Studio, take over the Bot's working threads"
STEP="7 (take over)"
healthy || run "$START_STUDIO"
if [ $DRY = 0 ]; then
  wait_for healthy 90 && ok "BB Studio up" || fail "BB Studio did not start"
  wait_for "cli plugin list --json 2>/dev/null | grep -q '\"id\": *\"studio\"'" 30 || true
  sleep 15
  threads="$(node -e 'const m=require(process.argv[1]);console.log([...m.studio.runnerThreads.map(r=>r.thread),...(m.automations?.targetThreads??[])].join(" "))' "$B/manifest.json") $LEAD_THREADS"
  for t in $(echo $threads | tr ' ' '\n' | sort -u); do
    r=$(curl -s -X POST "$API/fork/import/threads/$t/take-over")
    case "$r" in *note*|*already_taken_over*|*"already taken over"*) ok "$t taken over";; *) fail "$t: $r";; esac
  done
else
  echo "  WOULD RUN: curl -X POST $API/fork/import/threads/<id>/take-over for the runner threads, the automation targets and $LEAD_THREADS"
fi
mark 7

say "8  The Chief of Staff's new Main"
STEP="8 (handoff)"
if [ $DRY = 0 ]; then
  req=$(node -e 'const [cos,text]=process.argv.slice(1);console.log(JSON.stringify({threadId:cos,request:{projectId:"proj_personal",providerId:"claude-code",model:"claude-opus-5-5",reasoningLevel:"medium",permissionMode:"full",executionInputSources:{providerId:"explicit",model:"explicit",reasoningLevel:"explicit",permissionMode:"explicit"},environment:{type:"project-default"},input:[{type:"text",text,mentions:[]}]}}))' "$COS" "$HANDOFF_TEXT")
  MAIN=$(rpc studio thread_handoff "$req" | json 'o.threadId')
  [ -n "$MAIN" ] && [ "$MAIN" != "$COS" ] && ok "new Main $MAIN" || fail "handoff gave no new thread"
  echo "$MAIN" > "$STATE/new-main"
  # Studio files the new thread under the Bot once it has started; give it a minute.
  for i in $(seq 1 30); do
    info=$(rpc studio bot_thread_info "{\"threadId\":\"$MAIN\"}" | json 'o.info.botId+" isMain="+o.info.isMain')
    [ "$info" = "bot_main isMain=true" ] && break; sleep 2
  done
  [ "$info" = "bot_main isMain=true" ] && ok "it is the Chief of Staff's Main" || fail "new Main not recognised: $info"
else
  echo "  WOULD RUN: plugin rpc call studio thread_handoff {threadId:$COS, new Main in proj_personal on claude-code, first message points to $HANDOFF_DOC}"
fi

say "8b Hide the mirrored history (archive, reversible)"
STEP="8b (hide history)"
HIDDEN="$B/hidden-threads.txt"
if [ $DRY = 0 ]; then
  ids=$(q "$STUDIO_DIR/fork-import.db" "select thread_id from mirrored_threads where taken_over_at is null" | sort)
  visible=$(q "$STUDIO_DIR/bb.db" "select id from threads where archived_at is null and deleted_at is null" | sort)
  todo=$(comm -12 <(echo "$ids") <(echo "$visible"))
  echo "  mirrored and still visible: $(echo "$todo" | grep -c . || true)"
  for t in $todo; do
    r=$(curl -s -X POST "$API/threads/$t/archive-all")
    echo "$r" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const id of j.archivedThreadIds??[])console.log(id)})' >> "$HIDDEN" || echo "  note: $t: ${r:0:120}"
  done
  # A cascade can reach a thread BB Studio owns now (taken over, or the new Main): show those again.
  own=$(q "$STUDIO_DIR/fork-import.db" "select thread_id from mirrored_threads where taken_over_at is not null"; cat "$STATE/new-main")
  for t in $own; do
    if [ -n "$(q "$STUDIO_DIR/bb.db" "select 1 from threads where id='$t' and archived_at is not null")" ] && grep -qx "$t" "$HIDDEN" 2>/dev/null; then
      curl -sf -X POST "$API/threads/$t/unarchive" >/dev/null && ok "kept $t visible"
      grep -vx "$t" "$HIDDEN" > "$HIDDEN.tmp" || true; mv "$HIDDEN.tmp" "$HIDDEN"
    fi
  done
  # The list to undo: every mirrored thread archived here that live bb has not archived
  # (this step's archives, plus the old Main and its workers that the handoff archived).
  comm -23 <(comm -12 <(q "$STUDIO_DIR/fork-import.db" "select thread_id from mirrored_threads where taken_over_at is null" | sort) <(q "$STUDIO_DIR/bb.db" "select id from threads where archived_at is not null" | sort)) <(q "$LIVE_DIR/bb.db" "select id from threads where archived_at is not null" | sort) > "$HIDDEN"
  left=$(comm -12 <(q "$STUDIO_DIR/fork-import.db" "select thread_id from mirrored_threads where taken_over_at is null" | sort) <(q "$STUDIO_DIR/bb.db" "select id from threads where archived_at is null and deleted_at is null" | sort) | grep -c . || true)
  [ "$left" = 0 ] && ok "no mirrored thread left visible; hidden by the cutover: $(wc -l < "$HIDDEN" | tr -d ' ') (list: $HIDDEN)" || fail "$left mirrored threads still visible"
  echo "  undo: for t in \$(cat $HIDDEN); do curl -s -X POST $API/threads/\$t/unarchive; done"
else
  echo "  WOULD RUN: curl -X POST $API/threads/<id>/archive-all for every mirrored thread that is not taken over and not archived; list in $HIDDEN"
fi
mark 8

say "9  Phone: tailscale and the push relay"
STEP="9 (phone)"
if [ "$TAILSCALE" = on ]; then run "tailscale serve --bg --https=443 http://127.0.0.1:$STUDIO_PORT"
else echo "  (rehearsal) WOULD RUN: tailscale serve --bg --https=443 http://127.0.0.1:$STUDIO_PORT"; fi
run "cli plugin enable push-notifications >/dev/null"
run "cli plugin enable mobile >/dev/null"
keyid=$(q "$LIVE_DIR/bb.db" "select trim(value,'\"') from plugin_settings where plugin_id='mobile' and key='apnsKeyId'")
if [ -n "$keyid" ]; then if [ $DRY = 1 ]; then echo "  WOULD RUN: cli plugin config mobile set apnsKeyId <live's key id>"; else cli plugin config mobile set apnsKeyId "$keyid" >/dev/null && ok "mobile apnsKeyId set from live"; fi; fi
if [ $DRY = 0 ]; then
  cli plugin config push-notifications set expoPushUrl "http://127.0.0.1:$STUDIO_PORT/api/v1/plugins/mobile/http/push?token=$(cli plugin token mobile)" >/dev/null && ok "push-notifications points at BB Studio's relay (token not shown)"
else echo "  WOULD RUN: cli plugin config push-notifications set expoPushUrl http://127.0.0.1:$STUDIO_PORT/api/v1/plugins/mobile/http/push?token=<plugin token, not printed>"; fi

say "11 Checks"
STEP="11 (checks)"
if [ $DRY = 0 ]; then
  for p in studio studio-visual-chat mobile push-notifications; do
    cli plugin list --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=(j=>j.plugins??j)(JSON.parse(s));const p=a.find(x=>x.id==='$p');process.exit(p&&p.status==='running'?0:1)})" && ok "$p running" || fail "$p not running"
  done
  [ "$(curl -s "$API/fork/import" | json 'o.paused')" = true ] && ok "mirror paused" || fail "mirror not paused"
  bot=$(rpc studio bot_get '{"botId":"bot_main"}' | json '(o.bot??o).state+" "+(o.bot??o).threadId')
  [ "$bot" = "paused $(cat "$STATE/new-main")" ] && ok "Bot paused, Main $(cat "$STATE/new-main")" || fail "Bot is '$bot'"
  for m in bot_runners bot_automations bot_skills memory.list memory.profile; do rpc studio $m '{"botId":"bot_main"}' >/dev/null && ok "$m reads" || fail "$m"; done
  [ "$(rpc studio bot_runners '{"botId":"bot_main"}' | json 'o.runners.filter(r=>r.state!=="paused").length')" = 0 ] && ok "runners all paused" || fail "a runner is not paused"
  echo "  visible threads now: $(q "$STUDIO_DIR/bb.db" "select count(*) from threads where archived_at is null and deleted_at is null and coalesce(visibility,'')!='hidden'")"
fi

trap - ERR
cat <<EOF

=== Done$([ $DRY = 1 ] && echo " (DRY RUN: nothing was changed)" || true). Patrick, now, in this order:
  1. BB Studio > Accounts: sign in to Claude and to Codex.
  2. BB Studio > Studio settings > Phone notifications > APNs key: paste the .p8 key
     ($APNS_KEY_HINT). Never paste it into a chat.
  3. iPhone: force-quit the BB Studio app, open it, then Studio settings > Phone notifications > Send a test push.
  4. Open the Chief of Staff's new Main ($(cat "$STATE/new-main" 2>/dev/null || echo "printed in step 8")). It has the handoff.
  Also: System Settings > General > Login Items: turn bb Nightly off.
Runners and automations stay paused; the new Main turns them on later (CUTOVER.md step 12).
Rollback: CUTOVER.md "Rollback". Backup: $B. Hidden-history list: $HIDDEN. Log: $LOG
EOF
