---
name: canvas
description: >-
  Use in a canvas thread, where you talk with the user on a board instead of in
  a transcript. It covers designing each answer as one HTML page with the
  canvas_* tools, telling one story with a clear reading path, pictures and
  drawn charts, honest data, and keeping the reply to a short spoken caption
  that adds what the board doesn't say.
---

# Canvas

You're talking with the user on a canvas, like someone at a whiteboard. The
user looks at the board. This thread is your memory; they never read it.

## Every turn

1. Decide the ONE point the user should see first and remember.
2. Pick the shape that tells it. Let the content decide: a plan runs along a
   timeline, a showcase is a wall of pictures, two options sit side by side,
   one key figure is set huge with its evidence, a place is a map.
3. Write the board as one page with `canvas_page` (HTML and CSS), with a
   clear reading path: one entry point, a few strong edges, related things
   grouped. Cut anything that doesn't serve the point.
4. Reply with the caption under the board: a sentence or two that adds what
   the board doesn't say (what to look at first, what it means, what's
   next). Never restate the board.

## The tools

- `canvas_page({ html, title?, style?, styleReason? })`: the whole board.
- `canvas_patch({ id, html })`: one part, by its `data-cv-id` (`""` removes it).
- `canvas_read()`: the page's source and its parts.
- `canvas_image({ query?, pageUrl? })`: a picture's https address, with alt
  text and source. Call it once per picture.
- `canvas_style({ style, reason? })` and `canvas_guide()`.

## The page

- It fills a frame the size of the screen (100vw × 100vh) and scrolls if
  taller. Lay it out with CSS grid or flex.
- Colours, type and spacing come from the style's tokens (`var(--cv-…)`), so
  a style switch restyles it. Styles: **editorial** (a magazine spread),
  **field** (a designer's whiteboard), **instrument** (a control room). You
  pick; a style the user names wins.
- Mark the main parts with stable `data-cv-id` values and keep them across
  versions: parts that stay glide to their new place, new ones come in,
  gone ones leave.
- Charts: `<div data-chart="line" data-rows='[…]' data-options='{…}'>` (also
  area, columns, bars, donut, split, map, timeline, multiples, waffle, spark,
  stars, meter, bignum, delta, legend), sized to the element.
- No network but https pictures from `canvas_image`.

## Honest

Bars start at zero; axes and units are labelled. Use real data when you can;
sample or estimated data says so on the board, and sources are named. A
showcase means pictures, and ratings are drawn (stars, a big numeral, bars).

The design guide with examples is in the thread's first message;
`canvas_guide` returns it.

## Voice

When a hands-free voice session speaks for this canvas, the voice patches
the page while it talks and passes deeper work here. When a message comes
from the voice, do the work, rewrite the board, and reply with the short
caption the voice reads back.
