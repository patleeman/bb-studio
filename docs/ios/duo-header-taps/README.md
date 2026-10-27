# Duo header buttons: a tap near the top scrolled the chat up

26 October 2026. Patrick, TestFlight 1421 (2054), on the iPhone Duo's inner
screen with the list hidden: “if you click on the button to expand the
sidebar it just scrolls up”. Then: “All the buttons on top of the screen
cause scrolling up.”

## Cause

Beside two pages (`DuoLayout.twoPages`), the headers (`DuoHeader`, and
Studio items' own bars) start at the window's top edge. The Duo shows its
status bar in the trailing column, so the top safe-area inset is 0. iOS
still keeps a status-bar tap strip across the top of the window. It takes a
touch there before the app sees it, and scrolls the scroll view under the
touch's x to its top. The button under the finger never gets the tap.

The strip isn't reported. In the simulator the status bar frame is
2 points tall, but every tap above about 20 points is taken (measured with
real taps across the header: y 2, 8 and 14 scroll to the top; y 20 and below
reach the app). On the device it may be taller: Patrick's taps on the
middle of the buttons failed too.

Two more things made the header easy to miss:

- The bell's hit area was its 19 × 20-point glyph, and ⋯ was 18 × 6
  points. SwiftUI hosts a `Menu` in a `UIButton` only as big as its label.
- The header's background didn't take hits, so a tap between its buttons
  reached the transcript under it.

The earlier tests pressed the sidebar button through a Debug `activate`
command, as VoiceOver does, so a real tap was never tested.

## Fix

`StatusBarStrip` (`iOS/App/StatusBarStrip.swift`). While beside two pages,
the strip belongs to the headers:

- **One strip at the root.** `RootView` lays a row of 8-point-wide scroll
  views across the window's top 64 points (`StatusBarStripView`). iOS picks
  the scroll view under a strip tap's x, so the cell under the finger gets
  it. It runs the header control at that x and doesn't scroll. The cells
  never take a touch themselves (`point(inside:)` is false), so normal taps
  reach the header under them.
- **No other scroll view scrolls to top.** Every other scroll view in the
  window gets `scrollsToTop = false` while beside two pages. They get it back
  on one page: on the outer screen and on an iPhone, the status bar sits
  above the navigation bar, and tapping it still scrolls to the top.
- **Header controls are marked.** `DuoHeaderButtonStyle`, which every
  `DuoHeader` button and the sidebar toggle use, puts a
  `StatusBarTapMarker` behind the button. The rail's tabs have one too.
  Header menus mark their label (`DuoHeaderMenuLabel`), and a strip tap
  opens the menu's own `UIButton`. A UIKit bar button under the strip is
  sent its action.
- **44-point hit areas.** Header buttons and menu labels are 44 × 44 points.
- **The header takes its own hits.** `DuoHeader` has a content shape, so a
  tap between its buttons stops there.

A strip tap between controls does nothing beside two pages. Before, it
scrolled a chat to the oldest loaded message.

## Tests

`HeaderTapUITests`, offline, with real taps. Each button gets one tap at its
centre and one near its top edge:

- On the inner screen, the top-edge tap is at y 4, in the strip. A Debug
  `qa-duo/shift?<points>` command moves the 951 × 669 window so the button
  is in the middle of the simulator's screen, which is the outer screen's
  width. Taps near that screen's right edge aren't delivered.
- On the outer screen and on an iPhone, the top-edge tap is 4 points into
  the button.

Each tap must do what the button says: the bell opens Activity, ⋯ opens
its menu, Find opens the find bar, New Thread opens a new thread, and back
goes back. The content at the top of the transcript's visible part must
stay where it was, while the button's view is open and after it closes. The
sidebar toggle must change the list, and the message that was mid-view must
stay in view. The transcript reflows at the new width, so its raw offset
changes.

| Test | Inner screen (even, narrow, hidden) | Outer screen | iPhone |
| --- | --- | --- | --- |
| `testBotChatHeader` | toggle, bell, ⋯ | bell, ⋯ | bell, ⋯ |
| `testThreadHeaderEven` | toggle, ⋯, Find, the list's New Thread | ⋯ | ⋯, back |
| `testThreadHeaderNarrow`, `testThreadHeaderHidden` | toggle, ⋯, Find | | |

Run them with `TEST_RUNNER_HEADER_LAYOUT=inner|outer|phone` (inner and outer
on an iPhone Duo simulator).

On the outer screen the test found no navigation-bar back button in the
thread, so back is tested on the iPhone only. Studio items keep native navigation bars, and
the offline fixtures have no Studio items, so their bar buttons have no UI
test. A strip tap there reaches the bar button through the UIKit path.

### Results

Before is the base, f841f8ed, with only the test and its `shift` command
added.

| Layout | Before | After |
| --- | --- | --- |
| Duo inner screen, list even, narrow and hidden | All 4 tests fail. A strip tap on the sidebar toggle, bell, ⋯, Find or New Thread doesn't act and scrolls the transcript to offset 0. ⋯ doesn't open even from a centre tap. | All 4 pass |
| Duo outer screen | Passes: its navigation bar is below the strip | Passes |
| iPhone 17 Pro | Passes: its navigation bar is below the status bar | Passes |
