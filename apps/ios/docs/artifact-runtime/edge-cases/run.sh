#!/bin/bash
# Requires the isolated staged BB. Creates and removes only its own empty device/fixtures.
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
[[ "${BB_ARTIFACT_QA_SERVER_URL:-}" == http://127.0.0.1:49486 ]] || exit 1
[[ "${BB_DATA_DIR:-}" == /tmp/bb-studio-goal-staged/data ]] || exit 1
qa_dir=$(cd "$(dirname "$0")" && pwd)
ios_dir=$(cd "$qa_dir/../../.." && pwd)
export BB_ARTIFACT_QA_RUN_DIR=$(mktemp -d /tmp/bb-artifact-edge.XXXXXX)
export BB_ARTIFACT_QA_DEVICE=$(xcrun simctl create BBArtifactEdgePrivate com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
proxy_pid=""
cleanup() {
  if [[ -n "$proxy_pid" ]]; then kill "$proxy_pid" 2>/dev/null || true; fi
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
source_dir="$ios_dir"
if [[ -n "${BB_ARTIFACT_QA_SOURCE_COPY:-}" ]]; then
  [[ "$BB_ARTIFACT_QA_SOURCE_COPY" == /tmp/bb-artifact-edge.*/project ]] || exit 1
  [[ -f "$BB_ARTIFACT_QA_SOURCE_COPY/Shared/BBClient.swift" ]] || exit 1
  source_dir="$BB_ARTIFACT_QA_SOURCE_COPY"
fi
rsync -a --exclude='*.xcodeproj' --exclude='build' --exclude='UITests' --exclude='docs' "$source_dir/" "$BB_ARTIFACT_QA_RUN_DIR/project/"
shasum -a 256 "$BB_ARTIFACT_QA_RUN_DIR/project/iOS/Studio/ArtifactView.swift" "$BB_ARTIFACT_QA_RUN_DIR/project/iOS/Studio/ArtifactPDFPreview.swift" "$BB_ARTIFACT_QA_RUN_DIR/project/iOS/Studio/ArtifactWebPreview.swift" > "$BB_ARTIFACT_QA_RUN_DIR/source-sha256.txt"
cp "$ios_dir/UITests/ArtifactRuntimeUITests.swift" "$BB_ARTIFACT_QA_RUN_DIR/project/UITests/"
python3 - <<'PY'
import os
from pathlib import Path
for name in ['Shared/AppGroup.swift','Shared/BBClient.swift']:
 p=Path(os.environ['BB_ARTIFACT_QA_RUN_DIR'])/'project'/name
 s=p.read_text().replace('https://patricks-megamac.tail5a01ec.ts.net','http://127.0.0.1:49626')
 if name.endswith('BBClient.swift') and 'QA origin must remain isolated' not in s:
  s=s.replace('self.baseURL = baseURL','precondition(baseURL.absoluteString == "http://127.0.0.1:49626", "QA origin must remain isolated")\n        self.baseURL = baseURL')
 p.write_text(s)
PY
python3 "$qa_dir/../seed.py"
python3 "$qa_dir/seed.py"
python3 "$qa_dir/proxy.py" > "$BB_ARTIFACT_QA_RUN_DIR/proxy.log" 2>&1 &
proxy_pid=$!
sleep 1
kill -0 "$proxy_pid"
curl -fsS http://127.0.0.1:49626/__edge/status > "$BB_ARTIFACT_QA_RUN_DIR/proxy-before.json"
xcodegen generate --spec "$BB_ARTIFACT_QA_RUN_DIR/project/project.yml"
xcodebuild -project "$BB_ARTIFACT_QA_RUN_DIR/project/BBStudio.xcodeproj" -scheme BBStudio -configuration Debug -destination "platform=iOS Simulator,id=$BB_ARTIFACT_QA_DEVICE" -derivedDataPath "$BB_ARTIFACT_QA_RUN_DIR/build" build-for-testing > "$BB_ARTIFACT_QA_RUN_DIR/build.log" 2>&1
python3 "$qa_dir/configure.py" | tee "$BB_ARTIFACT_QA_RUN_DIR/origin-verification.txt"
xctestrun=$(find "$BB_ARTIFACT_QA_RUN_DIR/build/Build/Products" -maxdepth 1 -name '*.xctestrun' -print)
set +e
IFS=',' read -r -a test_names <<< "${BB_ARTIFACT_QA_TESTS:-testHealthyNativePreviews,testReadablePDFRendersPages,testCorruptHeaderPDFShowsRecoveryAction,testInitialLookupCanRetry,testDelayedVersionCannotReplaceSelection,testLockedPDFOffersShare}"
test_options=()
for test_name in "${test_names[@]}"; do
  case "$test_name" in
    testHealthyNativePreviews|testReadablePDFRendersPages|testCorruptHeaderPDFShowsRecoveryAction|testInitialLookupCanRetry|testDelayedVersionCannotReplaceSelection|testLockedPDFOffersShare) ;;
    *) printf 'Unsupported private test: %s\n' "$test_name" >&2; exit 1 ;;
  esac
  test_options+=("-only-testing:BBStudioUITests/ArtifactRuntimeUITests/$test_name")
done
xcodebuild test-without-building -xctestrun "$xctestrun" -destination "platform=iOS Simulator,id=$BB_ARTIFACT_QA_DEVICE" "${test_options[@]}" -parallel-testing-enabled NO -resultBundlePath "$BB_ARTIFACT_QA_RUN_DIR/results.xcresult" > "$BB_ARTIFACT_QA_RUN_DIR/test.log" 2>&1
test_exit=$?
set -e
xcrun xcresulttool get test-results summary --path "$BB_ARTIFACT_QA_RUN_DIR/results.xcresult" > "$BB_ARTIFACT_QA_RUN_DIR/summary.json"
xcrun xcresulttool export attachments --path "$BB_ARTIFACT_QA_RUN_DIR/results.xcresult" --output-path "$BB_ARTIFACT_QA_RUN_DIR/attachments"

curl -fsS http://127.0.0.1:49626/__edge/status > "$BB_ARTIFACT_QA_RUN_DIR/proxy-after.json"
exit "$test_exit"
