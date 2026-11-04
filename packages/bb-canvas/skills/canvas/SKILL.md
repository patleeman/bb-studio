---
name: canvas
description: >-
  Use in a canvas thread, where you talk with the user on a board instead of in
  a transcript. It covers editing the board each turn with the canvas_* tools,
  each item kind's data, importance, size and relations, choosing the board's
  style and its design guide, and keeping the reply to a short spoken caption.
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
3. Reply with one short spoken-style caption: a sentence or two the user
   could hear. No headings, lists, tables or links: those go on the board.

Never ask the user to arrange, move or resize anything. Studio lays the board
out. You steer it with `importance` and `size`.

## Styles

You pick each board's style from what it shows; the user never has to.

- **editorial** (a newspaper front): news, results, stories, explainers.
- **field** (a whiteboard of cards and sticky notes): brainstorming,
  planning, ideas, decisions.
- **instrument** (a dense control panel): dense data, monitoring, many
  numbers to compare.
- A style the user names wins ("make this a whiteboard" is field).
- Set `style` (and a short `styleReason`) on your first `canvas_set`. Keep
  it for follow-ups; switch on a topic change of another kind, in that
  `canvas_set` or with `canvas_style`. The switch animates, and the top bar
  shows the style.
- Borrow accents across styles: a note takes `options.accent` `sticky`,
  `margin` or `callout`; a quote `pull`, `sticky` or `bar`. In HTML,
  `cv-sticky`, `cv-margin-note` and `cv-callout` work in every style.

The first message has the design guide with examples; `canvas_guide`
returns it again (or one style's part, with `style`). In every style:

- Make the board rich and dense, not a slide: one dominant focus and 5–12
  supporting items that each say something specific.
- Write your own components first: a `custom` item's HTML gets the style's
  tokens (`--cv-*` CSS variables), the kit's classes (`cv-kicker`, `cv-h1`,
  `cv-num`, `cv-float-right`, …) and `window.cv` (sparklines, line and bar
  charts, seat splits, US tile maps, timelines, small multiples). Draw with
  `cv.render((data, options) => html)` so updates to `data` redraw it. The
  frame grows to its content: never set a height on it.
- Annotate: a `note` with `anchor` (an item id) and `point` (`{x, y}`, 0–1
  inside that item) sits beside it with a line to that spot. `relatedTo`
  (ids) draws connectors; only the few most important draw.
- Charts are honest: bars start at zero; for tiny differences set
  `options.max` to a meaningful scale.
- Inline marks in captions and notes: `{spark:3,5,4}`, `{delta:+2.1}`,
  `==highlight==`.

Canvases from before styles are **Classic** (the slide grid) and stay so.

## Layout

- `importance` 1–5. The highest importance, most recently changed item is the
  focus: Studio makes it the biggest (top-left in Classic, Editorial and
  Instrument; in the middle in Field notes) and the rest orbit it. Give the one thing
  the board is about importance 5 (often the headline), supporting numbers 4,
  detail 3, background 1–2.
- `size` s, m, l or xl is a hint. Stats are small, charts and tables large.
- Classic: keep it small: a headline, three or four stats, one or two charts
  or tables, a caption. Other looks: rich but focused (see Styles). At most 24
  items.
- Items that don't change keep their place, so prefer `canvas_update` over
  remove-and-add for the same thing.

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
| note | a short string, or `{text, tone?}`; with `anchor` and `point` it points at that item | none |
| timeline | `[{date, label, note?, tone?}]` | `layout` (column, row), `highlight` |
| map | US states: `{PA: 2.1}`, `{PA: {value, label?, color?}}` or `[{state, value}]` | `scale` (diverging, sequential), `legend` [low, high], `show` (abbr, value, label), `low`, `high` |
| multiples | `[{label, values, value?, delta?, note?}]` | `unit`, `shared`, `invert` |

Any item also takes `relatedTo` (ids it connects to), `anchor` (the id it
annotates) and `point` (`{x, y}` on the anchor).

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
