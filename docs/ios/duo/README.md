# Duo unfolded implementation — stopped at scroll preservation

23 October 2026. **Partial implementation; not ready to merge.** The same-process
resize test fails its scroll-position requirement. Patrick's instruction requires
stopping before changing transcript scrolling to fix it. `ThreadView.swift`, its
ScrollView, scroll anchoring, and keyboard handling are unchanged.

## Built layout

`DuoLayout` chooses two pages for a window at least 900 points wide and wider
than it is tall. It uses window bounds, so keyboard avoidance does not change the
layout decision. A 64-point tab rail and thread list occupy the left page. The
32-point gutter centers on the window midpoint, accounting for its leading safe
area. Selecting a thread updates the existing `AppModel.path`; the selected row
stays highlighted. Other tabs occupy the right page as single panes.

Narrow windows and portrait windows use the phone navigation stack. No new fixed
chrome appears around the portrait midpoint. Both the destination stack and its
root keep their structural identity through resizing. The thread's existing
state remains owned by its existing view; there is no second draft or selection
for the unfolded layout.

## Captures

These are screenshots of the built app with deterministic local messages, without
BB or an agent running. They are exact-size **iPad UIWindow captures**, not real
Duo hinge transitions. The status bar and safe areas belong to the iPad runtime.

| Layout | Window size (pt) | Screenshot |
| --- | --- | --- |
| Outer, before resize | 466 × 678 | [Built outer](built-outer.png) |
| Inner landscape | 951 × 669 | [Built landscape](built-landscape.png) |
| Inner portrait | 669 × 951 | [Built portrait](built-portrait.png) |
| Outer, after resize | 466 × 678 | [Outer after resize](built-outer-after-resize.png) |
| Keyboard on a full iPad window | 1376 × 1032 | [Keyboard](built-ipad-keyboard.png) |

The keyboard capture verifies the same layout decision at a native iPad scene
size. The keyboard spans the window, the composer stays on the right above it,
and the selected list row remains tappable. Keyboard behavior at the exact Duo
scene size and real folding remain unverified.

## Blocking regression

`DuoLayoutUITests.testThreadAndDraftSurviveThreeWindowSizes` opens an 80-message
thread, types an unsent draft, then drags inside the transcript until message 24
is visible. It resizes the existing window through outer → landscape → portrait
→ outer. It checks window dimensions, process identity, thread title, draft, and
the recorded message's vertical position with a 90-point tolerance.

The final run kept the process, thread and exact draft across every transition.
The scroll assertions failed:

| Window | Recorded message top (pt) | Result |
| --- | --- | --- |
| Initial outer | 166.97 | Baseline |
| Landscape | 365.03 | Moves 198.05 pt |
| Portrait | 1223.00 | Below the visible window |
| Returned outer | Not in the accessibility snapshot | Anchor lost |

Preserving a stable view hierarchy is insufficient for the existing scroll
position to survive this reflow. Explicit transcript anchor preservation on
resize appears necessary. That would require reviewing/changing the scrolling
code, which this task forbids without stopping and explaining. The failing test
is retained, and its tolerance has not been widened.

An earlier harness used `XCUIApplication.open`, which relaunches the app. The
final test uses `XCUIDevice.shared.system.open` and compares a process identifier
on the window after every resize. The reported failure is from that corrected
same-process test. The debug resize URL is enabled only with `-qaBotDemo duo`.

## Validation

- `xcodegen generate`: passed, with Xcode 27.1 selected through `DEVELOPER_DIR`.
- Full `BBStudioTests` on an owned iPhone 18 Pro: 330 tests, 1 skipped, 0 failures.
- `DuoLayoutUITests` on an owned iPad Pro 13-inch: keyboard test passed; state test
  failed 3 scroll assertions. Process, thread, draft and window-size checks passed.
- Studio package-local `tsc --noEmit`: passed.
- Studio package-local `vitest run`: 272 files, 1,982 tests passed.
- Root icon and documentation checks: passed.

Both disposable simulators were created for this task. No staged BB, real BB
server, installed app, release, TestFlight upload, merge or push was used.

To reproduce, create owned iPhone and iPad simulators and substitute their UUIDs:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd apps/ios
xcodegen generate
xcodebuild test -scheme BBStudio -destination id=<iphone-uuid> \
  -only-testing:BBStudioTests CODE_SIGNING_ALLOWED=NO
xcodebuild test -scheme BBStudio -destination id=<ipad-uuid> \
  -only-testing:BBStudioUITests/DuoLayoutUITests CODE_SIGNING_ALLOWED=NO
```
