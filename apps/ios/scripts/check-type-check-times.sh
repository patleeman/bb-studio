#!/bin/sh
# Fails if any function body or expression in the app takes longer than
# TYPE_CHECK_LIMIT_MS (default 1500) to type-check. A body that slow on this
# Xcode can be one an older or slower one (CI's Xcode 26) gives up on:
# "unable to type-check this expression in reasonable time". Split it into
# typed subviews or properties. Locally everything is under 500 ms.
#
#   scripts/check-type-check-times.sh            # 1500 ms
#   TYPE_CHECK_LIMIT_MS=500 scripts/check-type-check-times.sh
#
# A clean build of the app and its test targets for the simulator; no simulator needed.
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
limit="${TYPE_CHECK_LIMIT_MS:-1500}"
derived="${TYPE_CHECK_DERIVED_DATA:-build/type-check/DerivedData}"
log="${TMPDIR:-/tmp}/bbstudio-type-check.log"
xcodegen generate -q
rm -rf "$derived"
xcodebuild build-for-testing -scheme BBStudio -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO \
  OTHER_SWIFT_FLAGS="\$(inherited) -Xfrontend -warn-long-function-bodies=$limit -Xfrontend -warn-long-expression-type-checking=$limit" \
  > "$log" 2>&1 || {
    # The compiler's own errors first: a build that fails to type-check names the line here.
    grep -E '^/.*: error: ' "$log" | sed 's#^.*/apps/ios/##' | sort -u
    tail -20 "$log"; echo "Build failed (log: $log)"; exit 1; }
slow=$(grep -E '^/.*warning: .*ms to type-check' "$log" | sed 's#^.*/apps/ios/##' | sort -u || true)
if [ -n "$slow" ]; then
  echo "Over ${limit} ms to type-check (split these into typed subviews or properties):"
  echo "$slow"
  exit 1
fi
echo "Type-check times: nothing over ${limit} ms."
