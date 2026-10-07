// Studio Tables' data model, shared by the Tables add-on (which stores
// tables), the table grid (which edits them) and Pages (which embeds them):
// typed columns, rows, saved views, and the pure functions that keep values
// valid as columns change.
import { z } from "zod";

export const COLUMN_TYPES = [
  "text",
  "number",
  "select",
  "multi-select",
  "date",
  "checkbox",
  "person",
  "bot",
  "url",
  "relation",
] as const;
export const columnType = z.enum(COLUMN_TYPES);
export type ColumnType = (typeof COLUMN_TYPES)[number];

/** How each type reads in menus: its name and icon. */
export const COLUMN_TYPE_INFO: Record<ColumnType, { label: string; icon: string }> = {
  text: { label: "Text", icon: "AlignLeft" },
  number: { label: "Number", icon: "SortingOneNine" },
  select: { label: "Select", icon: "ChevronDown" },
  "multi-select": { label: "Multi-select", icon: "Layers" },
  date: { label: "Date", icon: "Calendar" },
  checkbox: { label: "Checkbox", icon: "CircleCheck" },
  person: { label: "Person", icon: "UserRound" },
  bot: { label: "Bot", icon: "Bot" },
  url: { label: "URL", icon: "Globe" },
  relation: { label: "Studio item", icon: "GridView" },
};

export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 800;
export const DEFAULT_COLUMN_WIDTH = 180;

