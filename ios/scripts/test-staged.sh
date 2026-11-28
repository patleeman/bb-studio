#!/bin/bash
# Run the staged-server iOS UI tests against an isolated staged BB server.
#
# Usage:
#   scripts/test-staged.sh
#   scripts/test-staged.sh --suite ComposerUITests --suite PageEditingUITests
#   BB_TEST_SIMULATOR_ID=<sim> TEST_RUNNER_BBGO_QA_SERVER=<url> scripts/test-staged.sh
#
# When TEST_RUNNER_BBGO_QA_SERVER (or BBGO_QA_SERVER) is unset, this script
# starts an isolated staged BB on a free ephemeral loopback port via
# ../plugins/scripts/staged-bb.mjs, seeds the mini-app fixtures, and stops +
# deletes it on exit. When BB_TEST_SIMULATOR_ID is unset, it creates a private
# throwaway iPhone simulator and deletes it on exit.
#
# STAGED_SCHEME and STAGED_CONFIGURATION pick another scheme or build
# configuration (scripts/test-release-launch.sh: BBStudioUITests, Release).
#
# Never touches ~/.bb-studio, ~/.bb, or the live BB port.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

default_suites=(
  ComposerUITests
  PageEditingUITests
  ThreadUITests
  BotLiveUITests
  MiniCardUITests
  MiniAppUITests
  NewSurfacesUITests
  StudioPagingUITests
  WorkflowUITests
  CollapseSubThreadsUITests
  ArtifactRuntimeUITests
)

