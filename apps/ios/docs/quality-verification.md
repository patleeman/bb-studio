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

Use a newly created empty simulator. Do not clone a user's booted simulator.
With the staged BB running, from `apps/ios`:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
QA_SIM=$(xcrun simctl create 'BB isolated quality review' \
  com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl boot "$QA_SIM"
xcodegen generate -q
xcodebuild build-for-testing -scheme BBStudio -destination "id=$QA_SIM" \
  -derivedDataPath build/review-quality/DerivedData
```

Inject the runner environment into a separate xctestrun file. This handles both
xctestrun formats and restricts the target to this suite:

```sh
python3 - <<'PY'
import pathlib, plistlib
root = pathlib.Path('build/review-quality/DerivedData/Build/Products')
source = next(p for p in root.glob('*.xctestrun') if p.name != 'ReviewQuality.xctestrun')
data = plistlib.loads(source.read_bytes())
if 'TestConfigurations' in data:
    targets = [t for c in data['TestConfigurations'] for t in c['TestTargets']]
else:
    targets = [t for t in data.values() if isinstance(t, dict) and 'BlueprintName' in t]
for target in targets:
    if target['BlueprintName'] == 'BBStudioUITests':
        target.setdefault('EnvironmentVariables', {})['BB_QA_SERVER_URL'] = 'http://127.0.0.1:49486'
        target['OnlyTestIdentifiers'] = ['ReviewQualityUITests']
    else:
        target['IsEnabled'] = False
(root / 'ReviewQuality.xctestrun').write_bytes(plistlib.dumps(data))
PY
xcodebuild test-without-building \
  -xctestrun build/review-quality/DerivedData/Build/Products/ReviewQuality.xctestrun \
  -destination "id=$QA_SIM" -parallel-testing-enabled NO \
  -only-testing:BBStudioUITests/ReviewQualityUITests \
  -resultBundlePath /tmp/bb-native-quality.xcresult
xcrun xcresulttool export attachments --path /tmp/bb-native-quality.xcresult \
  --output-path /tmp/bb-native-quality-attachments
xcrun simctl shutdown "$QA_SIM"
xcrun simctl delete "$QA_SIM"
```

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