export const columnSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  type: columnType,
  options: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  /** Pixels; the grid's default when unset. */
  width: z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH).optional(),
});
export const relationSchema = z.object({ pluginId: z.string().min(1), itemId: z.string().min(1) });
export const cellSchema = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  relationSchema,
  z.null(),
]);
export const valuesSchema = z.record(z.string(), cellSchema);
export const FILTER_OPS = ["contains", "eq", "neq", "gt", "lt", "empty", "not-empty"] as const;
export const filterSchema = z.object({
  columnId: z.string(),
  op: z.enum(FILTER_OPS),
  value: cellSchema.optional(),
});
export const sortSchema = z.object({
  columnId: z.string(),
  direction: z.enum(["asc", "desc"]),
});
export const VIEW_TYPES = ["table", "board", "calendar"] as const;
export const viewSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(100),
  type: z.enum(VIEW_TYPES),
  groupBy: z.string().nullable().default(null),
  dateBy: z.string().nullable().default(null),
  filters: z.array(filterSchema).max(20).default([]),
  sorts: z.array(sortSchema).max(10).default([]),
  /** Columns this view hides. */
  hidden: z.array(z.string()).max(100).default([]),
});
export type Column = z.infer<typeof columnSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Values = z.infer<typeof valuesSchema>;
export type Filter = z.infer<typeof filterSchema>;
export type FilterOp = Filter["op"];
export type Sort = z.infer<typeof sortSchema>;
export type View = z.infer<typeof viewSchema>;
export type ViewType = View["type"];
export type Row = {
  id: string;
  values: Values;
  createdAt: number;
  updatedAt: number;
};
export type Table = {
  id: string;
  title: string;
  projectId: string | null;
  columns: Column[];
  views: View[];
  /** In the table's own order, which views without a sort keep. */
  rows: Row[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isRelation(cell: Cell | undefined): cell is Relation {
  return typeof cell === "object" && cell !== null && !Array.isArray(cell);
}

export function isEmpty(cell: Cell | undefined): boolean {
  return cell == null || cell === "" || (Array.isArray(cell) && !cell.length);
}

function isUrl(text: string): boolean {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

export function validateValues(columns: Column[], values: Values, partial = false): Values {
  const result: Values = {};
  for (const [key, value] of Object.entries(values)) {
    const column = columns.find((item) => item.id === key);
    if (!column) throw new Error(`Unknown column: ${key}`);
    if (value !== null) {
      const valid =
        column.type === "number"
          ? typeof value === "number"
          : column.type === "checkbox"
            ? typeof value === "boolean"
            : column.type === "multi-select"
              ? Array.isArray(value) && value.every((item) => column.options.includes(item))
              : column.type === "relation"
                ? isRelation(value)
                : typeof value === "string";
      if (!valid) throw new Error(`Invalid value for ${column.name} (${column.type})`);
      if (column.type === "select" && !column.options.includes(value as string)) throw new Error(`Unknown option for ${column.name}`);
      if (column.type === "date" && (!DAY.test(value as string) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))))
        throw new Error(`Invalid date for ${column.name}`);
      if (column.type === "url" && !isUrl(value as string)) throw new Error(`Invalid URL for ${column.name}`);
    }
    result[key] = value;
  }
  if (!partial) for (const column of columns) result[column.id] ??= null;
  return result;
}

function compareCells(left: Cell | undefined, right: Cell | undefined): number {
  if (isEmpty(left) || isEmpty(right)) return isEmpty(left) === isEmpty(right) ? 0 : isEmpty(left) ? 1 : -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return cellText(left).localeCompare(cellText(right), undefined, { numeric: true });
}

function matches(cell: Cell | undefined, { op, value }: Filter): boolean {
  if (op === "empty") return isEmpty(cell);
  if (op === "not-empty") return !isEmpty(cell);
  if (op === "gt" || op === "lt") {
    if (isEmpty(cell) || isEmpty(value)) return false;
    const order = typeof cell === "number" ? cell - Number(value) : cellText(cell).localeCompare(cellText(value ?? null), undefined, { numeric: true });
    return op === "gt" ? order > 0 : order < 0;
  }
  if (op === "contains") {
    if (isEmpty(value)) return true;
    return cellText(cell).toLowerCase().includes(cellText(value ?? null).toLowerCase());
  }
  const equal = Array.isArray(cell) && typeof value === "string" ? cell.includes(value) : cellText(cell) === cellText(value ?? null);
  return op === "eq" ? equal : !equal;
}

export function queryRows(table: Table, view?: View, filters = view?.filters ?? [], sorts = view?.sorts ?? []): Row[] {
  for (const filter of filters)
    if (!table.columns.some((column) => column.id === filter.columnId)) throw new Error(`Unknown filter column: ${filter.columnId}`);
  for (const sort of sorts)
    if (!table.columns.some((column) => column.id === sort.columnId)) throw new Error(`Unknown sort column: ${sort.columnId}`);
  const order = new Map(table.rows.map((row, index) => [row.id, index]));
  return table.rows
    .filter((row) => filters.every((filter) => matches(row.values[filter.columnId], filter)))
    .sort((a, b) => {
      for (const { columnId, direction } of sorts) {
        const left = a.values[columnId];
        const right = b.values[columnId];
        const result = compareCells(left, right);
        // Empty cells stay last either way.
        if (result) return direction === "asc" || isEmpty(left) || isEmpty(right) ? result : -result;
      }
      return order.get(a.id)! - order.get(b.id)!;
    });
}

export function cellText(cell: Cell | undefined): string {
  if (cell == null) return "";
  if (typeof cell === "boolean") return cell ? "Yes" : "No";
  if (Array.isArray(cell)) return cell.join(", ");
  if (typeof cell === "object") return `${cell.pluginId}:${cell.itemId}`;
  return String(cell);
}

/** The column that names a row: the first text column, else the first column. */
export function titleColumn(table: Pick<Table, "columns">): Column | undefined {
  return table.columns.find((column) => column.type === "text") ?? table.columns[0];
}

export function rowTitle(table: Pick<Table, "columns">, row: Row): string {
  const column = titleColumn(table);
  return (column && cellText(row.values[column.id])) || "Untitled";
}

/**
 * Text, a pasted cell or an older value, as a value of the column's type:
 * the value, or null when it doesn't fit. Select values may name options
 * the column doesn't have yet; `withOptions` adds them.
 */
export function convertCell(cell: Cell | undefined, column: Pick<Column, "type">): Cell {
  if (isEmpty(cell)) return column.type === "checkbox" ? false : null;
  const text = cellText(cell).trim();
  switch (column.type) {
    case "number": {
      if (typeof cell === "number") return cell;
      const number = Number(text.replace(/[,\s$€£%]/g, ""));
      return text && Number.isFinite(number) ? number : null;
    }
    case "checkbox":
      return typeof cell === "boolean" ? cell : /^(true|yes|y|1|x|✓|✔|done|checked)$/i.test(text);
    case "select":
      return (Array.isArray(cell) ? (cell[0] ?? "") : text).slice(0, 100) || null;
    case "multi-select": {
      const parts = Array.isArray(cell) ? cell : text.split(",");
      const options = [...new Set(parts.map((part) => part.trim().slice(0, 100)).filter(Boolean))].slice(0, 100);
      return options.length ? options : null;
    }
    case "date": {
      if (DAY.test(text)) return Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? null : text;
      // A timestamp's date as written; read in the server's time zone, midnight UTC is the day before in the Americas.
      const stamp = /^(\d{4}-\d{2}-\d{2})[T ]\d/.exec(text);
      if (stamp && !Number.isNaN(Date.parse(text))) return stamp[1]!;
      const time = Date.parse(text);
      if (Number.isNaN(time)) return null;
      const date = new Date(time);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    case "url": {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
      return isUrl(url) && !/\s/.test(text) ? url.slice(0, 10000) : null;
    }
    case "relation": {
      if (isRelation(cell)) return cell;
      const split = text.indexOf(":");
      return split > 0 && split < text.length - 1 ? { pluginId: text.slice(0, split), itemId: text.slice(split + 1) } : null;
    }
    default:
      return text.slice(0, 10000) || null;
  }
}

/** Adds the select options `values` use that `columns` don't list yet. */
export function withOptions(columns: Column[], values: readonly Values[]): Column[] {
  return columns.map((column) => {
    if (column.type !== "select" && column.type !== "multi-select") return column;
    const options = [...column.options];
    for (const each of values) {
      const cell = each[column.id];
      for (const option of typeof cell === "string" ? [cell] : Array.isArray(cell) ? cell : [])
        if (!options.includes(option) && options.length < 100) options.push(option);
    }
    return options.length === column.options.length ? column : { ...column, options };
  });
}

/**
 * The table with new columns: values carried over to a changed type,
 * dropped with a removed column or option, and views cleared of columns
 * they can no longer use.
 */
export function withColumns(table: Table, next: Column[]): Pick<Table, "columns" | "rows" | "views"> {
  const before = new Map(table.columns.map((column) => [column.id, column]));
  const retyped = new Set(next.filter((column) => before.get(column.id)?.type !== column.type).map((column) => column.id));
  const converted = table.rows.map((row) => {
    const values: Values = {};
    for (const column of next) {
      const cell = row.values[column.id];
      values[column.id] = retyped.has(column.id) ? convertCell(cell, column) : (cell ?? null);
    }
    return { row, values };
  });
  // A changed type keeps its values as options; an edited option list drops the rest.
  const columns = withOptions(next.filter((column) => retyped.has(column.id)), converted.map((each) => each.values));
  const merged = next.map((column) => columns.find((each) => each.id === column.id) ?? column);
  const rows = converted.map(({ row, values }) => {
    for (const column of merged) {
      const cell = values[column.id];
      if (column.type === "select" && typeof cell === "string" && !column.options.includes(cell)) values[column.id] = null;
      if (column.type === "multi-select" && Array.isArray(cell)) {
        const kept = cell.filter((option) => column.options.includes(option));
        values[column.id] = kept.length ? kept : null;
      }
    }
    return { ...row, values };
  });
  return { columns: merged, rows, views: viewsFor(table.views, merged) };
}

/** Views with filters, sorts, grouping and hidden columns limited to `columns`. */
export function viewsFor(views: View[], columns: Column[]): View[] {
  const has = (id: string | null, type?: ColumnType) => columns.some((column) => column.id === id && (!type || column.type === type));
  const select = columns.find((column) => column.type === "select");
  const date = columns.find((column) => column.type === "date");
  return views.flatMap((view) => {
    const groupBy = view.type === "board" ? (has(view.groupBy, "select") ? view.groupBy : (select?.id ?? null)) : view.groupBy;
    const dateBy = view.type === "calendar" ? (has(view.dateBy, "date") ? view.dateBy : (date?.id ?? null)) : view.dateBy;
    // A board without a select column, or a calendar without a date, can't show anything.
    if ((view.type === "board" && !groupBy) || (view.type === "calendar" && !dateBy)) return [];
    return [{
      ...view,
      groupBy,
      dateBy,
      filters: view.filters.filter((filter) => has(filter.columnId)),
      sorts: view.sorts.filter((sort) => has(sort.columnId)),
      hidden: view.hidden.filter((id) => has(id)),
    }];
  });
}

export interface RowPatch {
  update?: { rowId: string; values: Values }[];
  /** New rows, placed before `before` or at the end. */
  insert?: { id?: string; values: Values; before?: string | null }[];
  remove?: string[];
}

/**
 * Applies a batch of row edits, adding any select options they use. Pure:
 * the caller saves the result. Throws on an unknown row or a bad value.
 */
export function applyRowPatch(table: Table, patch: RowPatch, now: number, newRowId: () => string): Pick<Table, "columns" | "rows"> & { inserted: Row[] } {
  const touched = [...(patch.update ?? []).map((each) => each.values), ...(patch.insert ?? []).map((each) => each.values)];
  const columns = withOptions(table.columns, touched);
  let rows = [...table.rows];
  for (const { rowId, values } of patch.update ?? []) {
    const index = rows.findIndex((row) => row.id === rowId);
    if (index < 0) throw new Error("Row not found.");
    rows[index] = { ...rows[index]!, values: { ...rows[index]!.values, ...validateValues(columns, values, true) }, updatedAt: now };
  }
  const inserted: Row[] = [];
  for (const { id, values, before } of patch.insert ?? []) {
    const row = { id: id && !rows.some((each) => each.id === id) ? id : newRowId(), values: validateValues(columns, values), createdAt: now, updatedAt: now };
    const at = before ? rows.findIndex((each) => each.id === before) : -1;
    rows.splice(at < 0 ? rows.length : at, 0, row);
    inserted.push(row);
  }
  if (patch.remove?.length) {
    const removed = new Set(patch.remove);
    rows = rows.filter((row) => !removed.has(row.id));
  }
  return { columns, rows, inserted };
}

export function markdown(table: Table, rows = table.rows): string {
  const escape = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [
    `# ${table.title}`,
    "",
    `| ${table.columns.map((column) => escape(column.name)).join(" | ")} |`,
    `| ${table.columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${table.columns.map((column) => escape(cellText(row.values[column.id]))).join(" | ")} |`),
  ].join("\n");
}

export function csv(table: Table, rows = table.rows): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    [
      table.columns.map((column) => quote(column.name)).join(","),
      ...rows.map((row) => table.columns.map((column) => quote(cellText(row.values[column.id]))).join(",")),
    ].join("\r\n") + "\r\n"
  );
}

