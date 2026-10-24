> Latest edge-to-edge surfaces and safe controls: [Duo v7](V7.md).

> Latest quick-reply clipping and system inset audit: [Duo v6](V6.md).

> Latest sidebar filters and matching margins: [Duo v5](V5.md).

> Latest search and sidebar alignment: [Duo v4](V4.md).

> Current implementation and dark phone/iPad comparisons: [Duo v3](V3.md).
> The captures and full-width tab behavior below document the earlier v2 build.

# Duo unfolded layout

23 October 2026. The built app uses two pages when the window is at least
900 points wide and wider than it is tall. Its thread list, selected thread,
composer draft and reading position survive outer → landscape → portrait → outer
window changes in the same process. The branch includes inline mini app cards
from `origin/main` (`d970f030`).

## Layout and state

A 64-point tab rail and thread list occupy the left page. The 32-point gutter
centers on the window midpoint, including asymmetric leading safe areas. Thread
selection uses the existing `AppModel.path`, with the selected row highlighted.
Bot, Studio and Settings fill the width after the rail as a single pane.
Only Threads reserves the left page for its list. The thread's back button is
hidden only when that list is beside it; narrow layouts retain the back button.
Portrait uses the phone layout without new fixed chrome at its midpoint.

The navigation stack and its root keep their identity across resizing. The
existing thread view continues to own its model, draft and ScrollPosition.
`TranscriptResizeAnchor` observes the top visible message and its window offset,
so changing between native and unfolded headers does not move its anchor.
Only a container-width change starts a restore: after the new lazy layout starts
to settle, it materializes that message and corrects its offset through the
existing ScrollPosition. A thread at its newest message uses the existing bottom
scroll operation instead. User interaction or leaving the thread cancels pending
restoration. Height-only changes, including the keyboard, do not request a
restore. Normal scrolling, keyboard avoidance and the existing bottom-anchor
rules are unchanged.

## iPhone root regression captures

The October 23 follow-up reproduces the root of `b868efe0` on an owned iPhone
Duo simulator with a **phone idiom**, resizing the existing window to 951 × 669
points. The original root exposed two navigation rails, duplicated titles and
actions, a Bot back button and a blank left page on other tabs. The new phone
regression checks their absence, the trailing status safe area, full-width
content and a populated thread list. Narrow and portrait windows retain the
native phone navigation.

The inbox model and load task now belong to the stable InboxTab, shared by its
narrow root and split list. A cold unfolded test starts on Settings and loads Threads
from the real staged sidebar endpoint without first opening the narrow inbox.
The warm staged baseline did populate; the real device's empty-list failure was
not independently reproduced as a server/decoder defect.

These PNGs are unmodified UIKit renders of the built phone window, at 3× scale
(2853 × 2007 pixels), with safe local fixture data. The staged Orbit sidebar and Studio page come from the real isolated server.
Bot and the selected split conversation use the local 80-message Juniper
fixture, exposed as a normal selectable list row only by the Debug phone QA
flag. The cold test starts on Settings, opens the unfolded list, selects that
row and checks that message 80 renders on the right page. No agent ran.

The earlier release-notes capture selected a genuinely empty scheduled thread.
The staged script deliberately schedules its first prompt weeks ahead; the
verified timeline response has `maxSeq: 0`, `rows: []` and no history segments.
Its queued-message response contains one future scheduled prompt. There was no
missing transcript to render for that thread. The refreshed captures show actual
messages instead.

The stronger cold-selection test also found a separate split-row hit-target bug:
plain buttons did not accept taps in blank space beyond a short title. A center
tap on Juniper left “No thread selected”. The full label now fills the row width
and supplies a rectangular hit shape. The cold test failed before that change.

The unfolded rail and grouped list backgrounds now paint
through the bottom safe area; controls keep their existing safe-area layout.

| Surface | Screenshot |
| --- | --- |
| Bot | [Bot](fix-bot.png) |
| Threads, selected thread | [Threads](fix-threads.png) |
| Threads, keyboard avoidance active | [Keyboard-up root](fix-threads-keyboard.png) |
| Studio | [Studio](fix-studio.png) |
| Settings | [Settings](fix-settings.png) |

**Keyboard capture limitation:** changing UIWindow bounds preserves the phone
idiom and app hierarchy but cannot resize the simulator's remote keyboard
service. It remains on the outer 466 × 678 display. The keyboard-up root render
shows the right-page composer avoiding that keyboard, but cannot draw the
cross-process keyboard itself. [The actual screen capture](fix-threads-keyboard-native.png)
shows the real system keyboard and clips the right half of the forced window.
Neither image is a verified full-width Duo keyboard screenshot. Geometry is
recorded in [capture metadata](fix-capture-geometry.json). The simulator's
supported screenConfig command rejected the inner display geometry.

