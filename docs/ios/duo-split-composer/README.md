# Duo split view: composer width, jump button and the status corner

25 October 2026. On the iPhone Duo inner screen (951 × 669 points, phone
idiom, two pages), three things were wrong in a chat in the right page:

1. The composer stopped about 84 points short of the page's right edge, while
   the message bubbles reached it.
2. The “Jump to latest” button sat in the bottom-right corner of that narrower
   composer, on top of the user's bubbles.
3. Transcript text ran under the status bar's clock and icons at the top right.

## Cause

The Duo reports its status bar as an 84-point safe-area inset on the window's
trailing edge, a column the height of the window. The clock and icons sit only
in its top 100 or so points.

The [v7 layout](../duo/V7.md) let the transcript run under that column
(`RegularScrollingSurface` ignores the trailing safe area beside two pages), but
not the composer or the jump button. Both stayed inside the safe area, so the
composer ended at x 855 while bubbles reached x 939, and the jump button sat at
the safe edge, over the bubbles. Patrick's screenshot of the real inner screen
shows the same 84 points: its composer also ends at about x 855.

Nothing covered the top of the column either. Rows scrolled under the header
bar (58 points high), but the clock and icons reach further down, so text below
the header ran under them. The system doesn't report how far down they reach:
the top safe-area inset is 0 and, in the simulator, the status bar frame is the
outer screen's.

## Fix

Beside two pages (`DuoLayout.twoPages`), in `ThreadView`:

- **Composer.** The transcript, jump band and composer together ignore the
  trailing safe area, as the transcript alone did. The composer uses the
  transcript's margins (12 points in the Bot's chat, 16 in other threads), so
  both edges line up with the bubbles. The header and find bar keep their
  buttons clear of the status column.
- **Jump button.** It sits in its own band above the composer, centred on the
  page. The band is a bottom safe-area inset, so the transcript's bottom inset
  includes it. Rows fade out under it on the page's background, so the button
  never sits on a row's text. The band shows only while the button does.
- **Status corner.** `StatusCorner` covers the top 104 points of the status
  column with the page's background, fading out over 16 points below it.
  Rows scroll under it as they scroll under the header. It shows only when the
  window has a trailing inset and no leading one: the Duo's status column, not
  a landscape iPhone's notch insets.

The outer screen, portrait and other iPhones keep one page, and nothing changed
there: the composer keeps its 12-point margins inside the safe area and the
jump button floats in the bottom-right corner.

The quick replies' row now borders the status column. SwiftUI stretches that
scroll view's frame to the window edge and insets its content by the same
12 points, so the replies still show only within the composer's width. The
Debug `replies-end` helper now scrolls to that inset end.

## Tests

`DuoSplitComposerUITests` runs on an owned iPhone Duo simulator with the
`-qaDuoWideTitles` fixture. In the Bot's chat, a Bot thread from Running and a
normal thread from the Threads list, it checks that:

- the composer's leading and trailing edges match the transcript's content
  edges within 4 points;
- the jump button, shown up in the history, is centred on the page within
  2 points and is above the composer;
- the jump button lies below the transcript's visible area (its bottom inset
  includes the button), and doesn't overlap the last visible row's text;
- any transcript text in the status column's top 100 points is covered.

Before the fix, all four failed in all three cases: the composer ended at
x 855 against the transcript's 939 or 935, the button's centre was at x 823
instead of 721, and text lay under the clock and icons. A second test checks
that the Duo's outer screen and an iPhone 18 Pro keep the old composer and
corner button.

The Debug transcript probe `transcript-<thread id>` records the transcript's
content edges. Debug `mid` now scrolls ordinary threads, not just the Bot's
chat. The quick-reply test's Duo history fixture has one reply made longer
(“Later today”), so the row is still wider than the wider landscape composer
(435 points) but fits the portrait one (473).

## Renders

Dark, UIKit window renders at 2×, scrolled up into the history so that the jump
button shows.

| Case | Before | After |
| --- | --- | --- |
| Bot chat | ![](before-bot-chat.png) | ![](after-bot-chat.png) |
| Bot thread (Running) | ![](before-bot-thread.png) | ![](after-bot-thread.png) |
| Normal thread (Threads) | ![](before-thread.png) | ![](after-thread.png) |

The Duo's outer screen (466 × 678) and an iPhone 18 Pro, after the change, are
unchanged: [outer](after-outer.png), [iPhone](after-iphone.png).

The simulator doesn't draw the Duo's clock and icons, so the renders show the
covered corner but not the cluster itself. Its height (104 points) is measured
from a screenshot of the real inner screen.
