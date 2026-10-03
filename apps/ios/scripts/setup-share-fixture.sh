#!/bin/bash
# The parent isolated runner validates the temporary staged server and simulator.
set -euo pipefail
run_dir=$1
mkdir -p "$run_dir/share-host"
cp docs/share-runtime/fixture-host/{Host.swift,project.yml} "$run_dir/share-host/"
xcodegen generate --spec "$run_dir/share-host/project.yml" -q
xcodebuild -project "$run_dir/share-host/ShareRuntimeHost.xcodeproj" -scheme ShareRuntimeHost \
  -destination "id=$BB_TEST_SIMULATOR_ID" -derivedDataPath "$run_dir/share-host-build" build \
  > "$run_dir/share-host-build.log" 2>&1
xcrun simctl install "$BB_TEST_SIMULATOR_ID" "$run_dir/DerivedData/Build/Products/Debug-iphonesimulator/BBStudio.app"
xcrun simctl install "$BB_TEST_SIMULATOR_ID" "$run_dir/share-host-build/Build/Products/Debug-iphonesimulator/ShareRuntimeHost.app"
app_data=$(xcrun simctl get_app_container "$BB_TEST_SIMULATOR_ID" nyc.plee.bbgo data)
group_data=$(xcrun simctl get_app_container "$BB_TEST_SIMULATOR_ID" nyc.plee.bbgo group.nyc.plee.bbgo)
python3 - "$app_data" "$group_data" <<'PY'
import os, plistlib, sys
from pathlib import Path
origin = os.environ['BB_QA_SERVER_URL']
for folder, domain in zip(map(Path, sys.argv[1:]), ['nyc.plee.bbgo', 'group.nyc.plee.bbgo']):
    path = folder / 'Library/Preferences' / (domain + '.plist')
    path.parent.mkdir(parents=True, exist_ok=True)
    values = plistlib.loads(path.read_bytes()) if path.exists() else {}
    values['serverURL'] = origin
    path.write_bytes(plistlib.dumps(values))
    assert plistlib.loads(path.read_bytes())['serverURL'] == origin
PY
