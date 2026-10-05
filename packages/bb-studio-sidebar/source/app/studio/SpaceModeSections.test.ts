import { describe, expect, it } from "vitest";
import { buildProjectThreadGroups, compareStandardThreads } from "../model/project-thread-groups.js";
import { makeSidebarThread } from "../testing/fixtures.js";
import { needsYouFirst } from "./SpaceModeSections.js";

describe("By space thread order", () => {
  it("puts threads that wait on you first: questions, then failures, then results", () => {
    const thread = (id: string, at: number, fields: Parameters<typeof makeSidebarThread>[0] = {}) =>
      makeSidebarThread({ id, projectId: "proj", createdAt: at, updatedAt: at, latestAttentionAt: at, isUnread: false, ...fields });
    const items = buildProjectThreadGroups([
      thread("thr_read", 6),
      thread("thr_busy", 5, { status: "active" }),
      thread("thr_done", 4, { isUnread: true }),
      thread("thr_failed", 3, { indicator: "unread-error" }),
      thread("thr_ask", 2, { hasPendingInteraction: true }),
      thread("thr_parent", 1),
      thread("thr_child_done", 0, { parentThreadId: "thr_parent", isUnread: true }),
    ], compareStandardThreads, new Set(), false);
    const ids = needsYouFirst(items).map((item) => (item.kind === "thread" ? item.node.thread.id : item.kind));
    expect(ids).toEqual(["thr_ask", "thr_failed", "thr_done", "thr_parent", "thr_busy", "thr_read"]);
  });
});
