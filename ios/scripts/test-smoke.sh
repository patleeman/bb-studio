#!/bin/sh
# The smoke set: the unit tests without the replay harness (about a minute)
# and the UI suites that cover the home you use, offline on the demo Bot
# (no server), in about ten minutes on an iPhone simulator. Run it on every
# change; the full UI suite and scripts/test-transcript.sh before a release.
#
#   BB_TEST_SIMULATOR_ID=<iphone> scripts/test-smoke.sh
#
# Point BB_TEST_SIMULATOR_ID at an iPhone Duo simulator to run the same set
# on the folded Duo. Set STAGED=1 to also run the staged-server UI suites via
# scripts/test-staged.sh (reusing this build). Set SKIP_BUILD=1 to reuse an
# existing build-for-testing DerivedData.
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
device="${BB_TEST_SIMULATOR_ID:?Set BB_TEST_SIMULATOR_ID to your private empty simulator}"
derived="${SMOKE_DERIVED_DATA:-build/smoke/DerivedData}"
xcrun simctl boot "$device" 2>/dev/null || true
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$device" defaults write "$domain" serverURL https://unit-tests.invalid
done
if [ "${SKIP_BUILD:-0}" != 1 ]; then
  xcodegen generate -q
  xcodebuild build-for-testing -scheme BBStudio -destination "id=$device" -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -quiet
fi

suites="
SpacesLoadingUITests
HomeUITests
OneListUITests
NewConversationUITests
ConversationsUITests
ApprovalsUITests
BotControlsUITests
LinksUITests
CaptureUITests
DesignZoomUITests
StrandsOverviewUITests
StrandFilterUITests
ReplyAskUITests
ComposerUITests
"
only=""
for suite in $suites; do only="$only -only-testing:BBStudioUITests/$suite"; done
xcodebuild test-without-building -scheme BBStudio -destination "id=$device" -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -test-timeouts-enabled YES \
  -only-testing:BBStudioTests -skip-testing:BBStudioTests/TranscriptReplayTests $only

if [ "${STAGED:-0}" = 1 ]; then
  SKIP_BUILD=1 STAGED_DERIVED_DATA="$derived" BB_TEST_SIMULATOR_ID="$device" scripts/test-staged.sh
fi
