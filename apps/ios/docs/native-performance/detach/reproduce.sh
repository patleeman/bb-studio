#!/bin/bash
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
[[ "${BB_DETACH_QA_SERVER_URL:-}" == http://127.0.0.1:49486 ]] || exit 1
here=$(cd "$(dirname "$0")" && pwd)
ios=$(cd "$here/../../.." && pwd)
run=$(mktemp -d /tmp/bb-page-detach.XXXXXX)
sim=$(xcrun simctl create BBPageDetachPrivate com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
cleanup() {
  python3 "$here/cleanup.py" "$run"
  xcrun simctl shutdown "$sim" >/dev/null 2>&1 || true
  xcrun simctl delete "$sim" >/dev/null 2>&1 || true
}
trap cleanup EXIT
printf 'Evidence: %s\nPrivate simulator: %s\n' "$run" "$sim"
python3 - "$ios" "$run" "$here" <<'PY'
import pathlib,shutil,sys
source,out,here=map(pathlib.Path,sys.argv[1:]); dest=out/'project'
shutil.copytree(source,dest,ignore=shutil.ignore_patterns('build','BBStudio.xcodeproj','BBStudio.xcworkspace'))
for name in ['Shared/AppGroup.swift','Shared/BBClient.swift']:
    p=dest/name; text=p.read_text(); old='https://patricks-megamac.tail5a01ec.ts.net'; assert old in text
    p.write_text(text.replace(old,'http://127.0.0.1:49486'))
shutil.copy(here/'PageModelDetachTests.swift',dest/'Tests/PageModelDetachTests.swift')
PY
xcrun simctl boot "$sim"
xcodegen generate --spec "$run/project/project.yml"
xcodebuild -project "$run/project/BBStudio.xcodeproj" -scheme BBStudio -configuration Debug -destination "platform=iOS Simulator,id=$sim" -derivedDataPath "$run/build" build-for-testing > "$run/build.log" 2>&1
python3 "$here/prepare.py" "$run" "$sim"
xcodebuild test-without-building -xctestrun "$run/build/Build/Products/detach.xctestrun" -destination "platform=iOS Simulator,id=$sim" -only-testing:BBStudioTests/PageModelDetachTests -parallel-testing-enabled NO -resultBundlePath "$run/result.xcresult" > "$run/test.log" 2>&1
xcrun xcresulttool get test-results summary --path "$run/result.xcresult" > "$run/summary.json"
