import { describe, expect, it } from "vitest";
import { currentTabTitle } from "./global-workbench";

describe("currentTabTitle", () => {
  const tabs = [
    { href: "/plugins/studio/studio/pages/pg_1?view=edit", title: "Trip plan" },
    { href: "/plugins/studio/studio/pages/pg_12", title: "Other" },
    { href: "/plugins/studio/studio/minis/mini_1", title: "  " },
  ];
  it("finds the item's tab by kind and id, ignoring the query", () => {
    expect(currentTabTitle(tabs, "pages", "pg_1")).toBe("Trip plan");
  });
  it("is null for an item that is not open or has no title yet", () => {
    expect(currentTabTitle(tabs, "pages", "pg_2")).toBeNull();
    expect(currentTabTitle(tabs, "minis", "mini_1")).toBeNull();
  });
});
