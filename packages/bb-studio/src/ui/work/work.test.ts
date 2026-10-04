import { describe, expect, it } from "vitest";
import { isShown } from "./Navigation";
import { inboxLink } from "./links";
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
