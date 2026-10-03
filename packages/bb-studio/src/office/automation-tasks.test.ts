import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { automationTasks } from "./automation-tasks";

it("imports each old schedule once, preserving the engine trigger and old conversation", async () => {
  const db = new Database(":memory:");
  const profiles = new Map([["thr_dm", { botId: "bot_one" }]]);
  const rows = ["a", "b"].map(id => ({ id, name: `Routine ${id}`, enabled: id === "a", trigger: { triggerType: "schedule", cron: "*/17 * * * *", timezone: "Europe/Paris" }, execution: { mode: "agent", targetThreadId: "thr_dm", prompt: "Read the queue", permissionMode: "auto" } }));
  const projected = new Map<string, { taskId: string; threadId: string; managed: boolean; suppressed: boolean }>();
  const inputs: any[] = [], updates: any[] = [];
  let spawned = 0, loseResponse = true;
  const sdk = {
    projects: { list: async () => [{ id: "proj_folder" }] },
    plugins: { callRpc: async ({ method, input }: any) => {
      if (method === "automations_list") return structuredClone(rows);
      if (method === "office_recurringLookup") return projected.get(input.automationId) ?? { taskId: null, threadId: null, managed: false, suppressed: false };
      if (method === "automations_update") {
        updates.push(input);
        expect(input.agent).toEqual({ target: { type: "target-thread", threadId: expect.any(String) }, permissionMode: "accept-edits" });
        Object.assign(rows.find(a => a.id === input.automationId)!.execution, { targetThreadId: input.agent.target.threadId, permissionMode: input.agent.permissionMode });
        if (loseResponse) { loseResponse = false; throw new Error("response lost"); }
        return {};
      }
      if (method === "office_syncRecurring") {
        inputs.push(input);
        const taskId = `tsk_${input.source.automationId}`;
        projected.set(input.source.automationId, { taskId, threadId: input.threadId, managed: false, suppressed: false });
        return { taskId };
      }
      throw new Error(method);
    } },
  };
  const store = { db, byThread: (id: string) => profiles.get(id), get: () => ({ id: "bot_one", trust: "ask" }) };
  const threads = { newThread: async (_bot: unknown, projectId: string) => {
    expect(projectId).toBe("proj_folder");
    const threadId = `thr_task_${++spawned}`; profiles.set(threadId, { botId: "bot_one" }); return { threadId };
  } };
  const make = () => automationTasks({ sdk } as never, store as never, threads as never);
  try {
    await expect(make()()).rejects.toThrow("response lost");
    await make()(); await make()();
    expect(spawned).toBe(2);
    expect(projected.size).toBe(2);
    expect(projected.get("a")?.threadId).not.toBe(projected.get("b")?.threadId);
    expect(profiles.has("thr_dm")).toBe(true);
    expect(rows.map(a => a.enabled)).toEqual([true, false]);
    expect(rows.every(a => a.trigger.cron === "*/17 * * * *" && a.trigger.timezone === "Europe/Paris")).toBe(true);
    expect(updates.every(u => Object.keys(u).sort().join() === "agent,automationId,projectId")).toBe(true);
    expect(inputs[1]).toMatchObject({ enabled: false, source: { automationId: "b", schedule: "*/17 * * * * (Europe/Paris)" } });
    expect(rows.every(a => a.execution.permissionMode === "accept-edits")).toBe(true);
    projected.set("a", { ...projected.get("a")!, suppressed: true });
    const before = inputs.length; await make()(); expect(inputs.length).toBe(before + 1);
  } finally { db.close(); }
});
