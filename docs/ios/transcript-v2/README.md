# The chat transcript on UIKit (flagged)

Settings ▸ Diagnostics ▸ **New chat transcript**, off by default. Turned
on, the Bot chat and threads draw on a UIKit transcript and composer
(`apps/ios/iOS/Transcript/`). Turned off, `ThreadView` is the SwiftUI
transcript, untouched. Debug builds can turn it on for a launch with
`-qaTranscriptV2`.

The SwiftUI transcript measured its geometry and then corrected it. That
loop caused the black past the end, the hovering composer, the gaps and two
watchdog hangs (see [the scroll root cause](../scroll-root-cause.md)). The
new transcript has one owner of the scroll position, and nothing writes
geometry back into layout.

## How it works

- **Rows.** A `UICollectionView` with a diffable data source keyed by row
  id. Each cell hosts the row's SwiftUI view (`MessageBubble`, the Bot's
  rows, cards, questions) through `UIHostingConfiguration`, so the rows
  look as they did. A row whose content changes (a streamed token) redraws
  only its own cell, with no snapshot.
- **Layout.** `TranscriptListLayout`: one column, top to bottom, not
  inverted, so VoiceOver order, context menus, text selection, the scroll
  indicator and interactive keyboard dismissal stay native. Heights are kept
  by row id. A short chat rests at the top, with no gap above it.
- **One owner.** `TranscriptController` is the only thing that writes the
  scroll offset, and every write is clamped to the valid range. It can't
  rest past the end.
- **Following or reading.** A state machine (`TranscriptFollow`) that changes
  only where the reader's own scroll comes to rest (near the end means
  following) and on the jump pill. A send counts as a jump. Layout, insets,
  the keyboard and new rows never change it.
  - Following: the anchor is the end of the content.
  - Reading: the anchor is the first row that starts at or below the top
    edge. Height changes above it (self-sizing, a card opening, older pages
    going in) move the view by the same amount, in the layout's own
    invalidation, so nothing on screen moves.
- **The pill.** While reading, a jump button with a count of new rows
  ("↓ 12 new"). On a phone it sits in the corner; beside two pages it is
  centred above the composer over a scrim.
- **Composer and keyboard.** The composer, Duo header and find bar are in
  the same container. The container leaves the keyboard's safe area in, so
  it ends at the keyboard's top, and the composer rests on that bottom, or on
  its resting edge when lower. The bottom content inset comes from the
  composer's frame and is written only when it changes by more than 0.5 pt.
  - Resting edge: 8 pt above the home indicator (and the tab bar) on an
    iPhone and the Duo's outer screen. On the Duo's inner screen it is 8 pt
    above the window's bottom edge. That includes iOS's two-app split there,
    detected as a phone-idiom screen at least 900 × 600 pt.
- **Generic.** The container takes ordered rows (any `Identifiable &
  Equatable`) and a SwiftUI view for each, and imports nothing from the
  app. It hands back near-top (for older pages), follow changes and pill
  state. `TranscriptHandle` takes requests: jump, scroll to a row,
  reconfigure a row, and carry a row's height to a new id (an optimistic row
  confirmed by the server).

### Using it in another app

- **Tap to close the keyboard.** The container already does this. A tap
  anywhere on the transcript ends editing. The tap recognizer never takes
  the touch, so links, buttons and text selection in a row keep working.
  The app chooses when editing ends (`dismissKeyboard`). The default waits
  one run-loop turn, so a tapped link still opens; BB waits until the
  window has stopped resizing.
- **Swipe down to close it.** The transcript dismisses the keyboard
  interactively (`keyboardDismissMode = .interactive`). As in any UIKit
  scroll view, the keyboard only starts to follow once the drag reaches
  its top edge; a swipe higher up scrolls the rows and leaves the keyboard
  up.
- **Accessibility identifiers.** A row's SwiftUI view is hosted in a cell.
  An identifier set on the row is passed down to the elements inside it,
  unless the row is an accessibility container. To find the row itself in
  a UI test, make it one (`.accessibilityElement(children: .contain)`), or
  set identifiers on the elements you want.
- **Swift 6.** The folder builds in Swift 6 language mode with no warnings.
  `apps/ios/scripts/check-transcript-swift6.sh` checks this, with and
  without DEBUG. The diffable data source holds row ids as
  `TranscriptRowID`, a `Sendable` wrapper. It is `@unchecked` because the
  snapshot never leaves the main actor; the rest of the API still takes
  any `Hashable` id.

### Deviation: no keyboard layout guide

