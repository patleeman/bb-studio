#!/usr/bin/env bash
# Builds BB Studio (Debug, development signing) and installs it on a paired iPhone,
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

# devicectl's table changed between Xcode versions (B19); read its JSON instead.
# A connected phone first, else any paired one (devicectl connects on demand).
find_device() {
  local json
  json="$(mktemp)"
  xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1 || { rm -f "$json"; return 0; }
  python3 -I - "$json" <<'PY'
import json, sys
devices = json.load(open(sys.argv[1])).get("result", {}).get("devices", [])
phones = [d for d in devices
          if d.get("hardwareProperties", {}).get("reality") == "physical"
          and d.get("hardwareProperties", {}).get("deviceType") == "iPhone"
          and d.get("connectionProperties", {}).get("pairingState") == "paired"]
phones.sort(key=lambda d: d.get("connectionProperties", {}).get("tunnelState") in ("unavailable", None))
if phones:
    print(phones[0]["hardwareProperties"]["udid"])
PY
  rm -f "$json"
}
device="${DEVICE:-$(find_device)}"
[ -n "$device" ] || { echo "No paired iPhone is available. Unlock it, and connect it by cable or the same Wi-Fi." >&2; exit 1; }

out=build/device
log="$out/xcodebuild.log"
mkdir -p "$out"
xcodegen generate --quiet

echo "Building for $device (log: $log)…"
if ! xcodebuild build \
  -project BBStudio.xcodeproj -scheme BBStudio -configuration Debug -destination "id=$device" \
  -derivedDataPath "$out/DerivedData" -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  BB_DEFAULT_SERVER_URL="${BB_DEFAULT_SERVER_URL:-}" >"$log" 2>&1; then
  grep -E "error:" "$log" | sort -u | head -20 >&2
  echo "Build failed; see $log." >&2
  exit 1
fi

app="$out/DerivedData/Build/Products/Debug-iphoneos/BBStudio.app"
echo "Installing…"
xcrun devicectl device install app --device "$device" "$app" >/dev/null
xcrun devicectl device process launch --device "$device" nyc.plee.bbgo >/dev/null 2>&1 || true
echo "Installed and launched BB Studio on $device."
