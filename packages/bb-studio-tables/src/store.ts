import { newId } from "@bb-studio/kit/ids";
import {
  applyRowPatch,
  columnSchema,
  importGrid,
  parseCsv,
  validateValues,
  viewSchema,
  viewsFor,
  withColumns,
  withOptions,
  type Column,
  type Row,
  type RowPatch,
  type Table,
  type Values,
  type View,
} from "@bb-studio/kit/tables";
import type Database from "better-sqlite3";

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

export type TableChanges = Partial<Pick<Table, "title" | "projectId" | "columns" | "views" | "archived">>;

function decode(row: RecordRow): Table {
  const data = JSON.parse(row.data) as { columns: Column[]; views: View[]; rows: Row[] };
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    archived: !!row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    columns: data.columns.map((column) => ({ ...column, options: column.options ?? [] })),
    // Views saved before views could hide columns.
    views: data.views.map((view) => ({ ...view, hidden: view.hidden ?? [] })),
    rows: data.rows,
  };
}

function checkedColumns(columns: Column[]): Column[] {
  const parsed = columnSchema.array().min(1).max(100).parse(columns);
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length || new Set(parsed.map((item) => item.name.toLowerCase())).size !== parsed.length)
    throw new Error("Column IDs and names must be unique.");
  return parsed;
}

function checkedViews(views: View[], columns: Column[]): View[] {
  const parsed = viewSchema.array().min(1).max(30).parse(views);
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) throw new Error("View IDs must be unique.");
  for (const view of parsed) {
    if (view.type === "board" && !columns.some((column) => column.id === view.groupBy && column.type === "select"))
      throw new Error("A board needs a select column.");
    if (view.type === "calendar" && !columns.some((column) => column.id === view.dateBy && column.type === "date"))
      throw new Error("A calendar needs a date column.");
    for (const item of [...view.filters, ...view.sorts])
      if (!columns.some((column) => column.id === item.columnId)) throw new Error(`Unknown view column: ${item.columnId}`);
  }
  return parsed;
}

export function defaultView(): View {
  return { id: newId("view"), name: "Table", type: "table", groupBy: null, dateBy: null, filters: [], sorts: [], hidden: [] };
}

export class TableStore {
  constructor(private db: Database.Database) {}

  list(): Table[] {
    return (this.db.prepare("SELECT * FROM studio_tables ORDER BY updated_at DESC").all() as RecordRow[]).map(decode);
  }

  get(id: string): Table | null {
    const row = this.db.prepare("SELECT * FROM studio_tables WHERE id = ?").get(id) as RecordRow | undefined;
    return row ? decode(row) : null;
  }

  require(id: string): Table {
    const table = this.get(id);
    if (!table) throw new Error(`Table ${id} not found.`);
    return table;
  }

  /** A new table, with starting rows given as values by column ID. */
  create(title: string, projectId: string | null, columns: Column[] = [{ id: "name", name: "Name", type: "text", options: [] }], rows: Values[] = []): Table {
    const now = Date.now();
    const id = newId("tbl");
    const withRows = withOptions(checkedColumns(columns), rows);
    const table: Table = {
      id,
      title: title.trim() || "Untitled table",
      projectId,
      columns: withRows,
      views: [defaultView()],
      rows: rows.map((values) => ({ id: newId("row"), values: validateValues(withRows, values), createdAt: now, updatedAt: now })),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare("INSERT INTO studio_tables VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, table.title, projectId, JSON.stringify({ columns: table.columns, views: table.views, rows: table.rows }), 0, now, now);
    return table;
  }

  save(table: Table): Table {
    table.columns = checkedColumns(table.columns);
    table.views = checkedViews(table.views, table.columns);
    table.rows = table.rows.map((row) => ({ ...row, values: validateValues(table.columns, row.values) }));
    table.updatedAt = Date.now();
    const result = this.db
      .prepare("UPDATE studio_tables SET title=?, project_id=?, data=?, archived=?, updated_at=? WHERE id=?")
      .run(
        table.title,
        table.projectId,
        JSON.stringify({ columns: table.columns, views: table.views, rows: table.rows }),
        Number(table.archived),
        table.updatedAt,
        table.id,
      );
    if (!result.changes) throw new Error("Table not found.");
    return table;
  }

  /** Changes a table's settings. New columns carry values over to a changed type and clean up the views. */
  update(id: string, changes: TableChanges): Table {
    let table = this.require(id);
    if (changes.columns) table = { ...table, ...withColumns(table, checkedColumns(changes.columns)) };
    if (changes.views) table.views = viewsFor(changes.views, table.columns);
    if (changes.title !== undefined) table.title = changes.title.trim() || table.title;
    if (changes.projectId !== undefined) table.projectId = changes.projectId;
    if (changes.archived !== undefined) table.archived = changes.archived;
    return this.save(table);
  }

  /** Edits, inserts and deletes rows in one save. */
  patchRows(id: string, patch: RowPatch): { table: Table; inserted: Row[] } {
    const table = this.require(id);
    const { columns, rows, inserted } = applyRowPatch(table, patch, Date.now(), () => newId("row"));
    return { table: this.save({ ...table, columns, rows }), inserted };
  }

  insert(id: string, values: Values, before?: string | null): Row {
    return this.patchRows(id, { insert: [{ values, before }] }).inserted[0]!;
  }

  updateRow(id: string, rowId: string, values: Values): Row {
    const { table } = this.patchRows(id, { update: [{ rowId, values }] });
    return table.rows.find((row) => row.id === rowId)!;
  }

  deleteRow(id: string, rowId: string): void {
    const table = this.require(id);
    if (!table.rows.some((row) => row.id === rowId)) throw new Error("Row not found.");
    this.patchRows(id, { remove: [rowId] });
  }

  /** Adds CSV rows, matching headers to columns by name and adding columns for the rest. */
  importCsv(id: string, source: string): number {
    const table = this.require(id);
    const { columns, rows } = importGrid(table.columns, parseCsv(source), () => newId("col"));
    if (!rows.length) return 0;
    const now = Date.now();
    this.save({
      ...table,
      columns,
      rows: [...table.rows, ...rows.map((values) => ({ id: newId("row"), values, createdAt: now, updatedAt: now }))],
    });
    return rows.length;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM studio_tables WHERE id=?").run(id);
  }
}
