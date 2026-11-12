# Typing during a burst of thread events

Reported 2026-10-17: in a long, busy thread (hundreds of turns, large Markdown
tables in tool output, about 20 background-task notifications within a couple
of minutes), typing in the composer lagged and the phone got warm until the
burst ended. Fixed on a side branch then (bb-studio 806bcb96), and ported to
the UIKit transcript on 2026-11-12 (BUGS.md B12).

## Causes

1. **Every key redrew the whole thread.** The draft was `@State` on
   `ThreadView`, which also builds the transcript's rows. `@State` redraws the
   view that owns it, so each key rebuilt the row list, diffed it in
   `TranscriptContainer`, and rebuilt the toolbar and the composer. A
   `Binding` made in `ThreadView`'s body (`$draft`, for `TalkDraft`) reads the
   text too.
2. **Each key also wrote the draft to `UserDefaults`.** Any write to the
   standard defaults redraws every view with an `@AppStorage`, and
   `ThreadView` has one (`runningPlugins`), as does `TranscriptV2Switch`.
3. **Each refresh redrew the thread more than once.** `refresh` and
   `loadInteractions` assigned `thread`, `error`, `interactions` and `queued`
   even when nothing had changed.

Smaller costs: the `@`/`/` suggestion checks built a regex on every composer
redraw, and the composer re-measured the whole draft on every layout pass.

## Fixes

- The draft lives in an `@Observable` `DraftText`. Only the composer reads
  it, built in its own body (`Isolated`), with `TalkDraft` attached there.
- The draft is saved to `UserDefaults` 500ms after typing pauses, and when
  the thread closes. `DraftText` holds the pending save. A `.task(id: draft)`
  on the composer restarted on every update of the UIKit transcript's
  composer host, which the save's own defaults write caused, so the app never
  went idle (468f2ce48).
- `refresh` and `loadInteractions` write `@Published` values only when they
  changed.
- `MentionSuggestions.query` and `CommandSuggestions.query` read only the
  last word, with no regex.
- `ComposerField` re-measures only when its text, width, font size or insets
  change.

The side branch also made `MessageBubble` `Equatable` for the SwiftUI
transcript. The UIKit transcript redraws only the cells whose rows changed,
so that part wasn't ported.

## Measurements

`-qaBurstDemo` ([`BurstDemo.swift`](../iOS/Thread/BurstDemo.swift)) serves a
60-turn thread from a local fake server. Each turn has a 40-row and a 30-row
table in tool output and a reply with a 14-row table. All 240 rows are
loaded, as after scrolling up. A typist then inserts a key into the composer
every 110ms:

- 4s of quiet
- a burst of 20 notifications, each followed by a reply streamed in 5 steps
  and a tool call (about 144 change signals in 20s)
- 4s of quiet

*Latency* runs from inserting a key to the next display-link callback, which
waits while the main thread is busy. *Dropped* frames took longer than two
refresh intervals. *Overrun per signal* is the frame time past the refresh
interval during the burst, divided by the change signals. *Thread redraws*
count `ThreadView` bodies.

iPhone 17 Pro simulator (iOS 27.0) on an M-series Mac, UIKit transcript.
Before: 3 runs; after: 5 runs.

| | Before | After |
| --- | --- | --- |
| Quiet typing, latency p50 / p95 | 19–36 / 48–49 ms | 6–11 / 15–29 ms |
| Quiet typing, dropped frames in 4s | 21–30 | 0–1 |
| Quiet typing, thread redraws for 35 keys | 72 | 0 |
| Typing in the burst, latency p50 / p95 | 31–33 / 48–51 ms | 9–14 / 27–32 ms |
| Typing in the burst, max latency | 74–90 ms | 31–63 ms |
| Dropped frames in the burst | 160–174 | 72–76 |
| Thread redraws in the burst | 421–423 | 75–78 |
| Overrun per change signal | 46–48 ms | 18–23 ms |

A phone is slower than a Mac, so expect higher absolute numbers on device.
The ratios should hold.

## Tests

`TypingBurstUITests`:

- `testTypingDoesNotRedrawTheThread` types 41 keys and reads
  `thread.body` from `bbstudio://qa-duo/counts` (54–74 before, 1 after).
- `testTypingDuringABurst` runs the harness and prints its numbers
  (`BURST-RESULT`, kept as `burst.*` counts).
- `testTypingAndDraftSurvivesRelaunch` checks the debounced save.

## Reproducing

```sh
xcrun simctl launch --console-pty <private-simulator> nyc.plee.bbgo \
  -serverURL https://offline-fixtures.invalid -skipPushPrompt YES -qaBurstDemo \
  -openURL bbstudio://thread/thr_burstdemo1
```

Wait for the `[burst] done` line. `-qaBurstTurns <n>` changes the thread's
length. `-qaBurstQuiet` serves the thread without the typist. To find what
redraws a view, temporarily add `let _ = Self._printChanges()` to its body.