suites=()
extra_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --suite)
      [[ $# -ge 2 ]] || { echo "Missing value for --suite" >&2; exit 2; }
      suites+=("$2")
      shift 2
      ;;
    --help|-h)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      extra_args+=("$1")
      shift
      ;;
  esac
done
if [[ ${#suites[@]} -eq 0 ]]; then
  suites=("${default_suites[@]}")
fi

derived="${STAGED_DERIVED_DATA:-build/staged/DerivedData}"
scheme="${STAGED_SCHEME:-BBStudio}"
configuration="${STAGED_CONFIGURATION:-Debug}"
result_bundle="${STAGED_XCRESULT:-build/staged/staged-ui.xcresult}"
server="${TEST_RUNNER_BBGO_QA_SERVER:-${BBGO_QA_SERVER:-}}"
mini_ids="${TEST_RUNNER_BBGO_QA_MINI_IDS:-${BBGO_QA_MINI_IDS:-}}"
device_id="${BB_TEST_SIMULATOR_ID:-}"

created_sim=""
started_staged_dir=""
started_staged_port=""

cleanup() {
  if [[ -n "$started_staged_dir" ]]; then
    BB_STAGED_DIR="$started_staged_dir" BB_STAGED_PORT="$started_staged_port" \
      node scripts/staged-server.mjs stop >/dev/null 2>&1 || true
    rm -rf "$started_staged_dir" >/dev/null 2>&1 || true
  fi
  if [[ -n "$created_sim" ]]; then
    xcrun simctl shutdown "$created_sim" >/dev/null 2>&1 || true
    xcrun simctl delete "$created_sim" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

validate_server_url() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse

raw = sys.argv[1].strip()
u = urlparse(raw)
if u.scheme not in ("http", "https") or not u.hostname:
    sys.exit(f"Invalid staged server URL: {raw}")
if u.port == 38986:
    sys.exit("Refusing to run staged iOS UI tests against live BB port 38986.")
PY
}

if [[ -z "$server" ]]; then
  command -v node >/dev/null || { echo "node is required to auto-start staged BB" >&2; exit 1; }
  started_staged_dir="$(mktemp -d "${TMPDIR:-/tmp}/bb-ios-staged.XXXXXX")"
  started_staged_port="$(python3 - <<'PY'
import socket
with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    assert port != 38986
    print(port)
PY
  )"
  echo "Starting isolated staged BB in $started_staged_dir on port $started_staged_port..."
  BB_STAGED_DIR="$started_staged_dir" BB_STAGED_PORT="$started_staged_port" \
    node scripts/staged-server.mjs start
  # shellcheck disable=SC1090
  . "$started_staged_dir/capture.env"
  server="$BB_SERVER_URL"
  mini_ids="${mini_ids:-${TEST_RUNNER_BBGO_QA_MINI_IDS:-}}"
  qa_mini="${TEST_RUNNER_BBGO_QA_MINI:-}"
  qa_thread="${TEST_RUNNER_BBGO_QA_THREAD:-}"
  qa_sent_thread="${TEST_RUNNER_BBGO_QA_SENT_THREAD:-}"
  qa_page="${TEST_RUNNER_BBGO_QA_PAGE:-}"
  qa_recording="${TEST_RUNNER_BBGO_QA_RECORDING:-}"
fi

validate_server_url "$server"
curl -fsS "$server/health" >/dev/null || { echo "Staged BB server is not healthy at $server" >&2; exit 1; }

if [[ -z "$mini_ids" ]]; then
  if mini_ids="$(python3 -I scripts/seed-staged-minis.py "$server" 2>/dev/null)"; then
    echo "Seeded staged mini apps: $mini_ids"
  else
    echo "Note: could not seed staged mini apps (continuing without TEST_RUNNER_BBGO_QA_MINI_IDS)." >&2
    mini_ids=""
  fi
fi

if [[ -z "$device_id" ]]; then
  read -r sim_runtime sim_type < <(xcrun simctl list -j devicetypes runtimes | python3 -c '
import json, re, sys
data = json.load(sys.stdin)
kinds = {d["identifier"]: d["name"] for d in data["devicetypes"]}
runtimes = [r for r in data["runtimes"] if r.get("isAvailable") and r["identifier"].split(".")[-1].startswith("iOS")]
runtimes.sort(key=lambda r: [int(p) for p in r["version"].split(".")], reverse=True)
for rt in runtimes:
    names = [d["identifier"] for d in rt.get("supportedDeviceTypes", []) if kinds.get(d["identifier"], "").startswith("iPhone") and kinds.get(d["identifier"], "").endswith("Pro")]
    if names:
        model = lambda i: int(re.search(r"\d+", kinds[i]).group()) if re.search(r"\d+", kinds[i]) else 0
        print(rt["identifier"], max(names, key=model))
        sys.exit(0)
sys.exit("No available iPhone Pro simulator runtime found")
')
  created_sim="$(xcrun simctl create BBStagedTestPrivate "$sim_type" "$sim_runtime")"
  device_id="$created_sim"
  echo "Created private simulator: $device_id ($sim_type)"
fi

xcrun simctl boot "$device_id" 2>/dev/null || true
xcrun simctl bootstatus "$device_id" -b
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$device_id" defaults write "$domain" serverURL https://unit-tests.invalid
done

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  xcodegen generate -q
  xcodebuild build-for-testing -scheme "$scheme" -configuration "$configuration" -destination "id=$device_id" \
    -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -quiet
fi

only=()
for suite in "${suites[@]}"; do
  only+=("-only-testing:BBStudioUITests/$suite")
done

rm -rf "$result_bundle"
mkdir -p "$(dirname "$result_bundle")"

set +e
env TEST_RUNNER_BBGO_QA_SERVER="$server" \
    TEST_RUNNER_BBGO_QA_MINI_IDS="$mini_ids" \
    TEST_RUNNER_BBGO_QA_MINI="${qa_mini:-${TEST_RUNNER_BBGO_QA_MINI:-}}" \
    TEST_RUNNER_BBGO_QA_THREAD="${qa_thread:-${TEST_RUNNER_BBGO_QA_THREAD:-}}" \
    TEST_RUNNER_BBGO_QA_SENT_THREAD="${qa_sent_thread:-${TEST_RUNNER_BBGO_QA_SENT_THREAD:-}}" \
    TEST_RUNNER_BBGO_QA_PAGE="${qa_page:-${TEST_RUNNER_BBGO_QA_PAGE:-}}" \
    TEST_RUNNER_BBGO_QA_RECORDING="${qa_recording:-${TEST_RUNNER_BBGO_QA_RECORDING:-}}" \
    xcodebuild test-without-building -scheme "$scheme" -configuration "$configuration" -destination "id=$device_id" \
    -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -test-timeouts-enabled YES -default-test-execution-time-allowance 300 -maximum-test-execution-time-allowance 300 \
    -resultBundlePath "$result_bundle" \
    "${only[@]}" ${extra_args[@]+"${extra_args[@]}"}
status=$?
set -e

if [[ -d "$result_bundle" ]]; then
  echo "--- Staged UI test summary ($result_bundle) ---"
  xcrun xcresulttool get test-results summary --path "$result_bundle" || true
fi
exit "$status"
