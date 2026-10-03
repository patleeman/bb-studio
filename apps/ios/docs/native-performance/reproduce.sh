#!/bin/bash
# All application and runner defaults point at staged BB before the first launch.
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fixture=http://127.0.0.1:49486
[[ "${BB_PERFORMANCE_QA_SERVER_URL:-}" == "$fixture" ]] || {
  printf 'Set BB_PERFORMANCE_QA_SERVER_URL=%s\n' "$fixture" >&2; exit 1;
}
repo_ios=$(cd "$(dirname "$0")/../.." && pwd)
run_dir=$(mktemp -d /tmp/bb-native-performance.XXXXXX)
device_id=$(xcrun simctl create BBNativePerformancePrivate com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
cleanup() {
  python3 - "$run_dir" <<'PY'
import json,pathlib,sys,urllib.request
path=pathlib.Path(sys.argv[1])/'fixture-ids.json'
for id in json.loads(path.read_text()) if path.exists() else []:
    request=urllib.request.Request('http://127.0.0.1:49486/api/v1/plugins/pages/rpc/remove',data=json.dumps({'id':id}).encode(),headers={'Content-Type':'application/json'})
    try:
        response=json.load(urllib.request.urlopen(request,timeout=10))
        assert response['ok'],response
    except Exception as error:
        print('Cleanup failed for owned fixture',id,error,file=sys.stderr)
PY
  xcrun simctl shutdown "$device_id" >/dev/null 2>&1 || true
  xcrun simctl delete "$device_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT
printf 'Evidence: %s\nPrivate simulator: %s\n' "$run_dir" "$device_id"
python3 - "$repo_ios" "$run_dir" <<'PY'
import json,pathlib,shutil,sys,urllib.request
source,out=map(pathlib.Path,sys.argv[1:]); dest=out/'project'
shutil.copytree(source,dest,ignore=shutil.ignore_patterns('build','BBStudio.xcodeproj','BBStudio.xcworkspace'))
for path in [dest/'Shared/AppGroup.swift',dest/'Shared/BBClient.swift']:
    text=path.read_text(); old='https://patricks-megamac.tail5a01ec.ts.net'
    assert old in text
    path.write_text(text.replace(old,'http://127.0.0.1:49486'))
for path in (dest/'UITests').glob('*.swift'):
    if path.name!='ReviewPerformanceUITests.swift': path.unlink()
ids=[]
for i in range(24):
    body={'projectId':None,'parentId':None,'title':f'Native Performance {i:02d}','markdown':'# Navigation fixture\n\nRead-only native review fixture.\n\n'+'\n\n'.join(f'Paragraph {n}: deterministic sample text for repeated native navigation.' for n in range(18))}
    request=urllib.request.Request('http://127.0.0.1:49486/api/v1/plugins/pages/rpc/create',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    result=json.load(urllib.request.urlopen(request,timeout=15)); assert result['ok'],result
    ids.append(result['result']['page']['id'])
    (out/'fixture-ids.json').write_text(json.dumps(ids,indent=2))
PY
xcrun simctl boot "$device_id"
xcodegen generate --spec "$run_dir/project/project.yml"
xcodebuild -project "$run_dir/project/BBStudio.xcodeproj" -scheme BBStudio -configuration Debug -destination "platform=iOS Simulator,id=$device_id" -derivedDataPath "$run_dir/build" build-for-testing > "$run_dir/build.log" 2>&1
xcrun simctl install "$device_id" "$run_dir/build/Build/Products/Debug-iphonesimulator/BBStudio.app"
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$device_id" defaults write "$domain" serverURL -string "$fixture"
  [[ "$(xcrun simctl spawn "$device_id" defaults read "$domain" serverURL)" == "$fixture" ]]
done
app_data=$(xcrun simctl get_app_container "$device_id" nyc.plee.bbgo data)
group_data=$(xcrun simctl get_app_container "$device_id" nyc.plee.bbgo group.nyc.plee.bbgo)
python3 - "$run_dir" "$app_data" "$group_data" <<'PY'
import pathlib,plistlib,sys
out,app,group=map(pathlib.Path,sys.argv[1:]); origin='http://127.0.0.1:49486'
for folder,domain in [(app,'nyc.plee.bbgo'),(group,'group.nyc.plee.bbgo')]:
    path=folder/'Library/Preferences'/f'{domain}.plist'; path.parent.mkdir(parents=True,exist_ok=True)
    values=plistlib.loads(path.read_bytes()) if path.exists() else {}
    values['serverURL']=origin; path.write_bytes(plistlib.dumps(values))
    assert plistlib.loads(path.read_bytes())['serverURL']==origin
source=next((out/'build/Build/Products').glob('*.xctestrun')); data=plistlib.loads(source.read_bytes())
targets=[t for c in data['TestConfigurations'] for t in c['TestTargets']] if 'TestConfigurations' in data else [t for t in data.values() if isinstance(t,dict) and t.get('BlueprintName')]
for target in targets:
    if target['BlueprintName']=='BBStudioUITests':
        target['OnlyTestIdentifiers']=['ReviewPerformanceUITests']
        target.setdefault('EnvironmentVariables',{}).update(BB_PERFORMANCE_QA_SERVER_URL=origin,BB_PERFORMANCE_QA_PRIVATE_SIM='YES')
    else: target['IsEnabled']=False
(out/'build/Build/Products/performance.xctestrun').write_bytes(plistlib.dumps(data))
for target in targets: target.get('EnvironmentVariables',{}).pop('BB_PERFORMANCE_QA_SERVER_URL',None)
(out/'build/Build/Products/refusal.xctestrun').write_bytes(plistlib.dumps(data))
PY
for run in refusal performance; do
  xcodebuild test-without-building -xctestrun "$run_dir/build/Build/Products/$run.xctestrun" -destination "platform=iOS Simulator,id=$device_id" -only-testing:BBStudioUITests/ReviewPerformanceUITests -parallel-testing-enabled NO -resultBundlePath "$run_dir/$run.xcresult" > "$run_dir/$run.log" 2>&1
  xcrun xcresulttool get test-results summary --path "$run_dir/$run.xcresult" > "$run_dir/$run-summary.json"
done
xcrun xcresulttool get test-results metrics --path "$run_dir/performance.xcresult" > "$run_dir/metrics.json"
xcrun xcresulttool export attachments --path "$run_dir/performance.xcresult" --output-path "$run_dir/attachments"
if [[ "${BB_PERFORMANCE_QA_LIFETIME:-}" == YES ]]; then
  # Separate run: copy-only logging must not affect the clean metrics above.
  python3 - "$run_dir" <<'PY'
from pathlib import Path
import sys
out=Path(sys.argv[1]); path=out/'project/iOS/Pages/PageView.swift'
text=path.read_text().replace('import SwiftUI','import SwiftUI\nimport os',1)
text=text.replace('        self.pageId = pageId\n','        self.pageId = pageId\n        Logger(subsystem: "nyc.plee.bbgo.nativeperformance", category: "lifetime").notice("PageModel init \\(pageId, privacy: .public)")\n',1)
text=text.replace('    private var cacheKey: String {','    deinit {\n        let releasedPageID = pageId\n        Logger(subsystem: "nyc.plee.bbgo.nativeperformance", category: "lifetime").notice("PageModel release \\(releasedPageID, privacy: .public)")\n    }\n\n    private var cacheKey: String {',1)
path.write_text(text)
path=out/'project/UITests/ReviewPerformanceUITests.swift'
text=path.read_text().replace('options.iterationCount = 5','options.iterationCount = 1').replace('XCTAssertGreaterThanOrEqual(completedCycles, 10)','XCTAssertGreaterThanOrEqual(completedCycles, 2)')
path.write_text(text)
PY
  xcodebuild -project "$run_dir/project/BBStudio.xcodeproj" -scheme BBStudio -configuration Debug -destination "platform=iOS Simulator,id=$device_id" -derivedDataPath "$run_dir/build" build-for-testing > "$run_dir/lifetime-build.log" 2>&1
  xcodebuild test-without-building -xctestrun "$run_dir/build/Build/Products/performance.xctestrun" -destination "platform=iOS Simulator,id=$device_id" -only-testing:BBStudioUITests/ReviewPerformanceUITests -parallel-testing-enabled NO -resultBundlePath "$run_dir/lifetime.xcresult" > "$run_dir/lifetime.log" 2>&1
  xcrun simctl spawn "$device_id" log show --last 10m --style json --predicate 'subsystem == "nyc.plee.bbgo.nativeperformance"' > "$run_dir/page-lifetime.json"
fi
