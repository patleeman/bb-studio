import { describe, expect, it } from "vitest";
import { applyRowPatch, type Column, type Table } from "../model";
import { bounds, clearPatch, copyGrid, invertPatch, pastePatch, step, tab } from "./sheet";

const columns: Column[] = [
  { id: "name", name: "Name", type: "text", options: [] },
  { id: "count", name: "Count", type: "number", options: [] },
  { id: "done", name: "Done", type: "checkbox", options: [] },
];
const table: Table = {
  id: "tbl",
  title: "T",
  projectId: null,
  columns,
  views: [],
  rows: [
    { id: "a", values: { name: "A", count: 1, done: true }, createdAt: 0, updatedAt: 0 },
    { id: "b", values: { name: "B", count: 2, done: false }, createdAt: 0, updatedAt: 0 },
  ],
  archived: false,
  createdAt: 0,
  updatedAt: 0,
};
let next = 0;
const newId = () => `new${++next}`;

describe("sheet", () => {
  it("moves and tabs within the grid", () => {
    expect(step({ row: 0, col: 0 }, "up", 2, 3)).toEqual({ row: 0, col: 0 });
    expect(step({ row: 0, col: 0 }, "right", 2, 3, true)).toEqual({ row: 0, col: 2 });
    expect(tab({ row: 0, col: 2 }, false, 2, 3)).toEqual({ row: 1, col: 0 });
    expect(tab({ row: 1, col: 0 }, true, 2, 3)).toEqual({ row: 0, col: 2 });
  });

  it("copies and clears a range", () => {
    const box = bounds({ anchor: { row: 1, col: 2 }, focus: { row: 0, col: 1 } });
    expect(copyGrid(table.rows, columns, box)).toEqual([["1", "Yes"], ["2", "No"]]);
    expect(clearPatch(table.rows, columns, box).update![0]).toEqual({ rowId: "a", values: { count: null, done: false } });
  });

  it("pastes past the last row as new rows, converting types", () => {
    const patch = pastePatch(table.rows, columns, bounds({ anchor: { row: 1, col: 0 }, focus: { row: 1, col: 0 } }), [["C", "3"], ["D", "x"]], newId);
    expect(patch.update).toEqual([{ rowId: "b", values: { name: "C", count: 3 } }]);
    expect(patch.insert).toEqual([{ id: "new1", values: { name: "D", count: null } }]);
  });

  it("fills a selection with a single pasted value", () => {
    const patch = pastePatch(table.rows, columns, bounds({ anchor: { row: 0, col: 2 }, focus: { row: 1, col: 2 } }), [["yes"]], newId);
    expect(patch.update!.map((each) => each.values.done)).toEqual([true, true]);
  });

  it("inverts a patch to undo it", () => {
    const patch = { update: [{ rowId: "a", values: { name: "Z" } }], insert: [{ id: "c", values: {} }], remove: ["b"] };
    const inverse = invertPatch(table, patch);
    const applied = applyRowPatch(table, patch, 1, newId);
    const undone = applyRowPatch({ ...table, ...applied }, inverse, 2, newId);
    expect(undone.rows.map((row) => [row.id, row.values.name])).toEqual([["a", "A"], ["b", "B"]]);
  });
});
