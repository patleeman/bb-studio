#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodegen generate -q
device_id="${BB_TEST_SIMULATOR_ID:?Set BB_TEST_SIMULATOR_ID to your private empty simulator}"
# The unit-test host launches the app too. Keep its background requests away
# from the user's server, including after tests temporarily change the origin.
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$device_id" defaults write "$domain" serverURL https://unit-tests.invalid
done
# The three transcript replay tests take about 12 minutes of the run's 13:
# they run in scripts/test-transcript.sh, and here only with REPLAY=1.
skip_replay="-skip-testing:BBStudioTests/TranscriptReplayTests"
if [ "${REPLAY:-0}" = 1 ]; then skip_replay=""; fi
xcodebuild test -scheme BBStudio -destination "id=$device_id" \
  -derivedDataPath build/system/DerivedData -only-testing:BBStudioTests $skip_replay "$@"