The plan pinned the composer to `keyboardLayoutGuide`. Hosted in SwiftUI,
neither the view's guide nor the window's ever moved: their frames stayed at
zero size through every keyboard show and hide (iOS 27 simulator; scroll log
`v2 viewLayout … guide=(0.0, 0.0, 0.0, 0.0)`), and the composer stayed under
the keyboard. The container instead leaves SwiftUI's keyboard safe area in
(`.ignoresSafeArea(.container)`), which ends it at the keyboard's top, with
no keyboard notification math. This keeps one dependency of the old path:
the hovering composer Patrick saw would come back if SwiftUI's keyboard
inset stuck.

## Tests

`apps/ios/scripts/test-transcript.sh` runs everything, offline.

### Replay harness

`TranscriptReplayTests` runs `TranscriptReplay` in a phone window, the Duo's
outer screen and the inner screen. The steps:

- 60 streamed tokens;
- a burst of 40 rows;
- a simulated keyboard up and down;
- an image that loads and a card that opens;
- fold, unfold and split;
- scrolling up through a 3,000-row history paged in from the near-top
  callback;
- a card opening across the top edge;
- the window resized and backgrounded;
- jump to latest;
- a short chat in a sheet that grows and shrinks.

After every step it checks:

- the view is never past the end;
- while following, the end sits just above the composer;
- while reading, the anchor row moves less than 1 pt;
- the composer's gap matches the layout;
- every visible row is as tall as it measures;
- layout passes per step are bounded, and nothing is written at rest.

With anchoring turned off (`TRANSCRIPT_CONTROL_NO_ANCHOR`), prepends drift
about 16,500 pt and the checks fail, so they aren't blind.

**M0 gate** (2e5ba03f), all three layouts, 158 steps each: 0.00 pt past
the end, 0.00 pt off the end while following, 0.00 pt anchor drift, 0.00 pt
composer gap error, at most 10 layout passes per step, and no work at rest.

The row-height check came later. It found rows a few to 60 pt off their
height, which the renders showed as a gap under a bubble. That is now fixed:
rows on screen measure again after each layout pass, and rows lay out at
their ideal height.

### UI tests

`TranscriptV2UITests` runs on a phone, the Duo's outer screen
(`TEST_RUNNER_TRANSCRIPT_LAYOUT=outer`) and the inner screen's right page
(`split`). It uses the real composer and keyboard, offline on the local Bot
demo, and samples the live scroll view every 0.1 s.

- `testBotChat`:
  - a reply comes in and streams with the keyboard up;
  - the composer sits above the keys;
  - a tap and a swipe down close the keyboard, and the draft and its photo
    stay;
  - up in the history, a burst of 12 and the keyboard going up and down move
    the rows 0.0 pt;
  - the pill counts the new rows, and the jump follows a stream again;
  - on the split, full width with the list hidden.
- `testThreads`: a Bot thread from Running (the split lists one) and a normal
  thread from the Threads list. Each opens at its end with the right
  composer gap, shows the pill up in the history, and jumps back.

All pass on all three layouts. No sample was past the end or blank.

## Renders

Dark. The phone renders are screenshots, so they show the keyboard. The Duo
renders are window captures at 3×, scaled down. They don't draw the keyboard;
with it up, the composer sits on its top edge.

| | Keyboard down | Keyboard up | Up in the history |
| --- | --- | --- | --- |
| iPhone | ![](phone-keyboard-down.png) | ![](phone-keyboard-up.png) | ![](phone-reading-keyboard-up.png) |
| Duo outer screen | ![](duo-outer-keyboard-down.png) | ![](duo-outer-keyboard-up.png) | ![](duo-outer-reading.png) |
| Duo inner, split | ![](duo-split-keyboard-down.png) | ![](duo-split-keyboard-up.png) | ![](duo-split-reading.png) |
| Duo inner, full width | ![](duo-full-width-keyboard-down.png) | ![](duo-full-width-keyboard-up.png) | |

A thread on the inner screen's split: [split](duo-split-thread.png). On the
outer screen: [outer](duo-outer-thread.png).

## Follow-ups (27 October)

- **Replay green in the full suite.** The drift came from the reading
  anchor being taken again inside layout passes while rows sized
  themselves during a scroll; only the reader's own movement moves it now.
  Rows on screen measure again in one batched pass. How many passes rows
  take depends on timing (11 in a quiet run, 51 under the full suite's
  load), so each step is held to 3 layout passes and 2 offset writes per
  row whose height changed. A loop lays out without anything resizing, so
  it still fails. Full `BBStudioTests` beside a parallel replay and UI run:
  381 tests, 0 failures.
- **Question pill.** A question or approval waiting while reading doesn't
  move the reader. The pill turns orange and says "Question" ("Approval",
  "N waiting"); push and the badge are as before. Sending still jumps to
  the end.
