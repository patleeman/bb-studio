# Duo inner screen: full-width chat, a resizable list, and a gap under the status cluster

26 October 2026. Patrick, on the iPhone Duo's inner screen (951 × 669 points,
phone idiom, two pages, crease at x ≈ 475):

1. “I want an option to full width the chat. Is that possible on the duo? Or
   shrink the sidebar.”
2. With the keyboard up: “text in the chat gets covered by the controls. We
   need that gap on the top right of the chat transcript.” The Duo's status
   cluster (Now Playing art, clock, battery) floats at the top right, and his
   blue bubble ran under it.

## The list pane

The Bot, Threads, Studio and Settings tabs share one container,
`RegularPages`. The Threads tab now uses it too, in place of its own copy.
The list has three widths:

| Width | List | Divider |
| --- | --- | --- |
| Even (the default) | 395.5 points | on the crease, as before |
| Narrow | 300 points | at x 380 |
| Full width | hidden | none; the detail runs from the rail to the edge |

- **Header button.** Every detail header (`DuoHeader`) leads with a
  sidebar button, “Hide list” or “Show list”. Studio's items, which keep
  their own bars, get it as a leading toolbar item. It brings the list back
  at the width it had. The empty detail (“No thread selected”, “Select an
  item”) offers “Show list” too.
- **Divider.** The crease gutter is the divider. It has a grab handle (a
  5 × 44-point capsule) and a 44-point-wide hit area. Dragging it shows an
  accent line where it will land. On release it snaps to the nearest of
  hidden, narrow and even. It can be adjusted with VoiceOver too.
- **Edge swipe.** With the list hidden, a swipe in from the detail's leading
  edge shows a preview and brings the list back where it's let go: narrow or
  even.
- **Remembered.** The width and the last width shown are stored in
  `UserDefaults` on this device. They survive a relaunch, and folding to the
  outer screen and back.

The list keeps its width while the divider is dragged, and the width changes
once, without animating. A first version resized live and animated the
change. The [recording](#recording) of that version showed the chat jumping
up its history while the width changed, before its resize anchor brought it
back to the end. A single change is what a fold does, which the anchor
already handles.

While shrinking below its narrow width, the list keeps 300 points and slides
under the rail rather than squeezing its rows.

## The gap under the status cluster

The Duo reports its status bar as an 84-point trailing safe area, the height
of the window. Since [the split composer](../duo-split-composer/README.md),
the transcript ran under it, so bubbles reached 12 points from the window's
edge. The cluster floats in the column's top: in Patrick's screenshot with
music playing, it runs from about 23 to 187 points down and from 20 to 75
points in from the edge. (Measured against the header's 58 points and the
composer's 12-point margin. Only this screenshot was on disk; the earlier
clock-only cluster was 104 points tall.)

**Fix.** `RegularScrollingSurface`, which every detail scroll view uses,
now keeps its content clear of the status column. Scroll views still draw
their background under it, but their content gets the column as a trailing
safe-area padding. It holds whatever the keyboard, list width or scroll
position.

- The **composer is unchanged**. It still runs under the column, 12 points
  from the window's edge, as Patrick asked.
- The **jump button** stays centred on the page above the composer.
- The **header** was already clear: its actions stay inside the safe area.
- In **full width**, the transcript is held to its 760-point readable width,
  and the room beside it already clears most of the column. The padding is
  only what's left (20.5 points), so the transcript moves as little as
  possible. It and the composer then sit about 10 points apart in centre.

This keeps the whole right edge of the transcript clear, not only the band
beside the cluster. Narrowing only the rows that pass the cluster would
reflow them as they scroll past it. A row that rewraps changes height, and
every row below it would jump on each crossing. A gap down the whole edge
is the simplest layout that clears the cluster in every state.

Only `ThreadView` changed by one line: it passes its readable width to
`RegularScrollingSurface`. Its scroll and keyboard code is untouched.

## Tests

`DuoPaneWidthUITests`, on an owned iPhone Duo simulator with the offline
`-qaDuoWideTitles` fixture:

- `testToggleHidesAndShowsTheList`: the header button hides the list (the
  detail starts at the rail, the rail stays), shows it, brings narrow back as
  narrow, and an edge swipe shows it.
- `testDividerSnapsToEachPoint`: the divider sits on the crease with a
  44-point hit area, and drags snap to narrow, even, narrow and hidden.
- `testWidthPersistsAcrossRelaunchAndFold`: narrow and hidden survive a
  relaunch. Hidden, narrow and even each survive folding to the outer screen
  and back, with the chat still at its end.
- `testNoBotChatTextUnderTheStatusCluster` and
  `testNoThreadTextUnderTheStatusCluster`: at each width, at the end, up in
  the history and with the keyboard up, no text lies in the status column's
  top 196 points (the cluster plus a margin).

The simulator's screen is the Duo's outer screen (466 × 678). The fixture
stretches the window to 951 × 669, but XCUITest can't touch most of the right
page. The tests press the header button through a Debug `activate` command,
which activates it through accessibility as VoiceOver does. They raise the
keyboard with `focus?<thread>`. The divider and edge swipe are real drags.

`DuoLayoutTests` covers the snap points, the drag preview and the column
padding. `DuoSplitComposerUITests`, `DuoQuickRepliesUITests` and
`DuoEdgeToEdgeUITests` now expect transcript content to stop at the status
column while the composer still runs under it.

## Renders

Dark, the window rendered at 2×. Before is the base, f3239dd3, where only the
even split exists. Up in the history the jump button shows. “Keyboard up”
has the keyboard raised; the window render doesn't draw it, but the composer
sits above it. The simulator draws no status cluster: its place is the right
84 points, where text now stops.

### Bot chat

| | Up in the history | Keyboard up |
| --- | --- | --- |
| Before, even | ![](before-bot-chat-even-history.png) | ![](before-bot-chat-even-keyboard.png) |
| After, even | ![](after-bot-chat-even-history.png) | ![](after-bot-chat-even-keyboard.png) |
| After, narrow | ![](after-bot-chat-narrow-history.png) | ![](after-bot-chat-narrow-keyboard.png) |
| After, full width | ![](after-bot-chat-hidden-history.png) | ![](after-bot-chat-hidden-keyboard.png) |

### A thread from the Threads tab

| | Up in the history | Keyboard up |
| --- | --- | --- |
| Before, even | ![](before-thread-even-history.png) | ![](before-thread-even-keyboard.png) |
| After, even | ![](after-thread-even-history.png) | ![](after-thread-even-keyboard.png) |
| After, narrow | ![](after-thread-narrow-history.png) | ![](after-thread-narrow-keyboard.png) |
| After, full width | ![](after-thread-hidden-history.png) | ![](after-thread-hidden-keyboard.png) |

### Recording

[drag-and-toggle.mp4](drag-and-toggle.mp4): the divider dragged to narrow and
back to even, the header button hiding and showing the list, the divider
dragged shut, and an edge swipe bringing the list back. It's assembled from
window renders in the Debug build (`record?start`), because the simulator's
own screen recording shows only the outer screen. Run
`DuoPaneWidthUITests/testRecordDragAndToggle` with
`TEST_RUNNER_DUO_PANE_RECORD=1` to make it again.
