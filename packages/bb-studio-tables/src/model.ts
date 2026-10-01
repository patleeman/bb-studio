import { z } from "zod";

export const columnType = z.enum([
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
]);
export const columnSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  type: columnType,
  options: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
});
export const cellSchema = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  z.object({ pluginId: z.string().min(1), itemId: z.string().min(1) }),
  z.null(),
]);
export const valuesSchema = z.record(z.string(), cellSchema);
export const filterSchema = z.object({
  columnId: z.string(),
  op: z.enum(["eq", "neq", "contains", "empty", "not-empty"]),
  value: cellSchema.optional(),
});
export const sortSchema = z.object({
  columnId: z.string(),
  direction: z.enum(["asc", "desc"]),
});
export const viewSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(100),
  type: z.enum(["table", "board", "calendar"]),
  groupBy: z.string().nullable().default(null),
  dateBy: z.string().nullable().default(null),
  filters: z.array(filterSchema).max(20).default([]),
  sorts: z.array(sortSchema).max(10).default([]),
});
export type Column = z.infer<typeof columnSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type Values = z.infer<typeof valuesSchema>;
export type View = z.infer<typeof viewSchema>;
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
  rows: Row[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

const day = /^\d{4}-\d{2}-\d{2}$/;
export function validateValues(
  columns: Column[],
  values: Values,
  partial = false,
): Values {
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
              ? Array.isArray(value) &&
                value.every((item) => column.options.includes(item))
              : column.type === "relation"
                ? typeof value === "object" &&
                  !Array.isArray(value) &&
                  "pluginId" in value &&
                  "itemId" in value
                : typeof value === "string";
      if (!valid)
        throw new Error(`Invalid value for ${column.name} (${column.type})`);
      if (column.type === "select" && !column.options.includes(value as string))
        throw new Error(`Unknown option for ${column.name}`);
      if (
        column.type === "date" &&
        (!day.test(value as string) ||
          Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
      )
        throw new Error(`Invalid date for ${column.name}`);
      if (column.type === "url" && !URL.canParse(value as string))
        throw new Error(`Invalid URL for ${column.name}`);
    }
    result[key] = value;
  }
  if (!partial) for (const column of columns) result[column.id] ??= null;
  return result;
}

export function queryRows(
  table: Table,
  view?: View,
  filters = view?.filters ?? [],
  sorts = view?.sorts ?? [],
): Row[] {
  for (const filter of filters)
    if (!table.columns.some((column) => column.id === filter.columnId))
      throw new Error(`Unknown filter column: ${filter.columnId}`);
  for (const sort of sorts)
    if (!table.columns.some((column) => column.id === sort.columnId))
      throw new Error(`Unknown sort column: ${sort.columnId}`);
  const rows = table.rows.filter((row) =>
    filters.every(({ columnId, op, value }) => {
      const cell = row.values[columnId];
      if (op === "empty")
        return (
          cell == null || cell === "" || (Array.isArray(cell) && !cell.length)
        );
      if (op === "not-empty")
        return (
          cell != null && cell !== "" && (!Array.isArray(cell) || !!cell.length)
        );
      const equal = JSON.stringify(cell) === JSON.stringify(value);
      if (op === "eq") return equal;
      if (op === "neq") return !equal;
      return String(Array.isArray(cell) ? cell.join(" ") : (cell ?? ""))
        .toLowerCase()
        .includes(String(value ?? "").toLowerCase());
    }),
  );
  return rows.sort((a, b) => {
    for (const { columnId, direction } of sorts) {
      const left = a.values[columnId],
        right = b.values[columnId];
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left ?? "").localeCompare(String(right ?? ""));
      if (result) return direction === "asc" ? result : -result;
    }
    return a.createdAt - b.createdAt;
  });
}
export function cellText(cell: Cell | undefined): string {
  if (cell == null) return "";
  if (typeof cell === "boolean") return cell ? "Yes" : "No";
  if (Array.isArray(cell)) return cell.join(", ");
  if (typeof cell === "object") return `${cell.pluginId}:${cell.itemId}`;
  return String(cell);
}
export function markdown(table: Table, rows = table.rows): string {
  const escape = (value: string) =>
    value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [
    `# ${table.title}`,
    "",
    `| ${table.columns.map((column) => escape(column.name)).join(" | ")} |`,
    `| ${table.columns.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${table.columns.map((column) => escape(cellText(row.values[column.id]))).join(" | ")} |`,
    ),
  ].join("\n");
}
export function csv(table: Table, rows = table.rows): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    [
      table.columns.map((column) => quote(column.name)).join(","),
      ...rows.map((row) =>
        table.columns
          .map((column) => quote(cellText(row.values[column.id])))
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export function parseCsv(input: string): string[][] {
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
    else if (!quoted && (char === "," || char === "\n")) {
      record.push(field);
      field = "";
      if (char === "\n") {
        records.push(record);
        record = [];
      }
    } else if (char !== "\r" || quoted) field += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (record.length || field) {
    record.push(field);
    records.push(record);
  }
  return records;
}
export function importValues(columns: Column[], record: string[]): Values {
  return validateValues(
    columns,
    Object.fromEntries(
      columns.map((column, index) => {
        const raw = record[index] ?? "";
        let value: Cell = raw || null;
        if (raw && column.type === "number") value = Number(raw);
        if (raw && column.type === "checkbox")
          value = /^(true|yes|1)$/i.test(raw);
        if (raw && column.type === "multi-select")
          value = raw.split(",").map((part) => part.trim());
        if (raw && column.type === "relation") {
          const [pluginId, itemId] = raw.split(":");
          value = { pluginId: pluginId ?? "", itemId: itemId ?? "" };
        }
        return [column.id, value];
      }),
    ),
  );
}
