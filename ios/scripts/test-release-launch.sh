#!/bin/sh
# The launch-crash check on the app as it ships: LaunchStackUITests on a
# Release build (optimized, no DEBUG demos), linked with the device's 1 MB
# main stack (project.yml). TestFlight 20261126.0313 crashed on every launch
# that way and the Debug suites didn't see it. The app opens the Bot and a
# thread of an isolated staged BB by deep link: offline, a Release build has
# nothing to open.
#
#   BB_TEST_SIMULATOR_ID=<iphone or duo> scripts/test-release-launch.sh
#
# Builds the BBStudioUITests scheme (the UI tests alone: the unit tests need
# Debug's testability), then runs it through scripts/test-staged.sh, which
# starts the staged BB (or uses TEST_RUNNER_BBGO_QA_SERVER). SKIP_BUILD=1
# reuses RELEASE_DERIVED_DATA. Run it before every TestFlight upload.
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
derived="${RELEASE_DERIVED_DATA:-build/release/DerivedData}"
TEST_RUNNER_BB_RELEASE_BUILD=1 STAGED_SCHEME=BBStudioUITests STAGED_CONFIGURATION=Release \
  STAGED_DERIVED_DATA="$derived" STAGED_XCRESULT="${RELEASE_XCRESULT:-build/release/launch.xcresult}" \
  exec scripts/test-staged.sh --suite LaunchStackUITests
