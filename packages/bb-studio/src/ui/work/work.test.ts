import { describe, expect, it } from "vitest";
import { isShown } from "./Navigation";
import { inboxLink } from "./links";
import { overviewOf } from "./Overview";
import { extendSelection, nest, sortThreads } from "./projects";
import { projectIdOf } from "./routes";

describe("navigation", () => {
  const panel = (pluginId: string, panelId: string, isVisible = true) => ({ isVisible, action: { kind: "open-plugin-panel" as const, pluginId, panelId } });

  it("keeps BB's own items and other plugins' panels as BB shows them", () => {
    expect(isShown({ isVisible: true, action: { kind: "new-thread" } })).toBe(true);
    expect(isShown(panel("pages", "pages"))).toBe(true);
    expect(isShown(panel("pages", "pages", false))).toBe(false);
  });

  it("shows Studio's places only, not the panels that serve item links", () => {
    expect(["office-inbox", "projects", "studio"].map((id) => isShown(panel("studio", id)))).toEqual([true, true, true]);
    expect(["artifacts", "tasks", "channels", "bots", "chat", "feed"].map((id) => isShown(panel("studio", id)))).toEqual([false, false, false, false, false, false]);
  });
});

describe("project routes", () => {
  it("reads the project from the panel sub-path", () => {
    expect(projectIdOf("")).toBeNull();
    expect(projectIdOf("proj_abc")).toBe("proj_abc");
    expect(projectIdOf("/proj_abc/")).toBe("proj_abc");
  });
});

describe("inboxLink", () => {
  it("keeps live paths", () => {
    expect(inboxLink({ href: "/plugins/pages/pages/pg_1", item: null, threadId: "thr_1" })).toEqual({ kind: "path", path: "/plugins/pages/pages/pg_1" });
    expect(inboxLink({ href: "/plugins/studio/office-inbox", item: null, threadId: null })).toEqual({ kind: "path", path: "/plugins/studio/office-inbox" });
  });
  it("sends removed office paths to the thread, or nowhere", () => {
    expect(inboxLink({ href: "/plugins/studio/office-team/bot_1", item: null, threadId: "thr_1" })).toEqual({ kind: "thread", threadId: "thr_1" });
    expect(inboxLink({ href: "/plugins/studio/office", item: null, threadId: null })).toBeNull();
    expect(inboxLink({ href: null, item: { ref: "x", title: "x", href: "/plugins/studio/office-conversation/c1" }, threadId: null })).toBeNull();
  });
});

describe("overviewOf", () => {
  const thread = (id: string, extra: Record<string, unknown> = {}) => ({
    id, projectId: "p", parentThreadId: null, isArchived: false, isHidden: false, hasPendingInteraction: false,
    runtimeStatus: "idle", updatedAt: 1, isUnread: false, displayTitle: id, ...extra,
  }) as never;
  const threads = [
    thread("lead", { updatedAt: 9 }),
    thread("a", { updatedAt: 5, runtimeStatus: "running" }),
    thread("a1", { parentThreadId: "a", updatedAt: 6, hasPendingInteraction: true }),
    thread("b", { parentThreadId: "lead", updatedAt: 7 }),
    thread("other", { projectId: "q" }),
    thread("old", { isArchived: true }),
  ];
  const event = (key: string, threadId: string | null, createdAt: number) => ({ key, threadId, createdAt }) as never;
  const view = overviewOf(threads, "p", "lead", [event("e1", "a", 1), event("e2", "other", 2), event("e3", "lead", 3)]);

  it("nests sub-threads under their parent; the lead's children are top level", () => {
    expect(view.tree.map(({ thread, children }) => [thread.id, children.map((child) => child.id)])).toEqual([["b", []], ["a", ["a1"]]]);
  });
  it("lists what needs you and what's running", () => {
    expect(view.needsYou.map((t) => t.id)).toEqual(["a1"]);
    expect(view.running.map((t) => t.id)).toEqual(["a"]);
  });
  it("keeps only this project's updates, newest first", () => {
    expect(view.updates.map((e) => e.key)).toEqual(["e3", "e1"]);
  });
});

describe("thread list", () => {
  const t = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({ id, updatedAt, createdAt: 100 - updatedAt, displayTitle: id, parentThreadId: null, ...extra }) as never;
  const threads = [t("b", 2), t("a", 3), t("c", 1), t("a1", 5, { parentThreadId: "a" })];
  it("sorts by updated, created and title, either way", () => {
    const ids = (list: { id: string }[]) => list.map((x) => x.id);
    expect(ids(sortThreads(threads, { by: "updated", desc: true }))).toEqual(["a1", "a", "b", "c"]);
    expect(ids(sortThreads(threads, { by: "created", desc: true }))).toEqual(["c", "b", "a", "a1"]);
    expect(ids(sortThreads(threads, { by: "alpha", desc: false }))).toEqual(["a", "a1", "b", "c"]);
    expect(ids(sortThreads(threads, { by: "alpha", desc: true }))).toEqual(["c", "b", "a1", "a"]);
  });
  it("puts sub-threads under their parent", () => {
    expect(nest(sortThreads(threads, { by: "updated", desc: true })).map((row) => `${row.thread.id}:${row.depth}`)).toEqual(["a:0", "a1:1", "b:0", "c:0"]);
  });
  it("toggles one, or selects a range from the anchor", () => {
    const order = ["a", "b", "c", "d"];
    expect([...extendSelection(order, new Set(), null, "b", false)]).toEqual(["b"]);
    expect([...extendSelection(order, new Set(["b"]), null, "b", false)]).toEqual([]);
    expect([...extendSelection(order, new Set(["d"]), "d", "b", true)].sort()).toEqual(["b", "c", "d"]);
  });
});
