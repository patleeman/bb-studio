#!/bin/sh
# The UIKit chat transcript (ios/iOS/Transcript): its state machine and
# anchor math, the replay harness on a phone and the Duo's outer and inner
# screens, and the UI tests of the Bot chat and a thread with it turned on.
# Offline: the app talks to no server (closed local fixtures only).
#
#   BB_TEST_SIMULATOR_ID=<iphone> BB_TEST_DUO_SIMULATOR_ID=<iphone duo> scripts/test-transcript.sh
#
# BB_TEST_DUO_SIMULATOR_ID is optional; without it only the phone runs.
# Starts with scripts/check-transcript-swift6.sh (Swift 6, no simulator).
# TEST_RUNNER_TRANSCRIPT_V2=1 puts any other UI suite on the new transcript.
# TRANSCRIPT_REPORT_DIR=<dir> keeps the replay's per-step JSON.
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
# The folder on its own, in Swift 6 mode: fails fast, before any build.
scripts/check-transcript-swift6.sh
xcodegen generate -q
phone="${BB_TEST_SIMULATOR_ID:?Set BB_TEST_SIMULATOR_ID to your private empty iPhone simulator}"
duo="${BB_TEST_DUO_SIMULATOR_ID:-}"
derived="${TRANSCRIPT_DERIVED_DATA:-build/transcript/DerivedData}"

isolate() {
  # The test host launches the app too: keep it away from any real server.
  xcrun simctl boot "$1" 2>/dev/null || true
  for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
    xcrun simctl spawn "$1" defaults write "$domain" serverURL https://unit-tests.invalid
  done
}

isolate "$phone"
if [ "${SKIP_BUILD:-0}" != 1 ]; then
  xcodegen generate -q
  xcodebuild build-for-testing -scheme BBStudio -destination "id=$phone" -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -quiet
fi

run_phone() {
  phone_failed=""
  report="${TRANSCRIPT_REPORT_DIR:-}"
  env TEST_RUNNER_TRANSCRIPT_REPORT_DIR="$report" xcodebuild test-without-building -test-timeouts-enabled YES -default-test-execution-time-allowance 300 -maximum-test-execution-time-allowance 300 -scheme BBStudio -destination "id=$phone" \
    -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO \
    -only-testing:BBStudioTests/TranscriptFollowTests -only-testing:BBStudioTests/TranscriptReplayTests \
    -only-testing:BBStudioUITests/TranscriptV2UITests -only-testing:BBStudioUITests/TranscriptScrollHoldUITests \
    || phone_failed="$phone_failed
  - phone: transcript unit, replay, and UI tests"
  if [ -n "$phone_failed" ]; then
    echo "Phone transcript failures:$phone_failed" >&2
    return 1
  fi
}

run_duo() {
  duo_failed=""
  isolate "$duo"
  for layout in outer outer-room split; do
    env TEST_RUNNER_TRANSCRIPT_LAYOUT="$layout" xcodebuild test-without-building -test-timeouts-enabled YES -default-test-execution-time-allowance 300 -maximum-test-execution-time-allowance 300 -scheme BBStudio -destination "id=$duo" \
      -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -only-testing:BBStudioUITests/TranscriptV2UITests \
      || duo_failed="$duo_failed
  - duo $layout: TranscriptV2UITests"
  done
  xcodebuild test-without-building -test-timeouts-enabled YES -default-test-execution-time-allowance 300 -maximum-test-execution-time-allowance 300 -scheme BBStudio -destination "id=$duo" \
    -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -only-testing:BBStudioUITests/DuoSplitComposerUITests \
    || duo_failed="$duo_failed
  - duo: DuoSplitComposerUITests"
  if [ -n "$duo_failed" ]; then
    echo "Duo transcript failures:$duo_failed" >&2
    return 1
  fi
}

rc=0
if [ -n "$duo" ]; then
  run_phone &
  pid_phone=$!
  run_duo &
  pid_duo=$!
  wait "$pid_phone" || rc=1
  wait "$pid_duo" || rc=1
else
  run_phone || rc=1
fi

if [ "$rc" -ne 0 ]; then
  exit 1
fi
echo "Transcript tests passed."
