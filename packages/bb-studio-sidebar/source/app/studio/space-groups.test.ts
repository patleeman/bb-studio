import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../testing/fixtures.js";
import { buildProjectThreadGroups, compareStandardThreads } from "../model/project-thread-groups.js";
import { buildSpaceThreadGroups, defaultSpaceId, type StudioSpace } from "./space-groups.js";
import { neighbourSpaceId } from "./SpaceSwitcher.js";

const spaces: StudioSpace[] = [
  { id: "sp_b", name: "Beta", color: "#00f", icon: null, defaultProjectId: null, isDefault: false, projectIds: ["proj_b"] },
  { id: "sp_a", name: "Alpha", color: "#f00", icon: "🚀", defaultProjectId: "proj_a", isDefault: true, projectIds: ["proj_a"] },
];

describe("By space grouping", () => {
  const rows = [
    makeSidebarThread({ id: "newest", updatedAt: 9, latestAttentionAt: 9 }),
    makeSidebarThread({ id: "lead", updatedAt: 1, latestAttentionAt: 1 }),
    makeSidebarThread({ id: "child", parentThreadId: "lead", updatedAt: 2, latestAttentionAt: 2 }),
    makeSidebarThread({ id: "beta", updatedAt: 3, latestAttentionAt: 3 }),
    makeSidebarThread({ id: "none", updatedAt: 4, latestAttentionAt: 4 }),
    makeSidebarThread({ id: "gone", updatedAt: 5, latestAttentionAt: 5 }),
  ];
  const spaceOf = { newest: "sp_a", lead: "sp_a", beta: "sp_b", gone: "sp_deleted", child: "sp_b" };

  it("keeps Studio's order, puts children with their root, and sends threads in no Space to the default Space", () => {
    const { groups, loose } = buildSpaceThreadGroups(rows, spaces, spaceOf, { sp_a: "lead" });
    expect(groups.map((group) => [group.space.id, group.leadThreadId, group.lead?.id ?? null, group.threads.map((thread) => thread.id)])).toEqual([
      ["sp_b", null, null, ["beta"]],
      ["sp_a", "lead", "lead", ["newest", "child", "none", "gone"]],
    ]);
    expect(loose).toEqual([]);
  });

  it("puts a thread Studio hasn't listed yet in its project's Space", () => {
    const fresh = makeSidebarThread({ id: "fresh", projectId: "proj_b", updatedAt: 10, latestAttentionAt: 10 });
    const { groups } = buildSpaceThreadGroups([...rows, fresh], spaces, spaceOf, {});
    expect(groups.find((group) => group.space.id === "sp_b")?.threads.map((thread) => thread.id)).toContain("fresh");
  });

  it("keeps threads loose only without Spaces", () => {
    expect(buildSpaceThreadGroups(rows, [], spaceOf, {}).loose).toHaveLength(rows.length);
  });

  it("steps through All and each Space, wrapping around", () => {
    expect(neighbourSpaceId(spaces, "all", 1)).toBe("sp_b");
    expect(neighbourSpaceId(spaces, "sp_b", 1)).toBe("sp_a");
    expect(neighbourSpaceId(spaces, "sp_a", 1)).toBe("all");
    expect(neighbourSpaceId(spaces, "all", -1)).toBe("sp_a");
    expect(neighbourSpaceId(spaces, "sp_b", -1)).toBe("all");
    expect(neighbourSpaceId([], null, 1)).toBeNull();
  });

  it("takes Studio's default Space, else the first", () => {
    expect(defaultSpaceId(spaces)).toBe("sp_a");
    expect(defaultSpaceId(spaces.map((space) => ({ ...space, isDefault: false })))).toBe("sp_b");
    expect(defaultSpaceId([])).toBeNull();
  });

  it("lists a Space with no threads", () => {
    const { groups, loose } = buildSpaceThreadGroups([], spaces, {}, {});
    expect(groups.map((group) => group.threads.length)).toEqual([0, 0]);
    expect(loose).toEqual([]);
  });

  it("lists the lead's workers at the top level, since the lead shows apart", () => {
    const threads = buildSpaceThreadGroups(rows, spaces, spaceOf, { sp_a: "lead" }).groups[1]!.threads;
    const items = buildProjectThreadGroups(threads, compareStandardThreads, new Set(), false);
    expect(items.map((item) => item.kind === "thread" ? item.node.thread.id : item.kind)).toEqual(["newest", "gone", "none", "child"]);
  });
});
