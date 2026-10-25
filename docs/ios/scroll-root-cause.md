# iOS transcript "scrolls into black": root cause

Patrick, Oct 24: "Often it shows black like it scrolls too far down." It was
the Bot chat on the iPhone Duo's outer screen. The transcript area above the
floating composer was black, and the scroll indicator sat short at the
bottom of its track. That means the scroll offset was past the end of the
content.

## In plain words

The chat follows the bottom by pinning the scroll position to an invisible
marker view at the end of the transcript (`timeline-bottom`). SwiftUI keeps
an id pin when rows change, but not when the **bottom inset** changes. The
bottom inset is everything below the reader's view: the composer, the quick
replies and the keyboard. When the keyboard closes, the inset shrinks by the
keyboard's height, and the offset stays where it was. The bottom of the view
then sits a keyboard's height below the last row, and that band is black.

The one repair that existed (`settlePastEnd`) only ran when the **whole**
viewport was past the end. That was a deliberate narrowing in 1747e32b
("Fix Duo long-history restoration"). The Oct 1 fix (03c1bfb1) had repaired
any overshoot over 40 pt. The narrowing came with a note that re-aiming
partial overshoots risked a scroll/layout feedback loop. So every overshoot
smaller than one screen stayed for good: on the phone 236 pt, and on the Duo
outer screen 261 pt of a 438 pt reading area.

On the Duo outer screen the reading area is so short that a keyboard-high
band covers most of it. The rest sits under the frosted header's soft edge,
so it reads as an all-black screen, which is what Patrick saw. That last
step is an inference from the geometry; the measured overshoots are below.

## Evidence

`TranscriptPastEndUITests` reads the live `UIScrollView` (contentOffset,
contentSize, adjustedContentInset) after each step through the Debug-only
`qa-duo/layout` URL. `past` is how far the bottom of the unobscured view
(above composer and keyboard) is below the content's end. Positive means
blank space.

Before the fix (fce99dd3, which is main plus the harness only), closing the
keyboard at the bottom, three rounds each:

```
phone  r0 reply:           settled=-8.7  offset=1967.3 content=2398.0 insets=116.0/452.0
phone  r0 keyboard closed: settled=236.3 offset=1967.3 content=2398.0 insets=116.0/207.0
duo    r0 reply:           settled=-9.0  offset=2767.0 content=3026.0 insets=82.0/428.0
duo    r0 keyboard closed: settled=261.0 offset=2767.0 content=3026.0 insets=82.0/158.0
```

The offset doesn't move. Only the bottom inset changes (452 → 207 on the
phone, 428 → 158 on the Duo), and nothing requests a scroll. The app's
scroll log (`-qaScrollLog`, Duo) shows the same. The keyboard closes at
19.595 and nothing happens until the keyboard comes back at 23.456:

```
13.507 geo offset=2674.3 content=2933.0 container=168.0 insetTop=82.0 insetBottom=428.0 past=-8.7
19.595 geo offset=2674.3 content=2933.0 container=438.0 insetTop=82.0 insetBottom=428.0 past=261.3
19.602 geo offset=2674.3 content=2933.0 container=438.0 insetTop=82.0 insetBottom=158.0 past=261.3
23.456 geo offset=2674.3 content=2933.0 container=168.0 insetTop=82.0 insetBottom=158.0 past=-8.7
```

`excessBottom` returned 0 here: `visibleBottom - viewportHeight - contentHeight`
= 3194.3 − 438 − 2933 < 0. Its unit test even asserted that a 200 pt
overshoot is "0".

| Before | After |
| --- | --- |
| ![Duo outer screen before: the last reply, then black down to the composer](scroll/duo-before.png) | ![Duo outer screen after: the last reply sits just above the composer](scroll/duo-after.png) |
| ![Phone before: a black band under the last reply](scroll/phone-before.png) | ![Phone after: the last reply sits just above the composer](scroll/phone-after.png) |

### Two more ways past the end, found on the way

The same unrepaired overshoot also comes from these. Both were transient in
the tests, but both feed the same gap.

- **Content shrinking under the offset.** `ThreadModel.refreshTimeline`
  replaces every row with the newest page when that page's first row isn't
  already loaded (more than a page arrived at once). On the phone a 40-row
  burst took content from 3209 to 2523 pt with the offset still at 2593:
  737 pt past the end. The old repair caught it only because that was more
  than a screen.
