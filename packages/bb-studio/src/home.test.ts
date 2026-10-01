import { describe, expect, it } from "vitest";
import { homeData, summarizeBotJobs, summarizeTurns } from "./home";

describe("home activity", () => {
  it("counts completed turns, measured duration and failures within the period", () => {
    expect(summarizeTurns([
      { type: "turn/completed", createdAt: 500 },
      { type: "turn/started", createdAt: 100 },
      { type: "turn/started", createdAt: 1_100 },
      { type: "turn/completed", createdAt: 1_400, data: { status: "failed" } },
      { type: "turn/started", createdAt: 1_500 },
    ], 1_000)).toEqual({ turns: 1, failures: 1, durationMs: 300 });
  });

  it("counts only started bot jobs in the period", () => {
    expect(summarizeBotJobs([
      { startedAt: null, updatedAt: 1_500, status: "queued" },
      { startedAt: 100, updatedAt: 500, status: "done" },
      { startedAt: 1_100, updatedAt: 1_400, status: "error" },
    ], 1_000)).toEqual({ turns: 1, failures: 1, durationMs: 300 });
  });

  it("shows task deadlines and hides missing add-ons", async () => {
    const now = Date.now();
    const date = new Date(now);
    const today = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    const sdk = {
      plugins: {
        list: async () => ({ plugins: [{ id: "studio-tasks", enabled: true, status: "running" }] }),
        callRpc: async ({ outputSchema }: { outputSchema: { parse: (value: unknown) => unknown } }) => outputSchema.parse({ tasks: [
          { id: "due", title: "Due", status: "todo", due: today, projectId: "p1", archived: false },
          { id: "review", title: "Review", status: "review", due: null, projectId: "p1", archived: false },
          { id: "other", title: "Other", status: "review", due: null, projectId: "p2", archived: false },
        ] }),
      },
      threads: { list: async () => [], events: { list: async () => [] } },
      projects: { list: async () => [{ id: "p1" }] },
    };
    const hub = { overview: async () => ({ items: [] }) };
    const services = { activity: () => [], openComments: () => [] };
    const result = await homeData(sdk as never, hub as never, services as never, { list: async () => null } as never, "p1");
    expect(result.due?.map((item) => item.id)).toEqual(["due"]);
    expect(result.review?.map((item) => item.id)).toEqual(["review"]);
    expect(result.working.bots).toBeNull();
    expect(result.automations).toBeNull();
  });

  it("uses each project's configured review column", async () => {
    const sdk = {
      plugins: {
        list: async () => ({ plugins: [{ id: "studio-tasks", enabled: true, status: "running" }] }),
        callRpc: async ({ method, outputSchema }: { method: string; outputSchema: { parse: (value: unknown) => unknown } }) => outputSchema.parse(method === "statuses"
          ? { columns: [{ id: "qa", label: "Review" }, { id: "done", label: "Done" }] }
          : { tasks: [{ id: "qa-task", title: "Check", status: "qa", due: null, projectId: "p1", archived: false }] }),
      },
      threads: { list: async () => [], events: { list: async () => [] } },
      projects: { list: async () => [{ id: "p1" }] },
    };
    const result = await homeData(sdk as never, { overview: async () => ({ items: [] }) } as never,
      { activity: () => [], openComments: () => [] } as never, { list: async () => null } as never, "p1");
    expect(result.review?.map((item) => item.id)).toEqual(["qa-task"]);
    expect(result.needsYou.map((entry) => entry.id)).toContain("task:review:qa-task");
  });
});
