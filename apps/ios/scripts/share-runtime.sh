#!/bin/bash
# Read-only Share checks against the isolated staged BB. Never reuse a device.
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fixture=http://127.0.0.1:49486
repo_ios=$(cd "$(dirname "$0")/.." && pwd)
: "${BB_SHARE_QA_SERVER_URL:?Set BB_SHARE_QA_SERVER_URL=http://127.0.0.1:49486}"
[[ "$BB_SHARE_QA_SERVER_URL" == "$fixture" ]] || exit 1
command -v xcodegen >/dev/null
curl -fsS "$fixture/api/v1/projects" | python3 -c 'import json,sys; assert any(p["name"] == "Share Runtime QA" for p in json.load(sys.stdin)), "Create the dedicated staged Share Runtime QA project first"'
run_dir=$(mktemp -d /tmp/bb-share-runtime.XXXXXX)
device_id=$(xcrun simctl create BBShareRuntimePrivate com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
cleanup() {
  xcrun simctl shutdown "$device_id" >/dev/null 2>&1 || true
  xcrun simctl delete "$device_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT
printf 'Share runtime artifacts: %s\nPrivate simulator: %s\n' "$run_dir" "$device_id"
xcrun simctl boot "$device_id"
mkdir -p "$run_dir/project/UITests" "$run_dir/host"
cp "$repo_ios/project.yml" "$run_dir/project/project.yml"
for path in iOS Shared Share LiveActivity Watch WatchWidgets Widgets NotificationService Tests; do
  ln -s "$repo_ios/$path" "$run_dir/project/$path"
done
ln -s "$repo_ios/UITests/ShareRuntimeUITests.swift" "$run_dir/project/UITests/ShareRuntimeUITests.swift"
cp "$repo_ios/docs/share-runtime/fixture-host/Host.swift" "$run_dir/host/Host.swift"
cp "$repo_ios/docs/share-runtime/fixture-host/project.yml" "$run_dir/host/project.yml"
xcodegen generate --spec "$run_dir/project/project.yml"
xcodegen generate --spec "$run_dir/host/project.yml"
xcodebuild -project "$run_dir/project/BBStudio.xcodeproj" -scheme BBStudio -configuration Debug -destination "platform=iOS Simulator,id=$device_id" -derivedDataPath "$run_dir/build" build-for-testing > "$run_dir/build.log" 2>&1
xcodebuild -project "$run_dir/host/ShareRuntimeHost.xcodeproj" -scheme ShareRuntimeHost -configuration Debug -destination "platform=iOS Simulator,id=$device_id" -derivedDataPath "$run_dir/host-build" build > "$run_dir/host-build.log" 2>&1
xcrun simctl install "$device_id" "$run_dir/build/Build/Products/Debug-iphonesimulator/BBStudio.app"
xcrun simctl install "$device_id" "$run_dir/host-build/Build/Products/Debug-iphonesimulator/ShareRuntimeHost.app"
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$device_id" defaults write "$domain" serverURL -string "$fixture"
  [[ "$(xcrun simctl spawn "$device_id" defaults read "$domain" serverURL)" == "$fixture" ]]
done
app_data=$(xcrun simctl get_app_container "$device_id" nyc.plee.bbgo data)
group_data=$(xcrun simctl get_app_container "$device_id" nyc.plee.bbgo group.nyc.plee.bbgo)
python3 - "$app_data" "$group_data" "$run_dir" <<'PY'
import plistlib, sys
from pathlib import Path
origin = 'http://127.0.0.1:49486'
app, group, run = map(Path, sys.argv[1:])
for folder, domain in [(app, 'nyc.plee.bbgo'), (group, 'group.nyc.plee.bbgo')]:
    path = folder / 'Library/Preferences' / (domain + '.plist')
    path.parent.mkdir(parents=True, exist_ok=True)
    values = plistlib.loads(path.read_bytes()) if path.exists() else {}
    values['serverURL'] = origin
    path.write_bytes(plistlib.dumps(values))
    assert plistlib.loads(path.read_bytes())['serverURL'] == origin
    print(f'Confirmed {domain}: {origin}')
plists = list((run / 'build/Build/Products').glob('*.xctestrun'))
assert len(plists) == 1
path = plists[0]
values = plistlib.loads(path.read_bytes())
if 'BBStudioUITests' in values:
    target = values['BBStudioUITests']
else:
    targets = [t for c in values['TestConfigurations'] for t in c['TestTargets'] if t['BlueprintName'] == 'BBStudioUITests']
    assert len(targets) == 1
    target = targets[0]
target.setdefault('EnvironmentVariables', {}).update(BB_SHARE_QA_SERVER_URL=origin, BB_SHARE_QA_PRIVATE_SIM='YES')
path.write_bytes(plistlib.dumps(values))
PY
xctestrun=$(find "$run_dir/build/Build/Products" -maxdepth 1 -name '*.xctestrun' -print)
xcodebuild test-without-building -xctestrun "$xctestrun" -destination "platform=iOS Simulator,id=$device_id" -only-testing:BBStudioUITests/ShareRuntimeUITests -parallel-testing-enabled NO -resultBundlePath "$run_dir/share-runtime.xcresult" > "$run_dir/test.log" 2>&1
xcrun xcresulttool get test-results summary --path "$run_dir/share-runtime.xcresult" > "$run_dir/summary.json"
xcrun xcresulttool export attachments --path "$run_dir/share-runtime.xcresult" --output-path "$run_dir/attachments"
printf 'Verified results and screenshots: %s\n' "$run_dir"
