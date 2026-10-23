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
Other tabs use a single pane on the right page. The thread's back button is
hidden only when that list is beside it; narrow layouts retain the back button.
Portrait uses the phone layout without new fixed chrome at its midpoint.

The navigation stack and its root keep their identity across resizing. The
existing thread view continues to own its model, draft and ScrollPosition.
`TranscriptResizeAnchor` observes the top visible message and its pixel offset.
Only a container-width change starts a restore: after the new lazy layout starts
to settle, it materializes that message and corrects its offset through the
existing ScrollPosition. A thread at its newest message uses the existing bottom
scroll operation instead. User interaction or leaving the thread cancels pending
restoration. Height-only changes, including the keyboard, do not request a
restore. Normal scrolling, keyboard avoidance and the existing bottom-anchor
rules are unchanged.

## Captures

These screenshots show the built app in exact-size **iPad UIWindow captures**;
the status bar and safe areas belong to the iPad runtime. They are not real Duo
hinge transitions.

| Layout | Window size (pt) | Screenshot |
| --- | --- | --- |
| Outer before resize | 466 × 678 | [Outer](built-outer.png) |
| Inner landscape | 951 × 669 | [Landscape](built-landscape.png) |
| Inner portrait | 669 × 951 | [Portrait](built-portrait.png) |
| Outer after resize | 466 × 678 | [Returned outer](built-outer-after-resize.png) |
| Keyboard on a full iPad scene | 1376 × 1032 | [Keyboard](built-ipad-keyboard.png) |
| Tall mini card after an internal drag, outer | 466 × 678 | [Mini in outer](mini-scroll-outer.png) |
| Tall mini card after an internal drag, split | 951 × 669 | [Mini in split](mini-scroll-landscape.png) |

The local 80-message fixture needs no server or agent. The mini fixtures use real
WebKit cards and an isolated staged BB at a pushed `d970f030`, started with
`scripts/staged-bb.mjs --plugin mobile`. No staged agent ran. The task-counter,
long-list and note apps use the server's real records, shared state and realtime.

## Verification

- `xcodegen generate`: passed with Xcode 27.1 selected through `DEVELOPER_DIR`.
- Full `BBStudioTests` on an owned iPhone 18 Pro: 332 tests, 1 skipped, 0 failures.
  New unit tests cover width-only restore requests, inset conversion, bottom
  pinning and cancellation. Keyboard-height changes and reading updates do not
  request restoration.
- All 3 `DuoLayoutUITests` passed on an owned iPad Pro 13-inch. The reading test
  compares process identity, selected thread, exact draft and a visible message
  within the original 90-point tolerance at each size. The bottom test keeps the
  newest message visible with no Jump to latest button. The keyboard test checks
  its full width, the right composer above it and the list's usable selected row.
- Both `MiniCardUITests` passed: the existing interaction/realtime test on the
  iPhone, and the new scroll-ownership test on the iPad. In both exact Duo layouts,
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

For mini tests, start a separate staged BB with `scripts/staged-bb.mjs` and seed
the counter, long list and note as described in [the iOS test guide](../../../apps/ios/README.md).
Set `TEST_RUNNER_BBGO_QA_SERVER` to that staged URL,
`TEST_RUNNER_BBGO_QA_MINI_THREAD=thr_botdemo01` and
`TEST_RUNNER_BBGO_QA_MINI_IDS=<counter-id>,<long-list-id>,<note-id>`.
Run `MiniCardUITests/testMiniCardsRunInline` on the owned iPhone, and
`MiniCardUITests/testScrollOwnershipInOuterAndLandscape` on the owned iPad.
The fixture's resize links use `XCUIDevice.shared.system.open`, which keeps the
process alive; `XCUIApplication.open` relaunches it and cannot test retention.
