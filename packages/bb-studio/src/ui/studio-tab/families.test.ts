import { describe, expect, it } from "vitest";
import { familyOf, itemParams, tabKind, tabTarget, toggleFamily } from "./model";

describe("item families", () => {
  it("puts documents under Pages and things that run under Apps, by type or by the kind name it had", () => {
    expect(["doc", "whiteboard", "design", "page", "drawing"].map(familyOf)).toEqual(["page", "page", "page", "page", "page"]);
    expect(["mini", "dashboard", "artifact"].map(familyOf)).toEqual(["app", "app", "app"]);
    expect(familyOf("recording")).toBeNull();
  });
  it("turns a whole family on, keeping other picks, and off again when it was all on", () => {
    const present = ["doc", "design", "mini", "recording"];
    const on = toggleFamily(["recording"], "page", present);
    expect(on).toEqual(["recording", "doc", "design"]);
    expect(toggleFamily(on, "page", present)).toEqual(["recording"]);
    expect(toggleFamily(["doc"], "page", present)).toEqual(["doc", "design"]);
  });
});

describe("tab params by family, type and the older kind", () => {
  const design = "dsn_0123456789abcdef";
  const dashboard = "dsh_0123456789abcdef";
  const artifact = "art_0123456789abcdef";
  it("opens a design as a page type, and still by its own kind", () => {
    expect(tabTarget({ kind: "page", id: design })).toEqual({ view: "item", kind: "design", id: design });
    expect(tabTarget({ kind: "design", id: design })).toEqual({ view: "item", kind: "design", id: design });
    expect(tabTarget({ kind: "page", id: "pg_abc" })).toEqual({ view: "item", kind: "page", id: "pg_abc" });
    expect(tabTarget({ kind: "doc", id: "pg_abc" })).toEqual({ view: "item", kind: "page", id: "pg_abc" });
  });
  it("opens a dashboard and an artifact as app types, and still by their own kinds", () => {
    expect(tabTarget({ kind: "app", id: dashboard })).toEqual({ view: "item", kind: "dashboard", id: dashboard });
    expect(tabTarget({ kind: "app", id: artifact })).toEqual({ view: "item", kind: "artifact", id: artifact });
    expect(tabTarget({ kind: "dashboard", id: dashboard })).toEqual({ view: "item", kind: "dashboard", id: dashboard });
    expect(tabTarget({ kind: "artifact", id: artifact })).toEqual({ view: "item", kind: "artifact", id: artifact });
  });
  it("opens the list for a family with an id of the other family, or of a kind that's off", () => {
    expect(tabTarget({ kind: "app", id: design })).toEqual({ view: "list" });
    expect(tabTarget({ kind: "page", id: dashboard })).toEqual({ view: "list" });
    expect(tabTarget({ kind: "page", id: design }, [tabKind("page")!])).toEqual({ view: "list" });
  });
  it("writes the tab kind every BB already reads, whichever name it was given", () => {
    expect(itemParams("page", design)).toEqual({ kind: "design", id: design });
    expect(itemParams("app", dashboard)).toEqual({ kind: "dashboard", id: dashboard });
    expect(itemParams("design", design)).toEqual({ kind: "design", id: design });
    expect(tabKind("whiteboard")?.kind).toBe("drawing");
  });
});
