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
  it("keeps a timestamp's written date in a date column, whatever the server's time zone", () => {
    const zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(convertCell("2026-02-03T00:00:00Z", { type: "date" })).toBe("2026-02-03");
      expect(convertCell("2026-02-03 23:30", { type: "date" })).toBe("2026-02-03");
      expect(convertCell("Feb 3, 2026", { type: "date" })).toBe("2026-02-03");
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
  it("counts an unset checkbox as unchecked in filters", () => {
    const tasks: Table = {
      ...table,
      columns: [{ id: "done", name: "Done", type: "checkbox", options: [] }],
      views: [],
      rows: [
        { id: "unset", values: { done: null }, createdAt: 1, updatedAt: 1 },
        { id: "no", values: { done: false }, createdAt: 1, updatedAt: 1 },
        { id: "yes", values: { done: true }, createdAt: 1, updatedAt: 1 },
      ],
    };
    const ids = (value: boolean, op: "eq" | "neq" = "eq") => queryRows(tasks, undefined, [{ columnId: "done", op, value }]).map((row) => row.id);
    expect(ids(false)).toEqual(["unset", "no"]);
    expect(ids(true)).toEqual(["yes"]);
    expect(ids(true, "neq")).toEqual(["unset", "no"]);
  });
  it("reads cells of columns named like Object built-ins as values, never inherited ones", () => {
    const columns = [
      { id: "constructor", name: "Constructor", type: "text" as const, options: [] },
      { id: "__proto__", name: "Proto", type: "text" as const, options: [] },
    ];
    const empty = validateValues(columns, {});
    expect(Object.hasOwn(empty, "constructor") && empty.constructor).toBeNull();
    expect(Object.hasOwn(empty, "__proto__") && empty["__proto__"]).toBeNull();
    const set = validateValues(columns, JSON.parse('{"__proto__":"x","constructor":"y"}'));
    expect(JSON.parse(JSON.stringify(set))).toEqual(JSON.parse('{"__proto__":"x","constructor":"y"}'));
    const added = withColumns({ ...table, views: [] }, [...table.columns, ...columns]);
    expect(Object.hasOwn(added.rows[0]!.values, "constructor") && added.rows[0]!.values.constructor).toBeNull();
    expect(Object.hasOwn(added.rows[0]!.values, "__proto__") && added.rows[0]!.values["__proto__"]).toBeNull();
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
