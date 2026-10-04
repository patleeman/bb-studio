// Studio Tables' RPC contract and links, shared so Pages can proxy a live
// table embed through the same schemas the Tables add-on serves.
import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { columnSchema, filterSchema, sortSchema, valuesSchema, viewSchema } from "./model";

// The SDK's defineRpcContract, inlined: Pages and Tables bundle this file
// into their frontends, where BB doesn't serve the bare SDK.
const defineRpcContract = <const Contract extends PluginRpcContract>(contract: Contract): Contract =>
  contract;

export const TABLES_PLUGIN_ID = "studio-tables";
export const TABLES_PANEL = "tables";
/** Tables' realtime channel; payload `{ tableId }`. */
export const TABLES_CHANNEL = "studio-tables-changed";
export const MAX_ROW_PATCH = 5000;

const id = z.string().min(1).max(100);
const title = z.string().trim().min(1).max(200);

export const rowSchema = z.object({
  id,
  values: valuesSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export const tableSchema = z.object({
  id,
  title: z.string(),
  projectId: z.string().nullable(),
  columns: z.array(columnSchema),
  views: z.array(viewSchema),
  rows: z.array(rowSchema),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export const rowPatchSchema = z.object({
  update: z.array(z.object({ rowId: id, values: valuesSchema })).max(MAX_ROW_PATCH).optional(),
  insert: z.array(z.object({ id: id.optional(), values: valuesSchema, before: id.nullable().optional() })).max(MAX_ROW_PATCH).optional(),
  remove: z.array(id).max(MAX_ROW_PATCH).optional(),
});
export const tableUpdateSchema = z.object({
  id,
  title: title.optional(),
  projectId: id.nullable().optional(),
  columns: z.array(columnSchema).optional(),
  views: z.array(viewSchema).optional(),
  archived: z.boolean().optional(),
});
export const tableCreateSchema = z.object({
  title,
  projectId: id.nullable().optional(),
  columns: z.array(columnSchema).optional(),
  /** Starting rows, as values by column id. */
  rows: z.array(valuesSchema).max(MAX_ROW_PATCH).optional(),
});
export const tableQuerySchema = z.object({
  id,
  viewId: id.optional(),
  filters: z.array(filterSchema).optional(),
  sorts: z.array(sortSchema).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  /** Pass the previous page's revision to reject edits during a scan. */
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

/** A Studio item a relation cell can point at. */
export const tableItemSchema = z.object({
  pluginId: z.string(),
  itemId: z.string(),
  title: z.string(),
  kindLabel: z.string().optional(),
  kindIcon: z.string().optional(),
  icon: z.string().nullable().optional(),
  /** The BB path that opens the item. */
  href: z.string().optional(),
});

export const tablesContract = defineRpcContract({
  list: { input: z.null(), output: z.object({ tables: z.array(tableSchema) }) },
  get: { input: z.object({ id }), output: z.object({ table: tableSchema.nullable() }) },
  create: { input: tableCreateSchema, output: z.object({ table: tableSchema }) },
  /** Title, columns (values follow a changed type) and views. */
  update: { input: tableUpdateSchema, output: z.object({ table: tableSchema }) },
  remove: { input: z.object({ id }), output: z.object({ ok: z.boolean() }) },
  insert: { input: z.object({ id, values: valuesSchema }), output: z.object({ row: rowSchema }) },
  /** Edits, inserts and deletes rows in one save, as a paste or a multi-row delete does. */
  patchRows: { input: rowPatchSchema.extend({ id }), output: z.object({ table: tableSchema }) },
  exportCsv: { input: z.object({ id, viewId: id.optional() }), output: z.object({ csv: z.string() }) },
  importCsv: { input: z.object({ id, csv: z.string().max(2_000_000) }), output: z.object({ imported: z.number() }) },
  /** Studio items relation cells can link to. */
  items: { input: z.null(), output: z.object({ items: z.array(tableItemSchema) }) },
});
export type TablesContract = typeof tablesContract;

export interface TableTarget {
  tableId: string;
  viewId?: string | null;
  rowId?: string | null;
}

/** The panel sub-path for a table, one of its views, or one of its rows. */
export function tableSubPath({ tableId, viewId, rowId }: TableTarget): string {
  return [tableId, ...(viewId ? ["view", viewId] : []), ...(rowId ? ["row", rowId] : [])].map(encodeURIComponent).join("/");
}

export function tableHref(target: TableTarget): string {
  return `/plugins/${TABLES_PLUGIN_ID}/${TABLES_PANEL}/${tableSubPath(target)}`;
}

/** The table, view and row a sub-path (`tbl_1/view/view_2/row/row_3`) points at. */
export function parseTableSubPath(subPath: string): TableTarget | null {
  const [tableId, ...rest] = subPath.split("/").filter(Boolean).map(decodeURIComponent);
  if (!tableId) return null;
  const target: TableTarget = { tableId };
  for (let i = 0; i + 1 < rest.length; i += 2) {
    if (rest[i] === "view") target.viewId = rest[i + 1]!;
    if (rest[i] === "row") target.rowId = rest[i + 1]!;
  }
  return target;
}
