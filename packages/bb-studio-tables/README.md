# Studio Tables

Structured tables for BB Studio. Each table has typed columns, rows, and saved table, board, or calendar views. You edit in a spreadsheet grid: arrow keys, Enter to edit, typing to replace, copy and paste with Excel or Sheets, undo and redo, and drag to resize columns. Every view and row has a link (`/plugins/studio-tables/tables/<id>/view/<view>/row/<row>`).

Pages embeds tables live, so edits in a page show in Tables and the other way round.

## In the app

- **Thread tab.** In a thread's workbench, the **Tables** tab lists the tables made or changed in that thread, then the project's recent ones. **New** makes a table in the thread's project and links it to the thread in Studio.
- **Reply cards.** When an agent creates a table or changes its rows, its reply shows the table's card (`::table{id="…"}`) with its first 20 rows, read-only. Click the title or arrow to open the table in the **Tables** tab beside the chat. Without a workbench, it opens in the main area.
- **Big tables.** The grid draws only the visible rows. Keyboard moves and clipboard ranges still span every row. Boards show 50 cards per lane and calendars 10 entries per day, with page controls and first/last buttons.
- **CSV.** Import matches headers to columns by name. Export starts with a byte-order mark so Excel reads UTF-8. Text that starts with `=`, `+`, `-` or `@` gets a leading apostrophe so spreadsheets don't run it as a formula. Import removes both, so a round trip keeps the table as it was.
- **Validation.** Date cells must be real `YYYY-MM-DD` days (2024-02-30 is rejected). URL cells can't use `javascript:`, `data:` or `vbscript:`.
- **Column edits.** Saving columns from an out-of-date copy keeps columns and select options someone else added meanwhile.
- **Backup.** `bb studio backup` includes every table (columns, views, rows). See [Backup and restore](../../docs/backup.md).

## Agent tools

`tables_list`, `tables_schema`, `tables_query`, `tables_create`, `tables_insert`, `tables_update`, `tables_delete_rows` and `tables_delete`. Both delete tools are permanent.

`tables_query` returns `{ rows, total, offset, nextOffset, revision }`. `limit` is 100 by default, up to 500. Continue with `offset: nextOffset` and `expectedRevision: revision` until `nextOffset` is null, keeping the same filters and sorts. If the table changes, the revision check tells you to restart. A page stays under about 200,000 characters: long text cells (over 2,000 characters) are cut and rows may end early. Both are noted in `truncated`.

## Commands

- `bb tables list`
- `bb tables create <title>`
- `bb tables schema <id>`
- `bb tables query <id> [--view <id>] [--limit 100] [--offset 0] [--revision <revision>]`
- `bb tables insert <id> <json>`
- `bb tables update <id> <row-id> <json>`
- `bb tables export <id>`
- `bb tables import <id> --csv <text>`

The plugin has no settings.

## Staged preview

![The compact Tables header](assets/compact-header.png)

The live 390-pixel Release inventory table contains a seeded Review notes row.
**Chat** stays visible, and **Item actions** keeps Export and More clickable
above the sticky table header.
These compact captures run on stable BB 0.45.0 with the full suite installed
from pushed commit 786fd2f. They check viewport bounds, button hit targets,
and the Related popover before capture.

![A seeded inventory table in the live BB Studio Tables panel](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`): a seeded "QA Inventory" table open in the Tables panel.
Its Name, Status, Quantity and Checked columns are typed (text, select, number
and checkbox), with two seeded rows, the row count, Filter, Sort, Columns, and
Import and Export.
