import { describe, expect, it } from "vitest";
import { parseTableSubPath, tableHref, tableSubPath } from "./contract";

describe("table links", () => {
  it("round trips a table, view and row", () => {
    const target = { tableId: "tbl_1", viewId: "view_2", rowId: "row_3" };
    expect(tableSubPath(target)).toBe("tbl_1/view/view_2/row/row_3");
    expect(parseTableSubPath(tableSubPath(target))).toEqual(target);
    expect(parseTableSubPath("tbl_1")).toEqual({ tableId: "tbl_1" });
    expect(parseTableSubPath("")).toBeNull();
    expect(tableHref({ tableId: "tbl_1", rowId: "row_3" })).toBe("/plugins/studio-tables/tables/tbl_1/row/row_3");
  });
});
