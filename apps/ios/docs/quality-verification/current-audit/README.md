# Current native accessibility audit

The strict accessibility gate is **not green**. Three fresh navigation/row tests
failed their final audit assertion on 3 October 2026. The run retained 37 raw
reports: 11 contrast, 13 Dynamic Type and 13 text-clipping reports. No element
detection, hit-region or insufficient-description report appeared. Default
Settings now has no element-detection finding; the largest-text Settings screen
has no finding in the six selected categories.

[Run summary](run-summary.json), [full findings](audit-findings.txt) and
[isolation readbacks](isolation.json) retain the original result. Screens and
accessibility trees in this directory correspond to that strict run, before
the later Today approval-card fix. Its aggregate audit methods and final
assertions remain unchanged.

## Native diagnostic regions

Separate narrow tests retain Apple's original issue descriptions, full app
screenshots and element crops under [native-diagnostics](native-diagnostics/).
The first four use no audit handler. Two second-issue tests deliberately select
the second contrast report: their handler returns true for only the first
report, then false so Apple records the next original issue. This is diagnostic
selection, never a waiver or a successful strict gate.

| Surface | Original native region | Interpretation |
| --- | --- | --- |
| Default Settings, first contrast | Bottom list content behind the translucent tab bar | Viewport overlap; visible body text above the bar remains readable |
| Default Settings, second contrast | Archived threads content behind the translucent tab bar | Handler also names Threads for the first report; both lie under the bar |
| Scrolled Studio, first contrast | Select toolbar control | System toolbar report, retained |
| Scrolled Studio, second contrast | Artifact metadata across the bottom tab bar | Scroll viewport overlap, not evidence that a complete row cannot be read after scrolling |
| Largest-text Today contrast | Workflows content behind the bottom tab bar | Scroll viewport overlap |
| Largest-text Today clipping | Narrow no-handler audit passed | The earlier unidentified clipping report did not reproduce; it remains unresolved |

The shared staged fixture changed between runs. Other native lanes added a
pending Watch approval and artifact rows. These crops identify the later
native diagnostic regions; they do not establish a one-to-one identity for
every unknown element in the earlier strict result. The strict result remains
37 reports, not a claimed reduction to zero. Disabled Note controls, Capture
viewport edges and toolbar font caps were not reclassified by these diagnostics.

## Today approval actions

A populated Today card revealed a separate visual defect at accessibility
XXXL: its horizontal actions split Open thread and Approve once across narrow
columns. The native clipping-only diagnostic passed despite that visible word
breaking. The fix stacks these actions vertically at accessibility sizes,
lets labels wrap at full row width, and gives every button a 44-point minimum
label/content target. An explicit borderless style keeps each List button's
action independent. Default-size actions remain horizontal.

Verification opens only the held inert thread fixture, never its decision
controls. Both focused tests passed: default 23.237 seconds, accessibility XXXL 22.386
seconds. The positive destination assertion found the visible fixture thread.
The exact pending interaction record remained unchanged after both taps.
[Summary](native-diagnostics/run-summary.json),
[commands](native-diagnostics/commands.txt),
[default screenshot](native-diagnostics/today-approval-default-action-deny.png),
[XXXL screenshot](native-diagnostics/today-approval-accessibility-xxxl-action-deny.png)
and [opened thread](native-diagnostics/today-approval-default-open-thread.png)
retain the result. These two focused passes do not replace the failed strict
audit or establish that Approve/Deny were exercised.

## Reproduce and limits

Use the private-copy, empty-simulator and prelaunch preference/container checks
in [the native review instructions](../../quality-verification.md). The fixture
is stable BB at `http://127.0.0.1:49486`. Both private Shared fallback files,
both simulator defaults domains and both installed container preference files
were checked before every diagnostic/approval launch. The test verifies the
rendered Settings URL before continuing.

Run only the intended `ReviewQualityUITests` methods in a newly generated
xctestrun file with `BB_QA_SERVER_URL` set to that exact origin. Approval tests
require the held inert thread titled `Watch approval QA 0700`; their only action
is Open thread. Export attachments before deleting the owned simulator.

Raw result bundles remain at `/tmp/bb-current-audit.rleYYF/results.xcresult`
and `/tmp/bb-current-diagnostic.6v09KU/`. The owned diagnostic simulator is
removed after export; no user's simulator or installed desktop app is used.
No physical-device, VoiceOver, dark-mode, iPad, offline, widget, share-extension
UI or full accessibility compliance claim is made.
