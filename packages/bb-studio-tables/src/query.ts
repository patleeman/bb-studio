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

/** An agent tool result stays small enough for a model's context. */
export const AGENT_CELL_CHARS = 2000;
export const AGENT_OUTPUT_CHARS = 200_000;

/** A query page for agents: long text cells cut, and rows that don't fit left for the next page. */
export function agentPage(table: Table, input: z.infer<typeof tableQuerySchema>) {
  const page = queryPage(table, input);
  let cut = false;
  let size = 0;
  const rows: typeof page.rows = [];
  for (const row of page.rows) {
    const values = Object.fromEntries(Object.entries(row.values).map(([id, cell]) => {
      if (typeof cell !== "string" || cell.length <= AGENT_CELL_CHARS) return [id, cell];
      cut = true;
      return [id, `${cell.slice(0, AGENT_CELL_CHARS)}… [truncated]`];
    }));
    const shown = { ...row, values };
    const length = JSON.stringify(shown).length + 1;
    if (rows.length && size + length > AGENT_OUTPUT_CHARS) break;
    rows.push(shown);
    size += length;
  }
  const short = rows.length < page.rows.length;
  const nextOffset = short ? page.offset + rows.length : page.nextOffset;
  const notes = [
    ...(cut ? [`Text cells over ${AGENT_CELL_CHARS} characters were truncated.`] : []),
    ...(short ? [`Only ${rows.length} of ${page.rows.length} rows fit, so this page was truncated; continue with offset=${nextOffset} and the same expectedRevision.`] : []),
  ];
  return { ...page, rows, nextOffset, ...(notes.length ? { truncated: notes.join(" ") } : {}) };
}
