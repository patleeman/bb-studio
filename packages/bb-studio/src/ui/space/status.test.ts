import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { OverviewThread } from "./data";
import { startedByLead, stateOf } from "./status";
const thread: OverviewThread = { id: "worker", title: "Review", status: "idle", updatedAt: 1, parentThreadId: null, isLead: false };
const live = (fields: Partial<PluginSidebarThread>) => ({ status: "idle", runtimeStatus: "idle", queuedWork: "none", hasPendingInteraction: false, activity: { backgroundAgents: 0, backgroundCommands: 0, workflows: 0, goals: 0, planMode: 0 }, ...fields }) as PluginSidebarThread;
describe("Space thread state", () => {
  it("does not claim an idle thread has finished its task", () => expect(stateOf({ ...thread, progress: "Tests passed; publication remains." }, live({})).label).toBe("Idle"));
  it("places a user decision before the busy runtime", () => expect(stateOf(thread, live({ status: "active", runtimeStatus: "active", hasPendingInteraction: true }))).toMatchObject({ label: "Needs you", order: 0 }));
  it("uses live recovered state over a stale failed overview", () => expect(stateOf({ ...thread, status: "error", failureReason: "Old error" }, live({})).label).toBe("Idle"));
  it("shows background work even between foreground turns", () => expect(stateOf(thread, live({ activity: { backgroundCommands: 1, backgroundAgents: 0, workflows: 0, goals: 0, planMode: 0 } })).label).toBe("Working"));
  it("shows the failure cause for a failed thread", () => expect(stateOf({ ...thread, status: "error", failureReason: "Provider quota exhausted." }, undefined).reason).toBe("Provider quota exhausted."));
  it("does not classify a disconnected machine as idle", () => expect(stateOf(thread, live({ runtimeStatus: "waiting-for-host" })).label).toBe("Blocked"));
});
describe("Who steers a Space thread", () => {
  const byId = (rows: OverviewThread[]) => new Map(rows.map((row) => [row.id, row]));
  const lead = { ...thread, id: "lead", isLead: true };
  it("counts the lead's workers, at any depth", () => {
    const worker = { ...thread, id: "w", parentThreadId: "lead" };
    const sub = { ...thread, id: "s", parentThreadId: "w" };
    expect(startedByLead(sub, byId([lead, worker, sub]), "lead")).toBe(true);
  });
  it("leaves threads you started to you", () => expect(startedByLead({ ...thread, parentThreadId: "other" }, byId([lead]), "lead")).toBe(false));
  it("survives a parent cycle", () => {
    const a = { ...thread, id: "a", parentThreadId: "b" };
    const b = { ...thread, id: "b", parentThreadId: "a" };
    expect(startedByLead(a, byId([a, b]), "lead")).toBe(false);
  });
});