## Earlier layout captures

These older images use exact-size iPad windows and do not cover phone root
navigation. They remain useful for transcript and mini-card behavior.

| Layout | Window size (pt) | Screenshot |
| --- | --- | --- |
| Outer before resize | 466 × 678 | [Outer](built-outer.png) |
| Inner landscape | 951 × 669 | [Landscape](built-landscape.png) |
| Inner portrait | 669 × 951 | [Portrait](built-portrait.png) |
| Outer after resize | 466 × 678 | [Returned outer](built-outer-after-resize.png) |
| Keyboard on a full iPad scene | 1376 × 1032 | [Keyboard](built-ipad-keyboard.png) |
| Tall mini card after an internal drag, outer | 466 × 678 | [Mini in outer](mini-scroll-outer.png) |
| Tall mini card after an internal drag, split | 951 × 669 | [Mini in split](mini-scroll-landscape.png) |

## Verification

- `xcodegen generate`: passed with Xcode 27.1 selected through `DEVELOPER_DIR`.
- Full `BBStudioTests` on the owned iPhone Duo: 332 tests, 1 skipped, 0 failures.
  Existing unit tests cover width-only restore requests, inset conversion, bottom
  pinning and cancellation. Keyboard-height changes and reading updates do not
  request restoration.
- All 3 `DuoPhoneRootUITests` cover the phone root, cold split loading, one rail/title/action pair, full-width tabs, no Bot back button, status-safe actions and native outer/portrait chrome.
- All 3 `DuoLayoutUITests` passed on an owned iPad Pro 13-inch. The reading test
  compares process identity, selected thread, exact draft and a visible message
  within the original 90-point tolerance at each size. The bottom test keeps the
  newest message visible with no Jump to latest button. The keyboard test checks
  its full width, the right composer above it and the list's usable selected row.
- Both `MiniCardUITests` passed: the interaction/realtime test on the
  iPhone Duo (explicitly starting at the newest card after its heights load), and the new scroll-ownership test on the iPad. In both exact Duo layouts,
  dragging over a short app scrolls the transcript; dragging over a tall app
  moves its rows internally while its card header stays within 4 points.
- Studio package-local `tsc --noEmit`: passed.
- Studio package-local `vitest run`: 272 files, 1,982 tests passed.
- Root icon and documentation checks and `git diff --check`: passed.

Real hinge transitions and the keyboard at exact Duo scene geometry remain
unverified because this Xcode installation cannot fold the Duo simulator. The
keyboard check uses a native iPad scene, while the retention and card tests use
exact-size app windows. No TestFlight, release, merge or push was performed.

## Reproduce

Create owned iPhone and iPad simulators, then substitute their UUIDs:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd apps/ios
xcodegen generate
xcodebuild test -scheme BBStudio -destination id=<iphone-uuid> \
  -only-testing:BBStudioTests CODE_SIGNING_ALLOWED=NO
xcodebuild test -scheme BBStudio -destination id=<ipad-uuid> \
  -only-testing:BBStudioUITests/DuoLayoutUITests CODE_SIGNING_ALLOWED=NO
```

For phone-root tests, start an isolated staged BB and seed its sidebar with the
Orbit demo threads and a page titled `Duo launch checklist`. The test uses real
sidebar/page RPCs and a local Bot transcript; `-qaDuoPhone` bypasses the fake
sidebar. Run on the owned **iPhone Duo** simulator (phone idiom):

```sh
TEST_RUNNER_BBGO_QA_SERVER=http://127.0.0.1:<staged-port> \
xcodebuild test -scheme BBStudio -destination id=<duo-iphone-uuid> \
  -only-testing:BBStudioUITests/DuoPhoneRootUITests CODE_SIGNING_ALLOWED=NO
```

The Debug-only `qa-duo/capture?name` URL writes the full UIKit window PNG and
geometry JSON to the app's Documents directory. Export them before deleting the
owned simulator. The keyboard's actual screen image is a test attachment.

For mini tests, start a separate staged BB with `scripts/staged-bb.mjs` and seed
the counter, long list and note as described in [the iOS test guide](../../../apps/ios/README.md).
Set `TEST_RUNNER_BBGO_QA_SERVER` to that staged URL,
`TEST_RUNNER_BBGO_QA_MINI_THREAD=thr_botdemo01` and
`TEST_RUNNER_BBGO_QA_MINI_IDS=<counter-id>,<long-list-id>,<note-id>`.
Run `MiniCardUITests/testMiniCardsRunInline` on the owned iPhone, and
`MiniCardUITests/testScrollOwnershipInOuterAndLandscape` on the owned iPad.
The fixture's resize links use `XCUIDevice.shared.system.open`, which keeps the
process alive; `XCUIApplication.open` relaunches it and cannot test retention.
