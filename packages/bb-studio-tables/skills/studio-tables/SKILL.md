---
name: studio-tables
description: Read and edit structured Studio Tables with typed columns and rows.
---

# Studio Tables

Use `tables_list` to find a table, or `tables_create` to make one with typed columns and starting rows. Use `tables_schema` to read its column IDs, types, and select options. Use `tables_query` for filtered rows, `tables_insert` for a new row, `tables_update` for existing cells, `tables_delete_rows` to remove rows, and `tables_delete` to remove a whole table. Deletes are permanent, so delete only what the user asked to remove. Table IDs and row IDs are opaque. Only fill in columns the user asks you to change.

From a terminal, `bb tables list`, `bb tables schema <id>`, and `bb tables query <id>` read data. `bb tables insert <id> '<json>'` and `bb tables update <id> <row-id> '<json>'` write rows. `bb tables export <id>` returns CSV; `bb tables import <id> --csv '<text>'` adds CSV rows, matching headers to columns by name and adding a text column for any header the table lacks.

Link to a table, view, or row as `/plugins/studio-tables/tables/<table-id>`, with `/view/<view-id>` and `/row/<row-id>` appended as needed.
