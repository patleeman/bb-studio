#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodegen generate -q
device_id="${BB_TEST_SIMULATOR_ID:?Set BB_TEST_SIMULATOR_ID to your private empty simulator}"
# The unit-test host launches the app too. Keep its background requests away
# from the user's server, including after tests temporarily change the origin.
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$device_id" defaults write "$domain" serverURL http://127.0.0.1:1
done
xcodebuild test -scheme BBStudio -destination "id=$device_id" \
  -derivedDataPath build/system/DerivedData -only-testing:BBStudioTests "$@"
