import { describe, expect, test } from "vitest";
import { databaseFromGrid, tableBlockGrid } from "./database";

describe("turn into database", () => {
  test("reads cells as text, including links and mentions", () => {
    const grid = tableBlockGrid({
      type: "tableContent",
      rows: [
        { cells: [[{ type: "text", text: "Name" }], { type: "tableCell", content: [{ type: "text", text: " Cost " }] }] },
        {
          cells: [
            [{ type: "link", content: [{ type: "text", text: "Docs" }] }, { type: "mention", props: { label: "@Ada" } }],
            { type: "tableCell", content: [{ type: "text", text: "1,200" }] },
          ],
        },
      ],
    });
    expect(grid).toEqual([["Name", "Cost"], ["Docs@Ada", "1,200"]]);
  });

  test("names blank headers, types numeric columns and skips empty rows", () => {
    let n = 0;
    const { columns, rows } = databaseFromGrid(
      [["Name", "", "Cost"], ["Rent", "a", "1,200"], ["", "", ""], ["Food", "", "80.5"]],
      () => `col_${++n}`,
    );
    expect(columns.map((column) => [column.name, column.type])).toEqual([["Name", "text"], ["Column 2", "text"], ["Cost", "number"]]);
    expect(rows).toEqual([
      { col_1: "Rent", col_2: "a", col_3: 1200 },
      { col_1: "Food", col_2: null, col_3: 80.5 },
    ]);
  });
});
