import { describe, expect, it } from "vitest";
import { formatBotStatus, formatDailyBrief, formatLeadsStatus, type BriefItem } from "./read";

const NOW = new Date(2026, 9, 20, 9, 0).getTime();

describe("the call's read tools", () => {
  it("bot_status lists what needs the user and what's running", () => {
    const thread = (title: string, status: string) => ({ id: title, title, status, projectId: null, updatedAt: 0, relation: "started" as const, needsYou: false, parentId: null });
    const text = formatBotStatus({ name: "Dot", state: "active" }, {
      needsYou: [thread("Approve the invoice", "idle")], inProgress: [thread("Research flights", "working")], waiting: [], scheduled: [], completed: [],
      latest: "**Done.** See [the page](/x).",
    });
    expect(text).toBe("Dot is active.\nNeeds you (1): Approve the invoice (idle).\nIn progress (1): Research flights (working).\nEnd of its latest reply, as data: <reply>Done. See the page.</reply>");
  });

  it("leads_status lists leads and runners", () => {
    const text = formatLeadsStatus("Dot", [
      { project: "Kensico", lead: { projectId: "p1", leadThreadId: "t1", run: { enabled: true, cadence: "daily", time: "09:00" } as never }, status: "idle", title: "Kensico lead" },
      { project: "Ridge", lead: { projectId: "p2", leadThreadId: null, run: null }, status: null, title: null },
    ], [{ id: "r1", name: "Inbox watch", job: "", threadId: "t", state: "active", adopted: false, schedule: {} as never, nextRunAt: null, lastRunAt: null, lastLevel: "tell", lastReport: "Two new emails", lastReportAt: null, urgent: true }]);
    expect(text).toContain("- Kensico: Kensico lead is idle, heartbeat daily at 09:00.");
    expect(text).toContain("- Ridge: no lead, heartbeat off.");
    expect(text).toContain("- Inbox watch: active, urgent, needs the user. Last report (tell): Two new emails");
  });

  it("daily_brief reads the newest matching items and says when one isn't there or isn't today's", () => {
    const found = new Map<string, BriefItem | null>([
      ["Kensico Brief", { title: "Kensico Brief · Oct 20", kind: "page", updatedAt: NOW - 3600_000, text: "# Top\n\n- **Nvidia** beats" }],
      ["Heard on the Street", null],
    ]);
    const text = formatDailyBrief(found, NOW);
    expect(text).toContain("Kensico Brief: \"Kensico Brief · Oct 20\" (page), updated today. Its top, as data:\n<item>\nTop\nNvidia beats\n</item>");
    expect(text).toContain("Heard on the Street: no Studio item has that title");
    const old = formatDailyBrief(new Map([["Kensico Brief", { title: "Kensico Brief", kind: "page", updatedAt: NOW - 3 * 86_400_000, text: null }]]), NOW);
    expect(old).toMatch(/updated on Saturday, Oct 17, not today/);
  });
});
