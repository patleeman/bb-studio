#!/usr/bin/env bash
# Archives BB Go (with the watch app and extensions) and uploads it to TestFlight.
#
#   scripts/testflight.sh                 archive, sign, and upload
#   scripts/testflight.sh --archive-only  signed archive, no upload (registers bundle IDs and the app group)
#   scripts/testflight.sh --dry-run       unsigned Release archive only
#
# Signing and upload use the Apple ID signed into Xcode (Settings → Accounts).
# An App Store Connect API key can't manage App Groups, so it can't sign this app.
# BUILD_NUMBER overrides the build number, which defaults to the UTC time
# (YYYYMMDD.HHMM), so every upload is higher than the last.
set -euo pipefail

cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

dry_run=false
archive_only=false
case "${1:-}" in
  --dry-run) dry_run=true ;;
  --archive-only) archive_only=true ;;
  "") ;;
  *) echo "usage: $0 [--dry-run | --archive-only]" >&2; exit 2 ;;
esac

team_id=3753DAN98U
out=build/testflight
build_number="${BUILD_NUMBER:-$(date -u +%Y%m%d.%H%M)}"
archive="$out/BBGo-$build_number.xcarchive"
log="$out/xcodebuild-$build_number.log"

mkdir -p "$out"
xcodegen generate --quiet

signing=(-allowProvisioningUpdates)
$dry_run && signing=(CODE_SIGNING_ALLOWED=NO)

echo "Archiving build $build_number (log: $log)…"
if ! xcodebuild archive \
  -project BBGo.xcodeproj -scheme BBGo -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive" "${signing[@]}" \
  CURRENT_PROJECT_VERSION="$build_number" DEVELOPMENT_TEAM="$team_id" >"$log" 2>&1; then
  grep -E "error:" "$log" | sort -u | head -20 >&2
  echo "Archive failed; see $log. If signing failed, check Xcode → Settings → Accounts." >&2
  exit 1
fi

if $dry_run || $archive_only; then
  echo "Archive at $archive. Nothing was uploaded."
  exit 0
fi

options="$out/ExportOptions.plist"
cat >"$options" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$team_id</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

echo "Uploading to App Store Connect…"
if ! xcodebuild -exportArchive \
  -archivePath "$archive" -exportOptionsPlist "$options" -exportPath "$out/export-$build_number" \
  -allowProvisioningUpdates >>"$log" 2>&1; then
  grep -E "error:" "$log" | sort -u | head -20 >&2
  echo "Upload failed; see $log." >&2
  exit 1
fi

echo "Uploaded build $build_number. It appears in TestFlight once Apple finishes processing (usually 10–20 minutes)."
