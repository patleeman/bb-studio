---
name: dashboards
description: Use when the user wants a dashboard, a status board, KPIs, live tiles, charts or feeds that stay up to date, or refers to a Studio dashboard — a /plugins/studio/studio/dashboards/<id> link, an @dashboard mention, "my dashboard", "add a widget" — or asks how dashboards get their data.
---

# Dashboards

A dashboard is a grid of widgets in Studio: stat tiles, charts, tables,
feeds, notes, embeds, clocks, images, progress bars and custom HTML widgets.
Each widget reads data from a source; Studio keeps its last good value with
the time it arrived and any error. The user's open dashboard updates live
when you change it or push data.

Link to one as `[Name](/plugins/studio/studio/dashboards/<dashboard-id>)`.

## Agent tools

| Tool | Use it to |
| --- | --- |
| `dashboard_create` | Create a dashboard, optionally with its widgets (a list of add ops). |
| `dashboard_list` | List dashboards with ids and links. |
| `dashboard_read` | Read widgets in grid order: ids, positions, sources and current data or errors, plus the widgets as JSON. Read before you edit. |
| `dashboard_edit` | Apply ops: `add`, `move`, `resize`, `remove`, `update`. All apply or none do. |
| `widget_define` | Add a custom widget type (HTML/JS) to the user's library, or update one by id. |
| `widget_set_data` | Push data to a widget whose source is `{kind: "push"}`. |

## Widgets and their data

| Type | Data |
| --- | --- |
| `stat` | a number; an array of numbers (last is the value, all form the sparkline); or `{value, delta, trend: up|down|flat, series, caption}`. Options: `label`, `unit`, `prefix`, `decimals`, `field`, `invert`. |
| `line`, `bar`, `area`, `pie` | rows, e.g. `[{"day": "Mon", "visits": 12}]`. Options: `x`, `series`, `stacked`, `unit`. |
| `table` | rows, or `{columns, rows}`. Options: `columns`, `maxRows`, `wrapColumns` (long text truncates on one line unless its column is listed here). Rows past the tile's height scroll. |
| `list` | `[{title, link, summary, date}]`, strings, or a feed `{items}` (RSS lands here). |
| `ticker` | `[{label, value, delta}]` or strings. |
| `note` | none: `options.markdown`. |
| `embed` | none: `options.href` (a Studio item link), `options.threadId`, or `options.url` (a web page, sandboxed). |
| `clock` | none: `options.mode` (`clock` or `countdown`), `timeZone`, `target`, `label`. |
| `image` | none: `options.url`, `alt`, `fit`. |
| `progress` | a number or `{value, max, label}`. Options: `style` (`bar` or `gauge`), `max`, `unit`. |
| `custom` | anything; see below. |

Positions are on a 12-column grid (`x`, `y`, `w`, `h`; a row is 36 px).
Leave `x`/`y` out to place a widget in the first free spot. Narrower
layouts (8 and 4 columns) follow on their own.

## Data sources

Set `source` on add or update:

- `{"kind": "static", "data": …}`: data stored on the widget (256 KB).
- `{"kind": "url", "url": "https://…", "format": "auto|json|rss", "intervalSec": 300, "select": "data.items"}`:
  Studio's server fetches JSON or RSS/Atom (http and https only, 2 MB, 15 s).
  It refreshes at most every 60 s, only while the dashboard is open, and
  every 30 min otherwise.
- `{"kind": "script", "command": "…", "cwd": "…", "intervalSec": 900, "select": "…"}`:
  a shell command on the BB host that prints JSON (or text). **It runs only
  after the user approves the exact command in the dashboard**, and any change
  to the command or folder needs approval again. You can propose one; you
  can't approve it, and must not try through the RPC or CLI: approval takes
  the user's own Approve in the dashboard's approval dialog. Tell the user
  what the command does. 30 s and 1 MB at
  most; every 5 min at most while open.
- `{"kind": "push"}`: you send data with `widget_set_data` (512 KB). A script
  can too: `bb studio dashboards set-data <dashboard-id> <widget-id> '<json>'`.
- `select` picks a path out of the result, e.g. `rows[0].value`.

Prefer a URL or push for data you can fetch yourself; propose a script only
when the data lives on the user's machine.

## Custom widgets

`widget_define` saves HTML, CSS and inline JavaScript as a library type; use
it with `{"op": "add", "type": "custom", "customType": "<wt_…>"}`. For a
one-off, pass `html` on the widget instead.

The widget runs in a sandboxed frame: scripts only, no same-origin, no
network (CSP `connect-src 'none'`), images only from `data:` URLs. Its data
comes from its source. In the frame:

```html
<div id="out"></div>
<script>
  addEventListener("bbwidget", (event) => {
    const { data, options, theme, size } = event.detail;
    out.textContent = data.value;
    out.style.color = theme.colors.foreground; // also background, muted, border, accent, series[]
  });
</script>
```

`window.bbWidget` holds the latest `{data, options, theme, size}`; the event
fires on load and on every change. To ask for more height, post
`parent.postMessage({type: "bb-widget-height", height}, "*")`. Use the theme's
colors so the widget works in light and dark.

## Working on a dashboard

1. `dashboard_read` first: the user may have moved or changed widgets.
2. Batch related changes into one `dashboard_edit` call.
3. For live data, choose a source that refreshes on its own, or push updates
   when you have them.
4. Link the dashboard in your reply.

## CLI

```sh
bb studio dashboards list
bb studio dashboards show <id>
bb studio dashboards set-data <id> <widget-id> '<json>'
```
