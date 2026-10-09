import { describe, expect, it } from "vitest";
import { buildProjectThreadGroups, compareStandardThreads } from "../model/project-thread-groups.js";
import { makeSidebarThread } from "../testing/fixtures.js";
import { buildGroupSectionItem } from "../list/ProjectList.js";
import { collectSectionThreadDndLookup, resolveSectionThreadDropDecision } from "../dnd/useSectionThreadDnd.js";
import { getSidebarThreadRowDroppableId } from "../rows/sidebarThreadRowDroppable.js";
import { chiefUnder, ignoringLeadDrags, needsYouFirst, withLeadRows } from "./SpaceModeSections.js";

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

describe("Chief of Staff", () => {
  const thread = (id: string, parentThreadId: string | null = null) => makeSidebarThread({ id, projectId: "proj", parentThreadId });
  const threads = [thread("thr_chief"), thread("thr_sub", "thr_chief"), thread("thr_deep", "thr_sub"), thread("thr_other")];

  it("knows the Chief of Staff's workers at any depth", () => {
    expect(threads.filter((candidate) => chiefUnder(threads, "thr_chief", candidate)).map((candidate) => candidate.id)).toEqual(["thr_chief", "thr_sub", "thr_deep"]);
    expect(chiefUnder(threads, null, threads[0]!)).toBe(false);
  });
});

describe("Dropping on a lead row", () => {
  const thread = (id: string, parentThreadId: string | null = null) => makeSidebarThread({ id, projectId: "proj", parentThreadId });
  const lead = [thread("thr_lead"), thread("thr_worker", "thr_lead")];
  const others = [thread("thr_other")];
  const section = buildGroupSectionItem("sp", "space:sp", "Space", others, compareStandardThreads, new Set(), false);
  const leadItems = buildProjectThreadGroups(lead, compareStandardThreads, new Set(), false);
  const lookup = collectSectionThreadDndLookup([withLeadRows(section, leadItems)], "chronological");
  const drop = (active: string, over: string) => resolveSectionThreadDropDecision(lookup, active, getSidebarThreadRowDroppableId(over));

  it("nests a thread under the lead", () => {
    expect(drop("thr_other", "thr_lead")).toMatchObject({ kind: "nest", parentThreadId: "thr_lead", threadIds: ["thr_other"] });
  });

  it("never nests the lead under its own worker, or a thread under itself", () => {
    expect(drop("thr_lead", "thr_worker")).toMatchObject({ kind: "rejected", reason: "own-subtree" });
    expect(drop("thr_worker", "thr_lead")).toMatchObject({ kind: "rejected", reason: "already-child" });
  });

  it("knows nothing of the lead without its rows", () => {
    const bare = collectSectionThreadDndLookup([section], "chronological");
    expect(resolveSectionThreadDropDecision(bare, "thr_other", getSidebarThreadRowDroppableId("thr_lead"))).toBeNull();
  });
});

describe("Dragging a lead", () => {
  it("is ignored from start to end, while other drags go through", () => {
    const seen: string[] = [];
    const props = ignoringLeadDrags({
      onDragStart: (event: { active: { id: unknown } }) => seen.push(`start ${String(event.active.id)}`),
      onDragEnd: (event: { active: { id: unknown } }) => seen.push(`end ${String(event.active.id)}`),
    } as never, (id) => id === "thr_lead") as { onDragStart(e: unknown): void; onDragEnd(e: unknown): void };
    for (const id of ["thr_lead", "thr_other"]) {
      props.onDragStart({ active: { id } });
      props.onDragEnd({ active: { id } });
    }
    expect(seen).toEqual(["start thr_other", "end thr_other"]);
  });
});
