#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
: "${BB_TEST_SIMULATOR_ID:?Set a private simulator ID}"
: "${BB_QA_SERVER_URL:?Set the isolated staged BB origin}"
: "${BB_QA_PROJECT_ID:?Set the staged project ID}"
: "${BBGO_QA_THREAD:?Set the staged thread ID}"
export BB_QA_SERVER_URL BB_QA_PROJECT_ID BBGO_QA_THREAD
python3 - <<'PY'
import json, os, urllib.parse, urllib.request
origin=os.environ['BB_QA_SERVER_URL']; u=urllib.parse.urlparse(origin)
assert u.scheme=='http' and u.hostname in ('127.0.0.1','localhost') and u.port not in (None,38886), 'Use an explicit isolated loopback server port'
projects=json.load(urllib.request.urlopen(origin+'/api/v1/projects'))
assert any(p['id']==os.environ['BB_QA_PROJECT_ID'] for p in projects), 'Staged project is missing'
PY
run_dir="${BB_UI_TEST_RUN_DIR:-/tmp/bb-studio-ui-tests-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$run_dir"
trap 'printf "UI test evidence: %s\n" "$run_dir"' EXIT
xcodegen generate -q
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$BB_TEST_SIMULATOR_ID" defaults write "$domain" serverURL -string "$BB_QA_SERVER_URL"
done
xcodebuild build-for-testing -scheme BBStudio -destination "id=$BB_TEST_SIMULATOR_ID" \
  -derivedDataPath "$run_dir/DerivedData" > "$run_dir/build.log" 2>&1
python3 - "$run_dir" <<'PY'
import glob, os, plistlib, sys
path=glob.glob(sys.argv[1]+'/DerivedData/Build/Products/*.xctestrun')[0]
with open(path,'rb') as f: data=plistlib.load(f)
def anchor(value):
 if isinstance(value,str): return value.replace('__TESTROOT__', os.path.dirname(path))
 if isinstance(value,list): return [anchor(v) for v in value]
 if isinstance(value,dict): return {k:anchor(v) for k,v in value.items()}
 return value
data=anchor(data)
targets=[data['BBStudioUITests']] if 'BBStudioUITests' in data else [t for c in data['TestConfigurations'] for t in c['TestTargets'] if t['BlueprintName']=='BBStudioUITests']
for target in targets:
 env=target.setdefault('EnvironmentVariables',{})
 env.update({k:v for k,v in os.environ.items() if k.startswith(('BB_QA_', 'BBGO_QA_', 'BB_OFFICE_CAPTURE_'))})
with open(sys.argv[1]+'/fixture.xctestrun','wb') as f: plistlib.dump(data,f)
PY
xcodebuild test-without-building -xctestrun "$run_dir/fixture.xctestrun" \
  -destination "id=$BB_TEST_SIMULATOR_ID" -only-testing:"${BB_UI_TEST_ONLY:-BBStudioUITests}" \
  -parallel-testing-enabled NO -resultBundlePath "$run_dir/results.xcresult" "$@" \
  > "$run_dir/tests.log" 2>&1
