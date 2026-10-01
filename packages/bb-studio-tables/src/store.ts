import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import {
  columnSchema,
  viewSchema,
  validateValues,
  type Column,
  type Row,
  type Table,
  type Values,
  type View,
} from "./model";

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS studio_tables (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, data TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS studio_tables_updated ON studio_tables(updated_at);`,
];
type RecordRow = {
  id: string;
  title: string;
  project_id: string | null;
  data: string;
  archived: number;
  created_at: number;
  updated_at: number;
};
function decode(row: RecordRow): Table {
  const data = JSON.parse(row.data) as {
    columns: Column[];
    views: View[];
    rows: Row[];
  };
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    archived: !!row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...data,
  };
}
function checkedColumns(columns: Column[]): Column[] {
  const parsed = columnSchema.array().max(100).parse(columns);
  if (
    new Set(parsed.map((item) => item.id)).size !== parsed.length ||
    new Set(parsed.map((item) => item.name)).size !== parsed.length
  )
    throw new Error("Column IDs and names must be unique.");
  return parsed;
}
function checkedViews(views: View[], columns: Column[]): View[] {
  const parsed = viewSchema.array().max(30).parse(views);
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length)
    throw new Error("View IDs must be unique.");
  for (const view of parsed) {
    if (
      view.type === "board" &&
      !columns.some(
        (column) => column.id === view.groupBy && column.type === "select",
      )
    )
      throw new Error("A board needs a select column.");
    if (
      view.type === "calendar" &&
      !columns.some(
        (column) => column.id === view.dateBy && column.type === "date",
      )
    )
      throw new Error("A calendar needs a date column.");
    for (const item of [...view.filters, ...view.sorts])
      if (!columns.some((column) => column.id === item.columnId))
        throw new Error(`Unknown view column: ${item.columnId}`);
  }
  return parsed;
}
export class TableStore {
  constructor(private db: Database.Database) {}
  list(): Table[] {
    return (
      this.db
        .prepare("SELECT * FROM studio_tables ORDER BY updated_at DESC")
        .all() as RecordRow[]
    ).map(decode);
  }
  get(id: string): Table | null {
    const row = this.db
      .prepare("SELECT * FROM studio_tables WHERE id = ?")
      .get(id) as RecordRow | undefined;
    return row ? decode(row) : null;
  }
  require(id: string): Table {
    const table = this.get(id);
    if (!table) throw new Error(`Table ${id} not found.`);
    return table;
  }
  create(
    title: string,
    projectId: string | null,
    columns: Column[] = [
      { id: "name", name: "Name", type: "text", options: [] },
    ],
  ): Table {
    const now = Date.now();
    const id = newId("tbl");
    const table: Table = {
      id,
      title: title.trim() || "Untitled table",
      projectId,
      columns: checkedColumns(columns),
      views: [
        {
          id: newId("view"),
          name: "Table",
          type: "table",
          groupBy: null,
          dateBy: null,
          filters: [],
          sorts: [],
        },
      ],
      rows: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare("INSERT INTO studio_tables VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        id,
        table.title,
        projectId,
        JSON.stringify({
          columns: table.columns,
          views: table.views,
          rows: [],
        }),
        0,
        now,
        now,
      );
    return table;
  }
  save(table: Table): Table {
    table.columns = checkedColumns(table.columns);
    table.views = checkedViews(table.views, table.columns);
    table.rows = table.rows.map((row) => ({
      ...row,
      values: validateValues(table.columns, row.values),
    }));
    table.updatedAt = Date.now();
    const result = this.db
      .prepare(
        "UPDATE studio_tables SET title=?, project_id=?, data=?, archived=?, updated_at=? WHERE id=?",
      )
      .run(
        table.title,
        table.projectId,
        JSON.stringify({
          columns: table.columns,
          views: table.views,
          rows: table.rows,
        }),
        Number(table.archived),
        table.updatedAt,
        table.id,
      );
    if (!result.changes) throw new Error("Table not found.");
    return table;
  }
  insert(id: string, values: Values): Row {
    const table = this.require(id);
    const now = Date.now();
    const row = {
      id: newId("row"),
      values: validateValues(table.columns, values),
      createdAt: now,
      updatedAt: now,
    };
    table.rows.push(row);
    this.save(table);
    return row;
  }
  updateRow(id: string, rowId: string, values: Values): Row {
    const table = this.require(id);
    const row = table.rows.find((item) => item.id === rowId);
    if (!row) throw new Error("Row not found.");
    row.values = {
      ...row.values,
      ...validateValues(table.columns, values, true),
    };
    row.updatedAt = Date.now();
    this.save(table);
    return row;
  }
  deleteRow(id: string, rowId: string): void {
    const table = this.require(id);
    const before = table.rows.length;
    table.rows = table.rows.filter((row) => row.id !== rowId);
    if (table.rows.length === before) throw new Error("Row not found.");
    this.save(table);
  }
  delete(id: string): void {
    this.db.prepare("DELETE FROM studio_tables WHERE id=?").run(id);
  }
}
