#!/usr/bin/env bash
# Builds BB Go (Debug, development signing) and installs it on a paired iPhone,
# replacing the TestFlight build. Much faster than a TestFlight round trip.
#
#   scripts/device.sh            build, install, and launch on the paired iPhone
#   DEVICE=<udid> scripts/device.sh
#
# The phone must be unlocked the first time, with Developer Mode on. Development
# builds get sandbox push tokens; the relay's `auto` environment handles both.
set -euo pipefail

cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

device="${DEVICE:-$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /iPhone/ && /available|connected/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) { print $i; exit } }')}"
[ -n "$device" ] || { echo "No paired iPhone is available. Unlock it, and connect it by cable or the same Wi-Fi." >&2; exit 1; }

out=build/device
log="$out/xcodebuild.log"
mkdir -p "$out"
xcodegen generate --quiet

echo "Building for $device (log: $log)…"
if ! xcodebuild build \
  -project BBGo.xcodeproj -scheme BBGo -configuration Debug -destination "id=$device" \
  -derivedDataPath "$out/DerivedData" -allowProvisioningUpdates -allowProvisioningDeviceRegistration >"$log" 2>&1; then
  grep -E "error:" "$log" | sort -u | head -20 >&2
  echo "Build failed; see $log." >&2
  exit 1
fi

app="$out/DerivedData/Build/Products/Debug-iphoneos/BBGo.app"
echo "Installing…"
xcrun devicectl device install app --device "$device" "$app" >/dev/null
xcrun devicectl device process launch --device "$device" nyc.plee.bbgo >/dev/null 2>&1 || true
echo "Installed and launched BB Go on $device."
