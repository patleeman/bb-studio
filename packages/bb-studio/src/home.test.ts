import { describe, expect, it } from "vitest";
import { homeData, summarizeTurns } from "./home";

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

  it("hides missing add-ons", async () => {
    const sdk = {
      plugins: { list: async () => ({ plugins: [] }), callRpc: async () => null },
      threads: { list: async () => [], events: { list: async () => [] } },
      projects: { list: async () => [{ id: "p1" }] },
    };
    const hub = { overview: async () => ({ providers: [], items: [] }) };
    const services = { activity: () => [], openComments: () => [] };
    const result = await homeData(sdk as never, hub as never, services as never, { list: async () => null } as never, "p1");
    expect(result.working.bots).toBeNull();
    expect(result.automations).toBeNull();
  });

  it("leaves background kinds out of recent items", async () => {
    const sdk = {
      plugins: { list: async () => ({ plugins: [] }), callRpc: async () => null },
      threads: { list: async () => [], events: { list: async () => [] } },
      projects: { list: async () => [] },
    };
    const item = (id: string, kind: string) => ({ pluginId: "talk", id, kind, title: id, href: `/${id}`, projectId: null, archived: false, updatedAt: 1 });
    const hub = { overview: async () => ({
      providers: [{ pluginId: "talk", kinds: [{ id: "recording" }, { id: "dictation", background: true }] }],
      items: [item("meeting", "recording"), item("quick", "dictation")],
    }) };
    const result = await homeData(sdk as never, hub as never, { activity: () => [], openComments: () => [] } as never, { list: async () => null } as never);
    expect(result.recent.map((entry) => entry.id)).toEqual(["meeting"]);
  });
});