/** Parses CSV, or with "\t" what spreadsheets put on the clipboard. */
export function parseDelimited(input: string, delimiter: "," | "\t" = ","): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted && char === '"' && input[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"' && !field) quoted = !quoted;
    else if (char === '"' && quoted) quoted = false;
    else if (!quoted && (char === delimiter || char === "\n")) {
      record.push(field);
      field = "";
      if (char === "\n") {
        records.push(record);
        record = [];
      }
    } else if (char !== "\r" || quoted) field += char;
  }
  if (quoted) throw new Error("Unclosed quote");
  if (record.length || field) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export const parseCsv = (input: string): string[][] => parseDelimited(input, ",");

/** Cells as tab-separated text, quoting what spreadsheets would. */
export function toTsv(grid: readonly (readonly string[])[]): string {
  return grid.map((line) => line.map((text) => (/[\t\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)).join("\t")).join("\n");
}

/**
 * CSV or pasted records, headers first, as rows of `columns`: headers match
 * columns by name, and a header no column has becomes a new text column.
 */
export function importGrid(columns: Column[], [head = [], ...records]: string[][], newColumnId: () => string): { columns: Column[]; rows: Values[] } {
  let next = [...columns];
  const targets = head.map((header, index) => {
    const name = header.trim().slice(0, 100) || `Column ${index + 1}`;
    const found = next.find((column) => column.name.toLowerCase() === name.toLowerCase());
    if (found) return found;
    const added: Column = { id: newColumnId(), name, type: "text", options: [] };
    next = [...next, added];
    return added;
  });
  const rows = records
    .filter((record) => record.some((field) => field.trim()))
    .map((record) => Object.fromEntries(targets.map((column, index) => [column.id, convertCell(record[index] ?? "", column)])) as Values);
  return { columns: withOptions(next, rows), rows };
}