- **Duo.** The composer uses `DuoLayout.innerScreen`, so iOS's two-app split
  on the inner screen rests 8 pt above the edge, as the old path does. The
  `transcript-<id>` content probe is wired. `DuoSplitComposerUITests` passes
  with the flag on.
- **Flag-on tests.** `TranscriptV2UITests` adds:
  - row actions: Copy, Quote, Select Text, Reply in Thread, Edit;
  - find, on the split, where the demo lists its thread;
  - the question pill;
  - offline mini cards.

  `TEST_RUNNER_TRANSCRIPT_V2=1` puts any UI suite on the new transcript,
  including the staged mini-card and side-thread suites.
- **Find was broken on the new path.** The hooks took the whole view, which
  SwiftUI can't compare, so the view never moved to a match. They now take
  the values they watch.

## M2: parity and coverage (27 October)

Every screen that opens a thread (Threads, the Bot tab, item chats from
Studio, pages and related items, automations) goes through `Route.thread`
to the same `ThreadView`, so all of them get the new transcript.

| Parity | State |
| --- | --- |
| Fold and unfold keep the reading position | Done. The container's anchor holds through width changes; the old `TranscriptResizeAnchor` restore isn't used on the new path. `testFoldKeepsTheReadingPosition`: the top row comes back at the same y after a fold and an unfold. |
| Unread divider, opening at the first unread | Done. A scroll to a row that isn't in yet waits for it. `testThreadParity` (`-qaDemoUnread 8`): the divider is on screen, reading. |
| Older history in threads | Done. The near-top callback loads pages in threads as in the Bot chat. `testThreadParity`: content 4,818 → 11,574 pt, nothing past the end. |
| Edit, quote, select in threads | Done. `testThreadParity`. |
| Question pill in a thread from the Threads list | Done. The demo now tells every open view of the thread (it told only the last one). |
| Header buttons in the status-bar strip | Done. The transcript's scroll view gives up scroll-to-top beside two pages, as the old path's scroll views do. |
| Voice mode and read-aloud | Same composer and rows. `NoVoiceChatUITests` passes on the new path; read-aloud has no offline test. |
| Scroll log and breadcrumbs | `v2 geo` lines like the old `geo` lines, ids through `ScrollLog.id`; tap-to-close writes its breadcrumb. `ScrollLogUITests` passes on the new path. |
| Mini cards with real content | Done. `MiniCardUITests` passes on the new path against a staged BB seeded by `apps/ios/scripts/seed-staged-minis.py`. |
| Side threads with real content | Done. `BotSideThreadUITests` passes on the new path (iPhone simulator) against a staged BB: a Bot made from a seeded thread (`bot_create`), a follow-up, `bot_side_thread_open` on the newest reply and one message in it. |

### Existing suites on the new path

`TEST_RUNNER_TRANSCRIPT_V2=1`, each also run with the flag off on the same
simulator to compare.

| Suite | New path | Old path |
| --- | --- | --- |
| TranscriptPastEnd (phone, Duo) | 7 + 8 pass | — |
| TranscriptTapDismiss (phone, outer, split) | pass; split: the links test fails | split: the same links test fails |
| TranscriptHang, Composer, DraftAttachment, ScrollLog, NoVoiceChat (phone, Duo), KeyboardFocusAway (phone, outer, split), KeyboardFold, DuoPaneWidth, DuoPhoneRoot, DuoSplitComposer, DuoSplitWidth | pass | — |
| HeaderTap (Duo) | the 3 thread tests fail on "find centre: the transcript moved" | the same 3 fail, the same amounts (+17, −44, −5 pt) |
| DuoEdgeToEdge, DuoRegularComparison, DuoSidebarSearch (with main's offline fixtures) | pass | pass |
| DuoLayout | skips (screen too small) | skips |
| DuoLongTranscript, DuoQuickReplies | fail | fail the same tests |

**Find doesn't move the view.** When Find opens while reading, the header
grows by the find bar (52 pt) and the offset drops by the same 52 pt, so
the row at the top of what the reader sees stays (scroll log:
`insets top=110`, `offset layout from 1488.3 to 1436.3`). What HeaderTap
reports next is rows above the reader, still at estimated heights,
measuring for real (content 6262 → 6278 → 6293 pt); the view moves with
them, so nothing moves on screen, but the test measures in content
coordinates. The old path shows the same numbers. Tracking the top row
itself, rather than the content offset, would tell the two apart.

## Known gaps

- Mini cards and side threads with real content need a staged server. Run
  `MiniCardUITests` and `BotSideThreadUITests` with `TEST_RUNNER_TRANSCRIPT_V2=1`.
- iOS's two-app split can't be driven in the simulator. The inner-screen rule
  is main's, and untested on a device.