- **Lazy-stack estimates during a fold restore.** On unfold, the content
  height collapsed from 3087 to 870 pt while the offset stayed at 1635. A
  bottom-marker jump then landed at offset 4350 against content 3865, with
  no rows on screen. The past-end repair is held off while a restore runs
  (`resizeAnchor.restoring`), and nothing re-checked once it finished.

Checked and ruled out: the bottom inset is applied once. It is the
`safeAreaInset(edge: .bottom) { composer }` plus the system keyboard or tab
bar. The measured insets (phone 207 at rest, 267 with quick replies, 452
with the keyboard; Duo 158 / 218 / 428) match the composer's frame.

## The fix

All in `apps/ios/iOS/Thread/ThreadView.swift` and `TranscriptResizeAnchor.swift`:

- **One way to the bottom, pinned to the edge.** `pinToBottom()` is used by
  every scroll-to-bottom. When the marker is on screen, the end is measured,
  so it pins to `.bottom` edge. SwiftUI holds an edge pin through inset
  changes, so the chat stays at its end as the keyboard, composer or quick
  replies change. When the marker is off screen, the edge is only a
  lazy-stack estimate, so it jumps to the marker first, which lays it out,
  and pins to the edge when the marker comes on screen.
- **Any overshoot at rest is clamped.** `TranscriptResizeAnchor.overshoot`
  measures any part of the view past the last row, not just a whole screen.
  `settlePastEnd` runs once scrolling is idle (a bounce isn't fought). It
  scrolls to `lastPoint`, the last valid offset of the *measured* content,
  by point rather than to the marker's estimated place, which could land
  past the end again. Then it re-pins to the edge.
- **The fold restore re-checks when it ends.** `settlePastEnd` runs after
  `resizeAnchor.finish`. The restore's own "beyond maximum" check is gone
  in favour of it; the restore still handles blank and above-the-top cases.
- `TranscriptResizeAnchor.correction` uses the same `lastPoint`, so restore
  corrections and the clamp agree on the valid range.

## Tests

`apps/ios/UITests/TranscriptPastEndUITests.swift`. Set
`TEST_RUNNER_SCROLL_DUO=1` for the Duo's outer screen and
`TEST_RUNNER_SCROLL_SHOTS=<dir>` for screenshots.

| Test | Before (fce99dd3) | After |
| --- | --- | --- |
| `testClosingTheKeyboardAtTheBottomLeavesNoBlank` | **fails**, phone 236 pt, Duo 261 pt | passes, phone and Duo (settled 0 to −1 pt) |
| `testRowsReplacedUnderTheReaderLeaveNoBlank` | passes (guard) | passes |
| `testFoldingNeverLeavesThePastEnd` (Duo) | passes (guard) | passes |

The keyboard test also checks that the newest row rides up with the keyboard
when it reopens. A point-only clamp failed that check at −238 pt, which is
why the clamp re-pins to the edge.

Reproduce (`apps/ios`, your own simulators):

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodegen generate
xcodebuild test -scheme BBStudio -destination id=<iphone> CODE_SIGNING_ALLOWED=NO \
  -only-testing:BBStudioUITests/TranscriptPastEndUITests
TEST_RUNNER_SCROLL_DUO=1 xcodebuild test -scheme BBStudio -destination id=<iphone-duo> \
  CODE_SIGNING_ALLOWED=NO -only-testing:BBStudioUITests/TranscriptPastEndUITests
```

For the step-by-step geometry, launch with `-qaScrollLog` and read
`Documents/scroll-log.txt` in the app's container.

## Risks

- An edge pin that is held while lazy rows *above* the viewport measure in
  should keep the bottom in place; that is what the follow-the-reply flows
  rely on, and they passed in the tests. It hasn't been tried on a real
  device with Markdown images or mini cards resizing at the bottom.
- During a fold or unfold, the viewport can still pass the end for a moment
  while the restore runs (up to about 2.6 s, as before). It's repaired as
  soon as the restore finishes. Real hinge folds can't be driven in this
  simulator; the tests resize the window.
- Not tried on a real Duo: the hardware keyboard's actual height on the outer
  screen, and Patrick's exact all-black frame.
