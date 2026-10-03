# Isolated native UI quality review

`ReviewQualityUITests` is an opt-in XCTest UI suite. It refuses to launch the app
unless the test runner receives exactly
`BB_QA_SERVER_URL=http://127.0.0.1:49486`. It sets `-serverURL` before launch and
asserts the URL rendered in Settings before continuing. Never run the older UI
suites against real user data: some of them contain production endpoints.

The fixture used here is the normal stable BB application staged at
`/tmp/bb-studio-goal-staged`, with its own demo data and port 49486. The tests
only navigate and inspect screens. They do not submit notes, start threads,
record audio, change server settings, or accept decisions.

## Reproduce

Use a newly created empty simulator and a private source copy. A launch argument
alone is insufficient: app-group defaults and background initialization must
also select the fixture before the first launch. Do not clone a user's simulator
or build the test directly from a checkout with production fallback URLs.

From the repository root, prepare the copy and empty device:

```sh
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export BB_QUALITY_QA_DIR=$(mktemp -d /tmp/bb-quality-review.XXXXXX)
export BB_QUALITY_QA_DEVICE=$(xcrun simctl create 'BB isolated quality review' \
  com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-27-0)
trap 'xcrun simctl shutdown "$BB_QUALITY_QA_DEVICE" >/dev/null 2>&1 || true; xcrun simctl delete "$BB_QUALITY_QA_DEVICE" >/dev/null 2>&1 || true' EXIT
python3 - <<'PYTHON'
import os, pathlib, shutil
source = pathlib.Path('apps/ios')
copy = pathlib.Path(os.environ['BB_QUALITY_QA_DIR']) / 'project'
shutil.copytree(source, copy, ignore=shutil.ignore_patterns('build', '*.xcodeproj', '*.xcworkspace', 'docs'))
for name in ['Shared/AppGroup.swift', 'Shared/BBClient.swift']:
    path = copy / name
    text = path.read_text()
    old = 'https://patricks-megamac.tail5a01ec.ts.net'
    assert old in text
    path.write_text(text.replace(old, 'http://127.0.0.1:49486'))
for path in (copy / 'UITests').glob('*.swift'):
    if path.name != 'ReviewQualityUITests.swift':
        path.unlink()
PYTHON
xcrun simctl boot "$BB_QUALITY_QA_DEVICE"
xcodegen generate --spec "$BB_QUALITY_QA_DIR/project/project.yml"
xcodebuild build-for-testing -project "$BB_QUALITY_QA_DIR/project/BBStudio.xcodeproj" \
  -scheme BBStudio -destination "id=$BB_QUALITY_QA_DEVICE" \
  -derivedDataPath "$BB_QUALITY_QA_DIR/build"
xcrun simctl install "$BB_QUALITY_QA_DEVICE" \
  "$BB_QUALITY_QA_DIR/build/Build/Products/Debug-iphonesimulator/BBStudio.app"
```

Set and read back both preference domains and both installed containers before
launching. Then enable only the review suite in a separate runner file:

```sh
for domain in nyc.plee.bbgo group.nyc.plee.bbgo; do
  xcrun simctl spawn "$BB_QUALITY_QA_DEVICE" defaults write "$domain" serverURL -string http://127.0.0.1:49486
  test "$(xcrun simctl spawn "$BB_QUALITY_QA_DEVICE" defaults read "$domain" serverURL)" = http://127.0.0.1:49486 || exit 1
done
python3 - <<'PYTHON'
import os, pathlib, plistlib, subprocess
origin = 'http://127.0.0.1:49486'
device = os.environ['BB_QUALITY_QA_DEVICE']
for container, domain in [('data', 'nyc.plee.bbgo'), ('group.nyc.plee.bbgo', 'group.nyc.plee.bbgo')]:
    root = pathlib.Path(subprocess.check_output(['xcrun', 'simctl', 'get_app_container', device, 'nyc.plee.bbgo', container], text=True).strip())
    path = root / 'Library/Preferences' / f'{domain}.plist'
    path.parent.mkdir(parents=True, exist_ok=True)
    values = plistlib.loads(path.read_bytes()) if path.exists() else {}
    values['serverURL'] = origin
    path.write_bytes(plistlib.dumps(values))
    assert plistlib.loads(path.read_bytes())['serverURL'] == origin
root = pathlib.Path(os.environ['BB_QUALITY_QA_DIR']) / 'build/Build/Products'
source = next(root.glob('*.xctestrun'))
data = plistlib.loads(source.read_bytes())
if 'TestConfigurations' in data:
    targets = [t for c in data['TestConfigurations'] for t in c['TestTargets']]
else:
    targets = [t for t in data.values() if isinstance(t, dict) and 'BlueprintName' in t]
for target in targets:
    if target['BlueprintName'] == 'BBStudioUITests':
        target.setdefault('EnvironmentVariables', {})['BB_QA_SERVER_URL'] = origin
        target['OnlyTestIdentifiers'] = ['ReviewQualityUITests']
    else:
        target['IsEnabled'] = False
(root / 'ReviewQuality.xctestrun').write_bytes(plistlib.dumps(data))
PYTHON
xcodebuild test-without-building \
  -xctestrun "$BB_QUALITY_QA_DIR/build/Build/Products/ReviewQuality.xctestrun" \
  -destination "id=$BB_QUALITY_QA_DEVICE" -parallel-testing-enabled NO \
  -only-testing:BBStudioUITests/ReviewQualityUITests \
  -resultBundlePath "$BB_QUALITY_QA_DIR/results.xcresult" || BB_QUALITY_QA_RESULT=$?
xcrun xcresulttool export attachments --path "$BB_QUALITY_QA_DIR/results.xcresult" \
  --output-path "$BB_QUALITY_QA_DIR/attachments"
exit "${BB_QUALITY_QA_RESULT:-0}"
```

