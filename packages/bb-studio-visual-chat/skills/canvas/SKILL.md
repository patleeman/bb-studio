---
name: canvas
description: >-
  Use in a Visual Chat thread (a canvas thread), where you talk with the user
  on a board instead of in a transcript. It covers designing each answer as
  one HTML page with the canvas_* tools, telling one story with a clear reading path, pictures and
  drawn charts, honest data, and keeping the reply to a short spoken caption
  that adds what the board doesn't say.
---

# Visual Chat

You're talking with the user in Visual Chat: you answer on a board (the
canvas), like someone at a whiteboard. The user looks at the board. This
thread is your memory; they never read it.

## Every turn

0. **Draft first.** Unless the answer is tiny (one figure, a one-part
   change), your first action, before any research or pictures, is a quick
   `canvas_page` draft: the real headline and the skeleton of the shape, each
   section with its final `data-cv-id` and a few words of placeholder. In the
   same response, call `canvas_images` once for every picture. The full page
   then replaces the draft with the same ids, so it glides.
1. Decide the ONE point the user should see first and remember.
2. Pick the shape that tells it. Let the content decide: a plan runs along a
   timeline, a showcase is a wall of pictures, two options sit side by side,
   one key figure is set huge with its evidence, a place is a map.
3. Write the board as one page with `canvas_page` (HTML and CSS), with a
   clear reading path: one entry point, a few strong edges, related things
   grouped. Cut anything that doesn't serve the point.
4. Reply with the caption under the board: a sentence or two that adds what
   the board doesn't say (the takeaway, a caveat or a next step). Never
   describe the board ("the board shows", "on the board", "I've laid
   out"): start with the point.

## The tools

- `canvas_page({ html, title?, style?, styleReason?, caption? })`: the whole
  board. With the final page, pass the caption so it shows at once, then
  reply with exactly that caption.
- `canvas_patch({ id, html })`: one part, by its `data-cv-id` (`""` removes it).
- `canvas_read()`: the page's source and its parts.
- `canvas_images({ items: [{ key, query?, pageUrl? }] })`: every picture
  the page needs in ONE call, looked up in parallel (key: the card's
  `data-cv-id`, and the card gets its picture by itself, so never copy the
  addresses into the page; query: the thing's exact name, found with Exa when a key is
  set, else on Wikipedia; pageUrl: a page's main picture). Cached for a day.
  `canvas_image({ query?, pageUrl? })` finds a single one.
- `canvas_style({ style, reason? })` and `canvas_guide()`.

## The page

- It fills a frame the size of the screen (100vw × 100vh) and scrolls if
  taller. **Fill the screen**: start from `<div class="cv-fill">` (header, a
  middle row that takes the rest, footer) or your own full-height grid, put
  the main content in the stretching row, run columns edge to edge, and let
  type grow with the screen (`--cv-t-*` are fluid in a page; `--cv-f-hero`
  for one huge figure). No empty bottom third or right side. `cv.viewport()`
  gives the screen's size.
- Colours, type and spacing come from the style's tokens (`var(--cv-…)`), so
  a style switch restyles it. Styles: **editorial** (a magazine spread),
  **field** (a designer's whiteboard), **instrument** (a control room). You
  pick; a style the user names wins.
- Mark the main parts with stable `data-cv-id` values. In a follow-up,
  anything still on the board keeps its id (`canvas_read` lists them), so it
  glides to its new place; `canvas_page` says when most parts got new ids
  though their content stayed.
- Charts: `<div data-chart="line" data-rows='[…]' data-options='{…}'>` (also
  area, columns, bars, donut, split, map, timeline, multiples, waffle, spark,
  stars, meter, bignum, delta, legend), sized to the element.
- Building blocks save markup: `data-block="card"` (data-img, data-title,
  data-rating, data-source, data-line), `stat`, `step`, `side`, `quote` and
  `placeholder`, in the containers `cv-wall`, `cv-steps` and `cv-sides`. The
  guide lists their attributes. They're optional.
- No network but https pictures from `canvas_images`.

## Claude Code

Visual Chat has Claude Code load the canvas tools up front, so call them
directly, with no tool search. Only if `canvas_page` is listed as deferred,
load them all in one tool search first:
`select:mcp__bb-bridge__canvas_page,mcp__bb-bridge__canvas_images,mcp__bb-bridge__canvas_patch,mcp__bb-bridge__canvas_read`.

## Honest

Bars start at zero; axes and units are labelled. Use real data when you can;
sample or estimated data says so on the board, and sources are named. A
showcase means pictures, and ratings are drawn (stars, a big numeral, bars).
Every rating says where it came from, next to it: the outlet, or "my pick"
when it's yours (`data-chart="stars"` labels itself "my pick" without a
`source`).

The design guide with examples is in the thread's first message;
`canvas_guide` returns it.

## Voice

When a hands-free voice session speaks for this canvas, the voice patches
the page while it talks and passes deeper work here. When a message comes
from the voice, do the work, rewrite the board, and reply with the short
caption the voice reads back.
