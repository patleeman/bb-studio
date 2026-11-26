import { describe, expect, it } from "vitest";
import { itemParams, tabKind, tabTarget } from "./model";

describe("tab params by family, type and the older kind", () => {
  const design = "dsn_0123456789abcdef";
  const mini = "mini_0123456789abcdef";
  const artifact = "art_0123456789abcdef";
  it("opens a design as a page type, and still by its own kind", () => {
    expect(tabTarget({ kind: "page", id: design })).toEqual({ view: "item", kind: "design", id: design });
    expect(tabTarget({ kind: "design", id: design })).toEqual({ view: "item", kind: "design", id: design });
    expect(tabTarget({ kind: "page", id: "pg_abc" })).toEqual({ view: "item", kind: "page", id: "pg_abc" });
    expect(tabTarget({ kind: "doc", id: "pg_abc" })).toEqual({ view: "item", kind: "page", id: "pg_abc" });
  });
  it("opens a mini app and an artifact as app types, and still by their own kinds", () => {
    expect(tabTarget({ kind: "app", id: mini })).toEqual({ view: "item", kind: "mini", id: mini });
    expect(tabTarget({ kind: "app", id: artifact })).toEqual({ view: "item", kind: "artifact", id: artifact });
    expect(tabTarget({ kind: "mini", id: mini })).toEqual({ view: "item", kind: "mini", id: mini });
    expect(tabTarget({ kind: "artifact", id: artifact })).toEqual({ view: "item", kind: "artifact", id: artifact });
  });
  it("opens the list for a family with an id of the other family, or of a kind that's off", () => {
    expect(tabTarget({ kind: "app", id: design })).toEqual({ view: "list" });
    expect(tabTarget({ kind: "page", id: mini })).toEqual({ view: "list" });
    expect(tabTarget({ kind: "app", id: "dsh_0123456789abcdef" })).toEqual({ view: "list" });
    expect(tabTarget({ kind: "page", id: design }, [tabKind("page")!])).toEqual({ view: "list" });
  });
  it("writes the tab kind every BB already reads, whichever name it was given", () => {
    expect(itemParams("page", design)).toEqual({ kind: "design", id: design });
    expect(itemParams("app", mini)).toEqual({ kind: "mini", id: mini });
    expect(itemParams("design", design)).toEqual({ kind: "design", id: design });
    expect(tabKind("whiteboard")?.kind).toBe("drawing");
  });
});
