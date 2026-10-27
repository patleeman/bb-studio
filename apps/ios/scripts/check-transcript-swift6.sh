#!/bin/sh
# apps/ios/iOS/Transcript is meant to move to a package unchanged, and a
# second app (Kensico) builds it in Swift 6 language mode. This typechecks
# the folder on its own, in Swift 6 mode with warnings as errors, both as
# shipped and with DEBUG (the replay harness): no app imports, no
# concurrency diagnostics. No simulator needed.
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
for flags in "" "-DDEBUG"; do
  # shellcheck disable=SC2086
  xcrun -sdk iphonesimulator swiftc -typecheck -swift-version 6 -warnings-as-errors $flags \
    -sdk "$sdk" -target arm64-apple-ios26.0-simulator iOS/Transcript/*.swift
done
echo "Transcript: Swift 6, no warnings (release and DEBUG)."
