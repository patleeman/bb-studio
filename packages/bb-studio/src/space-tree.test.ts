import { describe, expect, it } from "vitest";
import type { Space } from "./spaces";
import { spaceOpenItems, spaceTreeItems, type TreeSource } from "./space-tree";

const space: Space = { id: "s1", isDefault: false, name: "Launch", color: "#000", icon: null, description: "", defaultProjectId: null, projectIds: ["proj_app"], threadIds: [], itemKeys: [], createdAt: 0, updatedAt: 0 };
const item = (pluginId: string, id: string, updatedAt: number, extra: Partial<TreeSource> = {}): TreeSource => ({ pluginId, id, kind: "page", title: id, icon: null, href: `/${id}`, updatedAt, projectId: "proj_app", parentId: null, archived: false, ...extra });
const options = { background: new Set(["talk:note"]), kindIcon: () => "File" };

describe("spaceTreeItems", () => {
  it("lists held items newest first, sub-pages under their parent", () => {
    const { items, count } = spaceTreeItems(space, [
      item("pages", "a", 1),
      item("pages", "b", 3, { parentId: "a" }),
      item("pages", "c", 2, { parentId: "b" }),
      item("excalidraw", "d", 5, { projectId: "proj_app" }),
      item("pages", "other", 7, { projectId: null }),
      item("talk", "t1", 8, { kind: "note" }),
      item("pages", "gone", 6, { archived: true }),
    ], options);
    expect(count).toBe(4);
    expect(items.map((each) => [each.id, each.depth, each.parentId])).toEqual([["d", 0, null], ["a", 0, null], ["b", 1, "a"], ["c", 2, "b"]]);
  });

  it("caps the list and keeps a child whose parent is cut at the top", () => {
    const { items, count } = spaceTreeItems(space, [item("pages", "a", 1), item("pages", "b", 3, { parentId: "a" })], { ...options, limit: 1 });
    expect(count).toBe(2);
    expect(items.map((each) => [each.id, each.depth])).toEqual([["b", 0]]);
  });

  it("survives a parent cycle and clamps depth", () => {
    const chain = [item("pages", "1", 9), ...[2, 3, 4, 5].map((n) => item("pages", String(n), 9 - n, { parentId: String(n - 1) }))];
    const cycle = [item("pages", "x", 1, { parentId: "y" }), item("pages", "y", 0, { parentId: "x" })];
    const { items } = spaceTreeItems(space, [...chain, ...cycle], options);
    expect(items.map((each) => each.depth)).toEqual([0, 1, 2, 3, 3, 0, 1]);
    expect(items.at(-2)!.title).toBe("x");
  });
});

describe("spaceOpenItems", () => {
  it("keeps the Space's open items in tab order, dropping archived ones and other Spaces' items", () => {
    const items = [item("pages", "a", 1), item("pages", "b", 2), item("pages", "gone", 3, { archived: true }), item("pages", "elsewhere", 4, { projectId: "proj_other" })];
    const tabs = ["b", "elsewhere", "gone", "missing", "a"].map((id) => ({ pluginId: "pages", id, pinned: false }));
    expect(spaceOpenItems(space, tabs, items, () => ({ icon: "File", label: "Page" })).map((each) => each.id)).toEqual(["b", "a"]);
  });

  it("carries each tab's pinned flag in tab order", () => {
    const items = [item("pages", "a", 1), item("pages", "b", 2)];
    const tabs = [{ pluginId: "pages", id: "a", pinned: true }, { pluginId: "pages", id: "b", pinned: false }];
    expect(spaceOpenItems(space, tabs, items, () => ({ icon: "File", label: "Page" })).map((each) => [each.id, each.pinned])).toEqual([["a", true], ["b", false]]);
  });
});
