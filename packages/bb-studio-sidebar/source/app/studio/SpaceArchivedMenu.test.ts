import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../testing/fixtures.js";
import { spaceArchivedThreads } from "./SpaceArchivedMenu.js";
import type { StudioSpace } from "./space-groups.js";

const spaces: StudioSpace[] = [
  { id: "sp_b", name: "Beta", color: "#00f", icon: null, defaultProjectId: null, isDefault: false, projectIds: ["proj_b"] },
  { id: "sp_a", name: "Alpha", color: "#f00", icon: null, defaultProjectId: null, isDefault: true, projectIds: [] },
];

describe("spaceArchivedThreads", () => {
  const threads = [
    makeSidebarThread({ id: "old", archivedAt: 1 }),
    makeSidebarThread({ id: "new", archivedAt: 5 }),
    makeSidebarThread({ id: "child", parentThreadId: "old", archivedAt: 3 }),
    makeSidebarThread({ id: "beta", archivedAt: 4 }),
    makeSidebarThread({ id: "project", projectId: "proj_b", archivedAt: 6 }),
    makeSidebarThread({ id: "active", archivedAt: null }),
  ];
  const spaceOf = { old: "sp_a", beta: "sp_b", child: "sp_b" };

  it("keeps the Space's archived threads, children with their root, newest archived first", () => {
    expect(spaceArchivedThreads(threads, spaces[1]!, spaces, spaceOf).map((thread) => thread.id)).toEqual(["new", "child", "old"]);
    expect(spaceArchivedThreads(threads, spaces[0]!, spaces, spaceOf).map((thread) => thread.id)).toEqual(["project", "beta"]);
  });

  it("puts an archived child of an active parent in the parent's Space", () => {
    const parent = makeSidebarThread({ id: "parent", projectId: "proj_b", archivedAt: null });
    const child = makeSidebarThread({ id: "kid", parentThreadId: "parent", archivedAt: 2 });
    const archived = [child];
    const parentSpaceOf = { parent: "sp_b" };
    expect(spaceArchivedThreads(archived, spaces[0]!, spaces, parentSpaceOf, [parent]).map((thread) => thread.id)).toEqual(["kid"]);
    expect(spaceArchivedThreads(archived, spaces[1]!, spaces, parentSpaceOf, [parent])).toEqual([]);
  });
});
