import { describe, expect, it } from "vitest";
import {
  csv,
  importGrid,
  markdown,
  applyRowPatch,
  convertCell,
  parseCsv,
  parseDelimited,
  queryRows,
  toTsv,
  withColumns,
  validateValues,
  type Table,
} from "./model";
const table: Table = {
  id: "tbl_1",
  title: "QA Inventory",
  projectId: null,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  columns: [
    { id: "name", name: "Name", type: "text", options: [] },
    { id: "count", name: "Count", type: "number", options: [] },
    {
      id: "state",
      name: "State",
      type: "select",
      options: ["Ready", "Blocked"],
    },
  ],
  views: [{ id: "board", name: "Board", type: "board", groupBy: "state", dateBy: null, filters: [{ columnId: "count", op: "gt", value: 1 }], sorts: [], hidden: ["count"] }],
  rows: [
    {
      id: "a",
      values: { name: 'A, "part"', count: 2, state: "Ready" },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "b",
      values: { name: "B", count: 10, state: "Blocked" },
      createdAt: 2,
      updatedAt: 2,
    },
  ],
};
describe("table model", () => {
  it("checks typed values and select options", () => {
    expect(() => validateValues(table.columns, { count: "2" })).toThrow(
      /Invalid value/,
    );
    expect(() => validateValues(table.columns, { state: "Unknown" })).toThrow(
      /Unknown option/,
    );
    expect(validateValues(table.columns, { count: 2 })).toEqual({
      name: null,
      count: 2,
      state: null,
    });
  });
  it("filters and sorts by typed values", () => {
    expect(
      queryRows(table, undefined, [
        { columnId: "state", op: "eq", value: "Ready" },
      ]).map((row) => row.id),
    ).toEqual(["a"]);
    expect(
      queryRows(
        table,
        undefined,
        [],
        [{ columnId: "count", direction: "desc" }],
      ).map((row) => row.id),
    ).toEqual(["b", "a"]);
  });
  it("round trips quoted CSV and renders Markdown", () => {
    const records = parseCsv(csv(table));
    expect(records[1]?.[0]).toBe('A, "part"');
    expect(importGrid(table.columns, records, () => "new").rows[0]).toEqual(table.rows[0]?.values);
    const extra = importGrid(table.columns, [["count", "Notes"], ["7", "hi"]], () => "notes");
    expect(extra.columns.at(-1)).toMatchObject({ id: "notes", name: "Notes", type: "text" });
    expect(extra.rows).toEqual([{ count: 7, notes: "hi" }]);
    expect(markdown(table)).toContain("| Name | Count | State |");
  });
  it("keeps the table's own row order when nothing sorts", () => {
    const reordered = { ...table, rows: [table.rows[1]!, table.rows[0]!] };
    expect(queryRows(reordered).map((row) => row.id)).toEqual(["b", "a"]);
    expect(queryRows(table, undefined, [{ columnId: "count", op: "gt", value: 5 }]).map((row) => row.id)).toEqual(["b"]);
  });
  it("converts text to each type", () => {
    expect(convertCell("1,200", { type: "number" })).toBe(1200);
    expect(convertCell("abc", { type: "number" })).toBeNull();
    expect(convertCell("yes", { type: "checkbox" })).toBe(true);
    expect(convertCell("a, b, a", { type: "multi-select" })).toEqual(["a", "b"]);
    expect(convertCell("2026-02-03", { type: "date" })).toBe("2026-02-03");
    expect(convertCell("example.com", { type: "url" })).toBe("https://example.com");
    expect(convertCell("talk:rec_1", { type: "relation" })).toEqual({ pluginId: "talk", itemId: "rec_1" });
  });
  it("carries values to a new type and cleans views of removed columns", () => {
    const next = withColumns(table, [
      { id: "name", name: "Name", type: "select", options: [] },
      { id: "state", name: "State", type: "select", options: ["Ready"] },
    ]);
    expect(next.columns[0]!.options).toEqual(['A, "part"', "B"]);
    expect(next.rows.map((row) => row.values)).toEqual([
      { name: 'A, "part"', state: "Ready" },
      { name: "B", state: null },
    ]);
    expect(next.views[0]).toMatchObject({ groupBy: "state", filters: [], hidden: [] });
    // A board needs a select column to group by.
    expect(withColumns(table, [table.columns[0]!]).views).toEqual([]);
  });
  it("patches rows in one pass and adds the options they use", () => {
    let n = 0;
    const next = applyRowPatch(
      table,
      { update: [{ rowId: "a", values: { state: "Shipped" } }], insert: [{ values: { name: "C" }, before: "b" }], remove: ["b"] },
      5,
      () => `new_${++n}`,
    );
    expect(next.rows.map((row) => row.id)).toEqual(["a", "new_1"]);
    expect(next.columns[2]!.options).toEqual(["Ready", "Blocked", "Shipped"]);
    expect(next.rows[1]!.values).toEqual({ name: "C", count: null, state: null });
    expect(() => applyRowPatch(table, { update: [{ rowId: "missing", values: {} }] }, 5, () => "x")).toThrow(/Row not found/);
  });
  it("round trips spreadsheet clipboard text", () => {
    const grid = [["a", 'say "hi"'], ["line\nbreak", "tab\there"]];
    expect(parseDelimited(toTsv(grid), "\t")).toEqual(grid);
  });
});
