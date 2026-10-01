# Studio Tables

Structured tables for BB Studio. Each table has typed columns, rows, and saved table, board, or calendar views, edited in a spreadsheet grid: arrow keys, Enter to edit, typing to replace, copy and paste with Excel or Sheets, fill a range by pasting, undo and redo, and drag to resize columns. Every view and row has a link (`/plugins/studio-tables/tables/<id>/view/<view>/row/<row>`).

Pages embeds tables live, so edits in a page show in Tables and the other way round. Agents can create tables, inspect schemas, query rows, insert rows, and update cells. CSV import matches headers to columns by name.

## Commands

`bb tables list`, `create <title>`, `schema <id>`, `query <id>`, `insert <id> <json>`, `update <id> <row-id> <json>`, `export <id>`, and `import <id> --csv <text>` (headers match columns by name).

## Staged preview

![A seeded inventory table in the live BB Studio Tables panel](assets/staged-preview.png)

The running BB app shows a QA inventory table with typed columns and seeded rows.
