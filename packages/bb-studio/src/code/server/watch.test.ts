import { describe, expect, it } from "vitest";
import { ThreadWatcher } from "./watch";

type Ev = { seq: number; type: string; data?: unknown };

describe("following a working thread", () => {
  it("passes on each new activity once, starting after what came before", async () => {
    const log: Ev[] = [
      { seq: 1, type: "item/started", data: { item: { type: "fileRead", path: "/old.ts" } } },
    ];
    const seen: string[] = [];
    let status = "active";
    const watcher = new ThreadWatcher({
      events: async ({ afterSeq, order }) => {
        if (order === "desc") return { events: log.slice(-1) };
        return { events: log.filter((event) => event.seq > Number(afterSeq ?? 0)) };
      },
      threadPath: async () => "/repo",
      status: async () => status,
      onActivity: (_threadId, activity) => { seen.push(`${activity.kind}:${"path" in activity ? activity.path : activity.state}`); },
      pollMs: 10,
    });
    watcher.watch("thr_1");
    await new Promise((resolve) => setTimeout(resolve, 30));
    log.push({ seq: 2, type: "turn/started" });
    log.push({ seq: 3, type: "item/started", data: { item: { type: "fileRead", path: "/repo/a.ts" } } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    log.push({ seq: 4, type: "turn/completed" });
    status = "idle";
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(seen).toEqual(["turn:working", "read:/repo/a.ts", "turn:done"]);
    expect(watcher.watching("thr_1")).toBe(false);
    watcher.dispose();
  });
});

describe("BB's page limit", () => {
  it("never asks for more than 100 events at once", async () => {
    const limits: number[] = [];
    const watcher = new ThreadWatcher({
      events: async ({ limit }) => { limits.push(Number(limit)); return { events: [] }; },
      threadPath: async () => null,
      status: async () => "idle",
      onActivity: () => undefined,
      pollMs: 5,
    });
    watcher.watch("thr_x");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Math.max(...limits)).toBeLessThanOrEqual(100);
    watcher.dispose();
  });
});
