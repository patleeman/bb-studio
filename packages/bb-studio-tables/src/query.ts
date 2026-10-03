import { createHash } from "node:crypto";
import { queryRows, tableQuerySchema, type Table } from "@bb-studio/kit/tables";
import type { z } from "zod";

/** Shared by RPC, agents and CLI. A revision binds the table and query together. */
export function queryPage(table: Table, input: z.infer<typeof tableQuerySchema>) {
  const { viewId, filters, sorts, offset, limit, expectedRevision } = input;
  const view = viewId ? table.views.find((item) => item.id === viewId) : undefined;
  if (viewId && !view) throw new Error("View not found.");
  const actualFilters = filters ?? view?.filters ?? [];
  const actualSorts = sorts ?? view?.sorts ?? [];
  const revision = createHash("sha256").update(JSON.stringify([table, actualFilters, actualSorts])).digest("hex");
  if (expectedRevision && expectedRevision !== revision) {
    throw new Error("The table or query changed during pagination. Restart at offset 0 without expectedRevision.");
  }
  const all = queryRows(table, view, actualFilters, actualSorts);
  const rows = all.slice(offset, offset + limit);
  return { rows, total: all.length, offset, nextOffset: offset + rows.length < all.length ? offset + rows.length : null, revision };
}
