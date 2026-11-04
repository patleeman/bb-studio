---
name: canvas
description: >-
  Use in a canvas thread, where you talk with the user on a board instead of in
  a transcript. It covers editing the board each turn with the canvas_* tools,
  each item kind's data, importance and size, and keeping the reply to a short
  spoken caption.
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

## Layout

- `importance` 1–5. The highest importance, most recently changed item is the
  focus: Studio makes it the biggest and puts it top-left. Give the one thing
  the board is about importance 5 (often the headline), supporting numbers 4,
  detail 3, background 1–2.
- `size` s, m, l or xl is a hint. Stats are small, charts and tables large.
- Keep it small: a headline, three or four stats, one or two charts or tables,
  a caption. At most 24 items. Fewer, bigger items read better.
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
| embed | none | `href`: a mini app link, `/plugins/studio/studio/minis/<id>` |
| custom | anything (`window.bbWidget.data`) | anything; pass `html` too |

Generated widgets: a `custom` item's `html` runs in a sandboxed frame with no
network, and gets `window.bbWidget.data`, `.options` and `.theme` (listen for
the `bbwidget` event). For something interactive with its own data, make a
mini app with `minis_create` and add it as an `embed`.

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
