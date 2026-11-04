import { describe, expect, it } from "vitest";
import type { CanvasItem } from "../shared";
import { shortHeader, tableColumns } from "./items";

const table = (data: unknown, options: Record<string, unknown> = {}): CanvasItem => ({ id: "t", kind: "table", title: null, data, options, html: null, size: "m", importance: 3, createdAt: 1, updatedAt: 1, rev: 1 });

describe("canvas tables", () => {
  it("counts a table's columns for the layout", () => {
    expect(tableColumns(table([{ race: "PA", leader: "D", margin: 1.8 }, { race: "AZ", votes: 10 }]))).toBe(4);
    expect(tableColumns(table({ columns: ["a", "b"], rows: [[1, 2]] }))).toBe(2);
    expect(tableColumns(table([{ a: 1, b: 2, c: 3 }], { columns: ["a"] }))).toBe(1);
    expect(tableColumns({ ...table([]), kind: "bar" })).toBe(0);
  });

  it("shortens long headers only when the column is tight", () => {
    expect(shortHeader("Estimated residents", 90)).toBe("Est. Res.");
    expect(shortHeader("Estimated residents", 240)).toBe("Estimated residents");
    expect(shortHeader("Race", 60)).toBe("Race");
    expect(shortHeader("Outstanding ballots", 80)).toBe("Outst. ballots");
    expect(shortHeader("Margin (percentage)", 80)).toBe("Margin (%)");
  });
});
