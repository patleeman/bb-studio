# The gap under the composer beside another app

26 October 2026. Patrick, on TestFlight 20261026.1421: “There is still a gap
underneath the input area.” His screenshot shows the Duo's inner screen in
iOS's own two-app split: X on the left and BB Studio on the right, with the
keyboard down. X's content runs to the screen's bottom edge. Our composer
ends about 42 points above it.

## Cause

On the inner screen, iOS reports a 34-point bottom safe area for a home
indicator that the screen doesn't draw. TestFlight 0228 (f3239dd3) made the
chat ignore that inset, so the composer sits 8 points from the edge. See
[the split composer](../duo-split-composer/README.md#no-status-corner-no-gap-under-the-composer).
That rule ran only in our own two pages (`DuoLayout.twoPages`), which needs
a window at least 900 points wide.

Beside another app, our window is about 468 × 669 points. That's one page,
so the chat used the phone layout and kept the 34-point inset under its own
8-point padding: a 42-point gap. In this layout iOS moves the navigation
buttons and the tab bar into the trailing column, so nothing sits under the
composer except the empty inset.

The full-width, narrow and even list widths from 1421 were not the cause.
All three already measured 8 points. The 1421 build (3ff2f56d) and
`origin/main` (49ddf285) have the same layout code.

## Fix

The rule now depends on the screen, not on how many pages we show.

- `DuoLayout.isInnerScreen` decides from the screen's size: phone idiom,
  at least 900 × 600 points, wider than tall. The window can be any width.
  No iPhone screen is that tall in landscape, and an iPad isn't a phone.
  `WindowGeometry` reports it with the window's size and insets.
- `DuoLayout.chatIgnoredEdges` is the one place that decides where the
  composer sits. Beside two pages, the chat runs under the trailing status
  column. On the inner screen, it also runs under the bottom inset. The
  composer keeps its own 8-point padding, so it ends 8 points from the
  window's bottom edge. `ThreadView` only applies the result. The keyboard's
  safe area still applies everywhere.

The outer screen, an iPhone and an iPad are unchanged. The inner screen in
portrait (669 × 951) is not matched, and keeps the inset as before.

## Measured gaps

From `DuoSplitComposerUITests` on an owned iPhone Duo simulator and an owned
iPhone 18 Pro. “To edge” is the window's bottom edge minus the composer's
bottom edge. “Above keyboard” is the keyboard's top edge minus the
composer's bottom edge. The Bot's chat and a thread from the Threads list
measured the same in every layout.

| Layout | Window | Bottom inset | To edge, before | To edge, after | Above keyboard, before | Above keyboard, after |
| --- | --- | --- | --- | --- | --- | --- |
| Duo inner, list hidden (full width) | 951 × 669 | 34 | 8 | 8 | 8 | 8 |
| Duo inner, narrow list | 951 × 669 | 34 | 8 | 8 | 8 | 8 |
| Duo inner, even split | 951 × 669 | 34 | 8 | 8 | 8 | 8 |
| **Duo inner, beside another app (iOS split)** | 468 × 669 | 34 | **42** | **8** | 8 | 8 |
| Duo outer | 466 × 678 | 34 | 42 (8 above the indicator) | 42 | 8 | 8 |
| iPhone 18 Pro | 402 × 874 | 34 | 91 (8 above the tab bar) | 91 | 8 | 8 |

The outer screen draws its home indicator, and the composer sits 8 points
above it, which is the system's standard placement. There's no empty band.
On the iPhone the tab bar shows under the chat, and the composer sits
8 points above it.

## Tests

- `DuoSplitComposerUITests.testComposerGapInEveryLayout`, on the Duo: the Bot's
  chat and a thread at each list width, beside another app and on the outer
  screen. With the keyboard down, it checks 8 points to the inner screen's
  edge, or at least 8 points above the outer screen's home indicator. With
  the keyboard up, it checks 8 points above the keyboard. Before the fix it
  failed with 42 points beside another app, in both chats.
- `DuoSplitComposerUITests.testComposerGapOnAPhone`, on the iPhone 18 Pro:
  clear of the home indicator with the keyboard down, and 8 points above the
  keyboard with it up.
- `DuoLayoutTests.testInnerScreenAndTheEdgesAChatRunsUnder`: which screens
  count as the inner one, and the edges each layout ignores.
- `DuoEdgeToEdgeUITests` expected the inner screen's composer 8 points above
  the 34-point inset. That has been out of date since f3239dd3, so it now
  expects 8 points from the edge (an iPad keeps the inset).

The simulator can't run iOS's two-app split. The Debug `qa-duo/split` command
resizes the window to 468 × 669 and tells the layout that the screen is the
inner one. Debug `layout` now also reports the keyboard's top edge in the
window. The keyboard's frame that XCUITest reports belongs to the simulator's
outer screen.

## Renders

Dark, the window rendered at 2×. The renders don't draw the keyboard. With
the keyboard up, the composer sits above where it would be. Before is
`origin/main` 49ddf285 with only the Debug hooks added.

### The Bot's chat

| Layout | Before, keyboard down | After, keyboard down | Before, keyboard up | After, keyboard up |
| --- | --- | --- | --- | --- |
| Beside another app | ![](before-bot-chat-inner-split-down.png) | ![](after-bot-chat-inner-split-down.png) | ![](before-bot-chat-inner-split-up.png) | ![](after-bot-chat-inner-split-up.png) |
| Inner, list hidden | ![](before-bot-chat-inner-hidden-down.png) | ![](after-bot-chat-inner-hidden-down.png) | ![](before-bot-chat-inner-hidden-up.png) | ![](after-bot-chat-inner-hidden-up.png) |
| Inner, narrow | ![](before-bot-chat-inner-narrow-down.png) | ![](after-bot-chat-inner-narrow-down.png) | ![](before-bot-chat-inner-narrow-up.png) | ![](after-bot-chat-inner-narrow-up.png) |
| Inner, even | ![](before-bot-chat-inner-even-down.png) | ![](after-bot-chat-inner-even-down.png) | ![](before-bot-chat-inner-even-up.png) | ![](after-bot-chat-inner-even-up.png) |
| Outer | ![](before-bot-chat-outer-down.png) | ![](after-bot-chat-outer-down.png) | ![](before-bot-chat-outer-up.png) | ![](after-bot-chat-outer-up.png) |
| iPhone 18 Pro | ![](before-bot-chat-phone-down.png) | ![](after-bot-chat-phone-down.png) | ![](before-bot-chat-phone-up.png) | ![](after-bot-chat-phone-up.png) |

### A thread from the Threads tab

Only the split changed. The other layouts' before renders match the after
ones, as the gap table shows.

| Layout | Before, keyboard down | After, keyboard down | Before, keyboard up | After, keyboard up |
| --- | --- | --- | --- | --- |
| Beside another app | ![](before-thread-inner-split-down.png) | ![](after-thread-inner-split-down.png) | ![](before-thread-inner-split-up.png) | ![](after-thread-inner-split-up.png) |

| Layout | Keyboard down | Keyboard up |
| --- | --- | --- |
| Inner, list hidden | ![](after-thread-inner-hidden-down.png) | ![](after-thread-inner-hidden-up.png) |
| Inner, narrow | ![](after-thread-inner-narrow-down.png) | ![](after-thread-inner-narrow-up.png) |
| Inner, even | ![](after-thread-inner-even-down.png) | ![](after-thread-inner-even-up.png) |
| Outer | ![](after-thread-outer-down.png) | ![](after-thread-outer-up.png) |
| iPhone 18 Pro | ![](after-thread-phone-down.png) | ![](after-thread-phone-up.png) |
