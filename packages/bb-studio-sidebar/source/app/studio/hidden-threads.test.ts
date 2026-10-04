import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../testing/fixtures.js";
import { createSectionKeyResolver, filterHiddenThreads, hiddenThreadIds } from "./hidden-threads.js";
import type { SidebarThread } from "../model/sidebar-thread.js";

function filter(threads: SidebarThread[], hidden: string[], options: { revealed?: string[]; keep?: string[] } = {}) {
  return filterHiddenThreads({
    threads,
    hiddenIds: hiddenThreadIds(threads, hidden),
    sectionKeyOf: createSectionKeyResolver(threads, { mode: "project", personalProjectId: "proj_personal", spaceOf: {}, spaceIds: new Set() }),
    revealed: new Set(options.revealed),
    keepIds: new Set(options.keep),
  });
}

const ids = (threads: SidebarThread[]) => threads.map((thread) => thread.id);

describe("hidden threads", () => {
  it("covers children but never pinned trees or unknown ids", () => {
    const rows = [
      makeSidebarThread({ id: "hid" }),
      makeSidebarThread({ id: "child", parentThreadId: "hid" }),
      makeSidebarThread({ id: "pinned", isPinned: true }),
      makeSidebarThread({ id: "pinned-child", parentThreadId: "pinned" }),
    ];
    expect([...hiddenThreadIds(rows, ["hid", "pinned", "pinned-child", "gone"])].sort()).toEqual(["child", "hid"]);
  });

  it("hides per section, counts them, and reveals a section on request", () => {
    const rows = [
      makeSidebarThread({ id: "a", projectId: "proj_a" }),
      makeSidebarThread({ id: "b", projectId: "proj_a" }),
      makeSidebarThread({ id: "c", projectId: "proj_b" }),
    ];
    const hidden = filter(rows, ["a", "c"]);
    expect(ids(hidden.visible)).toEqual(["b"]);
    expect(hidden.hidden).toEqual(new Map([["project:proj_a", 1], ["project:proj_b", 1]]));
    const revealed = filter(rows, ["a", "c"], { revealed: ["project:proj_a"] });
    expect(ids(revealed.visible)).toEqual(["a", "b"]);
    expect(revealed.hidden.get("project:proj_a")).toBe(1);
  });

  it("keeps the open thread and its hidden ancestors", () => {
    const rows = [
      makeSidebarThread({ id: "root" }),
      makeSidebarThread({ id: "open", parentThreadId: "root" }),
      makeSidebarThread({ id: "sibling", parentThreadId: "root" }),
    ];
    expect(ids(filter(rows, ["root"], { keep: ["open"] }).visible)).toEqual(["root", "open"]);
  });
});
