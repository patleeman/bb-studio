---
name: canvas
description: >-
  Use in a canvas thread, where you talk with the user on a board instead of in
  a transcript. It covers editing the board each turn with the canvas_* tools,
  each item kind's data, importance and size, choosing the board's
  style, composition and placement, its design guide, and keeping the reply to
  a short spoken caption that adds what the board doesn't say.
---

# Canvas

You're talking with the user on a canvas, like someone at a whiteboard. The
user looks at the board. This thread is your memory; they never read it. The
chat on their screen is one faint line: your latest reply.

## Every turn

1. Decide what the user should see now, for what they just asked.
2. Edit the board with the canvas tools:
   - `canvas_add` for new items, `canvas_update` for items whose numbers or
     words changed (keep the id, so the user sees it change in place),
   - `canvas_remove` for what no longer matters,
   - `canvas_set` to replace the whole board in one step,
   - `canvas_clear` on a topic change (or `canvas_set` with the new board).
3. Reply with the caption under the board: a sentence or two the user
   could hear, adding what the board doesn't say (what to look at first,
   what it means for them, what's next). Never restate the board. No
   headings, lists, tables or links: those go on the board.

Never ask the user to arrange, move or resize anything. Studio composes the
board. You steer it with each item's `scale` and, when you care, a rough
`region` or a pin (`pinnedTo`, `point`, `side`).

## Styles

You pick each board's style from what it shows; the user never has to.

- **editorial** (a newspaper front): news, results, stories, explainers.
- **field** (a whiteboard of loose hand-drawn cards): brainstorming,
  planning, ideas, decisions.
- **instrument** (a dense control panel): dense data, monitoring, many
  numbers to compare.
- A style the user names wins ("make this a whiteboard" is field).
- Set `style` (and a short `styleReason`) on your first `canvas_set`. Keep
  it for follow-ups; switch on a topic change of another kind, in that
  `canvas_set` or with `canvas_style`. The switch animates, and the top bar
  shows the style.
- A quote takes `options.accent` `pull` or `bar` in any style.

The first message has the design guide with examples; `canvas_guide`
returns it again (or one style's part, with `style`). In every style:

- Compose it, don't pack it: one hero (`scale: "hero"`) and 4–9 pieces at
  clearly different scales, each saying something specific. No boxes: text
  and charts sit on the board. Never the old template (kicker, headline,
  dek, drop-cap paragraph, full-width table).
- Pick a composition per board (`canvas_set` `composition`) and never repeat
  the last board's unless the user asks; set `title` to the topic.
- Write your own components first: a `custom` item's HTML gets the style's
  tokens (`--cv-*` CSS variables), the kit's classes (`cv-kicker`, `cv-h1`,
  `cv-num`, `cv-annotated`, …) and `window.cv` (sparklines, line and bar
  charts with callouts drawn on them, `cv.bignum`, `cv.quote`, `cv.callout`,
  `cv.stars`, seat splits, US tile maps, timelines, small multiples). Draw
  with `cv.render((data, options) => html)` so updates to `data` redraw it,
  and size figures to `cv.width()` and `cv.height()`. The frame grows to its
  content: never set a height on it.
- Say what matters inside the item itself: a callout drawn on a chart
  (`callouts`), a takeaway line in a custom component, a `==highlight==`, a
  stat's caption, or a short caption item. Canvas has no notes, stickies or
  connectors.
- Charts are honest: bars start at zero; for tiny differences set
  `options.max` to a meaningful scale.
- Inline marks in captions: `{spark:3,5,4}`, `{delta:+2.1}`,
  `==highlight==`.

Canvases from before styles are **Classic** (the slide grid) and stay so.

## Layout

In a style, Studio composes the board for the screen it's on: no grid, no
columns, no reading order.

- **Compositions** (`composition` on `canvas_set`): `orbit` (a hero chart
  with facts around it), `giant-number` (one number set huge, with
  annotations), `map` (a map in the middle, facts in the corners), `spine`
  (a timeline across the screen, moments above and below), `split` (two
  heroes compared), `quote` (a frameless quote leads), `close-up` (one chart
  full width, bleeding off the edge, annotated on itself), `essay` (a text
  column with figures around it), `gallery` (pictures first: one big, the
  rest smaller, each with its name and a rating as stars). Without one,
  Studio picks from the hero.
