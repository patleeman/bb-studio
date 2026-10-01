---
name: studio-tables
description: Read and edit structured Studio Tables with typed columns and rows.
---

# Studio Tables

Use `tables_list` to find a table, then `tables_schema` to read its column IDs, types, and select options. Use `tables_query` for filtered rows, `tables_insert` for a new row, and `tables_update` for existing cells. Table IDs and row IDs are opaque. Only fill in columns the user asks you to change.

From a terminal, `bb tables list`, `bb tables schema <id>`, and `bb tables query <id>` read data. `bb tables insert <id> '<json>'` and `bb tables update <id> <row-id> '<json>'` write rows. `bb tables export <id>` returns CSV; `bb tables import <id> --csv '<text>'` imports CSV with headers matching the table columns.
