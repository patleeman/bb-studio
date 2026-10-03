#!/bin/bash
# Requires the isolated staged BB. Creates and removes only its own empty device/fixtures.
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
[[ "${BB_ARTIFACT_QA_SERVER_URL:-}" == http://127.0.0.1:49486 ]] || exit 1
[[ "${BB_DATA_DIR:-}" == /tmp/bb-studio-goal-staged/data ]] || exit 1
qa_dir=$(cd "$(dirname "$0")" && pwd)
ios_dir=$(cd "$qa_dir/../.." && pwd)
export BB_ARTIFACT_QA_RUN_DIR=$(mktemp -d /tmp/bb-artifact-runtime.XXXXXX)
export BB_ARTIFACT_QA_DEVICE=$(xcrun simctl create BBArtifactRuntimePrivate com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
cleanup() {
  xcrun simctl shutdown "$BB_ARTIFACT_QA_DEVICE" >/dev/null 2>&1 || true
  xcrun simctl delete "$BB_ARTIFACT_QA_DEVICE" >/dev/null 2>&1 || true
  python3 - <<'PY'
import os,json,urllib.request
from pathlib import Path
p=Path(os.environ['BB_ARTIFACT_QA_RUN_DIR'])/'fixtures.json'
if p.exists():
 for fixture in json.loads(p.read_text()).values():
  request=urllib.request.Request('http://127.0.0.1:49486/api/v1/plugins/artifacts/rpc/delete',data=json.dumps({'id':fixture['id']}).encode(),headers={'Content-Type':'application/json'})
  urllib.request.urlopen(request).read()
PY
}
trap cleanup EXIT
printf 'Private artifact runtime evidence: %s\n' "$BB_ARTIFACT_QA_RUN_DIR"
xcrun simctl boot "$BB_ARTIFACT_QA_DEVICE"
mkdir -p "$BB_ARTIFACT_QA_RUN_DIR/project/UITests"
rsync -a --exclude='*.xcodeproj' --exclude='build' --exclude='UITests' --exclude='docs' "$ios_dir/" "$BB_ARTIFACT_QA_RUN_DIR/project/"
cp "$ios_dir/UITests/ArtifactRuntimeUITests.swift" "$BB_ARTIFACT_QA_RUN_DIR/project/UITests/"
python3 - <<'PY'
import os
from pathlib import Path
for name in ['Shared/AppGroup.swift','Shared/BBClient.swift']:
 p=Path(os.environ['BB_ARTIFACT_QA_RUN_DIR'])/'project'/name
 p.write_text(p.read_text().replace('https://patricks-megamac.tail5a01ec.ts.net','http://127.0.0.1:49486'))
PY
python3 "$qa_dir/seed.py"
xcodegen generate --spec "$BB_ARTIFACT_QA_RUN_DIR/project/project.yml"
xcodebuild -project "$BB_ARTIFACT_QA_RUN_DIR/project/BBStudio.xcodeproj" -scheme BBStudio -configuration Debug -destination "platform=iOS Simulator,id=$BB_ARTIFACT_QA_DEVICE" -derivedDataPath "$BB_ARTIFACT_QA_RUN_DIR/build" build-for-testing > "$BB_ARTIFACT_QA_RUN_DIR/build.log" 2>&1
python3 "$qa_dir/configure.py"
xctestrun=$(find "$BB_ARTIFACT_QA_RUN_DIR/build/Build/Products" -maxdepth 1 -name '*.xctestrun' -print)
xcodebuild test-without-building -xctestrun "$xctestrun" -destination "platform=iOS Simulator,id=$BB_ARTIFACT_QA_DEVICE" -only-testing:BBStudioUITests/ArtifactRuntimeUITests -parallel-testing-enabled NO -resultBundlePath "$BB_ARTIFACT_QA_RUN_DIR/results.xcresult" > "$BB_ARTIFACT_QA_RUN_DIR/test.log" 2>&1
xcrun xcresulttool get test-results summary --path "$BB_ARTIFACT_QA_RUN_DIR/results.xcresult" > "$BB_ARTIFACT_QA_RUN_DIR/summary.json"
xcrun xcresulttool export attachments --path "$BB_ARTIFACT_QA_RUN_DIR/results.xcresult" --output-path "$BB_ARTIFACT_QA_RUN_DIR/attachments"