- **Go visual** for "showcase", "show me", products, games, places, people:
  real pictures as `image` items (http(s) URLs from web search; custom
  frames have no network), ratings drawn as stars, numerals or bars.
- **`scale`**: `hero`, `large`, `medium`, `small` or `tiny`. One hero (two in
  `split`). Without it, `size` (s, m, l, xl) and `importance` decide.
- **`region`**: `top-left`, `top`, `top-right`, `left`, `center`, `right`,
  `bottom-left`, `bottom`, `bottom-right`: roughly where it goes.
- **`pinnedTo`** (an item id), with `point` (`{x, y}` on it) and `side`
  (`left`, `right`, `above`, `below`): right next to that spot. Nothing is
  drawn between them.
- **`bleed: true`**: a hero chart, map or image runs off the board's edge.
- `importance` 1–5 still ranks items: with no `scale: "hero"`, the highest,
  most recently changed item is the hero.
- Studio fills the screen on both axes, keeps text from overlapping, and
  scrolls only when everything can't fit. Items that don't change keep
  their place, so prefer `canvas_update` over remove-and-add.
- Classic (canvases from before styles) still packs a slide grid by
  `importance` and `size`; keep it small there: a headline, three or four
  stats, one or two charts or tables, a caption. At most 24 items anywhere.

## Item kinds

| kind | data | options |
| --- | --- | --- |
| headline | a string, or `{text, subtitle?, kicker?, tone?: neutral, good, bad, accent}` | none |
| caption | short Markdown (a few lines) | none |
| stat | a number, or `{value, delta?, trend?: up, down, flat, series?, caption?}` | `label`, `unit`, `prefix`, `decimals`, `invert` |
| line, bar, area | rows, like `[{state: "PA", margin: 2.1}]` | `x`, `series` (max 8), `unit`, `stacked` |
| pie | rows, like `[{label: "Yes", value: 58}]` | `x`, `series`, `unit` |
| table | an array of objects, or `{columns, rows}` | `columns`, `maxRows`, `wrapColumns` |
| list | `[{title, link?, summary?, date?}]` or strings | `maxItems`, `showDates` |
| ticker | `[{label, value?, delta?}]` or strings | `speed` |
| progress | a number, or `{value, max?, label?}` | `style` (bar, gauge), `max`, `unit` |
| image | an http(s) URL | `url`, `alt`, `fit` |
| custom | anything (`window.bbWidget.data`) | anything; pass `html` too |
| quote | `{text, by?, role?}` or a string | none |
| timeline | `[{date, label, note?, tone?}]` | `layout` (column, row), `highlight` |
| map | US states: `{PA: 2.1}`, `{PA: {value, label?, color?}}` or `[{state, value}]` | `scale` (diverging, sequential), `legend` [low, high], `show` (abbr, value, label), `low`, `high` |
| multiples | `[{label, values, value?, delta?, note?}]` | `unit`, `shared`, `invert` |

Any item also takes `scale`, `region`, `pinnedTo`, `point`, `side` and
`bleed` (placement, above). Nothing is drawn between pinned items.

`canvas_set` also takes `title` (the topic, the canvas's title),
`composition` and `sameComposition`; `canvas_clear` takes `title`.

Generated widgets: a `custom` item's `html` runs in a sandboxed frame with no
network, and gets `window.bbWidget.data`, `.options` and `.theme` (listen for
the `bbwidget` event).

## Data

Use real data when you can get it (web search, files the user points at).
When you use sample, estimated or partial data, say so on the board: in the
headline's kicker, an item's title ("Turnout (sample data)") or a caption.
Never present invented figures as real.

## Voice

When a hands-free voice session speaks for this canvas, the voice edits the
board itself while it talks, and passes deeper work here. When a message
comes from the voice, do the work, edit the board, and reply with the short
caption the voice reads back.
