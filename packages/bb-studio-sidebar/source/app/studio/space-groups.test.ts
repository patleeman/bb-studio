import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../testing/fixtures.js";
import { buildProjectThreadGroups, compareStandardThreads } from "../model/project-thread-groups.js";
import { getSidebarThreadComparator } from "../list/ProjectList.js";
import { buildSpaceThreadGroups, leadFirst, spaceHref, type StudioSpace } from "./space-groups.js";

const spaces: StudioSpace[] = [
  { id: "sp_b", name: "Beta", color: "#00f", icon: null, defaultProjectId: null },
  { id: "sp_a", name: "Alpha", color: "#f00", icon: "🚀", defaultProjectId: "proj_a" },
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

  it("keeps Studio's order, puts children with their root, and sends unknown Spaces to Threads", () => {
    const { groups, loose } = buildSpaceThreadGroups(rows, spaces, spaceOf, { sp_a: "lead" });
    expect(groups.map((group) => [group.space.id, group.leadThreadId, group.threads.map((thread) => thread.id)])).toEqual([
      ["sp_b", null, ["beta"]],
      ["sp_a", "lead", ["newest", "lead", "child"]],
    ]);
    expect(loose.map((thread) => thread.id)).toEqual(["none", "gone"]);
  });

  it("lists a Space with no threads", () => {
    const { groups, loose } = buildSpaceThreadGroups([], spaces, {}, {});
    expect(groups.map((group) => group.threads.length)).toEqual([0, 0]);
    expect(loose).toEqual([]);
  });

  it("sorts the lead first under any sort", () => {
    const threads = buildSpaceThreadGroups(rows, spaces, spaceOf, { sp_a: "lead" }).groups[1]!.threads;
    for (const compare of [compareStandardThreads, getSidebarThreadComparator("alpha"), getSidebarThreadComparator("created")]) {
      const items = buildProjectThreadGroups(threads, leadFirst(compare, "lead"), new Set(), false);
      expect(items.map((item) => item.kind === "thread" ? item.node.thread.id : item.kind)).toEqual(["lead", "newest"]);
    }
  });

  it("opens a Space at Studio's Space path", () => {
    expect(spaceHref("sp a/b")).toBe("/plugins/studio/spaces/sp%20a%2Fb");
  });
});
