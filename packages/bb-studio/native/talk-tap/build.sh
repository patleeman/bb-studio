#!/bin/sh
# Builds bb-talk-tap for Studio: universal (arm64 + x86_64), macOS 14.2+,
# Info.plist embedded, stripped, ad-hoc signed. Writes ../../bin/bb-talk-tap
# and ../../bin/bb-talk-tap.sha256 (shasum format), which Studio's server
# checks before running the helper.
#
# Reproducible: dependencies are pinned in Package.resolved, there is no debug
# info, and an ad-hoc signature has no timestamp. Swift still bakes the length
# of each source path into release code, so the build always runs from a copy
# at one fixed path. The same source and Xcode then give the same bytes,
# wherever the checkout is.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
bin="$here/../../bin"
out="$bin/bb-talk-tap"
work=/tmp/bb-talk-tap-build
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

mkdir -p "$work/src"
rsync -a --delete --exclude .build --exclude .swiftpm "$here/" "$work/src/"
cd "$work/src"

slices=""
for arch in arm64 x86_64; do
  set -- -c release --product bb-talk-tap \
    --triple "$arch-apple-macosx14.2" \
    --scratch-path "$work/$arch" \
    --disable-automatic-resolution \
    -Xswiftc -gnone -Xcc -g0
  swift build "$@"
  slices="$slices $(swift build "$@" --show-bin-path)/bb-talk-tap"
done

tmp="$work/bb-talk-tap"
# shellcheck disable=SC2086
lipo -create $slices -output "$tmp"
strip -S -x "$tmp"
codesign --force --sign - --identifier dev.bbstudio.talk-tap "$tmp"
chmod 755 "$tmp"
mkdir -p "$bin"
mv -f "$tmp" "$out"

(cd "$bin" && shasum -a 256 bb-talk-tap > bb-talk-tap.sha256)
lipo -archs "$out"
cat "$bin/bb-talk-tap.sha256"
