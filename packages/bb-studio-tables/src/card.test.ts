import { expect, it } from "vitest";
import type { Table } from "@bb-studio/kit/tables";
import { PREVIEW_ROWS, previewRows } from "./card";

const row = (n: number) => ({ id: `r${n}`, values: { name: `Row ${n}`, size: n }, createdAt: 0, updatedAt: 0 });
const table = (rows: number): Table => ({
  id: "tbl_a",
  title: "T",
  projectId: null,
  columns: [{ id: "name", name: "Name", type: "text", options: [] }, { id: "size", name: "Size", type: "number", options: [] }],
  views: [{ id: "v", name: "All", type: "table", groupBy: null, dateBy: null, filters: [], sorts: [{ columnId: "size", direction: "desc" }], hidden: ["size"] }],
  rows: Array.from({ length: rows }, (_, n) => row(n)),
  archived: false,
  createdAt: 0,
  updatedAt: 0,
});

it("shows the first view's rows, sorted and without its hidden columns", () => {
  const preview = previewRows(table(3));
  expect(preview.columns.map((column) => column.id)).toEqual(["name"]);
  expect(preview.rows.map((each) => each.id)).toEqual(["r2", "r1", "r0"]);
});

it("caps the rows and counts the rest", () => {
  const preview = previewRows(table(PREVIEW_ROWS + 5));
  expect(preview.rows).toHaveLength(PREVIEW_ROWS);
  expect(preview.total).toBe(PREVIEW_ROWS + 5);
});
