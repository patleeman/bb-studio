import { describe, expect, it } from "vitest";
import {
  csv,
  importValues,
  markdown,
  parseCsv,
  queryRows,
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
  views: [],
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
    expect(importValues(table.columns, records[1]!)).toEqual(
      table.rows[0]?.values,
    );
    expect(markdown(table)).toContain("| Name | Count | State |");
  });
});