Run these commands in one shell so the cleanup trap removes only this private
device. Keep the result folder for review. The revised commands document the
isolation steps exercised by later native lanes; they are not a new audit result.

A missing/wrong environment causes an explicit skip before app launch. A skipped
run is not verification. Use a new result-bundle path on every run.

## Scope and interpretation

The suite opens Settings, Studio, Today, Capture, and the empty Note form at
normal text and `UICTContentSizeCategoryAccessibilityXXXL`. It verifies named,
hittable actions; all six Capture actions remain reachable by scrolling; an
empty note cannot be submitted. It retains screenshots and accessibility trees.

It attempts Apple's contrast, element detection, hit-region, sufficient-label,
Dynamic Type, and text-clipping audits on every screen. Findings are collected
and **fail the final assertion**; they are not silently suppressed. Native
navigation buttons have visible accessibility frames smaller than 44 points on
iOS 27, while the system hit-region audit does not flag them. Their hit regions
are therefore checked using that audit, not a visible-frame size assumption.
Custom Capture actions and the Settings action also have explicit 44-point
frame checks.

A three-iteration `XCTApplicationLaunchMetric` measurement is included. It is a
simulator observation, not a physical-device startup guarantee or a measurement
of when every server response finishes.

## Results, 3 October 2026

Initial launch measurement: **2.742 seconds mean**, samples 2.766627, 2.726193,
2.732914 seconds (0.645% relative standard deviation), fresh iPhone 18 Pro / iOS
27 simulator. The initial build succeeded and the launch test passed.

The initial audit reproduced narrow Studio row layouts at accessibility text:
titles, timestamps and metadata competed on one line; four quick actions broke
words across narrow columns. The layout now uses two action columns and stacks
row details at accessibility sizes, with higher-contrast metadata. Capture's
decorative symbols now fit their reserved column as text grows; labels retain
their full height. Settings provides a named, wrapping server URL field.

The final build-for-testing succeeded. Both navigation runs reached and checked
all five screens, then failed their final strict-audit assertion. The separate
Studio row accessibility-size run reached the real fixture row with no remaining
row text-clipping finding, then failed on toolbar/unattributed contrast and the
system Select control's font-size cap. **The accessibility gate is not green.**
No hit-region, insufficient-description, or element-detection issue was reported.

The largest-text Settings screen passed all six audit categories. The default
Settings screen still reports contrast and Dynamic Type findings, including
Keep Mac awake. Today reports clipping and contrast; Capture reports toolbar
contrast/font limits and clipping of labels near the scroll viewport; the empty
Note form reports disabled Save note contrast/clipping and Back font limits.
Studio still reports Select contrast/font limits and an unattributed contrast
issue in the scrolled-row view. These are retained for follow-up rather than
waived. The audit supplies no element identity for several findings, and its
label is not sufficient to conclude every report is an app defect.

Full findings: [audit-findings.txt](quality-verification/audit-findings.txt).
Result bundles from this run: `/tmp/bb-quality-final.xcresult` (both navigation
sizes), `/tmp/bb-quality-rows.xcresult` (scrolled row), and
`/tmp/bb-quality-first-run.xcresult` (launch measurement and initial failure).
The missing-environment negative run explicitly skipped before any application launch (`/tmp/bb-quality-refusal.xcresult`).
The local logs are `/tmp/bb-quality-final.log`, `/tmp/bb-quality-rows.log`, and
`/tmp/bb-quality-first-run.log`.

### Captured rendered screens

| Screen | Default text | Accessibility XXXL |
| --- | --- | --- |
| Settings | [PNG](quality-verification/settings-default.png) | [PNG](quality-verification/settings-accessibility-xxxl.png) |
| Studio | [PNG](quality-verification/studio-default.png) | [PNG](quality-verification/studio-accessibility-xxxl.png) |
| Today | [PNG](quality-verification/today-default.png) | [PNG](quality-verification/today-accessibility-xxxl.png) |
| Capture | [PNG](quality-verification/capture-default.png) | [PNG](quality-verification/capture-accessibility-xxxl.png) |
| Note | [PNG](quality-verification/note-default.png) | [PNG](quality-verification/note-accessibility-xxxl.png) |

[Scrolled Studio row at accessibility XXXL](quality-verification/studio-rows-accessibility-xxxl.png)


## Limits

No physical-device, VoiceOver rotor, Switch Control, keyboard-only, dark-mode,
iPad, watch, widget, share-extension UI, notification permission, offline,
thermal, memory-pressure or long-session performance claim is made. The SDK's
iOS 27 audit also reports system toolbar Dynamic Type caps, disabled-control
contrast, and sometimes unattributed contrast/clipping. Those reports require
triage against screenshots and supported-device behavior; a successful
navigation trace does not mean the full accessibility audit passed.
