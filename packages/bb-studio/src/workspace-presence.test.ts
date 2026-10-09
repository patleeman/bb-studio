import { describe, expect, it, vi } from "vitest";
import { formatWorkspace, WorkspacePresence, type WorkspaceReport } from "./workspace-presence";

const page = { href: "/plugins/pages/pages/pg_one", title: "Launch plan" };
const recording = { href: "/plugins/talk/recordings/rec_one", title: "Weekly sync" };
const report = (client: string, focused: boolean, extra: Partial<WorkspaceReport> = {}): WorkspaceReport => ({
  client, focused, showing: true, panes: [{ id: "p1", focused: true, active: page.href, tabs: [page, recording] }], ...extra,
});

describe("Studio workspace for agents", () => {
  it("picks the focused window, else the one that reported last", () => {
    let now = 0;
    const presence = new WorkspacePresence(() => now);
    expect(presence.current()).toBeNull();
    presence.report(report("a", true));
    now = 1000;
    presence.report(report("b", false));
    expect(presence.current()?.client).toBe("a");
    presence.report(report("a", false));
    now = 2000;
    presence.report(report("b", false));
    expect(presence.current()?.client).toBe("b");
  });

  it("lists each pane's tabs with the one in front", () => {
    const split = report("a", true, { panes: [
      { id: "p1", focused: false, active: page.href, tabs: [page] },
      { id: "p2", focused: true, active: recording.href, tabs: [recording, { href: "/plugins/studio/studio/browse", title: "New tab" }] },
    ] });
    expect(formatWorkspace({ ...split, at: 0 }, 5000)).toBe([
      "The user's Studio workspace (updated just now). The user is looking at it now.",
      "",
      "Pane 1:",
      "▸ Launch plan — /plugins/pages/pages/pg_one (in front)",
      "",
      "Pane 2 (focused):",
      "▸ Weekly sync — /plugins/talk/recordings/rec_one (in front, focused)",
      "· New tab (Studio's item list)",
    ].join("\n"));
  });

  it("says when nothing is open or the user is elsewhere", () => {
    expect(formatWorkspace(null, 0)).toMatch(/No BB window/);
    const away = { ...report("a", true, { showing: false, panes: [{ id: "p1", focused: true, active: null, tabs: [] }] }), at: 0 };
    expect(formatWorkspace(away, 3 * 60_000)).toBe("The user's Studio workspace (updated 3 min ago). The user is elsewhere in BB right now; these tabs are kept for when they come back.\nNo tabs are open.");
  });

  it("stops trusting a focused report once it goes stale, such as a closed window's", () => {
    let now = 0;
    const presence = new WorkspacePresence(() => now);
    presence.report(report("closed", true));
    now = 1000;
    presence.report(report("open", false));
    expect(presence.current()?.client).toBe("closed");
    now = 120_000;
    expect(presence.current()?.client).toBe("open");
  });

  it("waits for a window to confirm a command, and gives up on one that's gone", async () => {
    vi.useFakeTimers();
    try {
      const presence = new WorkspacePresence();
      presence.report(report("a", true));
      const hasDraft = (each: WorkspaceReport) => each.panes.some((pane) => pane.tabs.some((tab) => tab.href === "/plugins/pages/pages/draft"));
      const confirmed = presence.waitFor("a", hasDraft, 3000);
      presence.report(report("b", true, { panes: [{ id: "p", focused: true, active: null, tabs: [{ href: "/plugins/pages/pages/draft", title: "Draft" }] }] }));
      presence.report(report("a", true, { panes: [{ id: "p", focused: true, active: null, tabs: [{ href: "/plugins/pages/pages/draft", title: "Draft" }] }] }));
      await expect(confirmed).resolves.toBe(true);
      const silent = presence.waitFor("gone", hasDraft, 3000);
      vi.advanceTimersByTime(3000);
      await expect(silent).resolves.toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
