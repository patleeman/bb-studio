#!/bin/sh
# The smoke set: the unit tests without the replay harness (about a minute)
# and the UI suites that cover the home you use, offline on the demo Bot
# (no server), in about ten minutes on an iPhone simulator. Run it on every
# change; the full UI suite and scripts/test-transcript.sh before a release.
#
#   BB_TEST_SIMULATOR_ID=<iphone> scripts/test-smoke.sh
#
# Point BB_TEST_SIMULATOR_ID at an iPhone Duo simulator to run the same set
# on the folded Duo.
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcodegen generate -q
device="${BB_TEST_SIMULATOR_ID:?Set BB_TEST_SIMULATOR_ID to your private empty simulator}"
derived="${SMOKE_DERIVED_DATA:-build/smoke/DerivedData}"
xcrun simctl boot "$device" 2>/dev/null || true
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$device" defaults write "$domain" serverURL https://unit-tests.invalid
done
xcodebuild build-for-testing -scheme BBStudio -destination "id=$device" -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -quiet

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
xcodebuild test-without-building -scheme BBStudio -destination "id=$device" -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO \
  -only-testing:BBStudioTests -skip-testing:BBStudioTests/TranscriptReplayTests $only
