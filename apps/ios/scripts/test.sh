#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodegen generate -q
device_id="${BB_TEST_SIMULATOR_ID:?Set BB_TEST_SIMULATOR_ID to your private simulator clone}"
xcodebuild test -scheme BBStudio -destination "id=$device_id" \
  -derivedDataPath build/system/DerivedData -only-testing:BBStudioTests "$@"
