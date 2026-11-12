#!/bin/sh
# ios/iOS/VoiceLive/Core is hands-free voice's pure core: the wire
# events, the session state machine and the audio session rules. It has no
# app imports, so it typechecks on its own in Swift 6 language mode with
# warnings as errors (no concurrency diagnostics). No simulator needed.
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
for flags in "" "-DDEBUG"; do
  # shellcheck disable=SC2086
  xcrun -sdk iphonesimulator swiftc -typecheck -swift-version 6 -warnings-as-errors $flags \
    -sdk "$sdk" -target arm64-apple-ios26.0-simulator iOS/VoiceLive/Core/*.swift
done
echo "VoiceLive core: Swift 6, no warnings (release and DEBUG)."
