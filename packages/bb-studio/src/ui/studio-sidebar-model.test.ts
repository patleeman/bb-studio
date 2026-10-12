import { describe, expect, it } from "vitest";
import { RECENT_LIMIT, studioSidebarModel } from "./studio-sidebar-model";

const kind = (id: string, plural: string) => ({ id, label: id, plural, icon: `icon-${id}`, columns: [], actions: [], create: null, canArchive: true, blurb: "" });
const item = (pluginId: string, kindId: string, id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  id, kind: kindId, title: id, icon: null, projectId: null, parentId: null, createdAt: 0, updatedAt, updatedBy: null, preview: null, facts: [], badge: null, thumbnailUrl: null,
  href: `/plugins/${pluginId}/${kindId}/${id}`, archived: false, pluginId, tags: [] as string[], ...extra,
});
const providers = [
  { pluginId: "studio", name: "Studio", state: "ready" as const, detail: null, panel: null, kinds: [kind("design", "Designs"), kind("recording", "Recordings"), kind("page", "Pages")] },
  { pluginId: "other", name: "Other", state: "ready" as const, detail: null, panel: null, kinds: [kind("board", "Boards")] },
  { pluginId: "gone", name: "Gone", state: "offline" as const, detail: null, panel: null, kinds: [kind("thing", "Things")] },
];

describe("studioSidebarModel", () => {
  const items = [
    item("studio", "page", "p1", 30, { tags: ["t1"] }),
    item("studio", "page", "p2", 10),
    item("studio", "page", "old", 50, { archived: true }),
    item("studio", "design", "d1", 20, { tags: ["t1"] }),
    item("gone", "thing", "x1", 99),
  ];
  const data = { providers, items: items as never, tags: [{ id: "t1", name: "Launch plan", color: "blue" }], views: [{ id: "v1", name: "Mine", query: "kind:page" }] };
  const tabs = [{ pluginId: "studio", id: "p2", title: "p2", icon: "📌", kindIcon: "icon-page", href: "/plugins/studio/page/p2", pinned: true }];

  it("orders the built-in kinds first, counts live items, and skips off kinds and offline add-ons", () => {
    const model = studioSidebarModel(data, [], new Set(["recording"]));
    expect(model.kinds.map((each) => [each.label, each.count])).toEqual([["Pages", 2], ["Designs", 1], ["Boards", 0]]);
    expect(model.kinds[0]!.query).toBe("kind:page");
  });
  it("counts tags and filters by tag name", () => {
    const [tag] = studioSidebarModel(data, []).tags;
    expect(tag).toMatchObject({ name: "Launch plan", count: 2 });
    expect(tag!.query).toContain("tag:");
    expect(tag!.query).toContain("Launch plan");
  });
  it("lists pinned tabs and the most recently edited items, without repeats", () => {
    const model = studioSidebarModel(data, tabs);
    expect(model.pinned.map((each) => each.key)).toEqual(["studio:p2"]);
    expect(model.recent.map((each) => each.key)).toEqual(["studio:p1", "studio:d1"]);
    expect(model.views).toEqual(data.views);
  });
  it("keeps recents short", () => {
    const many = Array.from({ length: 30 }, (_, n) => item("studio", "page", `p${n}`, n));
    expect(studioSidebarModel({ ...data, items: many as never }, []).recent).toHaveLength(RECENT_LIMIT);
  });
});
